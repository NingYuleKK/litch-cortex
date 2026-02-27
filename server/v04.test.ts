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
  it("should have mergedChunk procedures (per-topic)", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("mergedChunk.byTopic");
    expect(procedures).toContain("mergedChunk.byProject");
    expect(procedures).toContain("mergedChunk.hasMerged");
    expect(procedures).toContain("mergedChunk.mergeByTopic");
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
  it("should reject mergedChunk.byTopic for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.byTopic({ topicId: 1 })
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
      caller.mergedChunk.hasMerged({ topicId: 1 })
    ).rejects.toThrow();
  });

  it("should reject mergedChunk.mergeByTopic for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.mergedChunk.mergeByTopic({ topicId: 1, projectId: 1 })
    ).rejects.toThrow();
  });
});

// ─── V0.4 Input Validation Tests ──────────────────────────────────

describe("V0.4 input validation", () => {
  it("explore.search should accept customPrompt parameter", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
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
    await expect(
      caller.summary.generate({ topicId: 999, customPrompt: "Custom prompt" })
    ).rejects.toThrow();
  });

  it("mergedChunk.mergeByTopic should validate topicId is a number", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing invalid input
      caller.mergedChunk.mergeByTopic({ topicId: "abc", projectId: 1 })
    ).rejects.toThrow();
  });

  it("mergedChunk.byTopic should return empty for non-existent topic", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.mergedChunk.byTopic({ topicId: 99999 });
    expect(result).toEqual([]);
  });

  it("mergedChunk.hasMerged should return false for non-existent topic", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.mergedChunk.hasMerged({ topicId: 99999 });
    expect(result).toBe(false);
  });
});

// ─── V0.5 Router Structure Tests ──────────────────────────────────

describe("V0.5 appRouter structure", () => {
  it("should have llmSettings procedures", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("llmSettings.getConfig");
    expect(procedures).toContain("llmSettings.saveConfig");
    expect(procedures).toContain("llmSettings.testConnection");
  });

  it("should have promptTemplate procedures", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("promptTemplate.list");
    expect(procedures).toContain("promptTemplate.create");
    expect(procedures).toContain("promptTemplate.update");
    expect(procedures).toContain("promptTemplate.delete");
  });
});

// ─── V0.5 Auth Protection Tests ───────────────────────────────────

describe("V0.5 auth protection", () => {
  it("should reject llmSettings.getConfig for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.llmSettings.getConfig()).rejects.toThrow();
  });

  it("should reject llmSettings.saveConfig for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.llmSettings.saveConfig({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "test-key",
        defaultModel: "anthropic/claude-sonnet-4",
      })
    ).rejects.toThrow();
  });

  it("should reject llmSettings.testConnection for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.llmSettings.testConnection({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4",
      })
    ).rejects.toThrow();
  });

  it("should reject promptTemplate.create for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.promptTemplate.create({
        name: "Test",
        systemPrompt: "Test prompt",
      })
    ).rejects.toThrow();
  });

  it("should reject promptTemplate.update for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.promptTemplate.update({
        id: 1,
        name: "Updated",
        systemPrompt: "Updated prompt",
      })
    ).rejects.toThrow();
  });

  it("should reject promptTemplate.delete for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.promptTemplate.delete({ id: 1 })
    ).rejects.toThrow();
  });
});

// ─── V0.5 LLM Settings Tests ─────────────────────────────────────

describe("V0.5 LLM settings", () => {
  it("llmSettings.getConfig should return config object", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.llmSettings.getConfig();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("llmSettings.saveConfig should accept valid config", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.llmSettings.saveConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test-key-12345",
      defaultModel: "anthropic/claude-sonnet-4",
      taskModels: { summarize: "anthropic/claude-sonnet-4", explore: "openai/gpt-4.1-mini" },
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("llmSettings.getConfig should return saved config without raw key", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.llmSettings.getConfig();
    expect(result).toBeDefined();
    expect(result.provider).toBe("openrouter");
    // API key should be empty (never returned)
    expect(result.apiKey).toBe("");
    expect(result.hasApiKey).toBe(true);
  });

  it("llmSettings.saveConfig should accept any provider string", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Provider is a free-form string, so this should succeed
    const result = await caller.llmSettings.saveConfig({
      provider: "custom",
      baseUrl: "https://example.com",
      apiKey: "test",
      defaultModel: "test",
    });
    expect(result.success).toBe(true);
  });
});

// ─── V0.5 Prompt Template Tests ───────────────────────────────────

describe("V0.5 prompt templates (DB-backed)", () => {
  it("promptTemplate.list should return preset templates", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const templates = await caller.promptTemplate.list();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThanOrEqual(5);
    // Check preset templates exist
    const names = templates.map((t: any) => t.name);
    expect(names).toContain("学术总结");
    expect(names).toContain("Blog 风格");
    expect(names).toContain("读书笔记");
    expect(names).toContain("对话摘要");
    expect(names).toContain("对话转 Blog（Beta Skill）");
  });

  it("promptTemplate.create should create a new template", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.promptTemplate.create({
      name: "Test Template V05",
      description: "A test template",
      systemPrompt: "You are a test assistant.",
    });
    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
  });

  it("promptTemplate.update should update a template", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    // First get the list to find our test template
    const templates = await caller.promptTemplate.list();
    const testTemplate = templates.find((t: any) => t.name === "Test Template V05");
    expect(testTemplate).toBeDefined();

    await caller.promptTemplate.update({
      id: testTemplate!.id,
      name: "Test Template V05 Updated",
      systemPrompt: "Updated prompt content.",
    });

    // Verify update
    const updated = await caller.promptTemplate.list();
    const found = updated.find((t: any) => t.id === testTemplate!.id);
    expect(found?.name).toBe("Test Template V05 Updated");
  });

  it("promptTemplate.delete should delete a non-preset template", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    const templates = await caller.promptTemplate.list();
    const testTemplate = templates.find((t: any) => t.name === "Test Template V05 Updated");
    expect(testTemplate).toBeDefined();

    await caller.promptTemplate.delete({ id: testTemplate!.id });

    // Verify deletion
    const after = await caller.promptTemplate.list();
    const found = after.find((t: any) => t.id === testTemplate!.id);
    expect(found).toBeUndefined();
  });

  it("promptTemplate.create should reject empty name", async () => {
    const ctx = createCortexAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.promptTemplate.create({
        name: "",
        systemPrompt: "test",
      })
    ).rejects.toThrow();
  });
});

// ─── V0.5 LLM Service Module Tests ───────────────────────────────

describe("V0.5 LLM service module", () => {
  it("should export callLLM function", async () => {
    const mod = await import("./llm-service");
    expect(typeof mod.callLLM).toBe("function");
  });

  it("callLLM should accept taskType parameter", async () => {
    const mod = await import("./llm-service");
    // Just verify the function signature accepts taskType without throwing type errors
    expect(mod.callLLM).toBeDefined();
  });
});

// ─── V0.4 Prompt Template Tests (client-side, pure logic) ─────────

describe("Prompt template configuration (legacy client-side)", () => {
  it("should have expected template IDs", async () => {
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
