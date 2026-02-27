# HANDOVER_CORTEX.md — Litch's Cortex V0.4.2 交接文档

## 项目概述

Litch's Cortex 是一个对话资产治理工具，用于管理 Litch 与多个 AI 进行深度对话产生的 PDF 记录。核心数据流为：**创建项目 → 上传 PDF → 解析分段 → LLM 提取话题标签 → 查看话题下的原文 → 按话题合并分段 → 生成总结**。

V0.1 打通了完整骨架和数据流。V0.2 新增了「项目区」功能。V0.3 新增了话题探索、独立认证系统、修复了中文文件名乱码。V0.4 新增了自定义 Prompt 模板、Chunk 合并优化、用户管理全局化、个人改密码、Admin 用户管理增强。V0.4.2 将 Chunk 合并从按文档整体合并改为按话题维度合并。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Tailwind CSS 4 | SPA，赛博认知深色主题 |
| 后端 | Node.js + Express + tRPC 11 | 类型安全的 RPC 接口 |
| 数据库 | MySQL (TiDB) + Drizzle ORM | 托管在 Manus 平台 |
| PDF 解析 | pdf-parse | 服务端解析 PDF 文本 |
| LLM | Manus 内置 LLM API (invokeLLM) | 话题提取 + 摘要生成 + 话题探索 + **按话题 Chunk 合并** |
| 认证 | **独立用户名密码 + JWT**（V0.3） | 替代 Manus OAuth，支持独立部署 |
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
users: id, openId, name, email, role, ... (Manus OAuth, 保留兼容)
```

**关系说明：**

- 一个 cortexUser 拥有多个 projects（一对多，通过 cortexUserId）
- 一个 project 包含多个 documents（一对多）
- 一个 document 包含多个 chunks（一对多）
- **一个 topic 可以有多个 mergedChunks（一对多，V0.4.2 改为按话题关联）**
- mergedChunks 通过 sourceChunkIds（JSON 数组）引用原始 chunks
- 一个 chunk 可以关联多个 topics，一个 topic 可以关联多个 chunks（多对多，通过 chunk_topics）
- 一个 topic 对应一个 summary（一对一）
- 话题列表和详情页在项目范围内进行数据隔离

---

## 认证系统（V0.3 新增，V0.4 增强）

### 架构

- **独立认证**：用户名 + 密码登录，不依赖 Manus OAuth
- **JWT Cookie**：登录后设置 `cortex_auth` httpOnly cookie，有效期 7 天
- **密码安全**：使用 bcryptjs（salt rounds = 10）哈希存储
- **角色控制**：admin 可创建新用户，member 只能访问自己的数据
- **默认管理员**：服务器启动时自动创建 admin 用户（username: litch, 初始密码: cortex2026）
- **V0.4 改密码**：所有用户可修改自己的密码（验证旧密码 + 设置新密码）
- **V0.4 初始密码记录**：Admin 创建用户时，初始密码明文存入 `initialPassword` 字段（用户自改密码后不更新）
- **V0.4 删除用户**：Admin 可删除用户（级联删除该用户所有项目、文档、chunks、merged_chunks 等数据）

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

### tRPC 集成

- `context.ts` 同时支持 Cortex JWT 和 Manus OAuth 认证
- Cortex 认证优先：先检查 `cortex_auth` cookie，成功则注入 `ctx.cortexUserId`
- 所有 `protectedProcedure` 路由自动支持两种认证方式
- `ctx.cortexUserId` 用于数据隔离查询

---

## 核心功能

### 1. 登录页 (`/login`)（V0.3 新增）
- 独立的用户名 + 密码登录表单
- 赛博认知风格设计
- 登录成功后跳转到项目列表

### 2. 项目管理 (`/`)
- 首页为项目列表，卡片式展示当前用户的项目
- **V0.4**：顶部导航栏含用户菜单（改密码、用户管理入口）
- 每个卡片显示项目名称、描述、文档数量、创建日期
- 支持新建项目（输入名称和描述）
- 数据按用户隔离（cortexUserId）

### 3. 项目工作区 (`/project/:id`)
- 侧边栏显示项目信息和导航菜单
- 包含子页面：上传文档、分段预览、话题列表、话题探索
- **V0.4**：用户管理入口移至全局导航栏（不再在侧边栏内）
- 底部显示当前用户信息和退出按钮

### 4. PDF 上传与解析 (`/project/:id`)
- 拖拽或点击上传 PDF（支持多文件批量，单文件最大 100MB）
- 使用 `multipart/form-data` + `fetch` 上传到 `/api/upload/pdf`
- 后端使用 multer + pdf-parse 解析，按 500-800 字分段

### 5. 分段预览 (`/project/:id/chunks`)
- Log 面板风格的分段列表
- 显示行号、来源文件、位置、字数
- **V0.4.2**：「原始分段 / 合并分段」切换按钮
- **V0.4.2**：合并分段视图按话题分组展示，每个话题下显示其合并块
- 合并操作在话题详情页触发（不再在分段预览页触发）

### 6. 话题列表 (`/project/:id/topics`)
- 三列网格布局展示话题
- 每个话题显示标签、关联 chunk 数量、权重

### 7. Topic 详情页 (`/project/:id/topics/:topicId`)
- 左侧：关联 chunks 原文列表，支持「原始片段 / 合并片段」Tab 切换
- **V0.4.2**：左侧新增「合并相关分段」/「重新合并」按钮
- 右侧：LLM 生成摘要 + 手动编辑总结
- 导出 MD / 导出 PDF 按钮
- **V0.4**：生成摘要按钮旁增加 Prompt 模板选择器

### 8. 话题探索 (`/project/:id/explore`)
- 用户输入关键词或问题
- **V0.4**：搜索框旁增加 Prompt 模板选择器
- 后端从当前项目中检索相关内容
- 将相关内容发给 LLM 整理出结构化话题总结
- 展示：话题标题 + 总结内容 + 关联原文片段
- 用户可选择「保存为 Topic」存入 topics 表
- 导出 MD / 导出 PDF 按钮

### 9. 用户管理 (`/admin/users`)（V0.4 全局化）
- **V0.4**：从项目工作区侧边栏移至全局路由 `/admin/users`
- **V0.4**：通过顶部导航栏齿轮图标进入（仅 admin 可见）
- 显示所有用户列表（用户名、角色、**初始密码**、创建时间、最后登录）
- admin 可创建新用户（设置用户名、密码、角色）
- **V0.4**：admin 可删除用户（带确认对话框，级联删除所有数据）

### 10. 修改密码（V0.4 新增）
- 所有登录用户可通过顶部导航栏用户菜单进入
- 弹出对话框：输入旧密码 + 新密码 + 确认新密码
- 后端验证旧密码正确后更新

### 11. 自定义 Prompt 模板（V0.4 新增）
- 预设 5 个模板：学术总结（默认）、Blog 风格、读书笔记、对话摘要、自定义
- 话题探索页和话题详情页均可选择模板
- 自定义 prompt 使用 localStorage 缓存
- 模板配置文件：`client/src/lib/promptTemplates.ts`

### 12. Chunk 按话题合并（V0.4.2 重新设计）
- **设计变更**：从 V0.4 的按文档整体合并，改为按话题维度合并
- 在话题详情页点击「合并相关分段」按钮触发
- 合并逻辑：获取该话题关联的所有 chunks → 每 5-8 个为一组 → LLM 判断语义相关性后合并
- 合并结果存入 `merged_chunks` 表，通过 `topicId` 关联
- 已有合并数据的话题显示「重新合并」按钮
- 话题详情页左侧支持「原始片段 / 合并片段」Tab 切换
- 分段预览页的合并分段 Tab 按话题分组展示所有已合并结果
- 原始 chunks 完全不动，金瓶梅数据保留

---

## 关键文件

```
drizzle/schema.ts                      → 数据库表定义（含 cortexUsers、mergedChunks 表）
server/db.ts                           → 数据库查询层（所有 CRUD 操作，含按话题合并的 merged chunk 操作）
server/routers.ts                      → tRPC 路由（API 端点，含 mergedChunk router）
server/uploadRoute.ts                  → PDF 上传 Express 路由
server/authRoute.ts                    → 独立认证路由（含改密码、删除用户 API）
server/_core/context.ts                → tRPC 上下文（双认证模式）
server/_core/index.ts                  → 服务器入口（注册路由）
client/src/hooks/useCortexAuth.tsx     → 前端 Cortex 认证 hook（含改密码、删除用户方法）
client/src/App.tsx                     → 前端路由配置（含 /admin/users 路由）
client/src/pages/Login.tsx             → 登录页
client/src/pages/ProjectList.tsx       → 项目列表首页（含全局导航栏）
client/src/pages/ProjectWorkspace.tsx  → 项目工作区容器
client/src/pages/Home.tsx              → PDF 上传页（项目内）
client/src/pages/Chunks.tsx            → 分段预览页（含原始/合并切换，合并按话题分组展示）
client/src/pages/Topics.tsx            → 话题列表页（项目内）
client/src/pages/TopicDetail.tsx       → Topic 详情页（含合并按钮、Prompt 模板选择器）
client/src/pages/Explore.tsx           → 话题探索页（含 Prompt 模板选择器）
client/src/pages/UserManagement.tsx    → 用户管理页（含初始密码显示、删除用户）
client/src/components/ChangePasswordDialog.tsx → 修改密码对话框
client/src/components/PromptTemplateSelector.tsx → Prompt 模板选择器组件
client/src/lib/promptTemplates.ts      → Prompt 模板配置
client/src/lib/exportTopic.ts          → 话题导出工具函数
client/src/index.css                   → 赛博认知深色主题
server/cortex.test.ts                  → Vitest 单元测试（18 个测试）
server/v04.test.ts                     → V0.4 新增测试（17 个测试）
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
| `document.list` | query | 获取文档列表（支持 projectId 过滤） |
| `document.upload` | mutation | 上传 PDF（Base64，小文件 fallback） |
| `POST /api/upload/pdf` | REST | **主要上传方式**：multipart/form-data |
| `chunk.listAll` | query | 获取所有分段（支持 projectId 过滤） |
| `extraction.extractDocument` | mutation | 批量 LLM 话题提取 |
| `topic.list` | query | 获取话题列表（支持 projectId 过滤） |
| `topic.get` | query | 获取话题详情（含关联 chunks + summary） |
| `summary.generate` | mutation | LLM 生成话题摘要（支持 customPrompt） |
| `summary.save` | mutation | 保存手动编辑的总结 |
| `explore.search` | mutation | 话题探索：关键词检索 + LLM 整理（支持 customPrompt） |
| `explore.saveAsTopic` | mutation | 将探索结果保存为 Topic |
| `mergedChunk.byTopic` | query | 获取话题的合并分段（V0.4.2） |
| `mergedChunk.byProject` | query | 获取项目的所有合并分段（按话题分组，V0.4.2） |
| `mergedChunk.hasMerged` | query | 检查话题是否已有合并数据（V0.4.2） |
| `mergedChunk.mergeByTopic` | mutation | 按话题触发 LLM 语义合并（V0.4.2） |

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
| V0.3.1 | 2026-02-27 | 新增话题导出功能：导出 Markdown / PDF（含标题、总结、原文引用） |
| V0.4 | 2026-02-27 | 自定义 Prompt 模板、Chunk 合并优化、用户管理全局化、改密码、Admin 增强 |
| V0.4.2 | 2026-02-27 | Chunk 合并改为按话题维度、修复 Prompt 模板选择器点击 bug |

---

## V0.5 可能的方向

1. **全文搜索增强**：使用 embedding 向量搜索替代关键词匹配
2. **批量操作**：批量重新提取话题、批量生成摘要
3. **可视化**：话题关系图谱、文档覆盖热力图
4. **项目删除与文档管理**：删除项目、删除文档、文档在项目间移动
5. **多格式支持**：支持 TXT、DOCX 等格式的文档上传
6. **协作功能**：多用户共享项目、评论和标注

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
6. LLM 调用使用 `invokeLLM` 函数（来自 `server/_core/llm`），无需额外配置 API Key
7. 认证系统在 `server/authRoute.ts`，使用 JWT + bcryptjs
8. 默认 admin 用户：username `litch`，初始密码 `cortex2026`
9. 项目区的路由结构为 `/project/:projectId/:tab`，所有数据查询支持 projectId 过滤
10. V0.4 新增的 Prompt 模板是纯前端功能，配置在 `client/src/lib/promptTemplates.ts`
11. **V0.4.2 的 Chunk 合并是按话题维度的**：在话题详情页触发 `mergedChunk.mergeByTopic`
12. merged_chunks 表通过 `topicId` 关联话题（不再通过 documentId）
13. 金瓶梅的原始 chunks 数据已保留，merged_chunks 是独立的新增层
