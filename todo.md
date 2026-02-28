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
- [x] 保存 checkpoint 并部署
- [x] 推送到 GitHub（NingYuleKK/litch-cortex）
- [x] 创建 HANDOVER_CORTEX.md 交接文档

## V0.2 项目区功能
- [x] 新增 projects 表（id, name, description, created_at）
- [x] documents 表新增 project_id 字段，关联到 projects
- [x] 后端 projects CRUD API（创建、列表、获取）
- [x] 后端所有查询按 project_id 隔离（documents, chunks, topics）
- [x] 前端首页改为项目列表（卡片式，显示项目名、描述、文档数量）
- [x] 新建项目对话框（输入名称和描述）
- [x] 项目工作区页面（包含文档上传、分段预览、话题列表、话题详情）
- [x] 项目切换器（侧边栏）
- [x] 上传 PDF 时自动归属到当前项目
- [x] 话题列表和话题详情限定在当前项目范围内
- [x] 更新 Vitest 测试
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md

## Bug 修复
- [x] 修复 PDF 解析报错：PicoPico运营策略与集群.pdf 解析出 0 个分段（根因：Base64 编码后 31MB 超出网关限制，改用 multipart/form-data）
- [x] 增强 PDF 解析的容错性，处理空文本或特殊格式 PDF（uploadRoute.ts 包含完整错误处理）
- [x] 推送修复到 GitHub 并保存 checkpoint

## V0.3 迭代

### 任务一：修复文件名乱码
- [x] 修复 multer multipart 上传中文文件名乱码问题
- [x] 确保中文文件名正确存储和显示

### 任务二：话题探索功能
- [x] 后端：关键词检索当前项目 chunks
- [x] 后端：将相关 chunks 发给 LLM 整理结构化话题总结
- [x] 后端：保存为 Topic 的 API
- [x] 前端：话题探索页面（搜索框 + 结果展示 + 保存按钮）
- [x] 前端：项目工作区侧边栏增加"话题探索"入口

### 任务三：独立认证系统
- [x] 新增独立 cortex_users 表（id, username, password_hash, role, created_at）
- [x] 密码哈希（bcrypt）
- [x] JWT 认证中间件（替换 Manus OAuth）
- [x] 登录 API + 注册 API（admin only）
- [x] 前端独立登录页（用户名+密码）
- [x] 前端顶部显示当前用户 + 退出登录
- [x] 数据隔离：projects 关联 cortex_user_id
- [x] 默认创建 admin 用户（litch / cortex2026）
- [x] Admin 用户管理页面

### 交付
- [x] 更新 Vitest 测试（19 个测试全部通过）
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md
- [x] 保存 checkpoint

## V0.3.1 话题导出功能
- [x] 创建通用导出工具函数（生成 Markdown 内容、触发下载）
- [x] TopicDetail 页面增加"导出 Markdown"和"导出 PDF"按钮
- [x] Explore 页面增加"导出 Markdown"和"导出 PDF"按钮
- [x] 导出内容包含：话题标题 + 总结 + 原文引用片段（带来源文档名）
- [x] PDF 导出使用浏览器原生打印方案（支持中文）
- [x] 文件名格式：topic-{话题名}-{日期}.md / .pdf
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md
- [x] 保存 checkpoint

## V0.4 迭代

### 功能一：自定义 Prompt 模板
- [x] 创建 Prompt 模板配置（学术总结/Blog风格/读书笔记/对话摘要/自定义）
- [x] 话题探索页：搜索框旁增加 Prompt 模板选择器
- [x] 话题详情页：生成摘要按钮旁增加 Prompt 模板选择器
- [x] 后端 API 支持接收自定义 prompt 参数
- [x] 自定义 prompt 用 localStorage 缓存

### 功能二：Chunk 合并优化
- [x] 新增 merged_chunks 表（id, document_id, project_id, content, source_chunk_ids, created_at）
- [x] 后端：文档上传解析后自动触发 LLM 合并（每 5-8 个 chunks 为一组判断语义相关性）
- [x] 后端：合并 API（支持已有文档的“重新合并”）
- [x] 话题提取改为基于 merged_chunks
- [x] 分段预览页增加切换：原始分段 / 合并分段
- [x] 话题探索搜索基于 merged_chunks
- [x] 已有文档提供“重新合并”按钮

### 通用
- [x] 更新 Vitest 测试
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md
- [x] 保存 checkpoint

### 功能三：用户管理入口全局化
- [x] 用户管理从项目工作区侧边栏移除
- [x] 在项目列表首页顶部导航栏添加用户管理入口（齿轮图标）
- [x] 创建独立的用户管理页面路由（/admin/users）
- [x] 非 admin 用户不显示管理入口

### 功能四：个人修改密码
- [x] 后端：修改密码 API（验证旧密码 + 设置新密码）
- [x] 前端：用户菜单增加“修改密码”入口
- [x] 前端：修改密码对话框（旧密码 + 新密码 + 确认新密码）

### 功能五：Admin 用户管理增强
- [x] Schema: cortex_users 表新增 initial_password 字段
- [x] 后端：创建用户时保存初始密码明文到 initial_password
- [x] 后端：删除用户 API（级联删除用户的所有项目和数据）
- [x] 前端：用户列表显示初始密码列
- [x] 前端：用户列表增加删除按钮（带确认对话框）

### Bug 修复（V0.4.1）
- [x] Bug1: Prompt 模板下拉菜单点击无反应（改用 DropdownMenu 替代 Popover+Select 嵌套）
- [x] Bug2: Chunk 合并按钮不可见（将合并控制区移到始终可见的位置）

### Bug 修复 + 功能改造（V0.4.2）
- [x] Bug: Prompt 模板选择器点击无效（已确认上次修复生效，DropdownMenu 替代方案正常工作）
- [x] 重新设计合并分段：移除分段预览页的整体合并触发
- [x] 重新设计合并分段：merged_chunks 表增加 topicId 关联
- [x] 重新设计合并分段：话题详情页增加“合并相关分段”按钮
- [x] 重新设计合并分段：按话题合并 LLM API
- [x] 重新设计合并分段：话题详情页展示合并后内容
- [x] 重新设计合并分段：分段预览页合并 tab 按话题分组展示
- [x] 推送 GitHub 并保存 checkpoint
- [x] 更新 Vitest 测试

## V0.5 LLM Service 重构

### 功能一：后端 LLM Service 抽象层
- [x] 创建 server/llm-service.ts 统一封装所有 LLM 调用
- [x] 定义 Provider 接口（OpenAI / OpenRouter / Custom）
- [x] OpenRouter 支持（base_url: https://openrouter.ai/api/v1，model: anthropic/claude-sonnet-4 等）
- [x] 所有现有 invokeLLM 调用点替换为统一服务（5 处：topic_extract, summarize, explore, chunk_merge）
- [x] .env BUILT_IN_FORGE_API_KEY 作为 fallback（数据库没配置时使用）

### 功能二：配置管理
- [x] 新增 llm_config 表（provider, base_url, api_key_encrypted, default_model, task models）
- [x] 任务类型字段：topic_extract, summarize, explore, chunk_merge
- [x] API key 存储 base64 编码（不明文）
- [x] 后端 CRUD API（读取/保存配置）
- [x] 支持全局默认配置

### 功能三：前端设置页 UI
- [x] 导航栏加“设置”入口（齿轮图标）
- [x] /settings 路由和页- [x] LLM Provider 选择（内置 / OpenAI / OpenRouter / 自定义）- [x] API Key 输入（密码框 + 显示/隐- [x] Base URL 配置（OpenRouter 自动填充）
- [x] 默认模型选择
- [x] 各任务类型模型配置（高级选项，可折叠）
- [x] 赛博深色主题一致

### 功能四：多自定义 Prompt 模板管理
- [x] 新增 prompt_templates 表（从 localStorage 迁移到 DB）
- [x] 后端 CRUD API（创建/列表/更新/删除模板）
- [x] 前端模板管理 UI（命名/编辑/删除）
- [x] “导入 Skill” 功能（粘贴 Skill prompt 导入为模板）
- [x] 预置“对话转Blog”模板（基于 SKILL.md）
- [x] PromptTemplateSelector 改为从 DB 读取模板
- [x] 多用户共享模板

### 交付
- [x] 更新 Vitest 测试
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md
- [x] 保存 checkpoint

## V0.5.1 小迭代

### 功能一：搜索加重试机制
- [x] callLLM 自动重试：失败后等 1 秒重试，最多 2 次
- [x] 前端搜索/探索报错时显示友好错误提示（不显示原始 JSON）

### 功能二：模型列表自动获取
- [x] 后端 API：调用 OpenRouter /api/v1/models 获取可用模型列表
- [x] 前端：默认模型输入框改为下拉搜索框（可输入关键词过滤）
- [x] 前端：高级选项各任务类型也用下拉搜索
- [x] 模型列表缓存（不用每次拉取）

### 功能三：Skill 文件导入
- [x] 后端 API：解析 .skill（zip 包含 SKILL.md）和 .md 文件
- [x] 前端：模板管理页添加"导入 Skill 文件"按钮（拖拽/选择文件）
- [x] 模板编辑文本框改大（可拖拽调整高度）+ 字符计数
- [x] 保存后显示模板内容预览（前几行 + 总字数）

### 交付
- [x] 更新 Vitest 测试
- [x] 推送 GitHub 并保存 checkpoint

## V0.5.2 话题摘要对话式交互

### 后端
- [x] 新增 topic_conversations 表（存储对话上下文）
- [x] 新增 tRPC procedure: summary.chat（对话式 LLM 交互）
- [x] 新增 tRPC procedure: summary.getConversation（获取历史对话）
- [x] 首条消息自动包含话题 chunks + prompt 模板

### 前端
- [x] TopicDetail 摘要区域改为迷你聊天窗口
- [x] 支持 Markdown 渲染 LLM 输出
- [x] 底部用户输入框支持多轮对话
- [x] 保留"开始对话"按钮作为启动对话入口
- [x] 保留 prompt 模板选择器
- [x] 赛博深色主题一致

### 交付
- [x] 更新 Vitest 测试
- [x] 推送 GitHub 并更新 HANDOVER_CORTEX.md
- [x] 保存 checkpoint

## V0.6 Embedding 向量搜索

### 后端
- [x] 新增 chunk_embeddings 表 + embedding_config 表
- [x] 新增 Embedding Service（支持 OpenAI text-embedding-3-small，走 LLM Service 抽象层）
- [x] 文档上传处理完成后自动生成 embedding（改为手动触发，避免上传延迟）
- [x] 搜索 API 改造：embedding 余弦相似度 + top-K 返回（embedding.semanticSearch）
- [x] 保留关键词搜索作为 fallback
- [x] 已有文档支持手动触发"生成向量"（embedding.generateForProject）
- [x] DB helpers（embedding CRUD + 相似度查询）

### 前端
- [x] 搜索结果展示优化：显示相似度分数
- [x] 设置页增加 Embedding 模型配置
- [x] 分段预览页增加"生成向量"按钮

### 交付
- [x] 更新 Vitest 测试（112 个测试全部通过）
- [x] 更新 HANDOVER_CORTEX.md（含完整路线图）
- [x] 推送 GitHub 并保存 checkpoint

## V0.6.1 Embedding 内置服务默认配置修复

- [x] 排查内置 API（BUILT_IN_FORGE_API_URL）是否支持 embedding endpoint
- [x] 修复 embedding-service.ts：无配置时默认走内置 API（BUILT_IN_FORGE_API_KEY + BUILT_IN_FORGE_API_URL）
- [x] 确认默认 Provider = builtin，默认模型 = text-embedding-3-small
- [x] 推送 GitHub + 保存 checkpoint

## V0.6.2 Embedding OpenRouter 支持

- [x] 后端 embedding-service.ts 支持 provider: "openrouter"（baseUrl: https://openrouter.ai/api/v1）- [x] 后端 resolveEmbeddingConfig 支持复用 LLM API Key 逻辑Router API Key
- [x] 前端 Settings.tsx Embedding Provider 列表加 OpenRouter 选项
- [x] 选 OpenRouter 时显示 API Key 输入框，模型默认 openai/text-embedding-3-small
- [x] 前端提示用户可复用 LLM 配置中的 OpenRouter Key（一键复用按钮）
- [x] 测试验证 + Git 推送 + checkpoint 保存
