/**
 * ChatGPT conversations.json Parser — V0.8
 *
 * Pure function module with ZERO DB dependencies.
 * Implements the 7 default rules from Root review + PRD:
 *   1. Main chain = current_node backtrack (not longest branch)
 *   2. Only index visible user/assistant messages
 *   3. Skip hidden/system/tool/user_editable_context
 *   4. conversation_id + message.id = stable source id
 *   5. conversation_id + message.id + chunk_index + content_hash = stable chunk id
 *   6. Incremental update by message diff (handled in import-service)
 *   7. Raw JSON as audit layer, not in search index
 */
import { createHash } from "crypto";

// ═══════════════════════════════════════════════════════════════════
// Types — ChatGPT export format
// ═══════════════════════════════════════════════════════════════════

export interface ChatGPTConversation {
  title: string;
  create_time: number | null;
  update_time: number | null;
  conversation_id: string;
  current_node: string;
  mapping: Record<string, ChatGPTNode>;
  default_model_slug?: string;
  [key: string]: unknown; // other fields preserved in rawMetadata
}

export interface ChatGPTNode {
  id: string;
  message: ChatGPTMessage | null;
  parent: string | null;
  children: string[];
}

export interface ChatGPTMessage {
  id: string;
  author: { role: string; name?: string | null };
  content: {
    content_type: string;
    parts?: (string | Record<string, unknown>)[];
    user_profile?: string;
    user_instructions?: string;
  };
  metadata?: {
    is_visually_hidden_from_conversation?: boolean;
    model_slug?: string;
    [key: string]: unknown;
  };
  create_time: number | null;
  update_time?: number | null;
  status?: string;
  weight?: number;
  end_turn?: boolean | null;
}

// ═══════════════════════════════════════════════════════════════════
// Types — Parsed output
// ═══════════════════════════════════════════════════════════════════

export interface ParsedConversation {
  externalId: string;
  title: string;
  createTime: Date | null;
  updateTime: Date | null;
  model: string | null;
  messages: ParsedMessage[];
  rawMetadata: string; // JSON string of top-level fields (audit layer)
}

export interface ParsedMessage {
  externalMessageId: string;
  role: "user" | "assistant";
  content: string;
  contentHash: string;  // SHA-256 hex
  position: number;     // 0-based order in visible main chain
  modelSlug: string | null;
  createTime: Date | null;
}

// ═══════════════════════════════════════════════════════════════════
// Core functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Backtrack from current_node to root, return node IDs in chronological order.
 * Rule 1: Main chain = current_node backtrack path.
 */
export function extractMainChain(conversation: ChatGPTConversation): string[] {
  const { mapping, current_node } = conversation;

  if (!current_node || !mapping[current_node]) {
    return [];
  }

  const chain: string[] = [];
  let nodeId: string | null = current_node;

  while (nodeId) {
    chain.push(nodeId);
    const node: ChatGPTNode | undefined = mapping[nodeId];
    if (!node) break;
    nodeId = node.parent;
  }

  // Reverse to get root → current order
  chain.reverse();
  return chain;
}

/**
 * Check if a node's message should be indexed.
 * Rules 2+3: Only visible user/assistant; skip system/tool/hidden/user_editable_context.
 */
export function isVisibleMessage(node: ChatGPTNode): boolean {
  const msg = node.message;

  // Skip nodes without a message (root/skeleton nodes)
  if (!msg) return false;

  const role = msg.author?.role;
  // Only user and assistant
  if (role !== "user" && role !== "assistant") return false;

  // Skip user_editable_context
  if (msg.content?.content_type === "user_editable_context") return false;

  // Skip visually hidden
  if (msg.metadata?.is_visually_hidden_from_conversation === true) return false;

  // Skip zero-weight messages (hidden by ChatGPT)
  if (msg.weight === 0) return false;

  return true;
}

/**
 * Extract text content from a ChatGPT message.
 * Joins string parts, skipping non-string items (images, tool objects).
 */
export function extractMessageContent(message: ChatGPTMessage): string {
  const parts = message.content?.parts;
  if (!parts || !Array.isArray(parts)) return "";

  const textParts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        textParts.push(trimmed);
      }
    }
    // Non-string parts (images, tool calls) are skipped
  }

  return textParts.join("\n\n");
}

/**
 * Compute SHA-256 hex hash of content string.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Convert Unix timestamp (seconds with fractional) to Date or null.
 */
export function unixToDate(ts: number | null | undefined): Date | null {
  if (ts == null || ts <= 0) return null;
  return new Date(ts * 1000);
}

/**
 * Parse a single ChatGPT conversation into our internal format.
 * Orchestrates: extract main chain → filter visible → extract content → compute hashes.
 */
export function parseConversation(raw: ChatGPTConversation): ParsedConversation {
  const chain = extractMainChain(raw);
  const messages: ParsedMessage[] = [];

  // Detect the primary model from the conversation
  let primaryModel: string | null = raw.default_model_slug || null;

  let visiblePosition = 0;

  for (const nodeId of chain) {
    const node = raw.mapping[nodeId];
    if (!node || !isVisibleMessage(node)) continue;

    const msg = node.message!;
    const content = extractMessageContent(msg);

    // Skip empty-content messages (e.g. assistant streaming placeholder)
    if (content.length === 0) continue;

    const modelSlug = msg.metadata?.model_slug || null;
    if (!primaryModel && modelSlug) {
      primaryModel = modelSlug;
    }

    messages.push({
      externalMessageId: msg.id,
      role: msg.author.role as "user" | "assistant",
      content,
      contentHash: computeContentHash(content),
      position: visiblePosition++,
      modelSlug,
      createTime: unixToDate(msg.create_time),
    });
  }

  // Build audit-layer rawMetadata (exclude the heavy mapping field)
  const { mapping, ...metadataFields } = raw;
  const rawMetadata = JSON.stringify(metadataFields);

  return {
    externalId: raw.conversation_id,
    title: raw.title || "Untitled",
    createTime: unixToDate(raw.create_time),
    updateTime: unixToDate(raw.update_time),
    model: primaryModel,
    messages,
    rawMetadata,
  };
}

/**
 * Validate that a raw object looks like a ChatGPT conversation.
 * Used for early rejection of malformed data.
 */
export function isChatGPTConversation(obj: unknown): obj is ChatGPTConversation {
  if (!obj || typeof obj !== "object") return false;
  const conv = obj as Record<string, unknown>;
  return (
    typeof conv.conversation_id === "string" &&
    typeof conv.mapping === "object" &&
    conv.mapping !== null &&
    typeof conv.current_node === "string"
  );
}
