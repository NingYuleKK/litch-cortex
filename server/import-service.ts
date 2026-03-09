/**
 * Import Service — V0.8
 *
 * Orchestrates ChatGPT conversations.json import with:
 *   - Streaming JSON parsing for large files (≥ 10MB via stream-json)
 *   - Small file fast path (< 10MB direct JSON.parse)
 *   - Three-level dedup: conversation → message → chunk (stableId)
 *   - In-memory progress tracking with DB fallback
 *   - Full attribution logging via import_logs table
 */
import { Readable } from "stream";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray";
import {
  isChatGPTConversation,
  parseConversation,
  type ChatGPTConversation,
  type ParsedConversation,
} from "./chatgpt-parser";
import { chunkConversation } from "./conversation-chunker";
import {
  createImportLog,
  updateImportLog,
  createConversation,
  getConversationByExternalId,
  updateConversation,
  insertConversationMessages,
  getExistingMessageIds,
  insertChunksWithStableId,
  deleteChunksByConversationAndStableIds,
  getChunksByConversation,
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
  buffer: Buffer;
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
const BATCH_SIZE = 50;

/**
 * Start a conversation import. Creates import_log immediately, returns importLogId.
 * The actual import runs asynchronously in the background.
 */
export async function importConversationsJson(params: ImportParams): Promise<number> {
  const { buffer, filename, projectId, cortexUserId } = params;

  // Create import_log record
  const importLogId = await createImportLog({
    cortexUserId,
    projectId,
    filename,
    fileSize: buffer.length,
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
    progress.errors.push(err instanceof Error ? err.message : String(err));
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
  const { buffer, projectId, cortexUserId } = params;

  let conversations: ChatGPTConversation[];

  // Phase 1: Parse JSON
  progress.phase = "parsing";
  if (buffer.length < SMALL_FILE_THRESHOLD) {
    // Small file: direct parse
    conversations = parseJsonDirect(buffer);
  } else {
    // Large file: streaming parse
    conversations = await parseJsonStream(buffer);
  }

  progress.conversationsTotal = conversations.length;

  // Phase 2: Import in batches
  progress.phase = "importing";

  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE);
    for (const raw of batch) {
      try {
        await importSingleConversation(raw, projectId, cortexUserId, importLogId, progress);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.errors.push(`Conversation ${raw.conversation_id}: ${msg}`);
        console.error(`[import-service] Error importing ${raw.conversation_id}:`, msg);
      }
      progress.conversationsProcessed++;
    }
  }

  // Phase 3: Finalize
  progress.phase = "finalizing";
  progress.status = "completed";
  await finalizeImport(importLogId, progress, startTime);

  // Keep progress in memory for 5 minutes after completion, then clean up
  setTimeout(() => {
    activeImports.delete(importLogId);
  }, 5 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════
// JSON Parsing
// ═══════════════════════════════════════════════════════════════════

function parseJsonDirect(buffer: Buffer): ChatGPTConversation[] {
  const raw = JSON.parse(buffer.toString("utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array of conversations");
  }
  return raw.filter((item: unknown) => {
    if (!isChatGPTConversation(item)) {
      console.warn("[import-service] Skipping invalid conversation object");
      return false;
    }
    return true;
  });
}

async function parseJsonStream(buffer: Buffer): Promise<ChatGPTConversation[]> {
  return new Promise((resolve, reject) => {
    const conversations: ChatGPTConversation[] = [];
    const readable = Readable.from(buffer);

    const pipeline = readable.pipe(parser()).pipe(streamArray());

    pipeline.on("data", ({ value }: { value: unknown }) => {
      if (isChatGPTConversation(value)) {
        conversations.push(value);
      }
    });

    pipeline.on("end", () => resolve(conversations));
    pipeline.on("error", (err: Error) => reject(err));
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
    // Check if conversation has been updated
    const existingUpdateTime = existing.updateTime?.getTime() ?? 0;
    const newUpdateTime = parsed.updateTime?.getTime() ?? 0;

    if (existingUpdateTime === newUpdateTime && existingUpdateTime > 0) {
      // No changes — skip entirely
      progress.conversationsSkipped++;
      return;
    }

    // Conversation updated — do incremental update
    await incrementalUpdateConversation(existing.id, parsed, progress);
    progress.conversationsUpdated++;
    return;
  }

  // New conversation — full import
  await fullImportConversation(parsed, projectId, cortexUserId, importLogId, progress);
  progress.conversationsImported++;
}

/**
 * Full import: create conversation record + messages + chunks.
 */
async function fullImportConversation(
  parsed: ParsedConversation,
  projectId: number,
  cortexUserId: number,
  importLogId: number,
  progress: ImportProgress,
): Promise<void> {
  // Create conversation record
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
    status: "done",
    rawMetadata: parsed.rawMetadata,
    importLogId,
  });

  // Insert messages
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
    );
    progress.messagesTotal += parsed.messages.length;
  }

  // Generate and insert chunks
  const chunks = chunkConversation(parsed.externalId, parsed.title, parsed.messages);
  if (chunks.length > 0) {
    const result = await insertChunksWithStableId(
      chunks.map((c) => ({
        conversationId,
        content: c.content,
        position: c.position,
        tokenCount: c.tokenCount,
        stableId: c.stableId,
      })),
    );
    progress.chunksCreated += result.inserted;
    progress.chunksSkipped += result.skipped;
  }
}

/**
 * Incremental update: diff messages by externalMessageId + contentHash,
 * then rebuild chunks for changed messages.
 */
async function incrementalUpdateConversation(
  conversationId: number,
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

  const needsRebuild = newMessages.length > 0 || changedMessages.length > 0;

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
    );
    progress.messagesTotal += newMessages.length;
  }

  // For changed messages, we'd need an update path.
  // For V0.8, we treat hash changes as needing chunk rebuild.
  // (Message content update is a future enhancement — for now we just rebuild chunks.)

  if (needsRebuild) {
    // Delete old chunks for this conversation and regenerate
    const oldChunks = await getChunksByConversation(conversationId);
    if (oldChunks.length > 0) {
      const oldStableIds = oldChunks
        .map((c) => c.stableId)
        .filter((id): id is string => id !== null);
      if (oldStableIds.length > 0) {
        await deleteChunksByConversationAndStableIds(oldStableIds);
      }
    }

    // Regenerate chunks from all messages (including new ones)
    const chunks = chunkConversation(parsed.externalId, parsed.title, parsed.messages);
    if (chunks.length > 0) {
      const result = await insertChunksWithStableId(
        chunks.map((c) => ({
          conversationId,
          content: c.content,
          position: c.position,
          tokenCount: c.tokenCount,
          stableId: c.stableId,
        })),
      );
      progress.chunksCreated += result.inserted;
      progress.chunksSkipped += result.skipped;
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
  });
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
      errors: progress.errors.length > 0 ? JSON.stringify(progress.errors) : null,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error(`[import-service] Failed to finalize import ${importLogId}:`, err);
  }
}
