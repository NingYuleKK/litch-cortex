# Litch's Cortex V0.1 - TODO

## 数据库与后端
- [x] 数据库 Schema（documents, chunks, topics, chunk_topics, summaries）
- [x] PDF 上传 API（接收文件，存储到 S3，解析文本）
- [x] PDF 解析与分段逻辑（pdf-parse，500-800 字分段）
- [x] LLM 话题提取 API（gpt-4.1-mini，每个 chunk 提取 1-2 个话题 tag）
- [x] 话题列表查询 API（含关联 chunk 数量）
- [x] Topic 详情查询 API（关联 chunks + summary）
- [x] LLM 生成摘要 API
- [x] 保存手动总结 API
- [x] Vitest 单元测试

## 前端页面
- [x] 赛博认知深色主题（深蓝/暗灰底 + 青色/荧光点缀）
- [x] DashboardLayout 侧边栏导航
- [x] PDF 上传页（拖拽上传，多文件支持，上传进度）
- [x] 分段预览列表页（Log 面板风格）
- [x] 话题列表页（话题 + 关联 chunk 数量）
- [x] Topic 详情页（左：chunks 原文列表，右：总结编辑 + LLM 生成）

## 部署与交付
- [x] 用 5 个测试 PDF 验证完整数据流
- [ ] 保存 checkpoint 并部署
- [ ] 推送到 GitHub（NingYuleKK/litch-cortex）
- [ ] 创建 HANDOVER_CORTEX.md 交接文档
