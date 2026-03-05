# Litch's Cortex — Docker 部署指南

## 前置条件

- Docker 20.10+
- Docker Compose v2+
- **可用的 LLM API Key**（OpenAI / DeepSeek / OpenRouter 等 OpenAI 兼容接口）—— 必须有，否则核心功能无法使用

## 快速启动

### 第一步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入以下必填项：

```env
MYSQL_ROOT_PASSWORD=your_root_password   # 自定义数据库 root 密码
MYSQL_PASSWORD=your_cortex_password      # 自定义数据库用户密码
JWT_SECRET=your_random_secret            # JWT 签名密钥（建议 32+ 位随机字符串）
```

生成随机 JWT_SECRET：

```bash
openssl rand -hex 32
```

可选：在 `.env` 中预设管理员初始密码（否则系统自动生成并打印到日志）：

```env
DEFAULT_ADMIN_PASSWORD=your_initial_password
```

### 第二步：启动服务

```bash
docker compose up -d
```

首次启动会自动：
1. 拉取 MySQL 8.0 镜像
2. 构建 Cortex 应用镜像
3. 运行数据库迁移
4. 启动服务

### 第三步：获取初始密码

```bash
docker compose logs app | grep "Initial password"
```

如果你在 `.env` 中设置了 `DEFAULT_ADMIN_PASSWORD`，则跳过此步。

### 第四步：访问应用并修改密码

浏览器打开 `http://localhost:3000`，使用默认用户名 `litch` 和初始密码登录。

> ⚠️ **安全提醒：首次登录后请立即修改管理员密码。不要使用默认密码运行在公网上。**
> 修改入口：右上角用户菜单 → 修改密码

### 第五步：配置 LLM Provider（必须）

> ⚠️ **此步骤是必须的。未配置 LLM Provider，以下功能将完全无法使用：**
> - 话题提取（PDF 上传后的核心分析功能）
> - 摘要生成
> - 话题探索与对话交互
> - 语义搜索（还需额外配置 Embedding）

登录后进入 **Settings（右上角齿轮图标）**，配置 LLM Provider：

| Provider | Base URL | 推荐模型 |
|----------|----------|---------|
| **DeepSeek**（推荐，性价比高） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **OpenRouter**（支持多模型切换） | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4.1-mini` |

配置完成后，点击"测试连接"验证 API Key 是否有效。

### 第六步：配置 Embedding Provider（语义搜索需要）

在设置页的 **Embedding 配置**部分，填入 Embedding API Key。推荐使用 OpenAI `text-embedding-3-small`（或 OpenRouter 的对应模型）。

未配置时，话题探索的语义搜索不可用，但关键词搜索仍可正常使用。

---

## 数据持久化

应用数据存储在 Docker volumes 中：

| Volume | 内容 |
|--------|------|
| `db_data` | MySQL 数据库文件 |
| `uploads` | 上传的 PDF 文件 |

`docker compose down` 不会删除 volumes，数据安全保留。

如需彻底清除数据：

```bash
docker compose down -v
```

---

## 常用操作

### 查看日志

```bash
docker compose logs -f app    # 应用日志
docker compose logs -f db     # 数据库日志
```

### 重启服务

```bash
docker compose restart app
```

### 更新到新版本

```bash
git pull
docker compose build
docker compose up -d
```

### 停止服务

```bash
docker compose down
```

---

## 常见问题

**Q: 应用启动失败，提示数据库连接错误**

A: MySQL 容器需要一些时间初始化。应用有 healthcheck 等待机制，正常情况下会自动重试。如果持续失败，检查 `.env` 中的密码配置是否正确。

**Q: 上传 PDF 后话题提取失败，报错"LLM 未配置"**

A: 必须在设置页配置 LLM Provider 才能使用话题提取功能。参见第五步。

**Q: 上传 PDF 失败**

A: 检查 `uploads` volume 是否正常挂载：
```bash
docker compose exec app ls /app/data/uploads
```

**Q: 修改了代码，如何更新**

A: 重新构建镜像：
```bash
docker compose build app && docker compose up -d app
```

**Q: 如何备份数据**

A: 备份数据库：
```bash
docker compose exec db mysqldump -u cortex -p cortex > backup.sql
```

备份上传文件：
```bash
docker compose cp app:/app/data/uploads ./uploads-backup
```
