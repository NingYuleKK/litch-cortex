import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { chunkText } from "./uploadRoute";
import type { TrpcContext } from "./_core/context";

// ─── Test the chunkText function (now exported from uploadRoute.ts) ──

describe("chunkText", () => {
  it("should return at least one chunk for any non-empty text", () => {
    const result = chunkText("Hello world");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toBe("Hello world");
  });

  it("should split long text into chunks within size limits", () => {
    const para = "这是一段测试文本。".repeat(80); // ~720 chars
    const text = `${para}\n\n${para}\n\n${para}`;
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(800 * 1.5);
    }
  });

  it("should handle single paragraph shorter than minSize", () => {
    const text = "短文本";
    const result = chunkText(text);
    expect(result).toEqual(["短文本"]);
  });

  it("should preserve paragraph boundaries when possible", () => {
    const p1 = "A".repeat(400);
    const p2 = "B".repeat(400);
    const text = `${p1}\n\n${p2}`;
    const result = chunkText(text);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("A");
    expect(result[0]).toContain("B");
  });

  it("should split when combined paragraphs exceed maxSize", () => {
    const p1 = "A".repeat(600);
    const p2 = "B".repeat(600);
    const text = `${p1}\n\n${p2}`;
    const result = chunkText(text);
    expect(result.length).toBe(2);
  });

  it("should handle text with null bytes gracefully", () => {
    const text = "Hello\x00World\n\nSecond paragraph with\x00nulls";
    const result = chunkText(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle very large text (200K+ chars)", () => {
    // Simulate a large PDF text (~200K chars)
    const para = "这是一段较长的测试文本，用于模拟大型PDF文件的解析结果。".repeat(20);
    const paragraphs = Array(200).fill(para);
    const text = paragraphs.join("\n\n");
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(100);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(800 * 1.5);
    }
  });
});

// ─── Test router structure ──────────────────────────────────────────

describe("appRouter structure", () => {
  it("should have all expected procedures including project routes", () => {
    expect(appRouter).toBeDefined();
    const procedures = Object.keys((appRouter as any)._def.procedures);

    // Auth
    expect(procedures).toContain("auth.me");
    expect(procedures).toContain("auth.logout");

    // Project management (V0.2)
    expect(procedures).toContain("project.list");
    expect(procedures).toContain("project.create");
    expect(procedures).toContain("project.get");
    expect(procedures).toContain("project.update");

    // Document management — upload is now via Express route, not tRPC
    expect(procedures).toContain("document.list");
    expect(procedures).toContain("document.upload"); // kept as fallback for small files
    expect(procedures).toContain("document.get");
    expect(procedures).toContain("document.chunks");

    // Chunk management
    expect(procedures).toContain("chunk.listAll");
    expect(procedures).toContain("chunk.get");
    expect(procedures).toContain("chunk.extractTopics");

    // Extraction
    expect(procedures).toContain("extraction.extractDocument");

    // Topic management
    expect(procedures).toContain("topic.list");
    expect(procedures).toContain("topic.get");
    expect(procedures).toContain("topic.chunks");

    // Summary management
    expect(procedures).toContain("summary.get");
    expect(procedures).toContain("summary.save");
    expect(procedures).toContain("summary.generate");
  });
});

// ─── Test auth context ──────────────────────────────────────────────

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("auth protection", () => {
  it("should return null for unauthenticated me query", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("should reject protected procedures for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.document.list()).rejects.toThrow();
  });

  it("should reject project.list for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.project.list()).rejects.toThrow();
  });

  it("should reject project.create for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.project.create({ name: "Test Project" })
    ).rejects.toThrow();
  });

  it("should reject topic.list for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.topic.list()).rejects.toThrow();
  });

  it("should reject summary.generate for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.summary.generate({ topicId: 1 })
    ).rejects.toThrow();
  });
});
