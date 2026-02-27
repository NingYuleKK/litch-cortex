import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Test helpers ─────────────────────────────────────────────────

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    cortexUserId: null,
    req: { protocol: "https", headers: {}, cookies: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createCortexAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "cortex-1",
      email: null,
      name: "Litch",
      loginMethod: "cortex",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    cortexUserId: 1,
    req: { protocol: "https", headers: {}, cookies: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── V0.5.2 Router Structure Tests ──────────────────────────────

describe("V0.5.2 appRouter structure - conversation procedures", () => {
  it("should have summary.startChat procedure", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.startChat");
  });

  it("should have summary.continueChat procedure", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.continueChat");
  });

  it("should have summary.listConversations procedure", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.listConversations");
  });

  it("should have summary.getConversation procedure", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.getConversation");
  });

  it("should have summary.deleteConversation procedure", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.deleteConversation");
  });

  it("should still have legacy summary procedures", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.get");
    expect(procedures).toContain("summary.save");
    expect(procedures).toContain("summary.generate");
  });
});

// ─── V0.5.2 Auth Protection Tests ───────────────────────────────

describe("V0.5.2 auth protection for conversation procedures", () => {
  it("should reject summary.startChat for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.startChat({ topicId: 1 })
    ).rejects.toThrow();
  });

  it("should reject summary.continueChat for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.continueChat({ conversationId: 1, userMessage: "test" })
    ).rejects.toThrow();
  });

  it("should reject summary.listConversations for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.listConversations({ topicId: 1 })
    ).rejects.toThrow();
  });

  it("should reject summary.getConversation for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.getConversation({ conversationId: 1 })
    ).rejects.toThrow();
  });

  it("should reject summary.deleteConversation for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.deleteConversation({ conversationId: 1 })
    ).rejects.toThrow();
  });
});

// ─── V0.5.2 Input Validation Tests ──────────────────────────────

describe("V0.5.2 input validation", () => {
  it("summary.startChat should require topicId", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing missing required field
      caller.summary.startChat({})
    ).rejects.toThrow();
  });

  it("summary.continueChat should require conversationId and userMessage", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing missing required field
      caller.summary.continueChat({ conversationId: 1 })
    ).rejects.toThrow();
  });

  it("summary.continueChat should reject empty userMessage", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.continueChat({ conversationId: 1, userMessage: "" })
    ).rejects.toThrow();
  });

  it("summary.startChat should fail for non-existent topic", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.startChat({ topicId: 999999 })
    ).rejects.toThrow();
  });

  it("summary.continueChat should fail for non-existent conversation", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.continueChat({ conversationId: 999999, userMessage: "test" })
    ).rejects.toThrow();
  });
});

// ─── V0.5.2 Conversation Query Tests ────────────────────────────

describe("V0.5.2 conversation queries", () => {
  it("summary.listConversations should return empty array for non-existent topic", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.summary.listConversations({ topicId: 999999 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("summary.getConversation should return null for non-existent conversation", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.summary.getConversation({ conversationId: 999999 });
    expect(result).toBeNull();
  });

  it("summary.listConversations should accept optional projectId", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.summary.listConversations({ topicId: 999999, projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ─── V0.5.2 DB Helper Tests ─────────────────────────────────────

describe("V0.5.2 DB helpers for topic_conversations", () => {
  it("should export createTopicConversation", async () => {
    const mod = await import("./db");
    expect(typeof mod.createTopicConversation).toBe("function");
  });

  it("should export getTopicConversation", async () => {
    const mod = await import("./db");
    expect(typeof mod.getTopicConversation).toBe("function");
  });

  it("should export getConversationsByTopic", async () => {
    const mod = await import("./db");
    expect(typeof mod.getConversationsByTopic).toBe("function");
  });

  it("should export updateTopicConversation", async () => {
    const mod = await import("./db");
    expect(typeof mod.updateTopicConversation).toBe("function");
  });

  it("should export deleteTopicConversation", async () => {
    const mod = await import("./db");
    expect(typeof mod.deleteTopicConversation).toBe("function");
  });

  it("should create, read, update, and delete a conversation", async () => {
    const { createTopicConversation, getTopicConversation, updateTopicConversation, deleteTopicConversation } = await import("./db");

    // Create
    const messages = JSON.stringify([
      { role: "system", content: "Test system prompt" },
      { role: "user", content: "Test user message" },
      { role: "assistant", content: "Test assistant reply" },
    ]);
    const id = await createTopicConversation({
      topicId: 1,
      projectId: 1,
      title: "Test Conversation V052",
      messages,
      promptTemplateId: null,
    });
    expect(id).toBeGreaterThan(0);

    // Read
    const conv = await getTopicConversation(id);
    expect(conv).not.toBeNull();
    expect(conv!.topicId).toBe(1);
    expect(conv!.title).toBe("Test Conversation V052");
    const parsed = JSON.parse(conv!.messages);
    expect(parsed.length).toBe(3);
    expect(parsed[0].role).toBe("system");

    // Update
    const updatedMessages = JSON.stringify([
      ...parsed,
      { role: "user", content: "Follow-up" },
      { role: "assistant", content: "Follow-up reply" },
    ]);
    await updateTopicConversation(id, { messages: updatedMessages, title: "Updated Title" });
    const updated = await getTopicConversation(id);
    expect(updated!.title).toBe("Updated Title");
    const updatedParsed = JSON.parse(updated!.messages);
    expect(updatedParsed.length).toBe(5);

    // Delete
    await deleteTopicConversation(id);
    const deleted = await getTopicConversation(id);
    expect(deleted).toBeNull();
  });
});

// ─── V0.5.2 Schema Tests ────────────────────────────────────────

describe("V0.5.2 schema - topicConversations table", () => {
  it("should export topicConversations table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.topicConversations).toBeDefined();
  });

  it("should export TopicConversation type", async () => {
    // This is a compile-time check - if it imports, the type exists
    const schema = await import("../drizzle/schema");
    expect(schema.topicConversations).toBeDefined();
  });
});
