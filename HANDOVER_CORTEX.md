# HANDOVER_CORTEX.md — Litch's Cortex V0.1 交接文档

## 项目概述

Litch's Cortex 是一个对话资产治理工具的 MVP 骨架，用于管理 Litch 与多个 AI 进行深度对话产生的 PDF 记录。核心数据流为：**上传 PDF → 解析分段 → LLM 提取话题标签 → 查看话题下的原文 → 生成总结**。

当前版本 V0.1 已打通完整骨架和数据流，使用 5 个真实的金瓶梅对话 PDF 完成了端到端验证。

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
documents: id, filename, uploadTime, rawText, status
chunks: id, documentId, content, position, tokenCount, createdAt
topics: id, label, description, weight, createdAt
chunk_topics: id, chunkId, topicId, relevanceScore
summaries: id, topicId, summaryText, generatedAt
users: id, openId, name, email, role, ... (Manus OAuth)
```

**关系说明：**
- 一个 document 包含多个 chunks（一对多）
- 一个 chunk 可以关联多个 topics，一个 topic 可以关联多个 chunks（多对多，通过 chunk_topics）
- 一个 topic 对应一个 summary（一对一）

---

## 核心功能

### 1. PDF 上传与解析 (`/`)
- 拖拽或点击上传 PDF（支持多文件批量）
- 前端将 PDF 转为 Base64 发送到后端
- 后端使用 pdf-parse 解析文本，按 500-800 字分段
- 分段存入 chunks 表，原文存入 documents 表
- 上传后自动触发 LLM 话题提取

### 2. 分段预览 (`/chunks`)
- Log 面板风格的分段列表
- 显示行号、来源文件、位置、字数
- 支持滚动浏览所有分段

### 3. 话题列表 (`/topics`)
- 网格布局展示所有话题
- 每个话题显示标签、描述、关联 chunk 数量、权重
- 按权重降序排列
- 点击进入话题详情

### 4. Topic 详情页 (`/topics/:id`)
- 左侧：该话题关联的所有 chunks 原文列表（含来源文件、相关度分数）
- 右侧：话题总结区域
  - 「LLM 生成摘要」按钮：调用 LLM 自动生成总结
  - 手动编写/编辑总结
  - 总结保存到 summaries 表

---

## 关键文件

```
drizzle/schema.ts          → 数据库表定义
server/db.ts               → 数据库查询层（所有 CRUD 操作）
server/routers.ts          → tRPC 路由（API 端点）
client/src/App.tsx          → 前端路由配置
client/src/pages/Home.tsx   → PDF 上传页
client/src/pages/Chunks.tsx → 分段预览页
client/src/pages/Topics.tsx → 话题列表页
client/src/pages/TopicDetail.tsx → Topic 详情页
client/src/components/DashboardLayout.tsx → 侧边栏布局
client/src/index.css        → 赛博认知深色主题
server/cortex.test.ts       → Vitest 单元测试
```

---

## tRPC API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `document.upload` | mutation | 上传 PDF（Base64），解析分段存库 |
| `document.list` | query | 获取所有文档列表（含 chunk 数量） |
| `chunk.listAll` | query | 获取所有分段（含来源文件名） |
| `extraction.extractDocument` | mutation | 对指定文档的所有 chunk 进行 LLM 话题提取 |
| `topic.list` | query | 获取所有话题（含关联 chunk 数量） |
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

使用 5 个金瓶梅对话 PDF 完成了完整测试：
- 6 条文档记录（其中 1 个为重复上传）
- 506 个文本分段
- 342+ 个话题标签
- 1 条 LLM 生成的摘要（「金瓶梅解读」话题）

---

## V0.2 可能的方向

1. **话题聚类与合并**：当前话题粒度较细（342 个），可以考虑用 LLM 或 embedding 进行二次聚类，合并相似话题
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
