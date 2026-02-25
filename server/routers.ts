import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  createDocument, updateDocument, getDocumentsByUser, getDocumentById,
  insertChunks, getChunksByDocument, getAllChunksByUser, getChunkById,
  findOrCreateTopic, getAllTopicsWithCount, getTopicById, getChunksByTopic,
  linkChunkToTopic, getSummaryByTopic, upsertSummary,
} from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";

// ─── PDF parsing helper ─────────────────────────────────────────────
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

// ─── Text chunking helper ───────────────────────────────────────────
function chunkText(text: string, minSize = 500, maxSize = 800): string[] {
  const results: string[] = [];
  // Split by paragraphs first
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
        // Allow slight overflow to avoid tiny chunks
        current = current ? current + "\n\n" + trimmed : trimmed;
      } else {
        if (current) results.push(current);
        current = trimmed;
      }
    }
  }
  if (current) results.push(current);

  // Handle case where single paragraphs are very long
  const finalResults: string[] = [];
  for (const chunk of results) {
    if (chunk.length <= maxSize * 1.5) {
      finalResults.push(chunk);
    } else {
      // Split long chunks by sentences
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

// ─── Routers ────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Document Management ──────────────────────────────────────────
  document: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDocumentsByUser(ctx.user.id);
    }),

    upload: protectedProcedure
      .input(z.object({
        filename: z.string(),
        fileBase64: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");

        // 1. Upload to S3
        const fileKey = `cortex/${ctx.user.id}/pdfs/${nanoid()}-${input.filename}`;
        const { url: fileUrl } = await storagePut(fileKey, buffer, "application/pdf");

        // 2. Create document record
        const docId = await createDocument({
          userId: ctx.user.id,
          filename: input.filename,
          fileUrl,
          status: "parsing",
        });

        // 3. Parse PDF
        try {
          const rawText = await parsePdfBuffer(buffer);
          const textChunks = chunkText(rawText);

          // 4. Insert chunks
          const chunkData = textChunks.map((content, idx) => ({
            documentId: docId,
            content,
            position: idx,
            tokenCount: content.length,
          }));
          await insertChunks(chunkData);

          // 5. Update document
          await updateDocument(docId, {
            rawText,
            status: "done",
            chunkCount: textChunks.length,
          });

          return { id: docId, chunkCount: textChunks.length, status: "done" };
        } catch (err: any) {
          await updateDocument(docId, { status: "error" });
          throw new Error(`PDF parsing failed: ${err.message}`);
        }
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getDocumentById(input.id);
      }),

    chunks: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ input }) => {
        return getChunksByDocument(input.documentId);
      }),
  }),

  // ─── Chunk Management ─────────────────────────────────────────────
  chunk: router({
    listAll: protectedProcedure.query(async ({ ctx }) => {
      return getAllChunksByUser(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getChunkById(input.id);
      }),

    // Extract topics for a single chunk
    extractTopics: protectedProcedure
      .input(z.object({ chunkId: z.number() }))
      .mutation(async ({ input }) => {
        const chunk = await getChunkById(input.chunkId);
        if (!chunk) throw new Error("Chunk not found");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一个话题提取助手。请从给定的文本中提取 1-2 个核心话题标签。
要求：
- 每个话题标签用简短的中文短语表示（2-8个字）
- 话题应该反映文本的核心主题
- 返回 JSON 格式

返回格式：
{"topics": [{"label": "话题名称", "relevance": 0.9}]}`,
            },
            {
              role: "user",
              content: chunk.content,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "topic_extraction",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  topics: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        relevance: { type: "number" },
                      },
                      required: ["label", "relevance"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["topics"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content || typeof content !== "string") throw new Error("LLM returned empty response");

        const parsed = JSON.parse(content);
        const extractedTopics: { label: string; topicId: number; relevance: number }[] = [];

        for (const t of parsed.topics) {
          const topicId = await findOrCreateTopic(t.label);
          await linkChunkToTopic(input.chunkId, topicId, t.relevance);
          extractedTopics.push({ label: t.label, topicId, relevance: t.relevance });
        }

        return extractedTopics;
      }),
  }),

  // ─── Batch Topic Extraction ───────────────────────────────────────
  extraction: router({
    // Extract topics for all chunks of a document
    extractDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .mutation(async ({ input }) => {
        const docChunks = await getChunksByDocument(input.documentId);
        if (docChunks.length === 0) throw new Error("No chunks found for document");

        await updateDocument(input.documentId, { status: "extracting" });

        let processed = 0;
        const errors: string[] = [];

        for (const chunk of docChunks) {
          try {
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `你是一个话题提取助手。请从给定的文本中提取 1-2 个核心话题标签。
要求：
- 每个话题标签用简短的中文短语表示（2-8个字）
- 话题应该反映文本的核心主题
- 返回 JSON 格式

返回格式：
{"topics": [{"label": "话题名称", "relevance": 0.9}]}`,
                },
                {
                  role: "user",
                  content: chunk.content,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "topic_extraction",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      topics: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            label: { type: "string" },
                            relevance: { type: "number" },
                          },
                          required: ["label", "relevance"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["topics"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content;
            if (content && typeof content === "string") {
              const parsed = JSON.parse(content);
              for (const t of parsed.topics) {
                const topicId = await findOrCreateTopic(t.label);
                await linkChunkToTopic(chunk.id, topicId, t.relevance);
              }
            }
            processed++;
          } catch (err: any) {
            errors.push(`Chunk ${chunk.id}: ${err.message}`);
          }
        }

        await updateDocument(input.documentId, { status: "done" });

        return { processed, total: docChunks.length, errors };
      }),
  }),

  // ─── Topic Management ─────────────────────────────────────────────
  topic: router({
    list: protectedProcedure.query(async () => {
      return getAllTopicsWithCount();
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const topic = await getTopicById(input.id);
        if (!topic) throw new Error("Topic not found");
        const topicChunks = await getChunksByTopic(input.id);
        const summary = await getSummaryByTopic(input.id);
        return { topic, chunks: topicChunks, summary };
      }),

    chunks: protectedProcedure
      .input(z.object({ topicId: z.number() }))
      .query(async ({ input }) => {
        return getChunksByTopic(input.topicId);
      }),
  }),

  // ─── Summary Management ───────────────────────────────────────────
  summary: router({
    get: protectedProcedure
      .input(z.object({ topicId: z.number() }))
      .query(async ({ input }) => {
        return getSummaryByTopic(input.topicId);
      }),

    save: protectedProcedure
      .input(z.object({
        topicId: z.number(),
        summaryText: z.string(),
      }))
      .mutation(async ({ input }) => {
        const id = await upsertSummary(input.topicId, input.summaryText);
        return { id };
      }),

    generate: protectedProcedure
      .input(z.object({ topicId: z.number() }))
      .mutation(async ({ input }) => {
        const topic = await getTopicById(input.topicId);
        if (!topic) throw new Error("Topic not found");

        const topicChunks = await getChunksByTopic(input.topicId);
        if (topicChunks.length === 0) throw new Error("No chunks found for this topic");

        const chunksText = topicChunks.map((c, i) => `[片段 ${i + 1}]\n${c.content}`).join("\n\n---\n\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一个专业的内容总结助手。请根据以下关于「${topic.label}」话题的多个文本片段，生成一份结构化的总结。

要求：
- 总结应该涵盖所有片段的核心观点
- 使用清晰的中文表达
- 长度适中（300-600字）
- 可以使用 Markdown 格式`,
            },
            {
              role: "user",
              content: chunksText,
            },
          ],
        });

        const summaryText = response.choices[0]?.message?.content;
        if (!summaryText || typeof summaryText !== "string") throw new Error("LLM returned empty response");

        const id = await upsertSummary(input.topicId, summaryText);
        return { id, summaryText };
      }),
  }),
});

export type AppRouter = typeof appRouter;
