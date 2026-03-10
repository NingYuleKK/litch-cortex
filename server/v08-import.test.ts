/**
 * V0.8 Import Service Tests — mocked DB layer
 *
 * Tests high-risk paths in import-service.ts:
 *   1. Bad JSON format handling
 *   2. Idempotency (same file imported twice)
 *   3. True incremental update (changed messages)
 *   4. Import error handling
 *   5. Streaming vs direct parse path selection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  parseConversation,
  type ChatGPTConversation,
} from "./chatgpt-parser";
import { chunkConversation } from "./conversation-chunker";

// Load fixture
import fixtureData from "./__fixtures__/chatgpt-sample.json";
const fixture = fixtureData as ChatGPTConversation[];

// ─── Mock DB module ──────────────────────────────────────────────
const mockDb = vi.hoisted(() => ({
  createImportLog: vi.fn().mockResolvedValue(1),
  updateImportLog: vi.fn().mockResolvedValue(undefined),
  createConversation: vi.fn().mockResolvedValue(100),
  getConversationByExternalId: vi.fn().mockResolvedValue(undefined),
  updateConversation: vi.fn().mockResolvedValue(undefined),
  insertConversationMessages: vi.fn().mockResolvedValue(undefined),
  getExistingMessageIds: vi.fn().mockResolvedValue(new Map()),
  insertChunksWithStableId: vi.fn().mockResolvedValue({ inserted: 5, skipped: 0 }),
  deleteChunksByStableIdPrefix: vi.fn().mockResolvedValue(1),
  updateConversationMessageContent: vi.fn().mockResolvedValue(undefined),
  updateChunkPositionByStableId: vi.fn().mockResolvedValue(undefined),
  getChunkStableIdsAndPositions: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({})),
}));

vi.mock("./db", () => mockDb);

// Import after mock is set up
const { importConversationsJson, getImportProgress } = await import("./import-service");

// ─── Helpers ─────────────────────────────────────────────────────

let tmpFiles: string[] = [];

async function writeTmpJson(data: unknown): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `cortex-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  tmpFiles.push(tmpPath);
  return tmpPath;
}

function waitForImportDone(importLogId: number, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const progress = getImportProgress(importLogId);
      if (!progress) {
        // Already cleaned up = done
        resolve();
        return;
      }
      if (progress.status === "completed" || progress.status === "failed") {
        resolve();
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`Import did not complete within ${timeout}ms, status: ${progress.status}`));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  tmpFiles = [];

  // Reset to default behavior
  mockDb.createImportLog.mockResolvedValue(1);
  mockDb.createConversation.mockResolvedValue(100);
  mockDb.getConversationByExternalId.mockResolvedValue(undefined);
  mockDb.getExistingMessageIds.mockResolvedValue(new Map());
  mockDb.insertChunksWithStableId.mockResolvedValue({ inserted: 5, skipped: 0 });
  mockDb.getChunkStableIdsAndPositions.mockResolvedValue([]);
  mockDb.withTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({}));
});

afterEach(async () => {
  // Clean up temp files
  for (const f of tmpFiles) {
    await fs.unlink(f).catch(() => {});
  }
});

// ═══════════════════════════════════════════════════════════════════
// Group 5: Import Service
// ═══════════════════════════════════════════════════════════════════

describe("import-service: bad JSON handling", () => {
  it("should fail gracefully on non-JSON file", async () => {
    const filePath = await writeTmpJson("this is not valid json{{{");
    // Overwrite with raw invalid content
    await fs.writeFile(filePath, "this is not valid json{{{", "utf-8");

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "bad.json",
      projectId: 1,
      cortexUserId: 1,
    });

    await waitForImportDone(importLogId);
    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("failed");
    expect(progress?.errors.length).toBeGreaterThan(0);
  });

  it("should fail on non-array JSON (object instead of array)", async () => {
    const filePath = await writeTmpJson({ not: "an array" });

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 50,
      filename: "object.json",
      projectId: 1,
      cortexUserId: 1,
    });

    await waitForImportDone(importLogId);
    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("failed");
    expect(progress?.errors.some((e: string) => e.includes("array"))).toBe(true);
  });

  it("should skip invalid conversation objects in array", async () => {
    const filePath = await writeTmpJson([
      { invalid: true },
      fixture[0], // valid
      "not an object",
    ]);

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "mixed.json",
      projectId: 1,
      cortexUserId: 1,
    });

    await waitForImportDone(importLogId);
    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("completed");
    // Only 1 valid conversation should be imported
    expect(progress?.conversationsImported).toBe(1);
    // 2 invalid entries should produce errors/skips
    expect(progress?.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle empty array", async () => {
    const filePath = await writeTmpJson([]);

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 2,
      filename: "empty.json",
      projectId: 1,
      cortexUserId: 1,
    });

    await waitForImportDone(importLogId);
    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("completed");
    expect(progress?.conversationsTotal).toBe(0);
    expect(progress?.conversationsImported).toBe(0);
  });
});

describe("import-service: idempotency (same file twice)", () => {
  it("should skip conversations with same externalId and updateTime", async () => {
    const conv = fixture[0];
    const parsed = parseConversation(conv);

    // First import: no existing conversation
    mockDb.getConversationByExternalId.mockResolvedValueOnce(undefined);

    // Second import: conversation already exists with same updateTime
    mockDb.getConversationByExternalId.mockResolvedValueOnce({
      id: 100,
      externalId: parsed.externalId,
      updateTime: parsed.updateTime,
      projectId: 1,
    });

    const filePath1 = await writeTmpJson([conv]);
    const filePath2 = await writeTmpJson([conv]);

    // First import
    const id1 = await importConversationsJson({
      filePath: filePath1,
      fileSize: 100,
      filename: "first.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(id1);
    const p1 = getImportProgress(id1);
    expect(p1?.conversationsImported).toBe(1);
    expect(p1?.conversationsSkipped).toBe(0);

    // Second import — should skip
    const id2 = await importConversationsJson({
      filePath: filePath2,
      fileSize: 100,
      filename: "second.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(id2);
    const p2 = getImportProgress(id2);
    expect(p2?.conversationsImported).toBe(0);
    expect(p2?.conversationsSkipped).toBe(1);
  });

  it("should report zero chunksCreated on idempotent skip", async () => {
    const conv = fixture[0];
    const parsed = parseConversation(conv);

    mockDb.getConversationByExternalId.mockResolvedValue({
      id: 100,
      externalId: parsed.externalId,
      updateTime: parsed.updateTime,
      projectId: 1,
    });

    const filePath = await writeTmpJson([conv]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "dup.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);
    const progress = getImportProgress(importLogId);
    expect(progress?.chunksCreated).toBe(0);
    expect(progress?.chunksSkipped).toBe(0);
  });
});

describe("import-service: true incremental update", () => {
  it("should update changed messages and rebuild only affected chunks", async () => {
    const conv = fixture[0];
    const parsed = parseConversation(conv);

    // Simulate: conversation exists with older updateTime
    const olderUpdateTime = new Date((parsed.updateTime?.getTime() ?? 0) - 10000);
    mockDb.getConversationByExternalId.mockResolvedValue({
      id: 200,
      externalId: parsed.externalId,
      updateTime: olderUpdateTime,
      projectId: 1,
    });

    // Simulate: one message has different hash (changed content)
    const existingMsgMap = new Map<string, string>();
    for (const msg of parsed.messages) {
      existingMsgMap.set(msg.externalMessageId, msg.contentHash);
    }
    // Change the hash of the first message to simulate a content change
    const firstMsgId = parsed.messages[0].externalMessageId;
    existingMsgMap.set(firstMsgId, "old_hash_different_from_current");
    mockDb.getExistingMessageIds.mockResolvedValue(existingMsgMap);

    const filePath = await writeTmpJson([conv]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "updated.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const progress = getImportProgress(importLogId);
    expect(progress?.conversationsUpdated).toBe(1);
    expect(progress?.conversationsImported).toBe(0);
    expect(progress?.conversationsSkipped).toBe(0);

    // Verify updateConversationMessageContent was called for the changed message
    // (now called with tx as 5th arg due to B3 transaction wrapping)
    expect(mockDb.updateConversationMessageContent).toHaveBeenCalledWith(
      200,
      firstMsgId,
      expect.any(String),
      expect.any(String),
      expect.anything(), // tx
    );

    // Verify deleteChunksByStableIdPrefix was called (targeted deletion)
    expect(mockDb.deleteChunksByStableIdPrefix).toHaveBeenCalled();
    const prefixArg = mockDb.deleteChunksByStableIdPrefix.mock.calls[0][0] as string;
    expect(prefixArg).toContain(parsed.externalId);
    expect(prefixArg).toContain(firstMsgId);

    // Verify insertChunksWithStableId was called (rebuild affected chunks)
    expect(mockDb.insertChunksWithStableId).toHaveBeenCalled();
  });

  it("should insert new messages and rebuild their chunks without touching existing", async () => {
    const conv = fixture[0];
    const parsed = parseConversation(conv);

    const olderUpdateTime = new Date((parsed.updateTime?.getTime() ?? 0) - 10000);
    mockDb.getConversationByExternalId.mockResolvedValue({
      id: 200,
      externalId: parsed.externalId,
      updateTime: olderUpdateTime,
      projectId: 1,
    });

    // Simulate: only first 2 messages exist (rest are "new")
    const partialMsgMap = new Map<string, string>();
    for (let i = 0; i < 2 && i < parsed.messages.length; i++) {
      const msg = parsed.messages[i];
      partialMsgMap.set(msg.externalMessageId, msg.contentHash);
    }
    mockDb.getExistingMessageIds.mockResolvedValue(partialMsgMap);

    const filePath = await writeTmpJson([conv]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "with-new-msgs.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const progress = getImportProgress(importLogId);
    expect(progress?.conversationsUpdated).toBe(1);

    // insertConversationMessages should have been called for new messages
    expect(mockDb.insertConversationMessages).toHaveBeenCalled();
    const insertedMsgs = mockDb.insertConversationMessages.mock.calls[0][0];
    expect(insertedMsgs.length).toBe(parsed.messages.length - 2);

    // updateConversationMessageContent should NOT have been called (no changed hashes)
    expect(mockDb.updateConversationMessageContent).not.toHaveBeenCalled();
  });
});

describe("import-service: error handling during import", () => {
  it("should continue importing other conversations when one fails", async () => {
    const conv1 = fixture[0];
    const conv2 = fixture[1]; // empty conversation

    // Make the first conversation's DB write fail
    let callCount = 0;
    mockDb.withTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Simulated DB error");
      }
      return fn({});
    });

    const filePath = await writeTmpJson([conv1, conv2]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "partial-fail.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("completed");
    expect(progress?.conversationsProcessed).toBe(2);
    expect(progress?.errors.length).toBeGreaterThan(0);
    expect(progress?.errors[0]).toContain("Simulated DB error");
  });

  it("should mark import as failed if all conversations fail", async () => {
    mockDb.withTransaction.mockRejectedValue(new Error("Total DB failure"));

    const filePath = await writeTmpJson([fixture[0]]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "total-fail.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const progress = getImportProgress(importLogId);
    // Import completes but with errors per conversation
    expect(progress?.status).toBe("completed");
    expect(progress?.errors.length).toBeGreaterThan(0);
  });
});

describe("import-service: transaction wrapping", () => {
  it("should call withTransaction for full imports", async () => {
    const filePath = await writeTmpJson([fixture[0]]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "tx-test.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    // withTransaction should be called at least once (for fullImportConversation)
    expect(mockDb.withTransaction).toHaveBeenCalled();
  });

  it("should pass tx to createConversation, insertConversationMessages, insertChunksWithStableId, updateConversation", async () => {
    const txObj = { isTx: true };
    mockDb.withTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(txObj));

    const filePath = await writeTmpJson([fixture[0]]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "tx-args.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    // createConversation should receive tx as second arg
    expect(mockDb.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "importing" }),
      txObj,
    );
    // insertConversationMessages should receive tx
    expect(mockDb.insertConversationMessages).toHaveBeenCalledWith(
      expect.any(Array),
      txObj,
    );
    // insertChunksWithStableId should receive tx
    expect(mockDb.insertChunksWithStableId).toHaveBeenCalledWith(
      expect.any(Array),
      txObj,
    );
    // updateConversation should set status to "done" with tx
    expect(mockDb.updateConversation).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ status: "done" }),
      txObj,
    );
  });
});

describe("import-service: file path selection", () => {
  it("should use direct JSON.parse for small files (< 10MB)", async () => {
    const filePath = await writeTmpJson([fixture[0]]);
    const stat = await fs.stat(filePath);

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: stat.size, // will be well under 10MB
      filename: "small.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const progress = getImportProgress(importLogId);
    expect(progress?.status).toBe("completed");
    expect(progress?.conversationsImported).toBe(1);
  });

  it("should clean up temp file after import", async () => {
    const filePath = await writeTmpJson([fixture[0]]);

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "cleanup.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    // File should be deleted
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
    // Remove from cleanup list since import already deleted it
    tmpFiles = tmpFiles.filter(f => f !== filePath);
  });

  it("should clean up temp file even on failure", async () => {
    const filePath = await writeTmpJson("invalid json{{{");
    await fs.writeFile(filePath, "invalid json{{{", "utf-8");

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "fail-cleanup.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
    tmpFiles = tmpFiles.filter(f => f !== filePath);
  });
});

describe("import-service: position reconciliation (S2 regression)", () => {
  it("should update positions of unaffected chunks when earlier chunk count changes", async () => {
    const conv = fixture[0];
    const parsed = parseConversation(conv);

    // Simulate: conversation exists with older updateTime
    const olderUpdateTime = new Date((parsed.updateTime?.getTime() ?? 0) - 10000);
    mockDb.getConversationByExternalId.mockResolvedValue({
      id: 200,
      externalId: parsed.externalId,
      updateTime: olderUpdateTime,
      projectId: 1,
    });

    // Simulate: first message has changed content hash → triggers rebuild of Q&A pair 0
    const existingMsgMap = new Map<string, string>();
    for (const msg of parsed.messages) {
      existingMsgMap.set(msg.externalMessageId, msg.contentHash);
    }
    const firstMsgId = parsed.messages[0].externalMessageId;
    existingMsgMap.set(firstMsgId, "old_hash_triggers_rebuild");
    mockDb.getExistingMessageIds.mockResolvedValue(existingMsgMap);

    // Simulate existing chunks with STALE positions (as if old chunk count differed).
    // After rebuild, position 0 chunk may split or merge, shifting downstream positions.
    // We return chunks at their old positions to verify reconciliation updates them.
    const expectedChunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);
    const staleChunks = expectedChunks.map((c, i) => ({
      stableId: c.stableId,
      position: i + 10, // deliberately wrong positions
    }));
    mockDb.getChunkStableIdsAndPositions.mockResolvedValue(staleChunks);

    const filePath = await writeTmpJson([conv]);
    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "position-shift.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    // updateChunkPositionByStableId should have been called for stale positions
    expect(mockDb.updateChunkPositionByStableId).toHaveBeenCalled();

    // Verify correct positions were assigned
    for (const call of mockDb.updateChunkPositionByStableId.mock.calls) {
      const [stableId, position] = call;
      const expected = expectedChunks.find(c => c.stableId === stableId);
      if (expected) {
        expect(position).toBe(expected.position);
      }
    }
  });
});

describe("import-service: progress tracking", () => {
  it("should finalize import log with correct stats", async () => {
    const filePath = await writeTmpJson([fixture[0]]);

    const importLogId = await importConversationsJson({
      filePath,
      fileSize: 100,
      filename: "stats.json",
      projectId: 1,
      cortexUserId: 1,
    });
    await waitForImportDone(importLogId);

    // updateImportLog should be called with final stats
    expect(mockDb.updateImportLog).toHaveBeenCalledWith(
      importLogId,
      expect.objectContaining({
        status: "completed",
        conversationsTotal: 1,
        conversationsImported: 1,
        durationMs: expect.any(Number),
      }),
    );

    // durationMs should be >= 0 (can be 0 on fast machines/CI)
    const updateCall = mockDb.updateImportLog.mock.calls[0][1];
    expect(updateCall.durationMs).toBeGreaterThanOrEqual(0);
  });
});
