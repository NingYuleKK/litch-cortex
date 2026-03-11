# Litch's Cortex 版本规划

## 已完成版本

### V0.1 — 基础框架
- 项目初始化，PDF 上传 + 解析 + chunk + embedding + 语义搜索
- 话题探索 + LLM 总结
- 部署到 manus.space

### V0.7 — Docker 支持
- Docker Compose 本地部署
- 环境变量配置

### V0.8 — JSON Import（已完成）
- ChatGPT conversations.json 导入（大文件流式解析，1GB 上限）
- 增量更新（只处理变化的对话）
- 跨项目 stableId 隔离
- V2 查询链路（分段预览 + 关键词搜索 + 语义搜索支持 conversation chunks）
- rawMetadata/errors 字段 MEDIUMTEXT
- 分段预览分页（后端分页 + 前端分页 UI）
- 向量生成分批处理（前端轮询式 + 进度显示）

---

## 阶段一：V0.9 — 功能完善期

**目标：让 Litch 自己能持续用起来**

### 核心功能
- **Topic Extraction 接通**：导入 conversation 后自动提取话题，话题列表不再为空
- **后台任务系统**：向量生成 + topic extraction 统一迁到后台 worker + 进度查询，用户不用等着
- **导入 diff 报告**：每次导入后显示新增/修改/跳过了哪些对话
- **导入失败可恢复/可重试**

### Import / Index Observability
- 本次导入新增/修改/跳过了多少消息
- 生成了多少 chunk、新增了多少 embeddings
- 哪些 topic 受影响
- 耗时、错误日志

### 数据完整性
- chunk_topics 幂等保护（唯一约束）
- findOrCreateTopic weight 逻辑重审
- topic 查询链路 V2（支持 conversation chunks）

### 技术债清理
- chunks 表冗余 projectId 字段（解决 LEFT JOIN + OR 慢查询）
- withTransaction tx: any 类型洞修复
- 无用 import 清理

---

## 阶段二：V1.0 — 质量打磨期

**目标：把"可用"打磨到"稳定产出"**

### Prompt 调优
- 转写 prompts 细磨（LLM 总结/话题提取的 prompt 调优）
- 更新 diff 的增量优化

### Golden Eval Set
- 选 10-20 个 Litch 特别熟的 case，建立固定回归测试集
- 每个 case 定义：query、预期召回片段、不该召回的噪声、聚合后应提炼的结构、summary 评分
- 每次换 prompt/embedding/rerank 都跑一遍

### 人工修正闭环
- 把 chunk 从 topic A 挪到 B
- 合并两个 topic
- 给 topic 设人工标题
- 标记总结质量高/低
- 标记结果可做 benchmark

### Case by Case 验收
- Litch 高频使用，边用边调
- 验证召回准不准、聚合稳不稳、产出能不能用

---

## 阶段三A：V1.x — 开源准备

**目标：别人能跑起来并理解 Cortex**

- 架构文档（ARCHITECTURE.md）
- 样例数据
- 部署指南
- 通用化配置（清理私有痕迹）
- provider / embedding / prompt 抽象接口
- 最小可运行 demo

---

## 阶段三B：V1.x — 上线准备

**目标：别人能稳定使用**

- 多用户支持
- 权限与存储隔离
- 资源与成本控制
- 安全/隐私说明
- 队列与失败恢复
- 正式环境部署与监控
