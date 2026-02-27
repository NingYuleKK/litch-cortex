# Litch's Cortex — 对话资产治理 Step 1 架构设计

## 项目定位

**大背景**：对话资产治理（Personal Cognitive System），将人与多个 AI 的对话转化为可检索、可迁移、可复用的认知资产。

**Step 1 目标**：上传 PDF 对话记录 → 模型提取话题聚类 → 生成话题星图/索引 → 点击查看原文 + 生成总结 → 导出给其他 AI 做上下文。

**项目名候选**：Litch's Cortex（大脑皮层，认知中枢）

---

## GPT（Root）建议分析

Root 的建议主要是大项目的整体规划（5 个模块、3 个阶段），覆盖面很广但对 Step 1 的具体实现指导不够。他的建议更像是"产品路线图"，我们需要的是"Step 1 的工程方案"。

**Root 建议中值得采纳的**：
- 对话资产的 chunk 提取思路
- 话题聚类 + 索引的核心概念
- 导出为可迁移格式

**我们 Step 1 不需要的**：
- 多用户系统、权限管理
- 实时对话接入
- 复杂的知识图谱

---

## Step 1 架构方案

### 核心流程

```
上传 PDF → 解析文本 → 分段(chunk) → LLM 提取话题标签 → 聚类 → 星图/索引 → 点击查看原文+总结 → 导出
```

### 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| 前端 | React + Tailwind | 与现有项目一致 |
| 可视化 | D3.js force graph | 节点大小可变的力导向图，适合话题星图 |
| 后端 | Node.js + tRPC | 与 Check/Nexus 一致 |
| PDF 解析 | pdf-parse (npm) | 轻量，纯 JS，适合 Chrome 导出的 PDF |
| LLM 调用 | OpenAI API (gpt-4.1-mini) | 环境已配置，成本低 |
| 数据存储 | SQLite (Drizzle ORM) | 与现有项目一致，自用够了 |

### 数据模型

```
documents (文档表)
├── id, filename, upload_time, raw_text

chunks (分段表)
├── id, document_id, content, position, token_count

topics (话题表)
├── id, label, description, weight (节点大小)

chunk_topics (关联表)
├── chunk_id, topic_id, relevance_score

summaries (总结表)
├── id, topic_id, summary_text, generated_at
```

### 页面结构

1. **上传页**：拖拽上传 PDF，显示解析进度
2. **星图页**：D3 力导向图，节点 = 话题，大小 = 关联 chunk 数量，点击节点进入详情
3. **话题详情页**：左侧原文片段列表，右侧 LLM 生成的非对话体总结
4. **导出页**：选择话题 → 导出 Markdown（总结 + 关键原文片段）

### LLM 调用策略

分两步调用，控制成本：

**第一步：话题提取**（批量处理所有 chunk）
- 每 5-10 个 chunk 打包发给 LLM
- Prompt：提取话题标签 + 每个 chunk 的话题归属
- 用 gpt-4.1-mini，成本低

**第二步：总结生成**（按需，用户点击时触发）
- 用户点击某个话题时，将该话题下的所有 chunk 发给 LLM
- Prompt：生成一段非对话体的认知总结
- 结果缓存到 summaries 表

### 设计风格

赛博认知风格：
- 深蓝/暗紫底色 + 荧光节点
- 星图背景有微弱的网格线，像神经网络
- 节点发光效果，hover 时扩大 + 高亮关联线
- 整体感觉：你在观察自己的认知网络

---

## 开发拆解（路线 A：子敬 spec + Codex 写代码）

### Issue #1：PDF 上传与解析
- 上传组件 + pdf-parse 解析 + 文本分段(chunk)
- 存入 documents + chunks 表
- 验收：上传 PDF 后能看到分段结果

### Issue #2：LLM 话题提取
- tRPC API 调用 OpenAI 提取话题
- 话题去重 + 权重计算
- 存入 topics + chunk_topics 表
- 验收：上传 PDF 后自动生成话题列表

### Issue #3：话题星图可视化
- D3.js 力导向图
- 节点大小 = chunk 数量，颜色 = 话题类别
- 点击节点跳转详情
- 验收：星图正确显示，交互流畅

### Issue #4：话题详情 + 总结生成
- 原文片段列表
- 点击"生成总结"调用 LLM
- 总结缓存
- 验收：能看到原文 + 生成总结

### Issue #5：导出功能
- 选择话题 → 导出 Markdown
- 包含总结 + 关键原文片段
- 验收：导出的 MD 文件可直接发给其他 AI

---

## 与 MiniMax 本地方案的对比

| 维度 | MiniMax 本地方案 | Cortex 方案 |
|---|---|---|
| 运行环境 | 本地 | Web (Manus 部署) |
| 可视化 | 无/简单 | D3 力导向星图 |
| 导出 | 文本 | Markdown + 结构化 |
| 可迭代性 | 脚本级 | 产品级，可持续迭代 |
| 多人使用 | 不支持 | 未来可扩展 |

---

## 时间估算

| Issue | 预计时间 | 谁做 |
|---|---|---|
| #1 PDF 上传解析 | 15 min | Codex |
| #2 LLM 话题提取 | 20 min | Codex |
| #3 星图可视化 | 30 min | Codex |
| #4 详情 + 总结 | 20 min | Codex |
| #5 导出 | 10 min | Codex |
| Spec 编写 | 30 min | 子敬 |
| 验收 + 部署 | 30 min | 子敬 |
| **总计** | **~2.5 小时** | |

如果走路线 B（子敬直接写），大约 1-1.5 小时。
