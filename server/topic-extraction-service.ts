/**
 * Topic Extraction Service — V0.9
 *
 * Extracted from routers.ts extraction.extractDocument logic.
 * Provides a reusable function for extracting topics from chunks via LLM.
 */

import { callLLM } from "./llm-service";

/**
 * Extract topics from a single chunk using LLM.
 * Returns an array of { label, relevance } pairs.
 */
export async function extractTopicsFromChunk(
  chunk: { id: number; content: string },
): Promise<Array<{ label: string; relevance: number }>> {
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
  if (content && typeof content === "string") {
    const parsed = JSON.parse(content);
    return parsed.topics || [];
  }

  return [];
}
