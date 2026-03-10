/**
 * Conversation Chunker — V0.8
 *
 * Chunks conversation messages into text segments suitable for
 * topic extraction and semantic search.
 *
 * Strategy: Q&A pairs as natural units (message-aware hybrid chunking).
 *   - Pair consecutive user + assistant messages
 *   - Target 500-800 chars per chunk (matching PDF chunk size)
 *   - Long messages split at sentence boundaries
 *   - Each chunk gets a context prefix and a stable ID
 */
import { createHash } from "crypto";
import type { ParsedMessage } from "./chatgpt-parser";
import { chunkText } from "./uploadRoute";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ConversationChunk {
  content: string;
  position: number;              // chunk index within this conversation
  stableId: string;              // chatgpt:{conv_id}:{msg_id}:{chunk_index}:{hash8}
  sourceMessageIds: string[];    // which messages contributed to this chunk
  tokenCount: number;            // content.length as proxy (matching existing convention)
}

export interface ChunkOptions {
  minSize?: number;   // default 500
  maxSize?: number;   // default 800
}

// ═══════════════════════════════════════════════════════════════════
// Stable ID
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a deterministic stable ID for dedup.
 * Format: chatgpt:{projectId}:{conversationExternalId}:{primaryMessageId}:{chunkIndex}:{contentHashFirst8}
 *
 * projectId is included to allow the same conversation to be imported into
 * multiple projects without stableId collision (B1 fix).
 */
export function buildStableId(
  projectId: number,
  conversationExternalId: string,
  primaryMessageId: string,
  chunkIndex: number,
  content: string,
): string {
  const hash = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 8);
  return `chatgpt:${projectId}:${conversationExternalId}:${primaryMessageId}:${chunkIndex}:${hash}`;
}

// ═══════════════════════════════════════════════════════════════════
// Core chunking
// ═══════════════════════════════════════════════════════════════════

/**
 * Group messages into Q&A pairs: (user, assistant).
 * Handles edge cases: orphan user, consecutive same-role, etc.
 */
export interface QAPair {
  user: ParsedMessage | null;
  assistant: ParsedMessage | null;
  turnIndex: number;
}

export function groupIntoQAPairs(messages: ParsedMessage[]): QAPair[] {
  const pairs: QAPair[] = [];
  let turnIndex = 0;
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "user") {
      // Look ahead for assistant response
      const next = messages[i + 1];
      if (next && next.role === "assistant") {
        pairs.push({ user: msg, assistant: next, turnIndex: turnIndex++ });
        i += 2;
      } else {
        // Orphan user message (no assistant response follows)
        pairs.push({ user: msg, assistant: null, turnIndex: turnIndex++ });
        i += 1;
      }
    } else if (msg.role === "assistant") {
      // Assistant without preceding user (e.g., system-triggered)
      pairs.push({ user: null, assistant: msg, turnIndex: turnIndex++ });
      i += 1;
    } else {
      i += 1; // skip unexpected roles
    }
  }

  return pairs;
}

/**
 * Format a Q&A pair into text content.
 */
export function formatQAPair(pair: QAPair): string {
  const parts: string[] = [];
  if (pair.user) {
    parts.push(`[Q] ${pair.user.content}`);
  }
  if (pair.assistant) {
    parts.push(`[A] ${pair.assistant.content}`);
  }
  return parts.join("\n\n");
}

/**
 * Chunk a single conversation's messages.
 *
 * @param projectId — project ID for stableId scoping (cross-project safety)
 * @param conversationExternalId — ChatGPT conversation_id for stableId construction
 * @param title — conversation title for context prefix
 * @param messages — visible messages from parseConversation()
 * @param options — chunk size options
 */
export function chunkConversation(
  projectId: number,
  conversationExternalId: string,
  title: string,
  messages: ParsedMessage[],
  options?: ChunkOptions,
): ConversationChunk[] {
  const minSize = options?.minSize ?? 500;
  const maxSize = options?.maxSize ?? 800;

  if (messages.length === 0) return [];

  const pairs = groupIntoQAPairs(messages);
  const chunks: ConversationChunk[] = [];
  let globalPosition = 0;

  for (const pair of pairs) {
    const formatted = formatQAPair(pair);
    const prefix = `[对话: ${title} | Turn ${pair.turnIndex + 1}]\n\n`;
    const primaryMsgId = pair.user?.externalMessageId || pair.assistant?.externalMessageId || "unknown";
    const sourceIds: string[] = [];
    if (pair.user) sourceIds.push(pair.user.externalMessageId);
    if (pair.assistant) sourceIds.push(pair.assistant.externalMessageId);

    if (formatted.length <= maxSize) {
      // Fits in one chunk
      const content = prefix + formatted;
      chunks.push({
        content,
        position: globalPosition++,
        stableId: buildStableId(projectId, conversationExternalId, primaryMsgId, 0, content),
        sourceMessageIds: sourceIds,
        tokenCount: content.length,
      });
    } else {
      // Need to split — use chunkText for sentence-boundary splitting
      const subChunks = chunkText(formatted, minSize, maxSize);
      for (let ci = 0; ci < subChunks.length; ci++) {
        const content = prefix + subChunks[ci];
        chunks.push({
          content,
          position: globalPosition++,
          stableId: buildStableId(projectId, conversationExternalId, primaryMsgId, ci, content),
          sourceMessageIds: sourceIds,
          tokenCount: content.length,
        });
      }
    }
  }

  return chunks;
}
