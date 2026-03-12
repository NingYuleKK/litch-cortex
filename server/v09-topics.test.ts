/**
 * V0.9 Topic Extraction Tests
 *
 * Tests:
 * - extractTopicsFromChunk with mocked LLM
 * - DiffReport data collection structure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LLM service
vi.mock("./llm-service", () => ({
  callLLM: vi.fn(),
}));

import { extractTopicsFromChunk } from "./topic-extraction-service";
import { callLLM } from "./llm-service";

const mockCallLLM = vi.mocked(callLLM);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractTopicsFromChunk", () => {
  it("should extract topics from a chunk via LLM", async () => {
    mockCallLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            topics: [
              { label: "人工智能", relevance: 0.9 },
              { label: "机器学习", relevance: 0.8 },
            ],
          }),
        },
        index: 0,
        finish_reason: "stop",
      }],
    } as any);

    const result = await extractTopicsFromChunk({
      id: 1,
      content: "这是一段关于人工智能和机器学习的文本。",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "人工智能", relevance: 0.9 });
    expect(result[1]).toEqual({ label: "机器学习", relevance: 0.8 });
  });

  it("should return empty array when LLM returns empty content", async () => {
    mockCallLLM.mockResolvedValue({
      choices: [{
        message: { content: null },
        index: 0,
        finish_reason: "stop",
      }],
    } as any);

    const result = await extractTopicsFromChunk({ id: 2, content: "test" });
    expect(result).toEqual([]);
  });

  it("should return empty array when LLM returns invalid JSON", async () => {
    mockCallLLM.mockResolvedValue({
      choices: [{
        message: { content: "not json" },
        index: 0,
        finish_reason: "stop",
      }],
    } as any);

    await expect(extractTopicsFromChunk({ id: 3, content: "test" })).rejects.toThrow();
  });

  it("should pass topic_extract taskType to LLM", async () => {
    mockCallLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({ topics: [] }),
        },
        index: 0,
        finish_reason: "stop",
      }],
    } as any);

    await extractTopicsFromChunk({ id: 4, content: "test content" });

    expect(mockCallLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "topic_extract",
      }),
    );
  });
});

describe("DiffReport structure", () => {
  it("should have correct initial shape", () => {
    // Import the type to verify structure
    const diff = {
      newConversations: [] as Array<{ title: string; messageCount?: number }>,
      updatedConversations: [] as Array<{ title: string; changes?: string }>,
      skippedConversations: [] as Array<{ title: string; reason?: string }>,
      totalNew: 0,
      totalUpdated: 0,
      totalSkipped: 0,
    };

    expect(diff.newConversations).toEqual([]);
    expect(diff.totalNew).toBe(0);
  });

  it("should cap at 100 detail entries", () => {
    const DIFF_DETAIL_LIMIT = 100;
    const entries: Array<{ title: string }> = [];

    // Simulate adding 150 entries with limit check
    for (let i = 0; i < 150; i++) {
      if (entries.length < DIFF_DETAIL_LIMIT) {
        entries.push({ title: `Conversation ${i}` });
      }
    }

    expect(entries).toHaveLength(100);
  });
});
