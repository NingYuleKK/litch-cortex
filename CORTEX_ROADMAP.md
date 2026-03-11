# Litch's Cortex 版本规划

## 已完成版本

### V0.1 — 基础框架
- 项目初始化，PDF 上传 + 解析 + chunk + embedding + 语义搜索
- 话题探索 + LLM 总结
- 部署到 manus.space

### V0.7 — Docker 支持
- Docker Compose 本地部署
- 环境变量配置

### V0.8 — JSON Import（当前版本）
- ChatGPT conversations.json 导入
- 增量更新（修改对话后重新导入只更新变化部分）
- 大文件流式解析
- 跨项目 stableId 隔离

## 当前进行中

### V0.8 Phase 1 Patch（进行中）
- [x] Bug 1: 上传限制 500MB → 1GB + 413 错误处理
- [x] Bug 2: V2 查询链路补齐（分段预览 + 关键词搜索 + 语义搜索）
- [x] Bug 2.5: rawMetadata/errors 字段 TEXT → MEDIUMTEXT
- [ ] Bug 3: 分段预览分页（后端分页查询 + 前端分页 UI）
- [ ] Bug 4: 向量生成分批处理（前端轮询式，每次处理 100-200 条）

### V0.8 Phase 2 — Topic Extraction + 后台任务系统（Issue #4）
- topic extraction 接入 import 链路（后台任务化）
- chunk_topics 幂等保护（唯一约束）
- findOrCreateTopic weight 逻辑重审
- topic 查询链路 V2（支持 conversation chunks）
- **统一后台任务系统**：向量生成 + topic extraction 都迁到后台 worker + 进度查询
- 向量生成从"前端轮询"升级为"后台 worker"

## 未来版本（待定）

### V0.9 — 待规划
- conversation.json 之外的格式支持？
- 本地模型支持？
- 多用户/团队？
- 其他 Litch 提出的需求
