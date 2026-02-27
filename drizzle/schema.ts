import { int, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, float, bigint } from "drizzle-orm/mysql-core";

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
 * Text chunks from parsed documents
 */
export const chunks = mysqlTable("chunks", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull(),
  content: mediumtext("content").notNull(),
  position: int("position").notNull(),
  tokenCount: int("tokenCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
});

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
