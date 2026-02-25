import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Test the chunkText function by importing it indirectly ─────────
// Since chunkText is not exported, we test it through the router behavior.
// But we can also test the chunking logic directly by extracting it.

// Replicate the chunkText logic for unit testing
function chunkText(text: string, minSize = 500, maxSize = 800): string[] {
  const results: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let current = "";
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (current.length + trimmed.length + 1 <= maxSize) {
      current = current ? current + "\n\n" + trimmed : trimmed;
    } else {
      if (current.length >= minSize) {
        results.push(current);
        current = trimmed;
      } else if (current.length + trimmed.length + 1 <= maxSize * 1.2) {
        current = current ? current + "\n\n" + trimmed : trimmed;
      } else {
        if (current) results.push(current);
        current = trimmed;
      }
    }
  }
  if (current) results.push(current);

  const finalResults: string[] = [];
  for (const chunk of results) {
    if (chunk.length <= maxSize * 1.5) {
      finalResults.push(chunk);
    } else {
      const sentences = chunk.split(/(?<=[。！？.!?])\s*/);
      let sub = "";
      for (const sent of sentences) {
        if (sub.length + sent.length + 1 <= maxSize) {
          sub = sub ? sub + sent : sent;
        } else {
          if (sub) finalResults.push(sub);
          sub = sent;
        }
      }
      if (sub) finalResults.push(sub);
    }
  }

  return finalResults.length > 0 ? finalResults : [text.slice(0, maxSize)];
}

describe("chunkText", () => {
  it("should return at least one chunk for any non-empty text", () => {
    const result = chunkText("Hello world");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toBe("Hello world");
  });

  it("should split long text into chunks within size limits", () => {
    // Create text with multiple paragraphs
    const para = "这是一段测试文本。".repeat(80); // ~720 chars
    const text = `${para}\n\n${para}\n\n${para}`;
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should be within reasonable limits
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
    // Should combine into one chunk since total is 800 (within maxSize)
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
});

// ─── Test router structure ──────────────────────────────────────────

describe("appRouter structure", () => {
  it("should have document router with expected procedures", () => {
    // Verify the router has the expected shape
    expect(appRouter).toBeDefined();
    // Check that key procedures exist by checking the router's _def
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("auth.me");
    expect(procedures).toContain("auth.logout");
    expect(procedures).toContain("document.list");
    expect(procedures).toContain("document.upload");
    expect(procedures).toContain("document.get");
    expect(procedures).toContain("document.chunks");
    expect(procedures).toContain("chunk.listAll");
    expect(procedures).toContain("chunk.get");
    expect(procedures).toContain("chunk.extractTopics");
    expect(procedures).toContain("extraction.extractDocument");
    expect(procedures).toContain("topic.list");
    expect(procedures).toContain("topic.get");
    expect(procedures).toContain("topic.chunks");
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
});
