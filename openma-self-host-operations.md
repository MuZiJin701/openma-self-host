# openma-self-host 基础知识与运维

## 运行边界

- 唯一源码和 Git 目录：`/home/chenjinchi/project/openma-self-host`
- Codex、终端、依赖、命令和测试全部在 WSL/Ubuntu 执行
- 共享 SQLite 或 PostgreSQL 保存租户配置和业务元数据
- `tenant_id` 是 Agent、Session、Model Card、Skill、Environment、File、KV 和事件查询的隔离键
- 每个租户只有一个由服务端派生的 Workspace：`SANDBOX_WORKDIR/workspaces/<url-encoded-tenant-id>`
- 同一租户的多个 Session 共享 Workspace；Session 临时文件不共享
- Environment 接口保留，但每条记录只能是 `env-local-runtime`；Session 可选择当前租户的任意一条记录
- 唯一执行后端是可信 `subprocess`，不提供安全沙箱隔离

## 关键配置

| 配置 | 作用 |
| --- | --- |
| `DATABASE_PATH` | SQLite 主数据库 |
| `DATABASE_URL` | PostgreSQL 主数据库；设置后优先于 SQLite |
| `AUTH_DATABASE_PATH` | SQLite Better Auth 数据库 |
| `BETTER_AUTH_SECRET` | Cookie/session 签名密钥 |
| `PLATFORM_ROOT_SECRET` | Model Card API key 加密密钥 |
| `SANDBOX_PROVIDER=subprocess` | 唯一支持的运行后端 |
| `SANDBOX_WORKDIR` | Workspace 和 Session 工作目录根 |
| `FILES_BLOB_DIR` | Files 与 Workspace backup 的 localfs 根目录 |
| `SESSION_OUTPUTS_DIR` | Session 输出目录 |

完整示例见 `.env.example`；不要把密钥写入源码、日志、测试输出或文档。

## 最短开发流程

```bash
cd /home/chenjinchi/project/openma-self-host
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

启动：

```bash
pnpm dev
# 或
docker compose -f docker-compose.yml up --build
docker compose -f docker-compose.postgres.yml up --build
```

主链是：登录/认证 → 选择 tenant → 创建 Agent → 配置 Model Card/Skill → 创建
local-runtime Environment → 创建 Session → 发送消息 → 通过 SSE 读取事件。

## 数据与迁移

历史 migration 和旧表为向前迁移兼容保留，不在本轮删除、回滚、DROP 或清空数据。认证数据库
和 `data/` 不要删除。PostgreSQL 运行前先使用 `pnpm db:check` 检查 schema；SQLite 与
PostgreSQL 不做双写。

## 明确不启用

Vault、Memory、Dreams、Evals、Integrations、MCP、OAuth、Webhook、Runtime Daemon、远程
sandbox provider、S3、Cloudflare Worker、多副本 fanout 和多副本专用 compose 均不构建、不启动、
不作为交付条件。旧 migration 中出现这些名字不代表它们仍是 API 能力。

## 排障顺序

1. 检查 `node -v`、`pnpm -v` 和当前路径是否为 WSL 项目目录。
2. 检查 `DATABASE_PATH`/`DATABASE_URL`、auth secret 和 `PLATFORM_ROOT_SECRET`。
3. 运行 `pnpm typecheck`、`pnpm db:check`、`git diff --check`。
4. 查看 `/health`；它应报告 `sqlite` 或 `postgres`，Blob 应报告 `localfs`。
5. 使用两个 tenant 验证 Agent、Session、File 和 Workspace 不能跨租户读取。

## 当前验证证据

- `pnpm typecheck`、`pnpm db:check`、`git diff --check` 已通过。
- Session Runtime：34/34；main-node：52/52，另有 1 个既有跳过；Console：25/25；Console production build 已通过。
- `docker compose` 真实容器验收尚未执行：当前 WSL 未接入 Docker Desktop。PostgreSQL 已完成 Drizzle schema check，不能据此替代真实数据库启动验收。
- 官方 Anthropic SDK/CLI、浏览器联调和完整双租户 HTTP/Workspace 验收仍是后续工作。
