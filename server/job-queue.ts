/**
 * Job Queue — V0.9
 *
 * DB-backed, in-process job scheduler. No external dependencies (no Redis/BullMQ).
 * Single worker: only 1 job runs at a time (single Node.js process constraint).
 * Scheduler polls every 5 seconds for pending jobs.
 * Crash recovery: on startup, resets any "running" jobs back to "pending".
 */

import {
  createJob,
  getJobById,
  updateJob,
  claimNextPendingJob,
  getActiveJobByTypeAndProject,
  resetRunningJobs,
  getChunksWithoutEmbeddingV2Limited,
  getEmbeddingCountByProjectV2,
  insertChunkEmbeddingsBatch,
  getChunksWithoutTopicsByProject,
  getChunksByProjectCountV2,
  deleteChunkTopicsByChunkId,
  findOrCreateTopic,
  linkChunkToTopic,
  withTransaction,
} from "./db";
import { generateEmbeddingsBatch } from "./embedding-service";
import type { Job } from "../drizzle/schema";

// ─── Types ─────────────────────────────────────────────────────────

export type JobType = "embedding_generation" | "topic_extraction";

export interface JobProgress {
  id: number;
  type: string;
  status: string;
  projectId: number;
  totalItems: number;
  processedItems: number;
  percentage: number;
  lastError: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Submit a new job. Returns job ID.
 * Checks for duplicate active jobs of the same type+project (S1).
 */
export async function submitJob(
  projectId: number,
  type: JobType,
  params?: Record<string, unknown>,
): Promise<{ jobId: number; deduplicated: boolean }> {
  // S1: Dedup — check for existing active job
  const existing = await getActiveJobByTypeAndProject(type, projectId);
  if (existing) {
    return { jobId: existing.id, deduplicated: true };
  }

  // Compute totalItems
  let totalItems = 0;
  if (type === "embedding_generation") {
    const counts = await getEmbeddingCountByProjectV2(projectId);
    totalItems = counts.total - counts.withEmbedding;
  } else if (type === "topic_extraction") {
    totalItems = await getChunksByProjectCountV2(projectId);
  }

  const jobId = await createJob({
    projectId,
    type,
    status: "pending",
    totalItems,
    processedItems: 0,
    attempts: 0,
    maxAttempts: 3,
    params: params ? JSON.stringify(params) : null,
  });

  return { jobId, deduplicated: false };
}

/**
 * Get job progress in a frontend-friendly format.
 */
export async function getJobProgress(jobId: number): Promise<JobProgress | null> {
  const job = await getJobById(jobId);
  if (!job) return null;
  return formatJobProgress(job);
}

/**
 * Cancel a job. Only works for pending/running jobs.
 */
export async function cancelJob(jobId: number): Promise<boolean> {
  const job = await getJobById(jobId);
  if (!job) return false;
  if (job.status !== "pending" && job.status !== "running") return false;
  await updateJob(jobId, { status: "cancelled" });
  return true;
}

/**
 * Retry a failed job by creating a new one with the same params.
 */
export async function retryJob(jobId: number): Promise<number | null> {
  const job = await getJobById(jobId);
  if (!job || job.status !== "failed") return null;

  const result = await submitJob(
    job.projectId,
    job.type as JobType,
    job.params ? JSON.parse(job.params) : undefined,
  );
  return result.jobId;
}

// ─── Scheduler ─────────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/**
 * Start the job scheduler. Call once at app startup.
 */
export async function startJobScheduler(): Promise<void> {
  // Crash recovery: reset any jobs stuck in "running"
  const resetCount = await resetRunningJobs();
  if (resetCount > 0) {
    console.log(`[JobQueue] Crash recovery: reset ${resetCount} running job(s) to pending`);
  }

  // Poll every 5 seconds
  schedulerInterval = setInterval(async () => {
    if (isProcessing) return; // Single worker: skip if already processing

    try {
      isProcessing = true;
      await processNextJob();
    } catch (err) {
      console.error("[JobQueue] Scheduler error:", err);
    } finally {
      isProcessing = false;
    }
  }, 5000);

  console.log("[JobQueue] Scheduler started (5s interval)");
}

/**
 * Stop the job scheduler. Call at app shutdown.
 */
export function stopJobScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[JobQueue] Scheduler stopped");
  }
}

// ─── Job Processing ────────────────────────────────────────────────

async function processNextJob(): Promise<void> {
  const job = await claimNextPendingJob();
  if (!job) return;

  console.log(`[JobQueue] Processing job #${job.id} (${job.type}) for project ${job.projectId}`);

  try {
    switch (job.type) {
      case "embedding_generation":
        await runEmbeddingJob(job);
        break;
      case "topic_extraction":
        await runTopicExtractionJob(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    // P1-3: Re-check status before marking completed — job may have been cancelled mid-run
    const afterRun = await getJobById(job.id);
    if (afterRun && afterRun.status === "cancelled") {
      console.log(`[JobQueue] Job #${job.id} was cancelled during execution, skipping completed update`);
      return;
    }

    // Mark completed
    await updateJob(job.id, {
      status: "completed",
      completedAt: new Date(),
    });
    console.log(`[JobQueue] Job #${job.id} completed`);
  } catch (err: any) {
    console.error(`[JobQueue] Job #${job.id} failed:`, err.message);

    // P1-1 fix: claimNextPendingJob already incremented attempts in DB,
    // so re-read the current value instead of adding +1 again.
    const current = await getJobById(job.id);
    const attempts = current?.attempts ?? job.attempts ?? 1;
    if (attempts < (job.maxAttempts || 3)) {
      // Auto-retry: set back to pending
      await updateJob(job.id, {
        status: "pending",
        lastError: err.message,
      });
      console.log(`[JobQueue] Job #${job.id} will retry (attempt ${attempts}/${job.maxAttempts})`);
    } else {
      // Max retries reached: mark as failed
      await updateJob(job.id, {
        status: "failed",
        lastError: err.message,
        completedAt: new Date(),
      });
      console.log(`[JobQueue] Job #${job.id} permanently failed after ${attempts} attempts`);
    }
  }
}

// ─── Embedding Generation Handler ──────────────────────────────────

async function runEmbeddingJob(job: Job): Promise<void> {
  const projectId = job.projectId;
  const batchSize = 200;
  let totalProcessed = job.processedItems || 0;

  while (true) {
    // Check cancellation
    const current = await getJobById(job.id);
    if (!current || current.status === "cancelled") {
      console.log(`[JobQueue] Embedding job #${job.id} cancelled`);
      return;
    }

    // Get next batch of un-embedded chunks
    const chunksToEmbed = await getChunksWithoutEmbeddingV2Limited(projectId, batchSize);
    if (chunksToEmbed.length === 0) break;

    // Generate embeddings
    const texts = chunksToEmbed.map((c) => {
      const t = c.content || "";
      return t.length > 8000 ? t.slice(0, 8000) : t;
    });

    const results = await generateEmbeddingsBatch(texts);

    // Write to DB
    const embeddingData = results.map((r, idx) => ({
      chunkId: chunksToEmbed[idx].id,
      embedding: JSON.stringify(r.embedding),
      model: r.model,
      dimensions: r.dimensions,
    }));
    await insertChunkEmbeddingsBatch(embeddingData);

    totalProcessed += results.length;

    // Update progress
    await updateJob(job.id, { processedItems: totalProcessed });
  }

  // Final count update
  const counts = await getEmbeddingCountByProjectV2(projectId);
  await updateJob(job.id, {
    processedItems: counts.withEmbedding,
    totalItems: counts.total,
    result: JSON.stringify({
      embedded: counts.withEmbedding,
      total: counts.total,
    }),
  });
}

// ─── Topic Extraction Handler ──────────────────────────────────────

/**
 * Dynamically imports topic-extraction-service to avoid circular dependency.
 */
async function runTopicExtractionJob(job: Job): Promise<void> {
  const { extractTopicsFromChunk } = await import("./topic-extraction-service");
  const projectId = job.projectId;
  let totalProcessed = job.processedItems || 0;
  const errors: string[] = [];

  // Get all chunks for the project that need topic extraction
  // We process in batches to avoid loading everything at once
  const batchSize = 200;

  while (true) {
    // Check cancellation
    const current = await getJobById(job.id);
    if (!current || current.status === "cancelled") {
      console.log(`[JobQueue] Topic extraction job #${job.id} cancelled`);
      break;
    }

    const chunksToProcess = await getChunksWithoutTopicsByProject(projectId, batchSize);
    if (chunksToProcess.length === 0) break;

    // Process each chunk serially (S7: serial LLM calls, single failure catch + continue)
    for (const chunk of chunksToProcess) {
      // Check cancellation between chunks
      const check = await getJobById(job.id);
      if (!check || check.status === "cancelled") break;

      try {
        // P1-2: LLM call OUTSIDE transaction to avoid long-running tx
        const extractedTopics = await extractTopicsFromChunk(chunk);

        // M2: Delete + rewrite inside a per-chunk transaction for atomicity
        await withTransaction(async (tx) => {
          await deleteChunkTopicsByChunkId(chunk.id, tx);
          for (const t of extractedTopics) {
            const topicId = await findOrCreateTopic(t.label, tx);
            await linkChunkToTopic(chunk.id, topicId, t.relevance, tx);
          }
        });
      } catch (err: any) {
        // S7: single failure doesn't stop the job
        errors.push(`Chunk ${chunk.id}: ${err.message}`);
      }

      totalProcessed++;

      // Update progress every chunk
      if (totalProcessed % 10 === 0 || totalProcessed === 1) {
        await updateJob(job.id, { processedItems: totalProcessed });
      }
    }
  }

  // Final update
  await updateJob(job.id, {
    processedItems: totalProcessed,
    result: JSON.stringify({
      processed: totalProcessed,
      errors: errors.length > 0 ? errors.slice(0, 50) : [], // cap error list
    }),
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatJobProgress(job: Job): JobProgress {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    projectId: job.projectId,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    percentage: job.totalItems > 0
      ? Math.round((job.processedItems / job.totalItems) * 100)
      : 0,
    lastError: job.lastError,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}
