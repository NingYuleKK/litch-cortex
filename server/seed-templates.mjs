/**
 * Seed preset prompt templates into the database.
 * Run once during initialization or after migration.
 * Usage: node server/seed-templates.mjs
 */

const PRESET_TEMPLATES = [
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
    sortOrder: 1,
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
    sortOrder: 2,
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
    sortOrder: 3,
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
    sortOrder: 4,
  },
  {
    name: "对话转 Blog（Beta Skill）",
    description: "基于 Litch 的 Claude Skill，将对话转写为高密度 Blog 文章",
    systemPrompt: `Transform raw dialogues into structured, readable blog posts through a four-phase workflow with structural tagging, concept stabilization, and self-refinement.

## Workflow

### Phase 0: Structural Tagging（结构标注）
Scan the entire text and tag each segment:
- [机制] - Technical mechanism / how something works
- [哲学] - Philosophical assumption / worldview premise
- [判断] - Author's judgment / conclusion
- [未尽] - Unfinished thought / deliberately held back
- [情绪] - Emotional emphasis / rhetorical flourish (candidate for削减)
- [例证] - Example / analogy / case study
- [可删] - Redundant or tangential (skip in blog)

Identify 3-7 core concepts. Create a Term Anchor Table with anchored definitions.

### Phase 1: Outline Generation（大纲生成）
Based on structural tags, generate outline with:
- 标题：从核心洞见提炼
- 核心概念锚定
- 结构：开篇钩子 → 主论证 → 支撑/例证 → 延伸/未尽 → 收束

### Phase 2: Draft Generation（初稿生成）
Write full blog post:
- First occurrence of each core concept → use anchored definition
- Subsequent occurrences → use consistent terminology (no drift)
- Prose essay format (no dialogue traces)
- Flowing paragraphs, minimal headers
- Active voice, conversational but precise
- Strong opening hook (no "本文将讨论...")
- Smooth transitions (no "接下来我们看...")
- Examples woven naturally, not listed
- Closing resonates, doesn't summarize

### Phase 3: Self-Refinement（自检精炼）
Run two checks:
A. Reader Anchor: scan for passages assuming context only in original dialogue
B. Tension Reduction: identify over-emphatic passages, suggest cuts

Apply refinements and output final version in Markdown.`,
    isPreset: 1,
    sortOrder: 5,
  },
];

// Use dynamic import for the database module
async function main() {
  // We'll use a direct HTTP call to the running server's tRPC endpoint
  // Or we can directly use the database
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  // Use mysql2 directly
  const { createConnection } = await import("mysql2/promise");
  
  const conn = await createConnection(DATABASE_URL + "?ssl={\"rejectUnauthorized\":true}");
  
  // Check if templates already exist
  const [rows] = await conn.execute("SELECT COUNT(*) as cnt FROM prompt_templates WHERE is_preset = 1");
  const count = rows[0].cnt;
  
  if (count > 0) {
    console.log(`Already have ${count} preset templates, skipping seed.`);
    await conn.end();
    return;
  }

  for (const t of PRESET_TEMPLATES) {
    await conn.execute(
      "INSERT INTO prompt_templates (name, description, system_prompt, is_preset, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
      [t.name, t.description, t.systemPrompt, t.isPreset, t.sortOrder]
    );
    console.log(`Inserted preset: ${t.name}`);
  }

  console.log("Done seeding preset templates.");
  await conn.end();
}

main().catch(console.error);
