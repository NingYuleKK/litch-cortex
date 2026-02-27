# HANDOVER_CORTEX.md — Litch's Cortex V0.5.2 交接文档

## 项目概述

Litch's Cortex 是一个对话资产治理工具，用于管理 Litch 与多个 AI 进行深度对话产生的 PDF 记录。核心数据流为：**创建项目 → 上传 PDF → 解析分段 → LLM 提取话题标签 → 查看话题下的原文 → 按话题合并分段 → 生成总结**。

V0.5 的核心变更是 **LLM Service 重构**：将硬编码的 LLM 调用抽象为可配置的多 Provider 服务层，支持 OpenAI、OpenRouter（Claude Opus 4.6 等）、自定义 Provider。V0.5.1 新增 LLM 调用自动重试机制、OpenRouter 模型列表自动获取（下拉搜索）、Skill 文件导入（.skill/.md）。V0.5.2 新增 **话题摘要对话式交互**：将单轮摘要生成改为多轮对话，支持多步骤 Skill 工作流（如 Phase 1 生成大纲 → 用户确认 → Phase 2 写初稿 → Phase 3 自检精炼）。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Tailwind CSS 4 | SPA，赛博认知深色主题 |
| 后端 | Node.js + Express + tRPC 11 | 类型安全的 RPC 接口 |
| 数据库 | MySQL (TiDB) + Drizzle ORM | 托管在 Manus 平台 |
| PDF 解析 | pdf-parse | 服务端解析 PDF 文本 |
| LLM | **多 Provider 抽象层（V0.5）** | 支持内置 API / OpenAI / OpenRouter / 自定义 Provider |
| 认证 | 独立用户名密码 + JWT（V0.3） | 替代 Manus OAuth，支持独立部署 |
| 密码哈希 | bcryptjs | 安全存储密码 |
| 部署 | Manus 平台 | 一键部署 |

---

## 数据模型

```
cortexUsers: id, username, passwordHash, initialPassword(V0.4), role(admin/member), createdAt, lastSignedIn
projects: id, userId, cortexUserId, name, description, createdAt, updatedAt
documents: id, userId, projectId, filename, fileUrl, rawText, status, chunkCount, uploadTime
chunks: id, documentId, content, position, tokenCount, createdAt
mergedChunks: id, topicId(V0.4.2), content, sourceChunkIds(JSON), position, createdAt
topics: id, label, description, weight, createdAt
chunk_topics: id, chunkId, topicId, relevanceScore
summaries: id, topicId, summaryText, generatedAt
llmConfig: id, provider, baseUrl, apiKeyEncrypted, defaultModel, taskModels(JSON), isActive, createdAt, updatedAt  ← V0.5 新增
promptTemplates: id, name, description, systemPrompt, isPreset, createdAt, updatedAt  ← V0.5 新增
topicConversations: id, topicId, projectId, title, messages(JSON), promptTemplateId, createdAt, updatedAt  ← V0.5.2 新增
users: id, openId, name, email, role, ... (Manus OAuth, 保留兼容)
```

**V0.5.2 新增表说明：**

- `topicConversations`：存储话题对话上下文，`messages` 字段为 JSON 格式的消息数组（`[{role, content}, ...]`），支持 system/user/assistant 角色。`promptTemplateId` 记录启动对话时选择的 Prompt 模板。每个话题可有多个对话记录。

---

## LLM Service 架构（V0.5 核心变更）

### 抽象层设计

```
server/llm-service.ts
callLLM(options)          → 统一入口，所有 LLM 调用走这里（含自动重试：失败后等 1s 重试，最多 2 次）
├── getProviderDefaults()     → 返回各 Provider 的默认配置
├── encodeApiKey(key)         → base64 编码 API key
└── decodeApiKey(encoded)     → 解码 API key
```
### Provider 支持

| Provider | Base URL | Model 格式 | 说明 |
|----------|----------|-----------|------|
| `builtin` | Manus 内置 API | `gemini-2.5-flash` 等 | 默认，无需配置 API key |
| `openai` | `https://api.openai.com/v1` | `gpt-4.1-mini` 等 | 标准 OpenAI API |
| `openrouter` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` 等 | OpenAI 兼容格式，支持多家模型 |
| `custom` | 用户自定义 | 用户自定义 | 任何 OpenAI 兼容 API |

### 任务类型与模型映射

| 任务类型 | 说明 | 默认模型 |
|----------|------|----------|
| `topic_extract` | 话题提取 | 使用全局默认 |
| `summarize` | 摘要生成 | 使用全局默认 |
| `explore` | 话题探索 | 使用全局默认 |
| `chunk_merge` | Chunk 合并 | 使用全局默认 |

用户可在设置页为每个任务类型指定不同模型（高级选项）。

### Fallback 机制

1. 检查数据库 `llmConfig` 表是否有活跃配置
2. 如果有，使用数据库配置的 Provider + API key
3. 如果没有，fallback 到 Manus 内置 `invokeLLM`（使用 `BUILT_IN_FORGE_API_KEY`）
4. 任务类型模型覆盖：先查 `taskModels[taskType]`，再查 `defaultModel`

### API Key 安全

- 存储：base64 编码后存入 `apiKeyEncrypted` 字段
- 读取：API 返回时永远不返回原始 key，只返回 `hasApiKey: boolean`
- 前端：密码框 + 显示/隐藏切换

---

## Prompt 模板系统（V0.5 重构）

### 从 localStorage 迁移到数据库

V0.4 的 Prompt 模板是纯前端功能（`localStorage`），V0.5 迁移到数据库：

- 预设 5 个模板（`isPreset: true`，不可删除）：学术总结、Blog 风格、读书笔记、对话摘要、对话转 Blog（Beta Skill）
- 用户可创建自定义模板（`isPreset: false`，可编辑/删除）
- 支持"导入 Skill"功能：粘贴 Claude Skill 的 prompt 内容导入为模板
- 多用户共享：所有用户看到相同的模板库

### PromptTemplateSelector 组件

- 从数据库加载模板列表（`trpc.promptTemplate.list`）
- 支持 compact 模式（DropdownMenu）和 full 模式（Select）
- 选择模板后返回 `systemPrompt` 内容给调用方
- 话题探索页和话题详情页均使用此组件

---

## 话题对话式交互（V0.5.2 核心变更）

### 设计背景

用户导入的多步骤 Claude Skill（如"对话转 Blog"）需要多轮交互：Phase 1 生成大纲 → 用户确认 → Phase 2 写初稿 → Phase 3 自检精炼。原有的单轮摘要生成无法支持此工作流。

### 架构设计

```
话题详情页右侧面板
├── 对话 Tab（V0.5.2 新增）
│   ├── 历史对话列表（可切换/删除）
│   ├── 迷你聊天窗口（消息列表 + 输入框）
│   ├── Prompt 模板选择器
│   └── "开始对话" 按钮
└── 总结 Tab（保留原有功能）
    ├── 手动编辑摘要
    └── 保存总结
```

### 后端 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `summary.startChat` | mutation | 启动新对话：自动构建 system prompt（含 chunks 内容 + 模板），发送首条消息给 LLM |
| `summary.continueChat` | mutation | 继续对话：追加用户消息到上下文，调用 LLM 获取回复 |
| `summary.listConversations` | query | 获取话题的所有对话记录列表 |
| `summary.getConversation` | query | 获取单个对话的完整消息历史 |
| `summary.deleteConversation` | mutation | 删除对话记录 |

### 对话上下文管理

- **持久化存储**：对话消息存储在 `topicConversations` 表的 `messages` JSON 字段
- **消息格式**：`[{role: "system"|"user"|"assistant", content: string}, ...]`
- **首条消息构建**：
  1. 获取话题关联的所有 chunks 内容
  2. 构建 system prompt：用户选择的 Prompt 模板内容
  3. 构建 user 消息：包含所有 chunks 原文
  4. 调用 LLM 获取首条回复
  5. 保存完整消息历史到数据库
- **后续消息**：追加 user 消息 → 调用 LLM → 追加 assistant 回复 → 更新数据库

### 前端组件

- **对话 Tab**：默认显示，包含历史对话列表和聊天窗口
- **历史对话列表**：显示该话题的所有对话，可点击切换、可删除
- **聊天窗口**：
  - 消息列表：区分 user/assistant 消息，assistant 消息支持 Markdown 渲染
  - 输入框：底部固定，支持 Enter 发送
  - 加载状态：LLM 响应时显示"思考中..."动画
- **总结 Tab**：保留原有的手动编辑摘要功能

---

## 认证系统（V0.3 新增，V0.4 增强）

### 架构

- **独立认证**：用户名 + 密码登录，不依赖 Manus OAuth
- **JWT Cookie**：登录后设置 `cortex_auth` httpOnly cookie，有效期 7 天
- **密码安全**：使用 bcryptjs（salt rounds = 10）哈希存储
- **角色控制**：admin 可创建新用户，member 只能访问自己的数据
- **默认管理员**：服务器启动时自动创建 admin 用户（username: litch, 初始密码: cortex2026）
- **V0.4 改密码**：所有用户可修改自己的密码（验证旧密码 + 设置新密码）
- **V0.4 初始密码记录**：Admin 创建用户时，初始密码明文存入 `initialPassword` 字段
- **V0.4 删除用户**：Admin 可删除用户（级联删除该用户所有项目、文档、chunks 等数据）

### API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `POST /api/auth/login` | REST | 用户名密码登录，返回 JWT cookie |
| `POST /api/auth/logout` | REST | 清除认证 cookie |
| `GET /api/auth/me` | REST | 获取当前登录用户信息 |
| `POST /api/auth/users` | REST | 创建新用户（仅 admin） |
| `GET /api/auth/users` | REST | 获取用户列表（仅 admin，含 initialPassword） |
| `POST /api/auth/change-password` | REST | 修改密码（V0.4，所有已登录用户） |
| `DELETE /api/auth/users/:id` | REST | 删除用户（V0.4，仅 admin） |

---

## 核心功能

### 1. 登录页 (`/login`)
- 独立的用户名 + 密码登录表单
- 赛博认知风格设计

### 2. 项目管理 (`/`)
- 首页为项目列表，卡片式展示当前用户的项目
- 顶部导航栏含用户菜单（改密码、用户管理入口、**设置入口 V0.5**）
- 支持新建项目

### 3. 项目工作区 (`/project/:id`)
- 侧边栏显示项目信息和导航菜单
- 包含子页面：上传文档、分段预览、话题列表、话题探索

### 4. PDF 上传与解析 (`/project/:id`)
- 拖拽或点击上传 PDF（支持多文件批量，单文件最大 100MB）
- 使用 `multipart/form-data` + `fetch` 上传到 `/api/upload/pdf`

### 5. 分段预览 (`/project/:id/chunks`)
- Log 面板风格的分段列表
- 「原始分段 / 合并分段」切换，合并分段按话题分组展示

### 6. 话题列表 (`/project/:id/topics`)
- 三列网格布局展示话题

### 7. Topic 详情页 (`/project/:id/topics/:topicId`)（V0.5.2 重大改造）
- 左侧：关联 chunks 原文列表，支持「原始片段 / 合并片段」Tab 切换
- 左侧新增「合并相关分段」/「重新合并」按钮
- 右侧改为双 Tab 布局：
  - **对话 Tab（V0.5.2）**：迷你聊天窗口，支持多轮对话，Prompt 模板选择器 + 历史对话列表
  - **总结 Tab**：手动编辑摘要 + 保存（保留原有功能）
- **V0.5**：Prompt 模板选择器从数据库加载模板

### 8. 话题探索 (`/project/:id/explore`)
- 用户输入关键词或问题
- **V0.5**：Prompt 模板选择器从数据库加载模板
- 后端检索相关内容 → LLM 整理结构化话题总结

### 9. 用户管理 (`/admin/users`)
- 全局路由，通过顶部导航栏齿轮图标进入（仅 admin 可见）
- 显示所有用户列表（含初始密码）
- admin 可创建/删除用户

### 10. 设置页 (`/settings`)（V0.5 新增）
- **LLM Provider 配置**：选择 Provider（内置/OpenAI/OpenRouter/自定义）
- **API Key 输入**：密码框 + 显示/隐藏切换
- **Base URL 配置**：OpenRouter 自动填充，自定义可编辑
- **默认模型选择**：输入框
- **连接测试**：发送测试请求验证配置是否正确
- **各任务类型模型配置**：高级选项，可折叠，为不同任务指定不同模型
- **V0.5.1 模型下拉搜索**：OpenRouter 自动获取可用模型列表，支持关键词过滤（如输入 "claude" 显示所有 Claude 模型）
- **Prompt 模板管理入口**：链接到模板管理页

### 11. Prompt 模板管理 (`/settings/templates`)（V0.5 新增）
- 列表展示所有模板（预设 + 自定义）
- 创建新模板（名称 + 描述 + System Prompt）
- 编辑/删除自定义模板（预设模板不可删除）
- **导入 Skill**：粘贴 Claude Skill 的 prompt 内容，自动解析并导入为模板
- **V0.5.1 文件导入**：拖拽或选择 .skill（zip）或 .md 文件直接导入为模板
- **V0.5.1 模板编辑增强**：可拖拽调整高度的文本框、字符计数、内容预览（前几行 + 总字数）

---

## 关键文件

```
drizzle/schema.ts                      → 数据库表定义（含 llmConfig、promptTemplates、topicConversations 表）
server/llm-service.ts                  → V0.5 LLM Service 抽象层（callLLM、Provider 配置）
server/db.ts                           → 数据库查询层（含 LLM Config、Prompt Template、TopicConversation CRUD）
server/routers.ts                      → tRPC 路由（含 llmSettings、promptTemplate、summary.chat routers）
server/uploadRoute.ts                  → PDF 上传 Express 路由
server/authRoute.ts                    → 独立认证路由
server/_core/context.ts                → tRPC 上下文（双认证模式）
server/_core/llm.ts                    → Manus 内置 LLM 调用（作为 fallback）
client/src/pages/Settings.tsx          → V0.5 设置页（LLM Provider 配置）
client/src/pages/PromptTemplateManager.tsx → V0.5 Prompt 模板管理页
client/src/components/PromptTemplateSelector.tsx → Prompt 模板选择器（从 DB 加载）
client/src/lib/promptTemplates.ts      → Prompt 模板配置（前端预设定义，作为 fallback）
client/src/hooks/useCortexAuth.tsx     → 前端 Cortex 认证 hook
client/src/App.tsx                     → 前端路由配置
client/src/pages/Login.tsx             → 登录页
client/src/pages/ProjectList.tsx       → 项目列表首页（含全局导航栏）
client/src/pages/ProjectWorkspace.tsx  → 项目工作区容器
client/src/pages/Home.tsx              → PDF 上传页
client/src/pages/Chunks.tsx            → 分段预览页
client/src/pages/Topics.tsx            → 话题列表页
client/src/pages/TopicDetail.tsx       → Topic 详情页（V0.5.2 对话式交互）
client/src/pages/Explore.tsx           → 话题探索页
client/src/pages/UserManagement.tsx    → 用户管理页
client/src/lib/exportTopic.ts          → 话题导出工具函数
client/src/index.css                   → 赛博认知深色主题
server/cortex.test.ts                  → Vitest 单元测试（18 个测试）
server/v04.test.ts                     → V0.4+V0.5+V0.5.1 测试（46 个测试）
server/v052.test.ts                    → V0.5.2 对话功能测试（27 个测试）
server/auth.logout.test.ts             → 认证测试（1 个测试）
```

---

## tRPC API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `project.list` | query | 获取当前用户的所有项目 |
| `project.create` | mutation | 创建新项目 |
| `project.get` | query | 获取项目详情 |
| `project.update` | mutation | 更新项目信息 |
| `document.list` | query | 获取文档列表 |
| `document.upload` | mutation | 上传 PDF（Base64，小文件 fallback） |
| `POST /api/upload/pdf` | REST | 主要上传方式：multipart/form-data |
| `chunk.listAll` | query | 获取所有分段 |
| `extraction.extractDocument` | mutation | 批量 LLM 话题提取 |
| `topic.list` | query | 获取话题列表 |
| `topic.get` | query | 获取话题详情 |
| `summary.generate` | mutation | LLM 生成话题摘要（支持 customPrompt） |
| `summary.save` | mutation | 保存手动编辑的总结 |
| `summary.get` | query | 获取话题摘要 |
| `summary.startChat` | mutation | **V0.5.2** 启动话题对话（含 chunks + prompt 模板） |
| `summary.continueChat` | mutation | **V0.5.2** 继续对话（追加消息 + LLM 回复） |
| `summary.listConversations` | query | **V0.5.2** 获取话题的所有对话列表 |
| `summary.getConversation` | query | **V0.5.2** 获取单个对话完整历史 |
| `summary.deleteConversation` | mutation | **V0.5.2** 删除对话记录 |
| `explore.search` | mutation | 话题探索（支持 customPrompt） |
| `explore.saveAsTopic` | mutation | 将探索结果保存为 Topic |
| `mergedChunk.byTopic` | query | 获取话题的合并分段 |
| `mergedChunk.byProject` | query | 获取项目所有合并分段（按话题分组） |
| `mergedChunk.hasMerged` | query | 检查话题是否已有合并数据 |
| `mergedChunk.mergeByTopic` | mutation | 按话题触发 LLM 语义合并 |
| `llmSettings.getConfig` | query | **V0.5** 获取 LLM 配置（不返回原始 key） |
| `llmSettings.saveConfig` | mutation | **V0.5** 保存 LLM 配置 |
| `llmSettings.getProviderDefaults` | query | **V0.5** 获取各 Provider 默认配置 |
| `llmSettings.testConnection` | mutation | **V0.5** 测试 LLM 连接 |
| `llmSettings.fetchModels` | mutation | **V0.5.1** 获取 Provider 可用模型列表 |
| `promptTemplate.list` | query | **V0.5** 获取所有 Prompt 模板 |
| `promptTemplate.getById` | query | **V0.5** 获取单个模板详情 |
| `promptTemplate.create` | mutation | **V0.5** 创建自定义模板 |
| `promptTemplate.update` | mutation | **V0.5** 更新模板 |
| `promptTemplate.delete` | mutation | **V0.5** 删除模板（预设不可删） |
| `promptTemplate.importFile` | mutation | **V0.5.1** 导入 .skill/.md 文件为模板 |

---

## 设计风格

赛博认知风格深色主题：

- 背景：深蓝/暗灰（oklch 0.13 0.02 250）
- 前景文字：高对比浅灰（oklch 0.92 0.01 250）
- 主色调：青色（oklch 0.75 0.15 192）
- 卡片背景：略浅暗灰（oklch 0.17 0.02 250）
- 字体：JetBrains Mono（标题和代码风格元素）
- 特效：cyber-glow（青色辉光阴影）

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V0.1 | 2026-02-25 | MVP 骨架：PDF 上传解析、LLM 话题提取、Topic 详情页 |
| V0.2 | 2026-02-25 | 新增项目区：projects 表、项目列表首页、项目工作区、数据隔离 |
| V0.2.1 | 2026-02-27 | 修复大文件 PDF 上传失败：改用 multipart/form-data + multer |
| V0.3 | 2026-02-27 | 修复中文文件名乱码、新增话题探索功能、独立用户名密码认证系统 |
| V0.3.1 | 2026-02-27 | 新增话题导出功能：导出 Markdown / PDF |
| V0.4 | 2026-02-27 | 自定义 Prompt 模板、Chunk 合并优化、用户管理全局化、改密码、Admin 增强 |
| V0.4.2 | 2026-02-27 | Chunk 合并改为按话题维度、修复 Prompt 模板选择器点击 bug |
| V0.5 | 2026-02-27 | LLM Service 多 Provider 抽象层、配置管理、设置页 UI、多 Prompt 模板管理（DB 迁移） |
| V0.5.1 | 2026-02-27 | LLM 调用自动重试、OpenRouter 模型列表下拉搜索、Skill 文件导入（.skill/.md）、模板编辑增强 |
| **V0.5.2** | **2026-02-27** | **话题摘要对话式交互：topicConversations 表、多轮对话 tRPC API、迷你聊天窗口、历史对话管理、Markdown 渲染** |

---

## V0.6 可能的方向

1. **全文搜索增强**：使用 embedding 向量搜索替代关键词匹配
2. **批量操作**：批量重新提取话题、批量生成摘要
3. **可视化**：话题关系图谱、文档覆盖热力图
4. **项目删除与文档管理**：删除项目、删除文档、文档在项目间移动
5. **多格式支持**：支持 TXT、DOCX 等格式的文档上传
6. **协作功能**：多用户共享项目、评论和标注
7. **项目级 LLM 配置**：每个项目可覆盖全局 LLM 设置
8. **对话导出**：将对话结果导出为 Markdown/PDF

---

## 开发与部署

```bash
# 本地开发
pnpm install
pnpm dev

# 数据库迁移
pnpm db:push

# 运行测试
pnpm test

# 构建
pnpm build
pnpm start
```

**部署方式：** Manus 平台内置部署，通过 Management UI 的 Publish 按钮一键发布。

---

## 给新 AI 实例的指引

1. 克隆仓库：`gh repo clone NingYuleKK/litch-cortex`
2. 阅读本文档了解项目全貌
3. 查看 `todo.md` 了解当前进度和待办事项
4. 核心代码集中在 `server/routers.ts`（后端）和 `client/src/pages/`（前端）
5. 数据库 Schema 在 `drizzle/schema.ts`，修改后运行 `pnpm db:push`
6. **V0.5 LLM 调用统一走 `server/llm-service.ts` 的 `callLLM` 函数**
7. `callLLM` 自动从数据库读取 Provider 配置，fallback 到 Manus 内置 API
8. 认证系统在 `server/authRoute.ts`，使用 JWT + bcryptjs
9. 默认 admin 用户：username `litch`，初始密码 `cortex2026`
10. Prompt 模板已从 localStorage 迁移到数据库（`promptTemplates` 表）
11. 设置页在 `/settings`，模板管理在 `/settings/templates`
12. API key 存储使用 base64 编码（`encodeApiKey` / `decodeApiKey`）
13. 金瓶梅的原始 chunks 数据已保留，merged_chunks 是独立的新增层
14. **V0.5.1** `callLLM` 内置自动重试（失败后等 1s，最多重试 2 次），解决 OpenRouter 冷启动超时问题
15. **V0.5.1** 设置页模型选择改为下拉搜索框（OpenRouter 自动拉取模型列表，带缓存）
16. **V0.5.1** 模板管理支持 .skill/.md 文件导入，模板编辑器增强（可拖拽、字符计数、内容预览）
17. **V0.5.2** 话题详情页右侧改为双 Tab（对话 + 总结），对话 Tab 支持多轮 LLM 交互
18. **V0.5.2** 对话上下文持久化在 `topicConversations` 表，支持历史对话列表切换和删除
19. **V0.5.2** 对话启动时自动构建 system prompt（Prompt 模板）+ user 消息（chunks 内容）
20. **V0.5.2** 测试文件 `server/v052.test.ts` 包含 27 个测试覆盖对话功能
