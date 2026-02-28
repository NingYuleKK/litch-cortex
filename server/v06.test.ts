import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { cosineSimilarity } from "./embedding-service";

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

const caller = appRouter.createCaller;

// ─── Cosine Similarity Unit Tests ─────────────────────────────────

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("should return 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("should return -1 for opposite vectors", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("should handle zero vectors gracefully", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("should throw on dimension mismatch", () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => cosineSimilarity(a, b)).toThrow("Vector dimension mismatch");
  });

  it("should compute correct similarity for known vectors", () => {
    // cos(45°) ≈ 0.7071
    const a = [1, 0];
    const b = [1, 1];
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 4);
  });

  it("should handle high-dimensional vectors", () => {
    const dim = 1536;
    const a = Array.from({ length: dim }, (_, i) => Math.sin(i));
    const b = Array.from({ length: dim }, (_, i) => Math.cos(i));
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("should be symmetric", () => {
    const a = [0.5, 0.3, 0.8, 0.1];
    const b = [0.2, 0.9, 0.4, 0.6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

// ─── Embedding Router Auth Tests ──────────────────────────────────

describe("embedding router - auth", () => {
  it("should reject unauthenticated status query", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(trpc.embedding.status({ projectId: 1 })).rejects.toThrow();
  });

  it("should reject unauthenticated generateForProject", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(trpc.embedding.generateForProject({ projectId: 1 })).rejects.toThrow();
  });

  it("should reject unauthenticated generateForChunks", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(trpc.embedding.generateForChunks({ chunkIds: [1] })).rejects.toThrow();
  });

  it("should reject unauthenticated semanticSearch", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(
      trpc.embedding.semanticSearch({ projectId: 1, query: "test" })
    ).rejects.toThrow();
  });

  it("should reject unauthenticated getConfig", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(trpc.embedding.getConfig()).rejects.toThrow();
  });

  it("should reject unauthenticated saveConfig", async () => {
    const ctx = createUnauthContext();
    const trpc = caller(ctx);
    await expect(
      trpc.embedding.saveConfig({ provider: "builtin" })
    ).rejects.toThrow();
  });
});

// ─── Embedding Router Functional Tests ────────────────────────────

describe("embedding router - functional", () => {
  it("should return embedding status for a project", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);
    const status = await trpc.embedding.status({ projectId: 1 });
    expect(status).toHaveProperty("totalChunks");
    expect(status).toHaveProperty("embeddedChunks");
    expect(status).toHaveProperty("percentage");
    expect(typeof status.totalChunks).toBe("number");
    expect(typeof status.embeddedChunks).toBe("number");
    expect(typeof status.percentage).toBe("number");
    expect(status.percentage).toBeGreaterThanOrEqual(0);
    expect(status.percentage).toBeLessThanOrEqual(100);
  });

  it("should get embedding config", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);
    const config = await trpc.embedding.getConfig();
    expect(config).toHaveProperty("provider");
    expect(config).toHaveProperty("model");
    expect(config).toHaveProperty("dimensions");
    expect(config).toHaveProperty("hasApiKey");
    expect(config).toHaveProperty("isConfigured");
    expect(typeof config.provider).toBe("string");
  });

  it("should save embedding config", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);

    // Save builtin config (no apiKey needed)
    const result = await trpc.embedding.saveConfig({
      provider: "builtin",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(result.success).toBe(true);

    // Verify builtin config is returned correctly
    const config = await trpc.embedding.getConfig();
    expect(config.provider).toBe("builtin");
    expect(config.model).toBe("text-embedding-3-small");
    expect(config.dimensions).toBe(1536);

    // V0.6.1 behavior: external provider without apiKey falls back to builtin
    // This is by design — users without API keys should still be able to use embedding
    await trpc.embedding.saveConfig({ provider: "openai", model: "text-embedding-3-small" });
    const fallbackConfig = await trpc.embedding.getConfig();
    // No apiKey for openai → resolveEmbeddingConfig returns builtin as fallback
    expect(fallbackConfig.provider).toBe("builtin");

    // Reset to builtin
    await trpc.embedding.saveConfig({ provider: "builtin" });
  });

  it("should handle generateForProject with no chunks", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);
    // Project 9999 doesn't exist, so no chunks
    const result = await trpc.embedding.generateForProject({ projectId: 9999 });
    expect(result.generated).toBe(0);
    expect(result.message).toContain("已有向量");
  });

  it("should validate semanticSearch input", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);
    // Empty query should fail validation
    await expect(
      trpc.embedding.semanticSearch({ projectId: 1, query: "" })
    ).rejects.toThrow();
  });

  it("should validate generateForChunks input", async () => {
    const ctx = createCortexAuthContext();
    const trpc = caller(ctx);
    // Empty chunkIds should fail validation
    await expect(
      trpc.embedding.generateForChunks({ chunkIds: [] })
    ).rejects.toThrow();
  });
});
