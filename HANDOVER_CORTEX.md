# HANDOVER_CORTEX.md — Litch's Cortex V0.3 交接文档

## 项目概述

Litch's Cortex 是一个对话资产治理工具，用于管理 Litch 与多个 AI 进行深度对话产生的 PDF 记录。核心数据流为：**创建项目 → 上传 PDF → 解析分段 → LLM 提取话题标签 → 查看话题下的原文 → 生成总结**。

V0.1 打通了完整骨架和数据流。V0.2 新增了「项目区」功能。V0.3 新增了话题探索、独立认证系统、修复了中文文件名乱码。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Tailwind CSS 4 | SPA，赛博认知深色主题 |
| 后端 | Node.js + Express + tRPC 11 | 类型安全的 RPC 接口 |
| 数据库 | MySQL (TiDB) + Drizzle ORM | 托管在 Manus 平台 |
| PDF 解析 | pdf-parse | 服务端解析 PDF 文本 |
| LLM | Manus 内置 LLM API (invokeLLM) | 话题提取 + 摘要生成 + 话题探索 |
| 认证 | **独立用户名密码 + JWT**（V0.3） | 替代 Manus OAuth，支持独立部署 |
| 密码哈希 | bcryptjs | 安全存储密码 |
| 部署 | Manus 平台 | 一键部署 |

---

## 数据模型

```
cortexUsers: id, username, passwordHash, role(admin/member), createdAt, lastSignedIn
projects: id, userId, cortexUserId, name, description, createdAt, updatedAt
documents: id, userId, projectId, filename, fileUrl, rawText, status, chunkCount, uploadTime
chunks: id, documentId, content, position, tokenCount, createdAt
topics: id, label, description, weight, createdAt
chunk_topics: id, chunkId, topicId, relevanceScore
summaries: id, topicId, summaryText, generatedAt
users: id, openId, name, email, role, ... (Manus OAuth, 保留兼容)
```

**关系说明：**

- 一个 cortexUser 拥有多个 projects（一对多，通过 cortexUserId）
- 一个 project 包含多个 documents（一对多）
- 一个 document 包含多个 chunks（一对多）
- 一个 chunk 可以关联多个 topics，一个 topic 可以关联多个 chunks（多对多，通过 chunk_topics）
- 一个 topic 对应一个 summary（一对一）
- 话题列表和详情页在项目范围内进行数据隔离

---

## 认证系统（V0.3 新增）

### 架构

- **独立认证**：用户名 + 密码登录，不依赖 Manus OAuth
- **JWT Cookie**：登录后设置 `cortex_auth` httpOnly cookie，有效期 7 天
- **密码安全**：使用 bcryptjs（salt rounds = 10）哈希存储
- **角色控制**：admin 可创建新用户，member 只能访问自己的数据
- **默认管理员**：服务器启动时自动创建 admin 用户（username: litch, 初始密码: cortex2026）

### API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `POST /api/auth/login` | REST | 用户名密码登录，返回 JWT cookie |
| `POST /api/auth/logout` | REST | 清除认证 cookie |
| `GET /api/auth/me` | REST | 获取当前登录用户信息 |
| `POST /api/auth/users` | REST | 创建新用户（仅 admin） |
| `GET /api/auth/users` | REST | 获取用户列表（仅 admin） |

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
- 每个卡片显示项目名称、描述、文档数量、创建日期
- 支持新建项目（输入名称和描述）
- 数据按用户隔离（cortexUserId）

### 3. 项目工作区 (`/project/:id`)
- 侧边栏显示项目信息和导航菜单
- 包含子页面：上传文档、分段预览、话题列表、**话题探索**（V0.3）
- admin 用户额外显示「用户管理」入口
- 底部显示当前用户信息和退出按钮

### 4. PDF 上传与解析 (`/project/:id`)
- 拖拽或点击上传 PDF（支持多文件批量，单文件最大 100MB）
- **V0.3 修复**：中文文件名正确显示（使用 `Buffer.from(field, 'latin1').toString('utf8')` 解码）
- 使用 `multipart/form-data` + `fetch` 上传到 `/api/upload/pdf`
- 后端使用 multer + pdf-parse 解析，按 500-800 字分段

### 5. 分段预览 (`/project/:id/chunks`)
- Log 面板风格的分段列表
- 显示行号、来源文件、位置、字数

### 6. 话题列表 (`/project/:id/topics`)
- 三列网格布局展示话题
- 每个话题显示标签、关联 chunk 数量、权重

### 7. Topic 详情页 (`/project/:id/topics/:topicId`)
- 左侧：关联 chunks 原文列表
- 右侧：LLM 生成摘要 + 手动编辑总结
- **V0.3.1**：导出 MD / 导出 PDF 按钮（含话题标题 + 总结 + 原文引用片段）

### 8. 话题探索 (`/project/:id/explore`)（V0.3 新增）
- 用户输入关键词或问题
- 后端从当前项目 chunks 中关键词检索相关内容
- 将相关 chunks 发给 LLM 整理出结构化话题总结
- 展示：话题标题 + 总结内容 + 关联原文片段
- 用户可选择「保存为 Topic」存入 topics 表
- **V0.3.1**：导出 MD / 导出 PDF 按钮（与 Topic 详情页相同格式）

### 9. 用户管理 (`/project/:id/users`)（V0.3 新增，admin only）
- 显示所有用户列表（用户名、角色、创建时间、最后登录）
- admin 可创建新用户（设置用户名、密码、角色）

---

## 关键文件

```
drizzle/schema.ts                      → 数据库表定义（含 cortexUsers 表）
server/db.ts                           → 数据库查询层（所有 CRUD 操作）
server/routers.ts                      → tRPC 路由（API 端点）
server/uploadRoute.ts                  → PDF 上传 Express 路由（multipart/form-data）
server/authRoute.ts                    → 独立认证路由（登录/注册/用户管理）（V0.3）
server/_core/context.ts                → tRPC 上下文（双认证模式）（V0.3 修改）
server/_core/index.ts                  → 服务器入口（注册路由）
client/src/hooks/useCortexAuth.tsx     → 前端 Cortex 认证 hook（V0.3）
client/src/App.tsx                     → 前端路由配置
client/src/pages/Login.tsx             → 登录页（V0.3）
client/src/pages/ProjectList.tsx       → 项目列表首页
client/src/pages/ProjectWorkspace.tsx  → 项目工作区容器
client/src/pages/Home.tsx              → PDF 上传页（项目内）
client/src/pages/Chunks.tsx            → 分段预览页（项目内）
client/src/pages/Topics.tsx            → 话题列表页（项目内）
client/src/pages/TopicDetail.tsx       → Topic 详情页（项目内，含导出按钮）
client/src/pages/Explore.tsx           → 话题探索页（V0.3，含导出按钮）
client/src/lib/exportTopic.ts          → 话题导出工具函数（V0.3.1）
client/src/pages/UserManagement.tsx    → 用户管理页（V0.3，admin only）
client/src/index.css                   → 赛博认知深色主题
server/cortex.test.ts                  → Vitest 单元测试（19 个测试）
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
| `summary.generate` | mutation | LLM 生成话题摘要 |
| `summary.save` | mutation | 保存手动编辑的总结 |
| `explore.search` | mutation | **话题探索**：关键词检索 + LLM 整理（V0.3） |
| `explore.saveAsTopic` | mutation | 将探索结果保存为 Topic（V0.3） |

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

---

## V0.4 可能的方向

1. **话题聚类与合并**：当前话题粒度较细，可以用 LLM 或 embedding 进行二次聚类
2. ~~**导出功能**：支持导出话题总结为 Markdown/PDF~~ → 已在 V0.3.1 实现
3. **全文搜索增强**：使用 embedding 向量搜索替代关键词匹配
4. **批量操作**：批量重新提取话题、批量生成摘要
5. **可视化**：话题关系图谱、文档覆盖热力图
6. **项目删除与文档管理**：删除项目、删除文档、文档在项目间移动
7. **密码修改**：用户自助修改密码

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
