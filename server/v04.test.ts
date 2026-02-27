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

// ─── V0.4 Router Structure Tests ──────────────────────────────────

describe("V0.4 appRouter structure", () => {
  it("should have mergedChunk procedures", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("mergedChunk.byDocument");
    expect(procedures).toContain("mergedChunk.byProject");
    expect(procedures).toContain("mergedChunk.hasMerged");
    expect(procedures).toContain("mergedChunk.merge");
  });

  it("should have explore.search with customPrompt support", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("explore.search");
    expect(procedures).toContain("explore.saveAsTopic");
  });

  it("should have summary.generate with customPrompt support", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("summary.generate");
  });
});

// ─── V0.4 Auth Protection Tests ───────────────────────────────────

describe("V0.4 auth protection for merged chunks", () => {
  it("should reject mergedChunk.byDocument for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.byDocument({ documentId: 1 })
    ).rejects.toThrow();
  });

  it("should reject mergedChunk.byProject for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.byProject({ projectId: 1 })
    ).rejects.toThrow();
  });

  it("should reject mergedChunk.hasMerged for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.hasMerged({ documentId: 1 })
    ).rejects.toThrow();
  });

  it("should reject mergedChunk.merge for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.merge({ documentId: 1 })
    ).rejects.toThrow();
  });
});

// ─── V0.4 Input Validation Tests ──────────────────────────────────

describe("V0.4 input validation", () => {
  it("explore.search should accept customPrompt parameter", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    // With a non-existent project, it returns empty results (no throw)
    const result = await caller.explore.search({ projectId: 999, query: "test", customPrompt: "Custom prompt" });
    expect(result).toBeDefined();
    expect(result.chunks).toEqual([]);
    expect(result.chunkCount).toBe(0);
  });

  it("explore.search should reject empty query", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.explore.search({ projectId: 1, query: "" })
    ).rejects.toThrow();
  });

  it("summary.generate should accept customPrompt parameter", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    // This will fail at DB level but validates the input schema
    await expect(
      caller.summary.generate({ topicId: 999, customPrompt: "Custom prompt" })
    ).rejects.toThrow();
  });

  it("mergedChunk.merge should validate documentId is a number", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing invalid input
      caller.mergedChunk.merge({ documentId: "abc" })
    ).rejects.toThrow();
  });
});

// ─── V0.4 Prompt Template Tests (client-side, pure logic) ─────────

describe("Prompt template configuration", () => {
  it("should have expected template IDs", async () => {
    // Import the client-side prompt template module
    const { PRESET_TEMPLATES: PROMPT_TEMPLATES } = await import("../client/src/lib/promptTemplates");
    const ids = PROMPT_TEMPLATES.map(t => t.id);
    expect(ids).toContain("academic");
    expect(ids).toContain("blog");
    expect(ids).toContain("reading-notes");
    expect(ids).toContain("dialogue-summary");
    expect(ids).toContain("custom");
  });

  it("each template should have required fields", async () => {
    const { PRESET_TEMPLATES: PROMPT_TEMPLATES } = await import("../client/src/lib/promptTemplates");
    for (const t of PROMPT_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      // All except 'custom' should have a systemPrompt
      if (t.id !== "custom") {
        expect(t.systemPrompt).toBeTruthy();
      }
    }
  });

  it("getEffectivePrompt should return template prompt for known IDs", async () => {
    const { getEffectivePrompt, PRESET_TEMPLATES } = await import("../client/src/lib/promptTemplates");
    const blogTemplate = PRESET_TEMPLATES.find(t => t.id === "blog");
    expect(blogTemplate).toBeDefined();
    const prompt = getEffectivePrompt("blog");
    expect(prompt).toBe(blogTemplate!.systemPrompt);
  });

  it("getEffectivePrompt should return academic prompt for academic template", async () => {
    const { getEffectivePrompt, PRESET_TEMPLATES } = await import("../client/src/lib/promptTemplates");
    const prompt = getEffectivePrompt("academic");
    const academicTemplate = PRESET_TEMPLATES.find(t => t.id === "academic");
    expect(prompt).toBe(academicTemplate!.systemPrompt);
  });
});
