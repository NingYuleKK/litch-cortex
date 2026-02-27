/**
 * Prompt Template System for Litch's Cortex V0.4
 * 
 * Provides preset prompt templates for different summarization styles.
 * Custom prompts are stored in localStorage.
 */

export interface PromptTemplate {
  id: string;
  label: string;
  description: string;
  /** System prompt template. Use {{content}} as placeholder for content context. */
  systemPrompt: string;
  /** Whether this is a user-defined custom template */
  isCustom?: boolean;
}

export const PRESET_TEMPLATES: PromptTemplate[] = [
// Also export as PROMPT_TEMPLATES for backward compatibility
  {
    id: "academic",
    label: "学术总结",
    description: "结构化学术风格，涵盖核心论点与论据",
    systemPrompt: `你是一个专业的学术内容总结助手。请根据提供的文本片段，生成一份结构化的学术总结。

要求：
- 总结应该涵盖所有片段的核心观点和论据
- 使用清晰的中文学术表达
- 按照"背景→核心论点→论据支撑→结论"的结构组织
- 长度适中（300-600字）
- 使用 Markdown 格式`,
  },
  {
    id: "blog",
    label: "Blog 风格",
    description: "轻松易读的博客文章风格",
    systemPrompt: `你是一个优秀的博客写手。请根据提供的文本片段，生成一篇轻松易读的博客风格文章。

要求：
- 语言生动有趣，适合公开发表
- 可以加入个人见解和思考
- 使用短段落和小标题提升可读性
- 长度适中（400-800字）
- 使用 Markdown 格式，善用加粗和引用`,
  },
  {
    id: "reading-notes",
    label: "读书笔记",
    description: "要点提炼 + 金句 + 个人感悟框架",
    systemPrompt: `你是一个善于做读书笔记的助手。请根据提供的文本片段，生成一份读书笔记风格的总结。

要求：
- 提炼关键要点，使用编号列表
- 标注值得记忆的金句（用 > 引用格式）
- 对重要观点加上简短批注或思考
- 标注值得深入研究的方向
- 在末尾留出"个人感悟"框架供用户填写
- 使用 Markdown 格式`,
  },
  {
    id: "dialogue-summary",
    label: "对话摘要",
    description: "简洁的对话要点提取",
    systemPrompt: `你是一个对话分析助手。请根据提供的文本片段，生成一份简洁的对话摘要。

要求：
- 提炼对话中的核心议题和结论
- 标注不同参与者的主要观点（如果能识别）
- 总结达成的共识和分歧点
- 列出对话中提到的行动项或待办事项（如有）
- 保持简洁，长度控制在 200-400 字
- 使用 Markdown 格式`,
  },
  {
    id: "custom",
    label: "自定义",
    description: "使用你自己编写的 Prompt",
    systemPrompt: "",
    isCustom: true,
  },
];

const CUSTOM_PROMPT_KEY = "cortex-custom-prompt";
const SELECTED_TEMPLATE_KEY = "cortex-selected-template";

/**
 * Get the saved custom prompt from localStorage
 */
export function getCustomPrompt(): string {
  try {
    return localStorage.getItem(CUSTOM_PROMPT_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Save custom prompt to localStorage
 */
export function saveCustomPrompt(prompt: string): void {
  try {
    localStorage.setItem(CUSTOM_PROMPT_KEY, prompt);
  } catch {
    // localStorage not available
  }
}

/**
 * Get the last selected template ID from localStorage
 */
export function getSelectedTemplateId(): string {
  try {
    return localStorage.getItem(SELECTED_TEMPLATE_KEY) || "academic";
  } catch {
    return "academic";
  }
}

/**
 * Save selected template ID to localStorage
 */
export function saveSelectedTemplateId(id: string): void {
  try {
    localStorage.setItem(SELECTED_TEMPLATE_KEY, id);
  } catch {
    // localStorage not available
  }
}

/**
 * Get the effective system prompt for a given template ID.
 * Returns the prompt text (without placeholders replaced).
 */
export function getEffectivePrompt(templateId: string): string {
  const template = PRESET_TEMPLATES.find(t => t.id === templateId);
  
  if (!template) {
    return PRESET_TEMPLATES[0].systemPrompt;
  }

  if (template.isCustom) {
    const customPrompt = getCustomPrompt();
    if (!customPrompt) {
      return PRESET_TEMPLATES[0].systemPrompt;
    }
    return customPrompt;
  }

  return template.systemPrompt;
}

/** Alias for backward compatibility */
export const PROMPT_TEMPLATES = PRESET_TEMPLATES;
