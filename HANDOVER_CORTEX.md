# HANDOVER_CORTEX.md — Litch's Cortex V0.2.1 交接文档

## 项目概述

Litch's Cortex 是一个对话资产治理工具，用于管理 Litch 与多个 AI 进行深度对话产生的 PDF 记录。核心数据流为：**创建项目 → 上传 PDF → 解析分段 → LLM 提取话题标签 → 查看话题下的原文 → 生成总结**。

V0.1 打通了完整骨架和数据流。V0.2 新增了「项目区」功能，支持按项目组织和隔离文档、分段、话题数据。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Tailwind CSS 4 | SPA，赛博认知深色主题 |
| 后端 | Node.js + Express + tRPC 11 | 类型安全的 RPC 接口 |
| 数据库 | MySQL (TiDB) + Drizzle ORM | 托管在 Manus 平台 |
| PDF 解析 | pdf-parse | 服务端解析 PDF 文本 |
| LLM | Manus 内置 LLM API (invokeLLM) | 话题提取 + 摘要生成 |
| 认证 | Manus OAuth | 内置登录系统 |
| 部署 | Manus 平台 | 一键部署 |

---

## 数据模型

```
projects: id, userId, name, description, createdAt, updatedAt
documents: id, userId, projectId, filename, fileUrl, rawText, status, chunkCount, uploadTime
chunks: id, documentId, content, position, tokenCount, createdAt
topics: id, label, description, weight, createdAt
chunk_topics: id, chunkId, topicId, relevanceScore
summaries: id, topicId, summaryText, generatedAt
users: id, openId, name, email, role, ... (Manus OAuth)
```

**关系说明：**

- 一个 user 拥有多个 projects（一对多）
- 一个 project 包含多个 documents（一对多）
- 一个 document 包含多个 chunks（一对多）
- 一个 chunk 可以关联多个 topics，一个 topic 可以关联多个 chunks（多对多，通过 chunk_topics）
- 一个 topic 对应一个 summary（一对一）
- 话题列表和详情页在项目范围内进行数据隔离

---

## 核心功能

### 1. 项目管理 (`/`)（V0.2 新增）
- 首页为项目列表，卡片式展示所有项目
- 每个卡片显示项目名称、描述、文档数量、创建日期
- 支持新建项目（输入名称和描述）
- 点击项目卡片进入该项目的工作区

### 2. 项目工作区 (`/project/:id`)（V0.2 新增）
- 侧边栏显示项目信息和导航菜单
- 包含三个子页面：上传文档、分段预览、话题列表
- 所有数据按 projectId 隔离
- 支持返回项目列表

### 3. PDF 上传与解析 (`/project/:id`)
- 拖拽或点击上传 PDF（支持多文件批量，单文件最大 100MB）
- **V0.2.1 修复**：前端使用 `multipart/form-data` + `fetch` 上传到独立 Express 路由 `/api/upload/pdf`（不再使用 Base64-in-tRPC-JSON，避免大文件超出网关 body size 限制）
- 后端使用 multer 接收文件 + pdf-parse 解析文本，按 500-800 字分段
- 分段存入 chunks 表，原文存入 documents 表
- 上传后可触发 LLM 话题提取
- 上传自动归属到当前项目

### 4. 分段预览 (`/project/:id/chunks`)
- Log 面板风格的分段列表
- 显示行号、来源文件、位置、字数
- 按项目范围过滤

### 5. 话题列表 (`/project/:id/topics`)
- 三列网格布局展示话题
- 每个话题显示标签、关联 chunk 数量、权重
- 按权重降序排列，限定在当前项目范围内
- 点击进入话题详情

### 6. Topic 详情页 (`/project/:id/topics/:topicId`)
- 左侧：该话题在当前项目中关联的所有 chunks 原文列表
- 右侧：话题总结区域
  - 「LLM 生成摘要」按钮：调用 LLM 自动生成总结
  - 手动编写/编辑总结
  - 总结保存到 summaries 表

---

## 关键文件

```
drizzle/schema.ts                      → 数据库表定义（含 projects 表）
server/db.ts                           → 数据库查询层（所有 CRUD 操作）
server/routers.ts                      → tRPC 路由（API 端点）
server/uploadRoute.ts                  → PDF 上传 Express 路由（multipart/form-data，V0.2.1）
client/src/App.tsx                     → 前端路由配置
client/src/pages/ProjectList.tsx       → 项目列表首页（V0.2）
client/src/pages/ProjectWorkspace.tsx  → 项目工作区容器（V0.2）
client/src/pages/Home.tsx              → PDF 上传页（项目内）
client/src/pages/Chunks.tsx            → 分段预览页（项目内）
client/src/pages/Topics.tsx            → 话题列表页（项目内）
client/src/pages/TopicDetail.tsx       → Topic 详情页（项目内）
client/src/index.css                   → 赛博认知深色主题
server/cortex.test.ts                  → Vitest 单元测试（15 个测试）
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
| `POST /api/upload/pdf` | REST | **主要上传方式**：multipart/form-data 上传 PDF，支持大文件（V0.2.1） |
| `chunk.listAll` | query | 获取所有分段（支持 projectId 过滤） |
| `extraction.extractDocument` | mutation | 对指定文档的所有 chunk 进行 LLM 话题提取 |
| `topic.list` | query | 获取话题列表（支持 projectId 过滤） |
| `topic.get` | query | 获取话题详情（含关联 chunks + summary） |
| `summary.generate` | mutation | LLM 生成话题摘要 |
| `summary.save` | mutation | 保存手动编辑的总结 |

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

## 当前数据

使用多个对话 PDF 完成了完整测试：

- 2 个项目（金瓶梅研究 + PicoPico工作）
- 11+ 条文档记录（含 24.5MB 大文件 PicoPico运营策略与集群.pdf）
- 950+ 个文本分段
- 800+ 个话题标签
- 1 条 LLM 生成的摘要

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V0.1 | 2026-02-25 | MVP 骨架：PDF 上传解析、LLM 话题提取、Topic 详情页 |
| V0.2 | 2026-02-25 | 新增项目区：projects 表、项目列表首页、项目工作区、数据隔离 |
| V0.2.1 | 2026-02-27 | 修复大文件 PDF 上传失败：改用 multipart/form-data + multer，支持 100MB PDF |

---

## V0.3 可能的方向

1. **话题聚类与合并**：当前话题粒度较细（804 个），可以考虑用 LLM 或 embedding 进行二次聚类，合并相似话题为 20-30 个大类
2. **导出功能**：支持导出话题总结为 Markdown/PDF
3. **搜索功能**：全文搜索 chunks 内容
4. **批量操作**：批量重新提取话题、批量生成摘要
5. **缓存管理**：LLM 调用结果缓存，避免重复消耗
6. **高级 Prompt**：针对不同类型的对话内容优化提取和总结 prompt
7. **可视化**：话题关系图谱、文档覆盖热力图

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
7. 项目区的路由结构为 `/project/:projectId/:tab`，所有数据查询支持 projectId 过滤
