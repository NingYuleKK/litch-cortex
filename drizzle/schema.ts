import { int, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, float, bigint, uniqueIndex, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing Manus OAuth flow (kept for compatibility).
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Independent Cortex users - username/password auth (replaces Manus OAuth for production)
 */
export const cortexUsers = mysqlTable("cortex_users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 256 }).notNull(),
  displayName: varchar("displayName", { length: 128 }),
  role: mysqlEnum("role", ["admin", "member"]).default("member").notNull(),
  initialPassword: varchar("initialPassword", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type CortexUser = typeof cortexUsers.$inferSelect;
export type InsertCortexUser = typeof cortexUsers.$inferInsert;

/**
 * Projects - top-level grouping for documents
 */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // legacy Manus OAuth user id
  cortexUserId: int("cortexUserId"), // new independent auth user id
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Uploaded PDF documents
 */
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  filename: varchar("filename", { length: 512 }).notNull(),
  fileUrl: text("fileUrl"),
  rawText: mediumtext("rawText"),
  uploadTime: timestamp("uploadTime").defaultNow().notNull(),
  status: mysqlEnum("status", ["uploading", "parsing", "extracting", "done", "error"]).default("uploading").notNull(),
  chunkCount: int("chunkCount").default(0).notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

/**
 * Text chunks from parsed documents or conversations.
 * documentId and conversationId are mutually exclusive:
 *   - PDF chunks: documentId set, conversationId null
 *   - Conversation chunks: conversationId set, documentId null
 * stableId enables incremental dedup for conversation imports.
 */
export const chunks = mysqlTable("chunks", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId"),                         // nullable for conversation chunks
  conversationId: int("conversationId"),                 // V0.8: FK → conversations
  projectId: int("projectId"),                           // V0.9: denormalized for fast single-table queries
  content: mediumtext("content").notNull(),
  position: int("position").notNull(),
  tokenCount: int("tokenCount").default(0).notNull(),
  stableId: varchar("stableId", { length: 512 }),        // V0.8: unique dedup key
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("chunks_stableId_idx").on(table.stableId),
  index("chunks_conversationId_idx").on(table.conversationId),
  index("chunks_projectId_idx").on(table.projectId),
]);

export type Chunk = typeof chunks.$inferSelect;
export type InsertChunk = typeof chunks.$inferInsert;

/**
 * Topics extracted by LLM
 */
export const topics = mysqlTable("topics", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 256 }).notNull().unique(),
  description: text("description"),
  weight: int("weight").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Topic = typeof topics.$inferSelect;
export type InsertTopic = typeof topics.$inferInsert;

/**
 * Many-to-many relationship between chunks and topics
 */
export const chunkTopics = mysqlTable("chunk_topics", {
  id: int("id").autoincrement().primaryKey(),
  chunkId: int("chunkId").notNull(),
  topicId: int("topicId").notNull(),
  relevanceScore: float("relevanceScore").default(1.0).notNull(),
}, (table) => [
  uniqueIndex("chunk_topics_chunk_topic_idx").on(table.chunkId, table.topicId),
]);

export type ChunkTopic = typeof chunkTopics.$inferSelect;
export type InsertChunkTopic = typeof chunkTopics.$inferInsert;

/**
 * Summaries for topics
 */
export const summaries = mysqlTable("summaries", {
  id: int("id").autoincrement().primaryKey(),
  topicId: int("topicId").notNull(),
  summaryText: mediumtext("summaryText").notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
});

export type Summary = typeof summaries.$inferSelect;
export type InsertSummary = typeof summaries.$inferInsert;

/**
 * Merged chunks - LLM-merged groups of semantically related chunks per topic.
 * Original chunks are preserved; this is an overlay layer.
 */
export const mergedChunks = mysqlTable("merged_chunks", {
  id: int("id").autoincrement().primaryKey(),
  topicId: int("topicId").notNull(),
  projectId: int("projectId"),
  content: mediumtext("content").notNull(),
  sourceChunkIds: text("sourceChunkIds").notNull(), // JSON array of chunk IDs
  position: int("position").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MergedChunk = typeof mergedChunks.$inferSelect;
export type InsertMergedChunk = typeof mergedChunks.$inferInsert;

/**
 * LLM configuration - stores provider settings and per-task model overrides.
 * API keys are stored base64-encoded (not plaintext).
 */
export const llmConfig = mysqlTable("llm_config", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull().default("builtin"), // builtin | openai | openrouter | custom
  baseUrl: varchar("baseUrl", { length: 512 }),
  apiKeyEncrypted: text("apiKeyEncrypted"), // base64-encoded API key
  defaultModel: varchar("defaultModel", { length: 256 }),
  // Per-task model overrides (JSON: { task_type: model_name })
  taskModels: text("taskModels"), // JSON: { topic_extract: "...", summarize: "...", explore: "...", chunk_merge: "..." }
  isActive: int("isActive").default(1).notNull(), // only one active config at a time
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LlmConfig = typeof llmConfig.$inferSelect;
export type InsertLlmConfig = typeof llmConfig.$inferInsert;

/**
 * Prompt templates - stored in DB for multi-user access.
 * Replaces localStorage-based custom prompt storage.
 */
export const promptTemplates = mysqlTable("prompt_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 512 }),
  systemPrompt: mediumtext("systemPrompt").notNull(),
  isPreset: int("isPreset").default(0).notNull(), // 1 = system preset, 0 = user-created
  createdBy: int("createdBy"), // cortexUserId, null for system presets
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplates.$inferInsert;

/**
 * Topic conversations - stores multi-turn chat context for topic summaries.
 * Each conversation is tied to a topic and optionally a project.
 * Messages are stored as JSON array of {role, content} objects.
 */
export const topicConversations = mysqlTable("topic_conversations", {
  id: int("id").autoincrement().primaryKey(),
  topicId: int("topicId").notNull(),
  projectId: int("projectId"),
  title: varchar("title", { length: 256 }),  // auto-generated or user-set title
  messages: mediumtext("messages").notNull(), // JSON array of {role, content}
  promptTemplateId: int("promptTemplateId"), // which template was used to start
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TopicConversation = typeof topicConversations.$inferSelect;
export type InsertTopicConversation = typeof topicConversations.$inferInsert;

/**
 * Chunk embeddings - stores vector embeddings for semantic search.
 * Embedding vectors are stored as JSON text (array of floats).
 */
export const chunkEmbeddings = mysqlTable("chunk_embeddings", {
  id: int("id").autoincrement().primaryKey(),
  chunkId: int("chunkId").notNull(),
  embedding: mediumtext("embedding").notNull(), // JSON array of floats
  model: varchar("model", { length: 256 }).notNull(), // e.g. "text-embedding-3-small"
  dimensions: int("dimensions").default(0).notNull(), // vector dimension count
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChunkEmbedding = typeof chunkEmbeddings.$inferSelect;
export type InsertChunkEmbedding = typeof chunkEmbeddings.$inferInsert;

/**
 * Embedding configuration - separate from LLM config.
 * Stores provider/model/key specifically for embedding generation.
 */
export const embeddingConfig = mysqlTable("embedding_config", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull().default("openai"), // openai | custom
  baseUrl: varchar("baseUrl", { length: 512 }),
  apiKeyEncrypted: text("apiKeyEncrypted"), // base64-encoded API key
  model: varchar("model", { length: 256 }).notNull().default("text-embedding-3-small"),
  dimensions: int("dimensions").default(1536).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmbeddingConfig = typeof embeddingConfig.$inferSelect;
export type InsertEmbeddingConfig = typeof embeddingConfig.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// V0.8 — Conversation JSON Import
// ═══════════════════════════════════════════════════════════════════

/**
 * Imported conversations — parallel source entity to documents.
 * Each conversation maps to a ChatGPT (or future Claude/Gemini) exported dialogue.
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  cortexUserId: int("cortexUserId").notNull(),
  externalId: varchar("externalId", { length: 128 }).notNull(), // platform conversation_id
  title: varchar("title", { length: 512 }),
  source: varchar("source", { length: 32 }).notNull().default("chatgpt"), // chatgpt | claude | gemini
  model: varchar("model", { length: 128 }),                     // primary model_slug
  messageCount: int("messageCount").default(0).notNull(),       // visible message count
  createTime: timestamp("createTime"),                          // original conversation create_time
  updateTime: timestamp("updateTime"),                          // original conversation update_time
  status: mysqlEnum("status", ["importing", "done", "error"]).default("importing").notNull(),
  rawMetadata: mediumtext("rawMetadata"),                        // audit-layer JSON (not indexed)
  importLogId: int("importLogId"),                              // FK → import_logs
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("conversations_project_external_idx").on(table.projectId, table.externalId),
  index("conversations_projectId_idx").on(table.projectId),
]);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Conversation messages — the stable diff unit between conversations and chunks.
 * Only visible user/assistant messages are stored (filtering at parse time).
 */
export const conversationMessages = mysqlTable("conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),              // FK → conversations
  externalMessageId: varchar("externalMessageId", { length: 128 }).notNull(),
  role: varchar("role", { length: 32 }).notNull(),               // "user" | "assistant"
  content: mediumtext("content").notNull(),                      // joined text from parts[]
  contentHash: varchar("contentHash", { length: 64 }).notNull(), // SHA-256 hex for diff
  position: int("position").notNull(),                           // order in main chain (0-based)
  modelSlug: varchar("modelSlug", { length: 128 }),
  createTime: timestamp("createTime"),                           // from message.create_time
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("convmsg_conv_idx").on(table.conversationId),
  uniqueIndex("convmsg_ext_idx").on(table.conversationId, table.externalMessageId),
]);

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type InsertConversationMessage = typeof conversationMessages.$inferInsert;

/**
 * Import logs — attribution logging for every import operation.
 * Tracks stats, errors, and timing for observability and debugging.
 */
export const importLogs = mysqlTable("import_logs", {
  id: int("id").autoincrement().primaryKey(),
  cortexUserId: int("cortexUserId"),
  projectId: int("projectId"),
  filename: varchar("filename", { length: 512 }).notNull(),
  fileSize: bigint("fileSize", { mode: "number" }),              // bytes
  // Stats
  conversationsTotal: int("conversationsTotal").default(0).notNull(),
  conversationsImported: int("conversationsImported").default(0).notNull(),
  conversationsSkipped: int("conversationsSkipped").default(0).notNull(),
  conversationsUpdated: int("conversationsUpdated").default(0).notNull(),
  messagesTotal: int("messagesTotal").default(0).notNull(),
  chunksCreated: int("chunksCreated").default(0).notNull(),
  chunksSkipped: int("chunksSkipped").default(0).notNull(),
  // Errors and conflicts
  conflicts: text("conflicts"),                                   // JSON array of conflict records
  errors: mediumtext("errors"),                                   // JSON array of error messages
  diffReport: mediumtext("diffReport"),                           // V0.9: JSON diff report (new/updated/skipped conversations)
  // Status & timing
  status: mysqlEnum("status", ["running", "completed", "failed", "cancelled"]).default("running").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("importlogs_project_idx").on(table.projectId),
]);

export type ImportLog = typeof importLogs.$inferSelect;
export type InsertImportLog = typeof importLogs.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// V0.9 — Job Queue
// ═══════════════════════════════════════════════════════════════════

/**
 * Background job queue — DB-backed, in-process scheduler.
 * Supports embedding generation, topic extraction, and future task types.
 */
export const jobs = mysqlTable("jobs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  type: varchar("type", { length: 64 }).notNull(),               // "embedding_generation" | "topic_extraction"
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "cancelled"])
    .default("pending").notNull(),
  totalItems: int("totalItems").default(0).notNull(),
  processedItems: int("processedItems").default(0).notNull(),
  attempts: int("attempts").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(3).notNull(),
  lastError: mediumtext("lastError"),
  params: text("params"),                                         // JSON: job-specific parameters
  result: mediumtext("result"),                                   // JSON: completion result
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("jobs_projectId_idx").on(table.projectId),
  index("jobs_status_idx").on(table.status),
  index("jobs_type_status_idx").on(table.type, table.status),
]);

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;
