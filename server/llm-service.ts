/**
 * LLM Service Abstraction Layer — V0.5
 * 
 * Provides a unified interface for all LLM calls in Cortex.
 * Supports multiple providers: Built-in (Manus Forge), OpenAI, OpenRouter, Custom.
 * Configuration is read from the llm_config database table with ENV fallback.
 */
import { ENV } from "./_core/env";
import type { InvokeParams, InvokeResult, Message, ResponseFormat } from "./_core/llm";
import { invokeLLM as builtinInvokeLLM } from "./_core/llm";
import { getActiveLlmConfig } from "./db";

// ─── Types ─────────────────────────────────────────────────────────

export type LlmProvider = "builtin" | "openai" | "openrouter" | "custom";

export type TaskType = "topic_extract" | "summarize" | "explore" | "chunk_merge";

export interface LlmServiceConfig {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  taskModels: Record<string, string>;
}

// ─── Provider Defaults ─────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string }> = {
  builtin: {
    baseUrl: "", // Uses Manus Forge built-in URL
    defaultModel: "gemini-2.5-flash",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  custom: {
    baseUrl: "",
    defaultModel: "",
  },
};

// ─── API Key Encoding/Decoding ─────────────────────────────────────

export function encodeApiKey(plainKey: string): string {
  return Buffer.from(plainKey, "utf-8").toString("base64");
}

export function decodeApiKey(encodedKey: string): string {
  return Buffer.from(encodedKey, "base64").toString("utf-8");
}

// ─── Config Resolution ─────────────────────────────────────────────

/**
 * Resolve the active LLM configuration.
 * Priority: DB config > ENV fallback (built-in Forge)
 */
async function resolveConfig(): Promise<LlmServiceConfig> {
  try {
    const dbConfig = await getActiveLlmConfig();
    if (dbConfig) {
      const provider = (dbConfig.provider || "builtin") as LlmProvider;
      const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
      
      let apiKey = "";
      if (dbConfig.apiKeyEncrypted) {
        apiKey = decodeApiKey(dbConfig.apiKeyEncrypted);
      }

      let taskModels: Record<string, string> = {};
      if (dbConfig.taskModels) {
        try {
          taskModels = JSON.parse(dbConfig.taskModels);
        } catch {
          taskModels = {};
        }
      }

      return {
        provider,
        baseUrl: dbConfig.baseUrl || defaults.baseUrl,
        apiKey,
        defaultModel: dbConfig.defaultModel || defaults.defaultModel,
        taskModels,
      };
    }
  } catch {
    // DB not available, fall through to ENV fallback
  }

  // Fallback: use built-in Forge
  return {
    provider: "builtin",
    baseUrl: "",
    apiKey: "",
    defaultModel: "gemini-2.5-flash",
    taskModels: {},
  };
}

/**
 * Get the model to use for a specific task type.
 */
function getModelForTask(config: LlmServiceConfig, taskType?: TaskType): string {
  if (taskType && config.taskModels[taskType]) {
    return config.taskModels[taskType];
  }
  return config.defaultModel;
}

// ─── Message normalization (reuse from _core/llm.ts logic) ─────────

type MessageContent = string | { type: string; [key: string]: any };

function normalizeMessage(message: Message): Record<string, any> {
  const { role, name, tool_call_id } = message;
  const content = message.content;

  if (role === "tool" || role === "function") {
    const parts = Array.isArray(content) ? content : [content];
    const text = parts
      .map((part: any) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    return { role, name, tool_call_id, content: text };
  }

  const parts = Array.isArray(content) ? content : [content];
  const normalized = parts.map((part: any) => {
    if (typeof part === "string") return { type: "text", text: part };
    return part;
  });

  if (normalized.length === 1 && normalized[0].type === "text") {
    return { role, name, content: normalized[0].text };
  }

  return { role, name, content: normalized };
}

// ─── Response format normalization ─────────────────────────────────

function normalizeResponseFormat(params: InvokeParams): any {
  const format = params.responseFormat || params.response_format;
  if (format) return format;

  const schema = params.outputSchema || params.output_schema;
  if (!schema) return undefined;

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
}

// ─── External Provider Call ────────────────────────────────────────

async function callExternalProvider(
  config: LlmServiceConfig,
  params: InvokeParams,
  model: string,
): Promise<InvokeResult> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const payload: Record<string, unknown> = {
    model,
    messages: params.messages.map(normalizeMessage),
  };

  if (params.tools && params.tools.length > 0) {
    payload.tools = params.tools;
  }

  const toolChoice = params.toolChoice || params.tool_choice;
  if (toolChoice) {
    payload.tool_choice = toolChoice;
  }

  const maxTokens = params.maxTokens || params.max_tokens || 32768;
  payload.max_tokens = maxTokens;

  const responseFormat = normalizeResponseFormat(params);
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };

  // OpenRouter-specific headers
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://cortex.litch.app";
    headers["X-Title"] = "Litch's Cortex";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed [${config.provider}]: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}

// ─── Main Service Function ─────────────────────────────────────────

export interface CortexLlmParams extends InvokeParams {
  /** Task type for model routing */
  taskType?: TaskType;
}

// ─── Retry Helper ─────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Unified LLM call — resolves config from DB, routes to correct provider.
 * This is the ONLY function that should be used for LLM calls in Cortex.
 * Includes automatic retry: on failure, waits 1s and retries up to 2 times.
 */
export async function callLLM(params: CortexLlmParams): Promise<InvokeResult> {
  const config = await resolveConfig();
  const model = getModelForTask(config, params.taskType);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // If using built-in provider, delegate to the original invokeLLM
      if (config.provider === "builtin") {
        return await builtinInvokeLLM(params);
      }

      // For external providers (OpenAI, OpenRouter, Custom)
      if (!config.apiKey) {
        throw new Error(
          `API key not configured for provider "${config.provider}". ` +
          `Please configure it in Settings > LLM Configuration.`
        );
      }

      return await callExternalProvider(config, params, model);
    } catch (err: any) {
      lastError = err;
      // Don't retry config errors (missing API key)
      if (err.message?.includes("API key not configured")) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        console.log(
          `[LLM] Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms... Error: ${err.message?.substring(0, 100)}`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted
  const friendlyMsg = simplifyLlmError(lastError?.message || "Unknown error");
  throw new Error(friendlyMsg);
}

/**
 * Simplify raw LLM error messages into user-friendly text.
 */
function simplifyLlmError(raw: string): string {
  if (raw.includes("timeout") || raw.includes("ETIMEDOUT") || raw.includes("ECONNRESET")) {
    return "LLM 服务连接超时，请稍后重试。如果问题持续，请检查设置中的 Provider 配置。";
  }
  if (raw.includes("429") || raw.includes("rate limit") || raw.includes("Rate limit")) {
    return "LLM 服务请求频率过高，请稍等几秒后重试。";
  }
  if (raw.includes("401") || raw.includes("Unauthorized") || raw.includes("invalid_api_key")) {
    return "API Key 无效或已过期，请在设置中检查 LLM 配置。";
  }
  if (raw.includes("402") || raw.includes("insufficient") || raw.includes("Payment")) {
    return "API 余额不足，请检查您的 Provider 账户余额。";
  }
  if (raw.includes("500") || raw.includes("502") || raw.includes("503")) {
    return "LLM 服务暂时不可用，已自动重试但仍失败。请稍后再试。";
  }
  if (raw.includes("model") && (raw.includes("not found") || raw.includes("does not exist"))) {
    return "指定的模型不存在，请在设置中检查模型名称是否正确。";
  }
  // Truncate overly long error messages
  if (raw.length > 200) {
    return `LLM 调用失败：${raw.substring(0, 150)}...（已自动重试 ${MAX_RETRIES} 次）`;
  }
  return `LLM 调用失败：${raw}`;
}

/**
 * Get the current active LLM configuration (for display in settings UI).
 */
export async function getCurrentConfig(): Promise<LlmServiceConfig> {
  return resolveConfig();
}

/**
 * Get provider defaults for the settings UI.
 */
export function getProviderDefaults() {
  return PROVIDER_DEFAULTS;
}
