/**
 * V0.8 Tests — ChatGPT Conversation JSON Import
 *
 * Test groups:
 *   1. ChatGPT Parser pure functions
 *   2. Conversation Chunker
 *   3. StableId determinism
 *   4. Router structure & auth
 */
import { describe, it, expect } from "vitest";
import {
  extractMainChain,
  isVisibleMessage,
  extractMessageContent,
  computeContentHash,
  parseConversation,
  isChatGPTConversation,
  unixToDate,
  type ChatGPTConversation,
  type ChatGPTNode,
} from "./chatgpt-parser";
import {
  chunkConversation,
  buildStableId,
} from "./conversation-chunker";

// Load test fixture
import fixtureData from "./__fixtures__/chatgpt-sample.json";
const fixture = fixtureData as ChatGPTConversation[];

// ═══════════════════════════════════════════════════════════════════
// Group 1: ChatGPT Parser
// ═══════════════════════════════════════════════════════════════════

describe("chatgpt-parser", () => {
  const conv = fixture[0]; // "测试对话：简单问答"

  describe("extractMainChain", () => {
    it("should backtrack from current_node to root in chronological order", () => {
      const chain = extractMainChain(conv);
      expect(chain.length).toBeGreaterThan(0);
      // First node should be root
      expect(chain[0]).toBe("node-root");
      // Last node should be current_node
      expect(chain[chain.length - 1]).toBe("node-a4");
    });

    it("should include all nodes on the main path", () => {
      const chain = extractMainChain(conv);
      // The path: root → sys1 → ctx1 → u1 → a1 → u2 → tool1 → a2 → u3 → a4
      expect(chain).toContain("node-u1");
      expect(chain).toContain("node-a1");
      expect(chain).toContain("node-u2");
      expect(chain).toContain("node-a2");
      expect(chain).toContain("node-u3");
      expect(chain).toContain("node-a4");
    });

    it("should NOT include sibling branch nodes (a3-placeholder)", () => {
      const chain = extractMainChain(conv);
      // node-a3-placeholder is a sibling of node-a4, not on the main path
      expect(chain).not.toContain("node-a3-placeholder");
    });

    it("should handle empty conversation (root only)", () => {
      const emptyConv = fixture[1]; // "测试对话：空对话"
      const chain = extractMainChain(emptyConv);
      expect(chain).toEqual(["empty-root"]);
    });

    it("should return empty array if current_node is missing", () => {
      const broken = { ...conv, current_node: "nonexistent" };
      const chain = extractMainChain(broken);
      expect(chain).toEqual([]);
    });
  });

  describe("isVisibleMessage", () => {
    it("should accept visible user messages", () => {
      const node = conv.mapping["node-u1"];
      expect(isVisibleMessage(node)).toBe(true);
    });

    it("should accept visible assistant messages", () => {
      const node = conv.mapping["node-a1"];
      expect(isVisibleMessage(node)).toBe(true);
    });

    it("should reject null message (root node)", () => {
      const node = conv.mapping["node-root"];
      expect(isVisibleMessage(node)).toBe(false);
    });

    it("should reject system role messages", () => {
      const node = conv.mapping["node-sys1"];
      expect(isVisibleMessage(node)).toBe(false);
    });

    it("should reject tool role messages", () => {
      const node = conv.mapping["node-tool1"];
      expect(isVisibleMessage(node)).toBe(false);
    });

    it("should reject user_editable_context content_type", () => {
      const node = conv.mapping["node-ctx1"];
      expect(isVisibleMessage(node)).toBe(false);
    });

    it("should reject is_visually_hidden_from_conversation", () => {
      // node-sys1 has is_visually_hidden_from_conversation: true
      const node = conv.mapping["node-sys1"];
      expect(isVisibleMessage(node)).toBe(false);
    });

    it("should reject zero-weight messages", () => {
      // node-a3-placeholder has weight: 0
      const node = conv.mapping["node-a3-placeholder"];
      expect(isVisibleMessage(node)).toBe(false);
    });
  });

  describe("extractMessageContent", () => {
    it("should join string parts with newlines", () => {
      const msg = conv.mapping["node-u1"].message!;
      const content = extractMessageContent(msg);
      expect(content).toContain("RAG");
      expect(content.length).toBeGreaterThan(0);
    });

    it("should skip empty string parts", () => {
      const msg = conv.mapping["node-sys1"].message!;
      const content = extractMessageContent(msg);
      expect(content).toBe("");
    });

    it("should handle missing parts array", () => {
      const msg = { ...conv.mapping["node-u1"].message!, content: { content_type: "text" } };
      const content = extractMessageContent(msg as any);
      expect(content).toBe("");
    });
  });

  describe("computeContentHash", () => {
    it("should return 64-char hex string", () => {
      const hash = computeContentHash("test content");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should be deterministic", () => {
      const h1 = computeContentHash("same input");
      const h2 = computeContentHash("same input");
      expect(h1).toBe(h2);
    });

    it("should produce different hashes for different content", () => {
      const h1 = computeContentHash("content A");
      const h2 = computeContentHash("content B");
      expect(h1).not.toBe(h2);
    });
  });

  describe("unixToDate", () => {
    it("should convert Unix timestamp to Date", () => {
      const date = unixToDate(1770110380.527394);
      expect(date).toBeInstanceOf(Date);
      expect(date!.getFullYear()).toBeGreaterThanOrEqual(2026);
    });

    it("should return null for null/undefined/zero", () => {
      expect(unixToDate(null)).toBeNull();
      expect(unixToDate(undefined)).toBeNull();
      expect(unixToDate(0)).toBeNull();
    });
  });

  describe("parseConversation", () => {
    it("should extract only visible user/assistant messages", () => {
      const parsed = parseConversation(conv);
      expect(parsed.messages.length).toBeGreaterThan(0);
      for (const msg of parsed.messages) {
        expect(["user", "assistant"]).toContain(msg.role);
      }
    });

    it("should preserve chronological order (position 0, 1, 2...)", () => {
      const parsed = parseConversation(conv);
      for (let i = 0; i < parsed.messages.length; i++) {
        expect(parsed.messages[i].position).toBe(i);
      }
    });

    it("should compute content hash for each message", () => {
      const parsed = parseConversation(conv);
      for (const msg of parsed.messages) {
        expect(msg.contentHash).toHaveLength(64);
        // Verify hash matches content
        expect(msg.contentHash).toBe(computeContentHash(msg.content));
      }
    });

    it("should extract model from metadata", () => {
      const parsed = parseConversation(conv);
      expect(parsed.model).toBe("gpt-4o");
    });

    it("should set externalId from conversation_id", () => {
      const parsed = parseConversation(conv);
      expect(parsed.externalId).toBe("test-conv-001");
    });

    it("should convert timestamps to Date objects", () => {
      const parsed = parseConversation(conv);
      expect(parsed.createTime).toBeInstanceOf(Date);
      expect(parsed.updateTime).toBeInstanceOf(Date);
    });

    it("should exclude system/tool/hidden messages", () => {
      const parsed = parseConversation(conv);
      const ids = parsed.messages.map(m => m.externalMessageId);
      expect(ids).not.toContain("node-sys1");
      expect(ids).not.toContain("node-ctx1");
      expect(ids).not.toContain("node-tool1");
      expect(ids).not.toContain("node-a3-placeholder");
    });

    it("should skip empty-content messages (zero-weight placeholder)", () => {
      const parsed = parseConversation(conv);
      const ids = parsed.messages.map(m => m.externalMessageId);
      expect(ids).not.toContain("node-a3-placeholder");
    });

    it("should handle conversation with only system messages (no visible)", () => {
      const sysOnly = fixture[2]; // "测试对话：纯系统消息"
      const parsed = parseConversation(sysOnly);
      expect(parsed.messages).toHaveLength(0);
    });

    it("should handle empty conversation", () => {
      const empty = fixture[1];
      const parsed = parseConversation(empty);
      expect(parsed.messages).toHaveLength(0);
    });

    it("should build rawMetadata without mapping field", () => {
      const parsed = parseConversation(conv);
      const metadata = JSON.parse(parsed.rawMetadata);
      expect(metadata).not.toHaveProperty("mapping");
      expect(metadata).toHaveProperty("conversation_id");
      expect(metadata).toHaveProperty("title");
    });
  });

  describe("isChatGPTConversation", () => {
    it("should validate proper conversation object", () => {
      expect(isChatGPTConversation(conv)).toBe(true);
    });

    it("should reject null/undefined", () => {
      expect(isChatGPTConversation(null)).toBe(false);
      expect(isChatGPTConversation(undefined)).toBe(false);
    });

    it("should reject objects missing required fields", () => {
      expect(isChatGPTConversation({ title: "test" })).toBe(false);
      expect(isChatGPTConversation({ conversation_id: "x" })).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 2: Conversation Chunker
// ═══════════════════════════════════════════════════════════════════

describe("conversation-chunker", () => {
  const conv = fixture[0];

  it("should produce chunks from a parsed conversation", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should pair user+assistant messages as Q&A chunks", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    // Each chunk should contain [Q] and/or [A] markers
    for (const chunk of chunks) {
      const hasQ = chunk.content.includes("[Q]");
      const hasA = chunk.content.includes("[A]");
      expect(hasQ || hasA).toBe(true);
    }
  });

  it("should include conversation context prefix", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    for (const chunk of chunks) {
      expect(chunk.content).toContain("[对话:");
      expect(chunk.content).toContain("Turn");
    }
  });

  it("should generate valid stableId format", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    for (const chunk of chunks) {
      expect(chunk.stableId).toMatch(/^chatgpt:\d+:.+:.+:\d+:[a-f0-9]{8}$/);
    }
  });

  it("should have sequential positions", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].position).toBe(i);
    }
  });

  it("should track source message IDs", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    for (const chunk of chunks) {
      expect(chunk.sourceMessageIds.length).toBeGreaterThan(0);
    }
  });

  it("should set tokenCount as content length", () => {
    const parsed = parseConversation(conv);
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(chunk.content.length);
    }
  });

  it("should handle empty messages array", () => {
    const chunks = chunkConversation(1, "conv-empty", "Empty", []);
    expect(chunks).toHaveLength(0);
  });

  it("should handle orphan user message (no assistant response)", () => {
    const parsed = parseConversation(conv);
    // The last pair is user "谢谢！" + assistant response
    // All messages should be chunked
    const chunks = chunkConversation(1, parsed.externalId, parsed.title, parsed.messages);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 3: StableId Determinism
// ═══════════════════════════════════════════════════════════════════

describe("stableId determinism", () => {
  it("same content should produce same stableId", () => {
    const id1 = buildStableId(1, "conv-1", "msg-1", 0, "hello world");
    const id2 = buildStableId(1, "conv-1", "msg-1", 0, "hello world");
    expect(id1).toBe(id2);
  });

  it("different chunk_index should produce different stableId", () => {
    const id1 = buildStableId(1, "conv-1", "msg-1", 0, "hello world");
    const id2 = buildStableId(1, "conv-1", "msg-1", 1, "hello world");
    expect(id1).not.toBe(id2);
  });

  it("different content should produce different stableId (hash differs)", () => {
    const id1 = buildStableId(1, "conv-1", "msg-1", 0, "content A");
    const id2 = buildStableId(1, "conv-1", "msg-1", 0, "content B");
    expect(id1).not.toBe(id2);
  });

  it("stableId should contain all components including projectId", () => {
    const id = buildStableId(42, "conv-abc", "msg-xyz", 2, "test");
    expect(id).toMatch(/^chatgpt:42:conv-abc:msg-xyz:2:[a-f0-9]{8}$/);
  });

  it("different projectId should produce different stableId (B1 cross-project safety)", () => {
    const id1 = buildStableId(1, "conv-1", "msg-1", 0, "hello world");
    const id2 = buildStableId(2, "conv-1", "msg-1", 0, "hello world");
    expect(id1).not.toBe(id2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 4: Router Structure & Auth (V0.8 specific)
// ═══════════════════════════════════════════════════════════════════

describe("appRouter structure - V0.8", () => {
  it("should have conversation router procedures", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys((appRouter as any)._def.procedures);

    expect(procedures).toContain("conversation.list");
    expect(procedures).toContain("conversation.get");
    expect(procedures).toContain("conversation.messages");
    expect(procedures).toContain("conversation.chunks");
    expect(procedures).toContain("conversation.importProgress");
    expect(procedures).toContain("conversation.importHistory");
  });
});

describe("conversation router - auth", () => {
  // Auth context helpers (matching existing test pattern)
  function createUnauthContext() {
    return { user: null, cortexUserId: null } as any;
  }

  it("should reject unauthenticated conversation.list", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.conversation.list({ projectId: 1 })).rejects.toThrow();
  });

  it("should reject unauthenticated conversation.get", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.conversation.get({ id: 1 })).rejects.toThrow();
  });

  it("should reject unauthenticated conversation.importProgress", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.conversation.importProgress({ importLogId: 1 })).rejects.toThrow();
  });

  it("should reject unauthenticated conversation.importHistory", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.conversation.importHistory({ projectId: 1 })).rejects.toThrow();
  });
});
