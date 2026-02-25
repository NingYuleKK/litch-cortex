import { eq, sql, desc, asc, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  projects, InsertProject, Project,
  documents, InsertDocument, Document,
  chunks, InsertChunk, Chunk,
  topics, InsertTopic, Topic,
  chunkTopics, InsertChunkTopic,
  summaries, InsertSummary, Summary,
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

// ─── User Helpers ───────────────────────────────────────────────────

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

export async function createProject(data: { userId: number; name: string; description?: string }): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values({
    userId: data.userId,
    name: data.name,
    description: data.description ?? null,
  });
  return result[0].insertId;
}

export async function getProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Get projects with document count
  const rows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
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
  return rows;
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

/**
 * Get topics scoped to a specific project.
 * Joins through chunk_topics → chunks → documents to filter by projectId.
 */
export async function getTopicsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  // Find all chunk IDs belonging to this project
  const projectChunkIds = db
    .select({ id: chunks.id })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(documents.projectId, projectId));

  // Get topics that have at least one chunk in this project
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

/**
 * Get chunks for a topic, scoped to a specific project.
 */
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
