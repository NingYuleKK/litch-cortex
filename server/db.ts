import { eq, sql, desc, asc, and, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  cortexUsers, InsertCortexUser, CortexUser,
  projects, InsertProject, Project,
  documents, InsertDocument, Document,
  chunks, InsertChunk, Chunk,
  topics, InsertTopic, Topic,
  chunkTopics, InsertChunkTopic,
  summaries, InsertSummary, Summary,
  mergedChunks, InsertMergedChunk, MergedChunk,
  llmConfig, InsertLlmConfig, LlmConfig,
  promptTemplates, InsertPromptTemplate, PromptTemplate,
  topicConversations, InsertTopicConversation, TopicConversation,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User Helpers (Manus OAuth - kept for compatibility) ───────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Project Helpers ────────────────────────────────────────────────

export async function createProject(data: { userId: number; cortexUserId?: number; name: string; description?: string }): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values({
    userId: data.userId,
    cortexUserId: data.cortexUserId ?? null,
    name: data.name,
    description: data.description ?? null,
  });
  return result[0].insertId;
}

export async function getProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: projects.id,
      userId: projects.userId,
      cortexUserId: projects.cortexUserId,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      docCount: sql<number>`COUNT(${documents.id})`.as("docCount"),
    })
    .from(projects)
    .leftJoin(documents, eq(projects.id, documents.projectId))
    .where(eq(projects.userId, userId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
}

export async function getProjectsByCortexUser(cortexUserId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: projects.id,
      userId: projects.userId,
      cortexUserId: projects.cortexUserId,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      docCount: sql<number>`COUNT(${documents.id})`.as("docCount"),
    })
    .from(projects)
    .leftJoin(documents, eq(projects.id, documents.projectId))
    .where(eq(projects.cortexUserId, cortexUserId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function updateProject(id: number, data: { name?: string; description?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
}

// ─── Document Helpers ───────────────────────────────────────────────

export async function createDocument(data: InsertDocument): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documents).values(data);
  return result[0].insertId;
}

export async function updateDocument(id: number, data: Partial<InsertDocument>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documents).set(data).where(eq(documents.id, id));
}

export async function getDocumentsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(desc(documents.uploadTime));
}

export async function getDocumentsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.uploadTime));
}

export async function getDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result[0];
}

// ─── Chunk Helpers ──────────────────────────────────────────────────

export async function insertChunks(data: InsertChunk[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(chunks).values(data);
}

export async function getChunksByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chunks).where(eq(chunks.documentId, documentId)).orderBy(asc(chunks.position));
}

export async function getAllChunksByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      position: chunks.position,
      tokenCount: chunks.tokenCount,
      createdAt: chunks.createdAt,
      filename: documents.filename,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(documents.userId, userId))
    .orderBy(desc(chunks.createdAt));
}

export async function getAllChunksByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      position: chunks.position,
      tokenCount: chunks.tokenCount,
      createdAt: chunks.createdAt,
      filename: documents.filename,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(documents.projectId, projectId))
    .orderBy(desc(chunks.createdAt));
}

export async function getChunkById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chunks).where(eq(chunks.id, id)).limit(1);
  return result[0];
}

// ─── Chunk Search (keyword matching for topic exploration) ──────────

export async function searchChunksByKeyword(projectId: number, keyword: string, limit = 30) {
  const db = await getDb();
  if (!db) return [];

  // Split keyword into individual terms for broader matching
  const terms = keyword.trim().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return [];

  const conditions = terms.map(term => like(chunks.content, `%${term}%`));

  return db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      position: chunks.position,
      tokenCount: chunks.tokenCount,
      createdAt: chunks.createdAt,
      filename: documents.filename,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(and(eq(documents.projectId, projectId), or(...conditions)))
    .orderBy(desc(chunks.createdAt))
    .limit(limit);
}

// ─── Topic Helpers ──────────────────────────────────────────────────

export async function findOrCreateTopic(label: string, description?: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(topics).where(eq(topics.label, label)).limit(1);
  if (existing.length > 0) {
    await db.update(topics).set({ weight: sql`${topics.weight} + 1` }).where(eq(topics.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(topics).values({ label, description, weight: 1 });
  return result[0].insertId;
}

export async function getAllTopicsWithCount() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: topics.id,
      label: topics.label,
      description: topics.description,
      weight: topics.weight,
      createdAt: topics.createdAt,
      chunkCount: sql<number>`COUNT(${chunkTopics.chunkId})`.as("chunkCount"),
    })
    .from(topics)
    .leftJoin(chunkTopics, eq(topics.id, chunkTopics.topicId))
    .groupBy(topics.id)
    .orderBy(desc(topics.weight));
}

export async function getTopicsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  const projectChunkIds = db
    .select({ id: chunks.id })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(documents.projectId, projectId));

  return db
    .select({
      id: topics.id,
      label: topics.label,
      description: topics.description,
      weight: topics.weight,
      createdAt: topics.createdAt,
      chunkCount: sql<number>`COUNT(DISTINCT ${chunkTopics.chunkId})`.as("chunkCount"),
    })
    .from(topics)
    .innerJoin(chunkTopics, eq(topics.id, chunkTopics.topicId))
    .where(inArray(chunkTopics.chunkId, projectChunkIds))
    .groupBy(topics.id)
    .orderBy(desc(sql`chunkCount`));
}

export async function getTopicById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(topics).where(eq(topics.id, id)).limit(1);
  return result[0];
}

export async function getChunksByTopic(topicId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      position: chunks.position,
      tokenCount: chunks.tokenCount,
      createdAt: chunks.createdAt,
      relevanceScore: chunkTopics.relevanceScore,
      filename: documents.filename,
    })
    .from(chunkTopics)
    .innerJoin(chunks, eq(chunkTopics.chunkId, chunks.id))
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(chunkTopics.topicId, topicId))
    .orderBy(desc(chunkTopics.relevanceScore));
}

export async function getChunksByTopicAndProject(topicId: number, projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      position: chunks.position,
      tokenCount: chunks.tokenCount,
      createdAt: chunks.createdAt,
      relevanceScore: chunkTopics.relevanceScore,
      filename: documents.filename,
    })
    .from(chunkTopics)
    .innerJoin(chunks, eq(chunkTopics.chunkId, chunks.id))
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(and(eq(chunkTopics.topicId, topicId), eq(documents.projectId, projectId)))
    .orderBy(desc(chunkTopics.relevanceScore));
}

// ─── ChunkTopic Helpers ─────────────────────────────────────────────

export async function linkChunkToTopic(chunkId: number, topicId: number, relevanceScore: number = 1.0) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(chunkTopics).values({ chunkId, topicId, relevanceScore });
}

// ─── Summary Helpers ────────────────────────────────────────────────

export async function getSummaryByTopic(topicId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(summaries).where(eq(summaries.topicId, topicId)).orderBy(desc(summaries.generatedAt)).limit(1);
  return result[0];
}

export async function upsertSummary(topicId: number, summaryText: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(summaries).where(eq(summaries.topicId, topicId)).limit(1);
  if (existing.length > 0) {
    await db.update(summaries).set({ summaryText, generatedAt: new Date() }).where(eq(summaries.id, existing[0].id));
    return existing[0].id;
  }
  const result = await db.insert(summaries).values({ topicId, summaryText });
  return result[0].insertId;
}

// ─── Merged Chunk Helpers (per-topic) ────────────────────────────────────────

export async function insertMergedChunks(data: InsertMergedChunk[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(mergedChunks).values(data);
}

export async function getMergedChunksByTopic(topicId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mergedChunks).where(eq(mergedChunks.topicId, topicId)).orderBy(asc(mergedChunks.position));
}

export async function getMergedChunksByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: mergedChunks.id,
      topicId: mergedChunks.topicId,
      projectId: mergedChunks.projectId,
      content: mergedChunks.content,
      sourceChunkIds: mergedChunks.sourceChunkIds,
      position: mergedChunks.position,
      createdAt: mergedChunks.createdAt,
      topicLabel: topics.label,
    })
    .from(mergedChunks)
    .innerJoin(topics, eq(mergedChunks.topicId, topics.id))
    .where(eq(mergedChunks.projectId, projectId))
    .orderBy(asc(mergedChunks.topicId), asc(mergedChunks.position));
}

export async function deleteMergedChunksByTopic(topicId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(mergedChunks).where(eq(mergedChunks.topicId, topicId));
}



export async function hasMergedChunksForTopic(topicId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: mergedChunks.id }).from(mergedChunks).where(eq(mergedChunks.topicId, topicId)).limit(1);
  return result.length > 0;
}


// ─── LLM Config Helpers ────────────────────────────────────────────

export async function getActiveLlmConfig(): Promise<LlmConfig | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(llmConfig).where(eq(llmConfig.isActive, 1)).limit(1);
  return results[0] || null;
}

export async function upsertLlmConfig(data: {
  provider: string;
  baseUrl?: string | null;
  apiKeyEncrypted?: string | null;
  defaultModel?: string | null;
  taskModels?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Deactivate all existing configs
  await db.update(llmConfig).set({ isActive: 0 });

  // Check if there's an existing config to update
  const existing = await db.select().from(llmConfig).limit(1);
  if (existing.length > 0) {
    await db.update(llmConfig)
      .set({
        provider: data.provider,
        baseUrl: data.baseUrl ?? null,
        apiKeyEncrypted: data.apiKeyEncrypted ?? null,
        defaultModel: data.defaultModel ?? null,
        taskModels: data.taskModels ?? null,
        isActive: 1,
      })
      .where(eq(llmConfig.id, existing[0].id));
    return existing[0].id;
  }

  // Insert new config
  const result = await db.insert(llmConfig).values({
    provider: data.provider,
    baseUrl: data.baseUrl ?? null,
    apiKeyEncrypted: data.apiKeyEncrypted ?? null,
    defaultModel: data.defaultModel ?? null,
    taskModels: data.taskModels ?? null,
    isActive: 1,
  });
  return Number(result[0].insertId);
}

// ─── Prompt Template Helpers ───────────────────────────────────────

export async function getAllPromptTemplates(): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(promptTemplates).orderBy(promptTemplates.isPreset, promptTemplates.id);
}

export async function getPromptTemplateById(id: number): Promise<PromptTemplate | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).limit(1);
  return results[0] || null;
}

export async function createPromptTemplate(data: {
  name: string;
  description?: string | null;
  systemPrompt: string;
  isPreset?: number;
  createdBy?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(promptTemplates).values({
    name: data.name,
    description: data.description ?? null,
    systemPrompt: data.systemPrompt,
    isPreset: data.isPreset ?? 0,
    createdBy: data.createdBy ?? null,
  });
  return Number(result[0].insertId);
}

export async function updatePromptTemplate(id: number, data: {
  name?: string;
  description?: string | null;
  systemPrompt?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Record<string, any> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt;
  await db.update(promptTemplates).set(updateData).where(eq(promptTemplates.id, id));
}

export async function deletePromptTemplate(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Only allow deleting non-preset templates
  await db.delete(promptTemplates).where(
    and(eq(promptTemplates.id, id), eq(promptTemplates.isPreset, 0))
  );
}

// ─── Topic Conversation Helpers ────────────────────────────────────

export async function createTopicConversation(data: {
  topicId: number;
  projectId?: number | null;
  title?: string | null;
  messages: string; // JSON string
  promptTemplateId?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(topicConversations).values({
    topicId: data.topicId,
    projectId: data.projectId ?? null,
    title: data.title ?? null,
    messages: data.messages,
    promptTemplateId: data.promptTemplateId ?? null,
  });
  return result[0].insertId;
}

export async function getTopicConversation(id: number): Promise<TopicConversation | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(topicConversations).where(eq(topicConversations.id, id)).limit(1);
  return results[0] || null;
}

export async function getConversationsByTopic(topicId: number, projectId?: number): Promise<TopicConversation[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(topicConversations.topicId, topicId)];
  if (projectId !== undefined) {
    conditions.push(eq(topicConversations.projectId, projectId));
  }
  return db.select().from(topicConversations)
    .where(and(...conditions))
    .orderBy(desc(topicConversations.updatedAt));
}

export async function updateTopicConversation(id: number, data: {
  messages?: string;
  title?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Record<string, any> = {};
  if (data.messages !== undefined) updateData.messages = data.messages;
  if (data.title !== undefined) updateData.title = data.title;
  await db.update(topicConversations).set(updateData).where(eq(topicConversations.id, id));
}

export async function deleteTopicConversation(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(topicConversations).where(eq(topicConversations.id, id));
}

export async function seedPresetTemplates(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Check if presets already exist
  const existing = await db.select().from(promptTemplates).where(eq(promptTemplates.isPreset, 1)).limit(1);
  if (existing.length > 0) return;

  // Insert preset templates
  const presets = [
    {
      name: "学术总结",
      description: "结构化学术风格，涵盖核心论点与论据",
      systemPrompt: `你是一个专业的学术内容总结助手。请根据提供的文本片段，生成一份结构化的学术总结。

要求：
- 总结应该涵盖所有片段的核心观点和论据
- 使用清晰的中文学术表达
- 按照"背景→核心论点→论据支撑→结论"的结构组织
- 长度适中（300-600字）
- 使用 Markdown 格式`,
      isPreset: 1,
    },
    {
      name: "Blog 风格",
      description: "轻松易读的博客文章风格",
      systemPrompt: `你是一个优秀的博客写手。请根据提供的文本片段，生成一篇轻松易读的博客风格文章。

要求：
- 语言生动有趣，适合公开发表
- 可以加入个人见解和思考
- 使用短段落和小标题提升可读性
- 长度适中（400-800字）
- 使用 Markdown 格式，善用加粗和引用`,
      isPreset: 1,
    },
    {
      name: "读书笔记",
      description: "要点提炼 + 金句 + 个人感悟框架",
      systemPrompt: `你是一个善于做读书笔记的助手。请根据提供的文本片段，生成一份读书笔记风格的总结。

要求：
- 提炼关键要点，使用编号列表
- 标注值得记忆的金句（用 > 引用格式）
- 对重要观点加上简短批注或思考
- 标注值得深入研究的方向
- 在末尾留出"个人感悟"框架供用户填写
- 使用 Markdown 格式`,
      isPreset: 1,
    },
    {
      name: "对话摘要",
      description: "简洁的对话要点提取",
      systemPrompt: `你是一个对话分析助手。请根据提供的文本片段，生成一份简洁的对话摘要。

要求：
- 提炼对话中的核心议题和结论
- 标注不同参与者的主要观点（如果能识别）
- 总结达成的共识和分歧点
- 列出对话中提到的行动项或待办事项（如有）
- 保持简洁，长度控制在 200-400 字
- 使用 Markdown 格式`,
      isPreset: 1,
    },
    {
      name: "对话转Blog (Beta Skill)",
      description: "四阶段工作流：结构标注→大纲→初稿→自检精炼，将对话转写为高密度Blog",
      systemPrompt: `# Dialogue to Blog (Beta)

Transform raw dialogues into structured, readable blog posts through a four-phase workflow.

## Workflow

### Phase 0: Structural Tagging
Scan the entire text and tag each segment:
- [机制] Technical mechanism / how something works
- [哲学] Philosophical assumption / worldview premise
- [判断] Author's judgment / conclusion
- [未尽] Unfinished thought / deliberately held back
- [例证] Example / analogy / case study
- [可删] Redundant or tangential (skip in blog)

Identify 3-7 core concepts. Create a Term Anchor Table for consistency.

### Phase 1: Outline Generation
Based on structural tags, generate outline:
1. [开篇钩子] ← 来自 [判断] 或 [哲学] 标签
2. [主论证] ← 来自 [机制] 标签
3. [支撑/例证] ← 来自 [例证] 标签
4. [延伸/未尽] ← 来自 [未尽] 标签
5. [收束] ← 来自 [判断] 标签

### Phase 2: Draft Generation
Write full blog post with:
- Prose essay format (no dialogue traces)
- Flowing paragraphs, minimal headers
- Active voice, conversational but precise
- Preserve intellectual density without sacrificing readability
- Strong opening hook (no "本文将讨论...")
- Smooth transitions (no "接下来我们看...")
- Examples woven naturally, not listed

### Phase 3: Self-Refinement
- Reader Anchor Check: identify passages that assume context only in original dialogue
- Tension Reduction: identify over-emphatic passages, reduce redundancy
- Apply refinements and output final version

Output in Markdown format.`,
      isPreset: 1,
    },
  ];

  for (const preset of presets) {
    await db.insert(promptTemplates).values(preset);
  }
}
