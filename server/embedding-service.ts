/**
 * Embedding Service — V0.6.2
 *
 * Provides embedding generation for semantic search.
 * Supports built-in Manus API, OpenAI, OpenRouter, and custom providers.
 * Configuration is read from the embedding_config database table.
 * Priority: DB config > LLM config OpenRouter key > built-in API fallback.
 */
import { ENV } from "./_core/env";
import { getActiveEmbeddingConfig, getActiveLlmConfig } from "./db";
import { decodeApiKey } from "./llm-service";

// ─── Types ─────────────────────────────────────────────────────────

export interface EmbeddingServiceConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  usage?: { prompt_tokens: number; total_tokens: number };
}

// ─── Provider Defaults ─────────────────────────────────────────────

const EMBEDDING_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string }> = {
  builtin: { baseUrl: "", defaultModel: "text-embedding-3-small" },
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "text-embedding-3-small" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/text-embedding-3-small" },
  custom: { baseUrl: "", defaultModel: "text-embedding-3-small" },
};

// ─── Config Resolution ─────────────────────────────────────────────

function getBuiltinConfig(): EmbeddingServiceConfig {
  return {
    provider: "builtin",
    baseUrl: ENV.forgeApiUrl
      ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1`
      : "https://forge.manus.im/v1",
    apiKey: ENV.forgeApiKey || "",
    model: "text-embedding-3-small",
    dimensions: 1536,
  };
}

/**
 * Try to get the OpenRouter API key from the LLM config.
 * Returns empty string if LLM config is not OpenRouter or has no key.
 */
async function getLlmOpenRouterKey(): Promise<string> {
  try {
    const llmConfig = await getActiveLlmConfig();
    if (llmConfig && llmConfig.provider === "openrouter" && llmConfig.apiKeyEncrypted) {
      return decodeApiKey(llmConfig.apiKeyEncrypted);
    }
  } catch {
    // ignore
  }
  return "";
}

async function resolveEmbeddingConfig(): Promise<EmbeddingServiceConfig> {
  try {
    const dbConfig = await getActiveEmbeddingConfig();
    if (dbConfig) {
      const provider = dbConfig.provider || "builtin";

      // If provider is builtin, always use built-in API credentials
      if (provider === "builtin") {
        return {
          ...getBuiltinConfig(),
          model: dbConfig.model || "text-embedding-3-small",
          dimensions: dbConfig.dimensions || 1536,
        };
      }

      // For external providers, decode the stored API key
      let apiKey = "";
      if (dbConfig.apiKeyEncrypted) {
        apiKey = decodeApiKey(dbConfig.apiKeyEncrypted);
      }

      // If no API key configured for external provider:
      // Try to reuse LLM OpenRouter key if provider is openrouter
      if (!apiKey && provider === "openrouter") {
        apiKey = await getLlmOpenRouterKey();
      }

      // Still no key → fall back to built-in
      if (!apiKey) {
        return getBuiltinConfig();
      }

      const defaults = EMBEDDING_PROVIDER_DEFAULTS[provider] || EMBEDDING_PROVIDER_DEFAULTS.custom;
      return {
        provider,
        baseUrl: dbConfig.baseUrl || defaults.baseUrl,
        apiKey,
        model: dbConfig.model || defaults.defaultModel,
        dimensions: dbConfig.dimensions || 1536,
      };
    }
  } catch {
    // DB not available, fall through
  }

  // No embedding config: try to auto-use LLM OpenRouter key if available
  const openRouterKey = await getLlmOpenRouterKey();
  if (openRouterKey) {
    return {
      provider: "openrouter",
      baseUrl: EMBEDDING_PROVIDER_DEFAULTS.openrouter.baseUrl,
      apiKey: openRouterKey,
      model: EMBEDDING_PROVIDER_DEFAULTS.openrouter.defaultModel,
      dimensions: 1536,
    };
  }

  // Final fallback: built-in Manus API
  return getBuiltinConfig();
}

// ─── Embedding Generation ──────────────────────────────────────────

/**
 * Generate embedding for a single text input.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const config = await resolveEmbeddingConfig();

  // Built-in API always has a key injected from ENV; only throw if truly empty
  if (!config.apiKey) {
    throw new Error(
      "Embedding service is not available. The built-in API key is missing from the environment."
    );
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/embeddings`;

  const payload: Record<string, unknown> = {
    input: text,
    model: config.model,
  };

  // OpenAI supports dimensions parameter for text-embedding-3-* models
  if (config.model.includes("text-embedding-3")) {
    payload.dimensions = config.dimensions;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Embedding generation failed [${config.provider}]: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const result = await response.json();
  const embeddingData = result.data?.[0]?.embedding;

  if (!embeddingData || !Array.isArray(embeddingData)) {
    throw new Error("Invalid embedding response: no embedding data returned");
  }

  return {
    embedding: embeddingData,
    model: config.model,
    dimensions: embeddingData.length,
    usage: result.usage,
  };
}

/**
 * Generate embeddings for multiple texts in a single batch call.
 * OpenAI supports up to ~2048 inputs per batch.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  batchSize = 100
): Promise<EmbeddingResult[]> {
  const config = await resolveEmbeddingConfig();

  // Built-in API always has a key injected from ENV; only throw if truly empty
  if (!config.apiKey) {
    throw new Error(
      "Embedding service is not available. The built-in API key is missing from the environment."
    );
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/embeddings`;
  const results: EmbeddingResult[] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const payload: Record<string, unknown> = {
      input: batch,
      model: config.model,
    };

    if (config.model.includes("text-embedding-3")) {
      payload.dimensions = config.dimensions;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding batch failed [${config.provider}]: ${response.status} ${response.statusText} – ${errorText}`
      );
    }

    const result = await response.json();
    const embeddings = result.data;

    if (!Array.isArray(embeddings)) {
      throw new Error("Invalid batch embedding response");
    }

    // Sort by index to maintain order
    embeddings.sort((a: any, b: any) => a.index - b.index);

    for (const item of embeddings) {
      results.push({
        embedding: item.embedding,
        model: config.model,
        dimensions: item.embedding.length,
        usage: result.usage,
      });
    }
  }

  return results;
}

// ─── Cosine Similarity ─────────────────────────────────────────────

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Get the current embedding configuration for display.
 */
export async function getCurrentEmbeddingConfig(): Promise<EmbeddingServiceConfig> {
  return resolveEmbeddingConfig();
}
