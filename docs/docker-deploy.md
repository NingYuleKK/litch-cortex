# Litch's Cortex — Docker 部署指南

## 前置条件

- Docker 20.10+
- Docker Compose v2+
- 可用的 LLM API Key（OpenAI / DeepSeek / OpenRouter 等 OpenAI 兼容接口）

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

### 第二步：启动服务

```bash
docker compose up -d
```

首次启动会自动：
1. 拉取 MySQL 8.0 镜像
2. 构建 Cortex 应用镜像
3. 运行数据库迁移
4. 启动服务

### 第三步：访问应用

浏览器打开 `http://localhost:3000`

默认管理员账号：
- 用户名：`litch`
- 密码：`cortex2026`

**首次登录后请立即修改密码。**

### 第四步：配置 LLM Provider

登录后进入 **Settings（设置页）**，配置 LLM Provider：

- **OpenAI**：填入 API Key，选择模型（如 `gpt-4.1-mini`）
- **DeepSeek**：Base URL 填 `https://api.deepseek.com/v1`，填入 API Key，模型填 `deepseek-chat`
- **OpenRouter**：填入 API Key，可选择任意模型（如 `anthropic/claude-sonnet-4`）

同样在 Settings 中配置 **Embedding Provider**，推荐 OpenAI `text-embedding-3-small`。

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
