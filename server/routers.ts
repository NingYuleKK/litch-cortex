import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  createDocument, updateDocument, getDocumentsByUser, getDocumentsByProject, getDocumentById,
  insertChunks, getChunksByDocument, getAllChunksByUser, getAllChunksByProject, getChunkById,
  findOrCreateTopic, getAllTopicsWithCount, getTopicsByProject, getTopicById, getChunksByTopic, getChunksByTopicAndProject,
  linkChunkToTopic, getSummaryByTopic, upsertSummary,
  createProject, getProjectsByUser, getProjectsByCortexUser, getProjectById, updateProject,
  searchChunksByKeyword,
  insertMergedChunks, getMergedChunksByTopic, getMergedChunksByProject,
  deleteMergedChunksByTopic, hasMergedChunksForTopic,
  getActiveLlmConfig, upsertLlmConfig,
  getAllPromptTemplates, getPromptTemplateById, createPromptTemplate, updatePromptTemplate, deletePromptTemplate, seedPresetTemplates,
  createTopicConversation, getTopicConversation, getConversationsByTopic, updateTopicConversation, deleteTopicConversation,
  insertChunkEmbedding, insertChunkEmbeddingsBatch, getEmbeddingsByProject, getEmbeddingCountByProject, getChunksWithoutEmbedding,
  getActiveEmbeddingConfig, upsertEmbeddingConfig,
} from "./db";
import { storagePut } from "./storage";
import { callLLM } from "./llm-service";
import { encodeApiKey, decodeApiKey, getProviderDefaults } from "./llm-service";
import { generateEmbedding, generateEmbeddingsBatch, cosineSimilarity, getCurrentEmbeddingConfig } from "./embedding-service";
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

  // ─── Project Management ──────────────────────────────────────────
  project: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      // Use cortexUserId if available (independent auth), otherwise fall back to Manus user id
      if (ctx.cortexUserId) {
        return getProjectsByCortexUser(ctx.cortexUserId);
      }
      return getProjectsByUser(ctx.user.id);
    }),

    listByCortexUser: publicProcedure
      .input(z.object({ cortexUserId: z.number() }))
      .query(async ({ input }) => {
        return getProjectsByCortexUser(input.cortexUserId);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(1024).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await createProject({
          userId: ctx.user.id,
          cortexUserId: ctx.cortexUserId ?? undefined,
          name: input.name,
          description: input.description,
        });
        return { id };
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getProjectById(input.id);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        description: z.string().max(1024).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateProject(id, data);
        return { success: true };
      }),
  }),

  // ─── Document Management ──────────────────────────────────────────
  document: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (input?.projectId) {
          return getDocumentsByProject(input.projectId);
        }
        return getDocumentsByUser(ctx.user.id);
      }),

    upload: protectedProcedure
      .input(z.object({
        filename: z.string(),
        fileBase64: z.string(),
        projectId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const fileKey = `cortex/${ctx.user.id}/pdfs/${nanoid()}-${input.filename}`;
        const { url: fileUrl } = await storagePut(fileKey, buffer, "application/pdf");
        const docId = await createDocument({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          filename: input.filename,
          fileUrl,
          status: "parsing",
        });
        try {
          const rawText = await parsePdfBuffer(buffer);
          const textChunks = chunkText(rawText);
          const chunkData = textChunks.map((content, idx) => ({
            documentId: docId,
            content,
            position: idx,
            tokenCount: content.length,
          }));
          await insertChunks(chunkData);
          await updateDocument(docId, { rawText, status: "done", chunkCount: textChunks.length });
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
    listAll: protectedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (input?.projectId) {
          return getAllChunksByProject(input.projectId);
        }
        return getAllChunksByUser(ctx.user.id);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getChunkById(input.id);
      }),

    extractTopics: protectedProcedure
      .input(z.object({ chunkId: z.number() }))
      .mutation(async ({ input }) => {
        const chunk = await getChunkById(input.chunkId);
        if (!chunk) throw new Error("Chunk not found");

        const response = await callLLM({
          taskType: "topic_extract",
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
            { role: "user", content: chunk.content },
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
            const response = await callLLM({
              taskType: "topic_extract",
              messages: [
                {
        
                  role: "system",
                  content: `你是一个话题提取助手。请从给定的文本中提取 1-2 个核心话题标签。
要求：
- 每个话题标签用简短的中文短语表示（2-8个字）
- 话题应该反映文本的核心主题
- 返回 JSON 格式

返回格式：
{"topics": [{"label": "话题名称", "relevance": 0.9}]}`            },
                { role: "user", content: chunk.content },
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
    list: protectedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        if (input?.projectId) {
          return getTopicsByProject(input.projectId);
        }
        return getAllTopicsWithCount();
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number(), projectId: z.number().optional() }))
      .query(async ({ input }) => {
        const topic = await getTopicById(input.id);
        if (!topic) throw new Error("Topic not found");
        const topicChunks = input.projectId
          ? await getChunksByTopicAndProject(input.id, input.projectId)
          : await getChunksByTopic(input.id);
        const summary = await getSummaryByTopic(input.id);
        return { topic, chunks: topicChunks, summary };
      }),

    chunks: protectedProcedure
      .input(z.object({ topicId: z.number(), projectId: z.number().optional() }))
      .query(async ({ input }) => {
        if (input.projectId) {
          return getChunksByTopicAndProject(input.topicId, input.projectId);
        }
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
      .input(z.object({ topicId: z.number(), projectId: z.number().optional(), customPrompt: z.string().optional() }))
      .mutation(async ({ input }) => {
        const topic = await getTopicById(input.topicId);
        if (!topic) throw new Error("Topic not found");

        const topicChunks = input.projectId
          ? await getChunksByTopicAndProject(input.topicId, input.projectId)
          : await getChunksByTopic(input.topicId);
        if (topicChunks.length === 0) throw new Error("No chunks found for this topic");

        const chunksText = topicChunks.map((c, i) => `[片段 ${i + 1}]\n${c.content}`).join("\n\n---\n\n");

        // Use custom prompt if provided, otherwise use default
        const systemPrompt = input.customPrompt
          ? `${input.customPrompt}\n\n以下是关于「${topic.label}」的文本片段：`
          : `你是一个专业的内容总结助手。请根据以下关于「${topic.label}」话题的多个文本片段，生成一份结构化的总结。\n\n要求：\n- 总结应该涵盖所有片段的核心观点\n- 使用清晰的中文表达\n- 长度适中（300-600字）\n- 可以使用 Markdown 格式`;

        const response = await callLLM({
          taskType: "summarize",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            { role: "user", content: chunksText },
          ],
        });

        const summaryText = response.choices[0]?.message?.content;
        if (!summaryText || typeof summaryText !== "string") throw new Error("LLM returned empty response");

        const id = await upsertSummary(input.topicId, summaryText);
        return { id, summaryText };
      }),

    // ── Conversation-based chat for topic summaries ──

    /** Start a new conversation: build system prompt from chunks + template, call LLM, persist */
    startChat: protectedProcedure
      .input(z.object({
        topicId: z.number(),
        projectId: z.number().optional(),
        customPrompt: z.string().optional(),
        promptTemplateId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const topic = await getTopicById(input.topicId);
        if (!topic) throw new Error("Topic not found");

        const topicChunks = input.projectId
          ? await getChunksByTopicAndProject(input.topicId, input.projectId)
          : await getChunksByTopic(input.topicId);
        if (topicChunks.length === 0) throw new Error("No chunks found for this topic");

        const chunksText = topicChunks.map((c, i) => `[片段 ${i + 1}]\n${c.content}`).join("\n\n---\n\n");

        const systemPrompt = input.customPrompt
          ? `${input.customPrompt}\n\n以下是关于「${topic.label}」的文本片段：`
          : `你是一个专业的内容总结助手。请根据以下关于「${topic.label}」话题的多个文本片段，生成一份结构化的总结。\n\n要求：\n- 总结应该涵盖所有片段的核心观点\n- 使用清晰的中文表达\n- 长度适中（300-600字）\n- 可以使用 Markdown 格式`;

        // Build initial messages
        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: chunksText },
        ];

        // Call LLM
        const response = await callLLM({
          taskType: "summarize",
          messages,
        });

        const assistantContent = response.choices[0]?.message?.content;
        if (!assistantContent || typeof assistantContent !== "string") {
          throw new Error("LLM returned empty response");
        }

        // Append assistant reply to messages
        const fullMessages = [
          ...messages,
          { role: "assistant" as const, content: assistantContent },
        ];

        // Persist conversation
        const convId = await createTopicConversation({
          topicId: input.topicId,
          projectId: input.projectId ?? null,
          title: `对话: ${topic.label}`,
          messages: JSON.stringify(fullMessages),
          promptTemplateId: input.promptTemplateId ?? null,
        });

        // Also save as summary for backward compatibility
        await upsertSummary(input.topicId, assistantContent);

        return {
          conversationId: convId,
          assistantMessage: assistantContent,
          messages: fullMessages.filter(m => m.role !== "system"),
        };
      }),

    /** Continue an existing conversation: append user message, call LLM, update DB */
    continueChat: protectedProcedure
      .input(z.object({
        conversationId: z.number(),
        userMessage: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const conv = await getTopicConversation(input.conversationId);
        if (!conv) throw new Error("Conversation not found");

        let messages: Array<{ role: string; content: string }>;
        try {
          messages = JSON.parse(conv.messages);
        } catch {
          throw new Error("Invalid conversation data");
        }

        // Append user message
        messages.push({ role: "user", content: input.userMessage });

        // Call LLM with full context
        const response = await callLLM({
          taskType: "summarize",
          messages: messages as any,
        });

        const assistantContent = response.choices[0]?.message?.content;
        if (!assistantContent || typeof assistantContent !== "string") {
          throw new Error("LLM returned empty response");
        }

        // Append assistant reply
        messages.push({ role: "assistant", content: assistantContent });

        // Update conversation in DB
        await updateTopicConversation(input.conversationId, {
          messages: JSON.stringify(messages),
        });

        // Also update summary with latest assistant message
        await upsertSummary(conv.topicId, assistantContent);

        return {
          assistantMessage: assistantContent,
          messages: messages.filter(m => m.role !== "system"),
        };
      }),

    /** List conversations for a topic */
    listConversations: protectedProcedure
      .input(z.object({
        topicId: z.number(),
        projectId: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const convs = await getConversationsByTopic(input.topicId, input.projectId);
        return convs.map(c => ({
          id: c.id,
          title: c.title,
          topicId: c.topicId,
          projectId: c.projectId,
          promptTemplateId: c.promptTemplateId,
          messageCount: (() => {
            try { return JSON.parse(c.messages).filter((m: any) => m.role !== "system").length; } catch { return 0; }
          })(),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
      }),

    /** Get a single conversation with full messages */
    getConversation: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ input }) => {
        const conv = await getTopicConversation(input.conversationId);
        if (!conv) return null;
        let messages: Array<{ role: string; content: string }> = [];
        try { messages = JSON.parse(conv.messages); } catch { messages = []; }
        return {
          id: conv.id,
          topicId: conv.topicId,
          projectId: conv.projectId,
          title: conv.title,
          promptTemplateId: conv.promptTemplateId,
          messages: messages.filter(m => m.role !== "system"),
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        };
      }),

    /** Delete a conversation */
    deleteConversation: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteTopicConversation(input.conversationId);
        return { success: true };
      }),
  }),

  // ─── Topic Exploration (keyword search + LLM synthesis) ───────────
  explore: router({
    search: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        query: z.string().min(1).max(500),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Search original chunks by keyword
        const matchedChunks = await searchChunksByKeyword(input.projectId, input.query);

        if (matchedChunks.length === 0) {
          return {
            title: input.query,
            summary: "未找到与该关键词相关的内容片段。请尝试其他关键词。",
            chunks: [],
            chunkCount: 0,
          };
        }

        // 2. Prepare chunks text for LLM (limit to avoid token overflow)
        const topChunks = matchedChunks.slice(0, 15);
        const chunksText = topChunks.map((c: any, i: number) => `[片段 ${i + 1} - 来自: ${c.filename}]\n${c.content}`).join("\n\n---\n\n");

        // 3. Build system prompt (use custom if provided)
        const defaultPrompt = `你是一个专业的知识整理助手。用户正在探索关于「${input.query}」的话题。
请根据以下相关文本片段，生成一份结构化的话题总结。

要求：
- 给出一个精炼的话题标题（5-15字）
- 总结涵盖所有片段的核心观点和关键信息
- 使用清晰的中文表达
- 长度适中（300-800字）
- 可以使用 Markdown 格式
- 在总结末尾标注引用了哪些片段编号`;

        const systemPrompt = input.customPrompt
          ? `${input.customPrompt}\n\n用户正在探索关于「${input.query}」的话题。\n\n另外，请按以下 JSON 格式返回：\n{"title": "话题标题（5-15字）", "summary": "总结内容（Markdown）"}\n在总结末尾标注引用了哪些片段编号。`
          : `${defaultPrompt}\n\n返回 JSON 格式：\n{"title": "话题标题", "summary": "总结内容（Markdown）"}`;

        // 4. Call LLM to synthesize
        const response = await callLLM({
          taskType: "explore",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            { role: "user", content: chunksText },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "topic_exploration",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                },
                required: ["title", "summary"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content || typeof content !== "string") {
          return {
            title: input.query,
            summary: "LLM 生成失败，请稍后重试。",
            chunks: topChunks,
            chunkCount: matchedChunks.length,
          };
        }

        const parsed = JSON.parse(content);
        return {
          title: parsed.title,
          summary: parsed.summary,
          chunks: topChunks,
          chunkCount: matchedChunks.length,
        };
      }),

    saveAsTopic: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        summary: z.string(),
        chunkIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        // 1. Create or find topic
        const topicId = await findOrCreateTopic(input.title);

        // 2. Link chunks to topic
        for (const chunkId of input.chunkIds) {
          try {
            await linkChunkToTopic(chunkId, topicId, 1.0);
          } catch {
            // Ignore duplicate links
          }
        }

        // 3. Save summary
        if (input.summary) {
          await upsertSummary(topicId, input.summary);
        }

        return { topicId };
      }),
  }),

  // ─── Merged Chunk Management (per-topic) ─────────────────────────────
  mergedChunk: router({
    // Get merged chunks for a topic
    byTopic: protectedProcedure
      .input(z.object({ topicId: z.number() }))
      .query(async ({ input }) => {
        return getMergedChunksByTopic(input.topicId);
      }),

    // Get all merged chunks for a project (grouped by topic)
    byProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getMergedChunksByProject(input.projectId);
      }),

    // Check if a topic has merged chunks
    hasMerged: protectedProcedure
      .input(z.object({ topicId: z.number() }))
      .query(async ({ input }) => {
        return hasMergedChunksForTopic(input.topicId);
      }),

    // Merge chunks for a topic (LLM-based semantic merging)
    mergeByTopic: protectedProcedure
      .input(z.object({ topicId: z.number(), projectId: z.number() }))
      .mutation(async ({ input }) => {
        const topic = await getTopicById(input.topicId);
        if (!topic) throw new Error("Topic not found");

        // Get all chunks associated with this topic in this project
        const topicChunks = await getChunksByTopicAndProject(input.topicId, input.projectId);
        if (topicChunks.length === 0) throw new Error("No chunks found for this topic");

        // Delete existing merged chunks for this topic
        await deleteMergedChunksByTopic(input.topicId);

        // Group chunks into batches of 5-8 for LLM merging
        const BATCH_MIN = 5;
        const BATCH_MAX = 8;
        const mergedResults: Array<{ content: string; sourceChunkIds: number[] }> = [];

        let i = 0;
        while (i < topicChunks.length) {
          const remaining = topicChunks.length - i;
          let batchSize = Math.min(BATCH_MAX, remaining);
          if (remaining > BATCH_MAX && remaining < BATCH_MIN + BATCH_MIN) {
            batchSize = Math.ceil(remaining / 2);
          }
          const batch = topicChunks.slice(i, i + batchSize);
          i += batchSize;

          const batchText = batch.map((c: any, idx: number) => `[片段 ${idx + 1} (ID: ${c.id})]\n${c.content}`).join("\n\n---\n\n");

          try {
            const response = await callLLM({
              taskType: "chunk_merge",
              messages: [
                {
                  role: "system",
                  content: `你是一个文本合并助手。以下是与话题「${topic.label}」相关的文本片段。请将语义相关的片段合并成更大的段落。

规则：
- 将语义相关的片段合并，不必相邻
- 如果某个片段与其他片段内容差异较大，它应该单独成为一个合并块
- 合并时保留原文内容，不要改写或缩写
- 合并后的段落之间用两个换行符分隔

返回 JSON 格式：
{"groups": [{"chunk_ids": [1, 2, 3], "merged_content": "合并后的内容..."}]}`,
                },
                { role: "user", content: batchText },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "chunk_merge",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      groups: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            chunk_ids: { type: "array", items: { type: "number" } },
                            merged_content: { type: "string" },
                          },
                          required: ["chunk_ids", "merged_content"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["groups"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content;
            if (content && typeof content === "string") {
              const parsed = JSON.parse(content);
              for (const group of parsed.groups) {
                mergedResults.push({
                  content: group.merged_content,
                  sourceChunkIds: group.chunk_ids,
                });
              }
            } else {
              mergedResults.push({
                content: batch.map((c: any) => c.content).join("\n\n"),
                sourceChunkIds: batch.map((c: any) => c.id),
              });
            }
          } catch (err) {
            mergedResults.push({
              content: batch.map((c: any) => c.content).join("\n\n"),
              sourceChunkIds: batch.map((c: any) => c.id),
            });
          }
        }

        // Insert merged chunks into database
        const mergedData = mergedResults.map((m, idx) => ({
          topicId: input.topicId,
          projectId: input.projectId,
          content: m.content,
          sourceChunkIds: JSON.stringify(m.sourceChunkIds),
          position: idx,
        }));

        await insertMergedChunks(mergedData);

        return {
          mergedCount: mergedResults.length,
          originalCount: topicChunks.length,
        };
      }),
  }),

  // ─── LLM Settings Router ──────────────────────────────────────────
  llmSettings: router({
    getConfig: protectedProcedure.query(async () => {
      const config = await getActiveLlmConfig();
      if (!config) {
        return {
          provider: "builtin",
          baseUrl: "",
          apiKey: "",
          defaultModel: "gemini-2.5-flash",
          taskModels: {} as Record<string, string>,
          hasApiKey: false,
        };
      }
      let taskModels: Record<string, string> = {};
      if (config.taskModels) {
        try { taskModels = JSON.parse(config.taskModels); } catch { taskModels = {}; }
      }
      return {
        provider: config.provider,
        baseUrl: config.baseUrl || "",
        apiKey: "", // Never return the actual key
        defaultModel: config.defaultModel || "",
        taskModels,
        hasApiKey: !!config.apiKeyEncrypted,
      };
    }),

    saveConfig: protectedProcedure
      .input(z.object({
        provider: z.string(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(), // plain text, will be encoded
        defaultModel: z.string().optional(),
        taskModels: z.record(z.string(), z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKeyEncrypted = input.apiKey ? encodeApiKey(input.apiKey) : undefined;
        await upsertLlmConfig({
          provider: input.provider,
          baseUrl: input.baseUrl || null,
          apiKeyEncrypted: apiKeyEncrypted || null,
          defaultModel: input.defaultModel || null,
          taskModels: input.taskModels ? JSON.stringify(input.taskModels) : null,
        });
        return { success: true };
      }),

    getProviderDefaults: protectedProcedure.query(() => {
      return getProviderDefaults();
    }),

    fetchModels: protectedProcedure
      .input(z.object({
        provider: z.string(),
        baseUrl: z.string().optional(),
        apiKey: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const baseUrl = (input.baseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "");
          const response = await fetch(`${baseUrl}/models`, {
            method: "GET",
            headers: {
              authorization: `Bearer ${input.apiKey}`,
              ...(input.provider === "openrouter" ? {
                "HTTP-Referer": "https://cortex.litch.app",
                "X-Title": "Litch's Cortex",
              } : {}),
            },
          });
          if (!response.ok) {
            const errText = await response.text();
            return { success: false, models: [] as Array<{ id: string; name: string; context_length?: number; pricing?: any }>, error: `${response.status}: ${errText.substring(0, 200)}` };
          }
          const data = await response.json();
          // OpenRouter returns { data: [...] }, OpenAI returns { data: [...] }
          const rawModels = data.data || data.models || [];
          const models = rawModels.map((m: any) => ({
            id: m.id || m.model,
            name: m.name || m.id || m.model,
            context_length: m.context_length || m.max_tokens,
            pricing: m.pricing || null,
          })).sort((a: any, b: any) => (a.name || a.id).localeCompare(b.name || b.id));
          return { success: true, models, error: null };
        } catch (err: any) {
          return { success: false, models: [] as Array<{ id: string; name: string; context_length?: number; pricing?: any }>, error: err.message };
        }
      }),

    testConnection: protectedProcedure
      .input(z.object({
        provider: z.string(),
        baseUrl: z.string().optional(),
        apiKey: z.string(),
        model: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          // Test by making a simple LLM call
          const baseUrl = (input.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
          const model = input.model || "gpt-4.1-mini";
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${input.apiKey}`,
              ...(input.provider === "openrouter" ? {
                "HTTP-Referer": "https://cortex.litch.app",
                "X-Title": "Litch's Cortex",
              } : {}),
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: "Say hello in 5 words." }],
              max_tokens: 50,
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            return { success: false, error: `${response.status}: ${errText.substring(0, 200)}` };
          }
          const data = await response.json();
          const reply = data.choices?.[0]?.message?.content || "(no response)";
          return { success: true, reply, model: data.model };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }),
  }),

  // ─── Prompt Template Router ──────────────────────────────────────
  promptTemplate: router({
    list: protectedProcedure.query(async () => {
      // Seed presets on first access
      await seedPresetTemplates();
      return getAllPromptTemplates();
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getPromptTemplateById(input.id);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        systemPrompt: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createPromptTemplate({
          name: input.name,
          description: input.description || null,
          systemPrompt: input.systemPrompt,
          isPreset: 0,
          createdBy: (ctx.user as any)?.cortexUserId || null,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        systemPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await updatePromptTemplate(input.id, {
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePromptTemplate(input.id);
        return { success: true };
      }),

    importFile: protectedProcedure
      .input(z.object({
        fileName: z.string(),
        fileContent: z.string(), // base64 encoded file content
        fileType: z.enum(["skill", "md"]),
      }))
      .mutation(async ({ input, ctx }) => {
        let promptContent = "";
        let templateName = input.fileName.replace(/\.(skill|md)$/i, "");

        if (input.fileType === "md") {
          // Directly decode base64 to text
          promptContent = Buffer.from(input.fileContent, "base64").toString("utf-8");
          // Try to extract name from frontmatter
          const fmMatch = promptContent.match(/^---\n[\s\S]*?name:\s*(.+?)\n[\s\S]*?---/);
          if (fmMatch) {
            templateName = fmMatch[1].trim().replace(/^["']|["']$/g, "");
          }
        } else if (input.fileType === "skill") {
          // .skill is a zip file containing SKILL.md
          const AdmZip = (await import("adm-zip")).default;
          const zipBuffer = Buffer.from(input.fileContent, "base64");
          const zip = new AdmZip(zipBuffer);
          const entries = zip.getEntries();
          // Find SKILL.md in the zip
          const skillEntry = entries.find((e: any) =>
            e.entryName.endsWith("SKILL.md") || e.entryName === "SKILL.md"
          );
          if (!skillEntry) {
            throw new Error(".skill 文件中未找到 SKILL.md");
          }
          promptContent = skillEntry.getData().toString("utf-8");
          // Try to extract name from frontmatter
          const fmMatch = promptContent.match(/^---\n[\s\S]*?name:\s*(.+?)\n[\s\S]*?---/);
          if (fmMatch) {
            templateName = fmMatch[1].trim().replace(/^["']|["']$/g, "");
          }
        }

        if (!promptContent.trim()) {
          throw new Error("文件内容为空");
        }

        const id = await createPromptTemplate({
          name: templateName,
          description: `从文件 ${input.fileName} 导入`,
          systemPrompt: promptContent.trim(),
          isPreset: 0,
          createdBy: (ctx.user as any)?.cortexUserId || null,
        });

        return {
          id,
          name: templateName,
          contentLength: promptContent.length,
          preview: promptContent.substring(0, 200) + (promptContent.length > 200 ? "..." : ""),
        };
      }),
  }),

  // ─── Embedding Management ───────────────────────────────────────────
  embedding: router({
    // Get embedding status for a project
    status: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        const counts = await getEmbeddingCountByProject(input.projectId);
        return {
          totalChunks: counts.total,
          embeddedChunks: counts.withEmbedding,
          percentage: counts.total > 0 ? Math.round((counts.withEmbedding / counts.total) * 100) : 0,
        };
      }),

    // Generate embeddings for all un-embedded chunks in a project
    generateForProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        const chunksToEmbed = await getChunksWithoutEmbedding(input.projectId);
        if (chunksToEmbed.length === 0) {
          return { generated: 0, message: "所有分段已有向量，无需重新生成。" };
        }

        // Truncate long texts to avoid token limits (max ~8000 chars per chunk for embedding)
        const texts = chunksToEmbed.map(c => c.content.slice(0, 8000));

        try {
          const results = await generateEmbeddingsBatch(texts);

          const embeddingData = results.map((r, idx) => ({
            chunkId: chunksToEmbed[idx].id,
            embedding: JSON.stringify(r.embedding),
            model: r.model,
            dimensions: r.dimensions,
          }));

          await insertChunkEmbeddingsBatch(embeddingData);

          return {
            generated: results.length,
            model: results[0]?.model || "unknown",
            dimensions: results[0]?.dimensions || 0,
            message: `已为 ${results.length} 个分段生成向量。`,
          };
        } catch (err: any) {
          throw new Error(`Embedding 生成失败: ${err.message}`);
        }
      }),

    // Generate embedding for specific chunks
    generateForChunks: protectedProcedure
      .input(z.object({
        chunkIds: z.array(z.number()).min(1).max(500),
      }))
      .mutation(async ({ input }) => {
        // Get chunk contents
        const chunkContents: Array<{ id: number; content: string }> = [];
        for (const id of input.chunkIds) {
          const chunk = await getChunkById(id);
          if (chunk) {
            chunkContents.push({ id: chunk.id, content: chunk.content });
          }
        }

        if (chunkContents.length === 0) {
          return { generated: 0, message: "未找到指定的分段。" };
        }

        const texts = chunkContents.map(c => c.content.slice(0, 8000));
        const results = await generateEmbeddingsBatch(texts);

        const embeddingData = results.map((r, idx) => ({
          chunkId: chunkContents[idx].id,
          embedding: JSON.stringify(r.embedding),
          model: r.model,
          dimensions: r.dimensions,
        }));

        await insertChunkEmbeddingsBatch(embeddingData);

        return {
          generated: results.length,
          message: `已为 ${results.length} 个分段生成向量。`,
        };
      }),

    // Semantic search using embeddings
    semanticSearch: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        query: z.string().min(1).max(500),
        topK: z.number().min(1).max(50).default(15),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // 1. Generate embedding for the query
        let queryEmbedding: number[];
        try {
          const result = await generateEmbedding(input.query);
          queryEmbedding = result.embedding;
        } catch (err: any) {
          // Fallback to keyword search if embedding fails
          throw new Error(`向量搜索失败，请检查 Embedding 配置: ${err.message}`);
        }

        // 2. Get all embeddings for the project
        const projectEmbeddings = await getEmbeddingsByProject(input.projectId);

        if (projectEmbeddings.length === 0) {
          // No embeddings, fallback to keyword search
          const matchedChunks = await searchChunksByKeyword(input.projectId, input.query);
          if (matchedChunks.length === 0) {
            return {
              title: input.query,
              summary: "未找到相关内容。请先在分段预览页生成向量，或尝试关键词搜索。",
              chunks: [],
              chunkCount: 0,
              searchMode: "none" as const,
              similarities: [] as number[],
            };
          }
          const topChunks = matchedChunks.slice(0, input.topK);
          return {
            title: input.query,
            summary: "未找到向量数据，已自动回退到关键词搜索。请在分段预览页生成向量以启用语义搜索。",
            chunks: topChunks,
            chunkCount: matchedChunks.length,
            searchMode: "keyword" as const,
            similarities: [] as number[],
          };
        }

        // 3. Calculate cosine similarity for each chunk
        const similarities: Array<{ chunkId: number; similarity: number; embedding: any }> = [];

        for (const emb of projectEmbeddings) {
          try {
            const embVector = JSON.parse(emb.embedding) as number[];
            const sim = cosineSimilarity(queryEmbedding, embVector);
            similarities.push({ chunkId: emb.chunkId, similarity: sim, embedding: emb });
          } catch {
            // Skip invalid embeddings
          }
        }

        // 4. Sort by similarity and take top-K
        similarities.sort((a, b) => b.similarity - a.similarity);
        const topResults = similarities.slice(0, input.topK);

        if (topResults.length === 0) {
          return {
            title: input.query,
            summary: "未找到相关内容。",
            chunks: [],
            chunkCount: 0,
            searchMode: "semantic" as const,
            similarities: [] as number[],
          };
        }

        // 5. Fetch full chunk data for top results
        const chunkIds = topResults.map(r => r.chunkId);
        const chunkDataMap = new Map<number, any>();
        for (const id of chunkIds) {
          const chunk = await getChunkById(id);
          if (chunk) chunkDataMap.set(id, chunk);
        }

        const topChunks = topResults
          .filter(r => chunkDataMap.has(r.chunkId))
          .map(r => {
            const chunk = chunkDataMap.get(r.chunkId)!;
            return {
              id: chunk.id,
              documentId: chunk.documentId,
              content: chunk.content,
              filename: (chunk as any).filename || `doc:${chunk.documentId}`,
              similarity: Math.round(r.similarity * 10000) / 10000,
            };
          });

        // 6. Build LLM synthesis prompt
        const chunksText = topChunks.map((c, i) =>
          `[片段 ${i + 1} - 来自: ${c.filename} | 相似度: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`
        ).join("\n\n---\n\n");

        const defaultPrompt = `你是一个专业的知识整理助手。用户正在探索关于「${input.query}」的话题。
请根据以下相关文本片段（按语义相似度排序），生成一份结构化的话题总结。

要求：
- 给出一个精炼的话题标题（5-15字）
- 总结涵盖所有片段的核心观点和关键信息
- 使用清晰的中文表达
- 长度适中（300-800字）
- 可以使用 Markdown 格式
- 在总结末尾标注引用了哪些片段编号`;

        const systemPrompt = input.customPrompt
          ? `${input.customPrompt}\n\n用户正在探索关于「${input.query}」的话题。\n\n另外，请按以下 JSON 格式返回：\n{"title": "话题标题（5-15字）", "summary": "总结内容（Markdown）"}\n在总结末尾标注引用了哪些片段编号。`
          : `${defaultPrompt}\n\n返回 JSON 格式：\n{"title": "话题标题", "summary": "总结内容（Markdown）"}`;

        try {
          const response = await callLLM({
            taskType: "explore",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: chunksText },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "topic_exploration",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                  },
                  required: ["title", "summary"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = response.choices[0]?.message?.content;
          if (!content || typeof content !== "string") {
            return {
              title: input.query,
              summary: "LLM 生成失败，请稍后重试。",
              chunks: topChunks,
              chunkCount: topChunks.length,
              searchMode: "semantic" as const,
              similarities: topChunks.map(c => c.similarity),
            };
          }

          const parsed = JSON.parse(content);
          return {
            title: parsed.title,
            summary: parsed.summary,
            chunks: topChunks,
            chunkCount: topChunks.length,
            searchMode: "semantic" as const,
            similarities: topChunks.map(c => c.similarity),
          };
        } catch (llmErr: any) {
          // Return results without LLM synthesis
          return {
            title: input.query,
            summary: `向量搜索完成，但 LLM 总结生成失败: ${llmErr.message?.substring(0, 100)}`,
            chunks: topChunks,
            chunkCount: topChunks.length,
            searchMode: "semantic" as const,
            similarities: topChunks.map(c => c.similarity),
          };
        }
      }),

    // Get embedding config
    getConfig: protectedProcedure
      .query(async () => {
        const config = await getCurrentEmbeddingConfig();
        const dbConfig = await getActiveEmbeddingConfig();
        // Check if LLM config has an OpenRouter key that can be reused
        const llmConfig = await getActiveLlmConfig();
        const llmHasOpenRouterKey = !!(llmConfig?.provider === "openrouter" && llmConfig?.apiKeyEncrypted);
        return {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          dimensions: config.dimensions,
          hasApiKey: !!config.apiKey,
          isConfigured: !!dbConfig,
          llmHasOpenRouterKey,
          // Raw DB config provider (before fallback resolution)
          dbProvider: dbConfig?.provider || null,
        };
      }),

    // Save embedding config
    saveConfig: protectedProcedure
      .input(z.object({
        provider: z.string(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        model: z.string().optional(),
        dimensions: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKeyEncrypted = input.apiKey ? encodeApiKey(input.apiKey) : undefined;
        await upsertEmbeddingConfig({
          provider: input.provider,
          baseUrl: input.baseUrl || null,
          apiKeyEncrypted: apiKeyEncrypted || null,
          model: input.model || null,
          dimensions: input.dimensions || null,
        });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
