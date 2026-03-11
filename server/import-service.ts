/**
 * Import Service — V0.8
 *
 * Orchestrates ChatGPT conversations.json import with:
 *   - True streaming: reads from disk file, processes each conversation as it's parsed
 *   - Small file fast path (< 10MB direct JSON.parse for simplicity)
 *   - Three-level dedup: conversation → message → chunk (stableId)
 *   - In-memory progress tracking with DB fallback
 *   - Full attribution logging via import_logs table
 */
import { createReadStream } from "fs";
import fs from "fs/promises";
import StreamJsonPkg from "stream-json";
import StreamArrayPkg from "stream-json/streamers/StreamArray.js";
const { parser } = StreamJsonPkg;
const { streamArray } = StreamArrayPkg;
import {
  isChatGPTConversation,
  parseConversation,
  type ChatGPTConversation,
  type ParsedConversation,
} from "./chatgpt-parser";
import {
  chunkConversation,
  groupIntoQAPairs,
  formatQAPair,
  buildStableId,
} from "./conversation-chunker";
import { chunkText } from "./uploadRoute";

/** Truncate a single error message to avoid blowing up the DB column */
function truncateError(msg: string, maxLen = 500): string {
  if (msg.length <= maxLen) return msg;
  return msg.slice(0, maxLen) + `… [truncated, ${msg.length} chars total]`;
}
import {
  createImportLog,
  updateImportLog,
  createConversation,
  getConversationByExternalId,
  updateConversation,
  insertConversationMessages,
  getExistingMessageIds,
  insertChunksWithStableId,
  deleteChunksByStableIdPrefix,
  updateConversationMessageContent,
  updateChunkPositionByStableId,
  getChunkStableIdsAndPositions,
  withTransaction,
} from "./db";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ImportProgress {
  importLogId: number;
  status: "running" | "completed" | "failed" | "cancelled";
  phase: "parsing" | "importing" | "finalizing";
  conversationsTotal: number;
  conversationsProcessed: number;
  conversationsImported: number;
  conversationsSkipped: number;
  conversationsUpdated: number;
  messagesTotal: number;
  chunksCreated: number;
  chunksSkipped: number;
  errors: string[];
}

export interface ImportParams {
  filePath: string;       // path to temp file on disk
  fileSize: number;       // file size in bytes
  filename: string;
  projectId: number;
  cortexUserId: number;
}

// ═══════════════════════════════════════════════════════════════════
// In-memory progress store
// ═══════════════════════════════════════════════════════════════════

const activeImports = new Map<number, ImportProgress>();

export function getImportProgress(importLogId: number): ImportProgress | undefined {
  return activeImports.get(importLogId);
}

// ═══════════════════════════════════════════════════════════════════
// Core import flow
// ═══════════════════════════════════════════════════════════════════

const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

/**
 * Start a conversation import. Creates import_log immediately, returns importLogId.
 * The actual import runs asynchronously in the background.
 */
export async function importConversationsJson(params: ImportParams): Promise<number> {
  const { fileSize, filename, projectId, cortexUserId } = params;

  // Create import_log record
  const importLogId = await createImportLog({
    cortexUserId,
    projectId,
    filename,
    fileSize,
    status: "running",
  });

  // Initialize in-memory progress
  const progress: ImportProgress = {
    importLogId,
    status: "running",
    phase: "parsing",
    conversationsTotal: 0,
    conversationsProcessed: 0,
    conversationsImported: 0,
    conversationsSkipped: 0,
    conversationsUpdated: 0,
    messagesTotal: 0,
    chunksCreated: 0,
    chunksSkipped: 0,
    errors: [],
  };
  activeImports.set(importLogId, progress);

  const startTime = Date.now();

  // Run async — don't await
  runImport(params, importLogId, progress, startTime).catch((err) => {
    console.error(`[import-service] Fatal error in import ${importLogId}:`, err);
    progress.status = "failed";
    progress.errors.push(truncateError(err instanceof Error ? err.message : String(err)));
    finalizeImport(importLogId, progress, startTime).catch(() => {});
  });

  return importLogId;
}

/**
 * Internal: run the actual import pipeline.
 */
async function runImport(
  params: ImportParams,
  importLogId: number,
  progress: ImportProgress,
  startTime: number,
): Promise<void> {
  const { filePath, fileSize, projectId, cortexUserId } = params;

  try {
    progress.phase = "importing";

    if (fileSize < SMALL_FILE_THRESHOLD) {
      // Small file: read from disk, JSON.parse, process sequentially
      await importSmallFile(filePath, projectId, cortexUserId, importLogId, progress);
    } else {
      // Large file: stream from disk, process each conversation as it arrives
      await importLargeFileStreaming(filePath, projectId, cortexUserId, importLogId, progress);
    }

    // Finalize
    progress.phase = "finalizing";
    progress.status = "completed";
    await finalizeImport(importLogId, progress, startTime);
  } finally {
    // Always clean up temp file
    await fs.unlink(filePath).catch(() => {});

    // Keep progress in memory for 5 minutes after completion, then clean up
    setTimeout(() => {
      activeImports.delete(importLogId);
    }, 5 * 60 * 1000);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Small file path (< 10MB)
// ═══════════════════════════════════════════════════════════════════

async function importSmallFile(
  filePath: string,
  projectId: number,
  cortexUserId: number,
  importLogId: number,
  progress: ImportProgress,
): Promise<void> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array of conversations");
  }

  progress.conversationsTotal = raw.length;

  for (const item of raw) {
    if (!isChatGPTConversation(item)) {
      progress.errors.push("Skipping invalid conversation object");
      progress.conversationsProcessed++;
      continue;
    }
    try {
      await importSingleConversation(item, projectId, cortexUserId, importLogId, progress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      progress.errors.push(truncateError(`Conversation ${item.conversation_id}: ${msg}`));
      console.error(`[import-service] Error importing ${item.conversation_id}:`, msg);
    }
    progress.conversationsProcessed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Large file streaming path (≥ 10MB)
// ═══════════════════════════════════════════════════════════════════

async function importLargeFileStreaming(
  filePath: string,
  projectId: number,
  cortexUserId: number,
  importLogId: number,
  progress: ImportProgress,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readable = createReadStream(filePath, { encoding: "utf-8" });
    const pipeline = readable.pipe(parser()).pipe(streamArray());

    // Process each conversation as it arrives from the stream
    // Use a queue to ensure sequential processing (stream emits faster than DB writes)
    let processing = Promise.resolve();
    let totalSeen = 0;

    pipeline.on("data", ({ value }: { value: unknown }) => {
      totalSeen++;
      progress.conversationsTotal = totalSeen;

      if (!isChatGPTConversation(value)) {
        progress.errors.push("Skipping invalid conversation object");
        progress.conversationsProcessed++;
        return;
      }

      const conv = value;

      // Backpressure: pause stream while DB is processing (S3 fix)
      pipeline.pause();

      processing = processing.then(async () => {
        try {
          await importSingleConversation(conv, projectId, cortexUserId, importLogId, progress);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          progress.errors.push(truncateError(`Conversation ${conv.conversation_id}: ${msg}`));
          console.error(`[import-service] Error importing ${conv.conversation_id}:`, msg);
        }
        progress.conversationsProcessed++;
        // Resume stream after processing is done
        pipeline.resume();
      });
    });

    pipeline.on("end", () => {
      // Wait for all queued processing to finish
      processing.then(resolve).catch(reject);
    });

    pipeline.on("error", (err: Error) => {
      processing.then(() => reject(err)).catch(reject);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// Single conversation import (three-level dedup)
// ═══════════════════════════════════════════════════════════════════

async function importSingleConversation(
  raw: ChatGPTConversation,
  projectId: number,
  cortexUserId: number,
  importLogId: number,
  progress: ImportProgress,
): Promise<void> {
  // Parse the raw conversation
  const parsed = parseConversation(raw);

  // Level 1: Conversation-level dedup
  const existing = await getConversationByExternalId(projectId, parsed.externalId);

  if (existing) {
    // S2: Skip conversations still being imported (concurrent import protection)
    if (existing.status === "importing") {
      progress.conversationsSkipped++;
      progress.errors.push(`Conversation ${parsed.externalId}: skipped (still importing)`);
      return;
    }

    // Check if conversation has been updated
    const existingUpdateTime = existing.updateTime?.getTime() ?? 0;
    const newUpdateTime = parsed.updateTime?.getTime() ?? 0;

    if (existingUpdateTime === newUpdateTime && existingUpdateTime > 0) {
      // No changes — skip entirely
      progress.conversationsSkipped++;
      return;
    }

    // Conversation updated — do incremental update
    await incrementalUpdateConversation(existing.id, projectId, parsed, progress);
    progress.conversationsUpdated++;
    return;
  }

  // New conversation — full import
  await fullImportConversation(parsed, projectId, cortexUserId, importLogId, progress);
  progress.conversationsImported++;
}

/**
 * Full import: create conversation record + messages + chunks.
 * All writes are wrapped in a transaction — rollback on any failure.
 * Conversation starts as "importing" and is updated to "done" at the end.
 */
async function fullImportConversation(
  parsed: ParsedConversation,
  projectId: number,
  cortexUserId: number,
  importLogId: number,
  progress: ImportProgress,
): Promise<void> {
  const result = await withTransaction(async (tx) => {
    // Create conversation record with "importing" status
    const conversationId = await createConversation({
      projectId,
      cortexUserId,
      externalId: parsed.externalId,
      title: parsed.title,
      source: "chatgpt",
      model: parsed.model,
      messageCount: parsed.messages.length,
      createTime: parsed.createTime,
      updateTime: parsed.updateTime,
      status: "importing",
      rawMetadata: parsed.rawMetadata,
      importLogId,
    }, tx);

    // Insert messages
    let messagesInserted = 0;
    if (parsed.messages.length > 0) {
      await insertConversationMessages(
        parsed.messages.map((m) => ({
          conversationId,
          externalMessageId: m.externalMessageId,
          role: m.role,
          content: m.content,
          contentHash: m.contentHash,
          position: m.position,
          modelSlug: m.modelSlug,
          createTime: m.createTime,
        })),
        tx,
      );
      messagesInserted = parsed.messages.length;
    }

    // Generate and insert chunks
    const chunks = chunkConversation(projectId, parsed.externalId, parsed.title, parsed.messages);
    let chunksInserted = 0;
    let chunksSkippedCount = 0;
    if (chunks.length > 0) {
      const chunkResult = await insertChunksWithStableId(
        chunks.map((c) => ({
          conversationId,
          content: c.content,
          position: c.position,
          tokenCount: c.tokenCount,
          stableId: c.stableId,
        })),
        tx,
      );
      chunksInserted = chunkResult.inserted;
      chunksSkippedCount = chunkResult.skipped;
    }

    // Mark conversation as done (within same transaction)
    await updateConversation(conversationId, { status: "done" }, tx);

    return { messagesInserted, chunksInserted, chunksSkippedCount };
  });

  // Update progress counters after successful commit
  progress.messagesTotal += result.messagesInserted;
  progress.chunksCreated += result.chunksInserted;
  progress.chunksSkipped += result.chunksSkippedCount;
}

/**
 * Incremental update: diff messages by externalMessageId + contentHash,
 * update changed messages, rebuild only affected chunks with correct positions.
 * Entire operation is wrapped in a transaction (B3 fix).
 */
async function incrementalUpdateConversation(
  conversationId: number,
  projectId: number,
  parsed: ParsedConversation,
  progress: ImportProgress,
): Promise<void> {
  // Get existing messages as Map<externalMessageId, contentHash>
  const existingMap = await getExistingMessageIds(conversationId);

  // Diff: find new and changed messages
  const newMessages = parsed.messages.filter(
    (m) => !existingMap.has(m.externalMessageId),
  );
  const changedMessages = parsed.messages.filter((m) => {
    const existingHash = existingMap.get(m.externalMessageId);
    return existingHash !== undefined && existingHash !== m.contentHash;
  });

  // Build set of affected message IDs (new + changed)
  const affectedMsgIds = new Set<string>([
    ...newMessages.map((m) => m.externalMessageId),
    ...changedMessages.map((m) => m.externalMessageId),
  ]);

  const result = await withTransaction(async (tx) => {
    let messagesInserted = 0;

    // Insert new messages
    if (newMessages.length > 0) {
      await insertConversationMessages(
        newMessages.map((m) => ({
          conversationId,
          externalMessageId: m.externalMessageId,
          role: m.role,
          content: m.content,
          contentHash: m.contentHash,
          position: m.position,
          modelSlug: m.modelSlug,
          createTime: m.createTime,
        })),
        tx,
      );
      messagesInserted = newMessages.length;
    }

    // Update changed messages in DB (write back new content + hash)
    for (const msg of changedMessages) {
      await updateConversationMessageContent(
        conversationId,
        msg.externalMessageId,
        msg.content,
        msg.contentHash,
        tx,
      );
    }

    let chunksInserted = 0;
    let chunksSkippedCount = 0;

    if (affectedMsgIds.size > 0) {
      // Compute the full expected chunk list to get correct positions (B2 fix).
      // This is a pure function — no DB involved.
      const fullExpectedChunks = chunkConversation(
        projectId,
        parsed.externalId,
        parsed.title,
        parsed.messages,
      );
      // Build a map: stableId → expected position
      const expectedPositionMap = new Map<string, number>();
      for (const c of fullExpectedChunks) {
        expectedPositionMap.set(c.stableId, c.position);
      }

      // Regroup ALL messages into Q&A pairs to find affected pairs
      const pairs = groupIntoQAPairs(parsed.messages);
      const affectedPairs = pairs.filter((pair) => {
        if (pair.user && affectedMsgIds.has(pair.user.externalMessageId)) return true;
        if (pair.assistant && affectedMsgIds.has(pair.assistant.externalMessageId)) return true;
        return false;
      });

      // For each affected pair: delete old chunks by stableId prefix, then regenerate
      for (const pair of affectedPairs) {
        const primaryMsgId = pair.user?.externalMessageId || pair.assistant?.externalMessageId || "unknown";
        const prefix = `chatgpt:${projectId}:${parsed.externalId}:${primaryMsgId}:`;
        await deleteChunksByStableIdPrefix(prefix, tx);

        // Re-chunk this single pair
        const formatted = formatQAPair(pair);
        const titlePrefix = `[对话: ${parsed.title} | Turn ${pair.turnIndex + 1}]\n\n`;

        const maxSize = 800;
        const minSize = 500;

        if (formatted.length <= maxSize) {
          const content = titlePrefix + formatted;
          const stableId = buildStableId(projectId, parsed.externalId, primaryMsgId, 0, content);
          const position = expectedPositionMap.get(stableId) ?? 0;
          const chunkResult = await insertChunksWithStableId([{
            conversationId,
            content,
            position,
            tokenCount: content.length,
            stableId,
          }], tx);
          chunksInserted += chunkResult.inserted;
          chunksSkippedCount += chunkResult.skipped;
        } else {
          const subChunks = chunkText(formatted, minSize, maxSize);
          const chunkData = subChunks.map((sub, ci) => {
            const content = titlePrefix + sub;
            const stableId = buildStableId(projectId, parsed.externalId, primaryMsgId, ci, content);
            const position = expectedPositionMap.get(stableId) ?? ci;
            return {
              conversationId,
              content,
              position,
              tokenCount: content.length,
              stableId,
            };
          });
          const chunkResult = await insertChunksWithStableId(chunkData, tx);
          chunksInserted += chunkResult.inserted;
          chunksSkippedCount += chunkResult.skipped;
        }
      }

      // Reconcile positions for ALL chunks (including unaffected ones).
      // When chunk count changes for an earlier pair, subsequent chunks'
      // positions shift. Update any that don't match the expected position.
      const existingChunks = await getChunkStableIdsAndPositions(conversationId, tx);
      for (const chunk of existingChunks) {
        if (!chunk.stableId) continue;
        const expectedPos = expectedPositionMap.get(chunk.stableId);
        if (expectedPos !== undefined && expectedPos !== chunk.position) {
          await updateChunkPositionByStableId(chunk.stableId, expectedPos, tx);
        }
      }
    }

    // Update conversation metadata
    await updateConversation(conversationId, {
      title: parsed.title,
      model: parsed.model,
      messageCount: parsed.messages.length,
      updateTime: parsed.updateTime,
      rawMetadata: parsed.rawMetadata,
      status: "done",
    }, tx);

    return { messagesInserted, chunksInserted, chunksSkippedCount };
  });

  // Update progress counters after successful commit
  progress.messagesTotal += result.messagesInserted;
  progress.chunksCreated += result.chunksInserted;
  progress.chunksSkipped += result.chunksSkippedCount;
}

// ═══════════════════════════════════════════════════════════════════
// Finalize
// ═══════════════════════════════════════════════════════════════════

async function finalizeImport(
  importLogId: number,
  progress: ImportProgress,
  startTime: number,
): Promise<void> {
  try {
    await updateImportLog(importLogId, {
      status: progress.status === "completed" ? "completed" : "failed",
      conversationsTotal: progress.conversationsTotal,
      conversationsImported: progress.conversationsImported,
      conversationsSkipped: progress.conversationsSkipped,
      conversationsUpdated: progress.conversationsUpdated,
      messagesTotal: progress.messagesTotal,
      chunksCreated: progress.chunksCreated,
      chunksSkipped: progress.chunksSkipped,
      errors: progress.errors.length > 0
        ? JSON.stringify(progress.errors).slice(0, 4 * 1024 * 1024) // cap at 4MB (MEDIUMTEXT = 16MB)
        : null,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error(`[import-service] Failed to finalize import ${importLogId}:`, err);
  }
}
