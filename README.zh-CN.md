# OpenMA Self-Host

OpenMA Self-Host 是一个精简的多用户 Agent 服务。共享 SQLite 或 PostgreSQL 数据库存放
租户配置和业务元数据；每个租户派生一个独立 Workspace，保存该用户的全部内容。Console、
项目 SDK、CLI 和 Anthropic 兼容 HTTP 客户端共享同一套 `/v1` 接口。

## 核心范围

- Agent、Session、租户/Workspace 隔离、Model Cards、Skills、Environment、Files
- 保留 Environment CRUD，但创建记录只能选择 `env-local-runtime`
- Session 只使用可信本地 `subprocess` 执行后端
- 本地文件 Blob；简单部署使用 SQLite，共享部署使用 PostgreSQL
- 通过租户 Model Cards 调用本地或云端 Anthropic-compatible 模型

Vault、Memory、Dreams、Evals、Integrations、MCP、OAuth、Webhook、Runtime Daemon、远程
sandbox provider、S3 和 Cloudflare Worker 均不属于本项目。历史 migration 为向前兼容保留，
本轮不作为接口启用，也不删除或回滚。

## 开发与运行

Codex、源码、命令、依赖和测试全部在 WSL 的
`/home/chenjinchi/project/openma-self-host` 执行。

```bash
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

复制 `.env.example` 为 `.env`。认证部署设置 `PLATFORM_ROOT_SECRET` 和
`BETTER_AUTH_SECRET`；使用 `DATABASE_URL` 连接 PostgreSQL，不设置时使用 `DATABASE_PATH`
对应的 SQLite。

```bash
pnpm dev
docker compose -f docker-compose.postgres.yml up --build
```

Console 构建到 `apps/console/dist` 后，可通过 `CONSOLE_DIR` 让 Node 服务提供静态文件。

## 精简规则

保持项目小：优先最短可用流程，删除无消费者的入口；没有明确用户需求和测试证据时，
不新增 provider、adapter、worker 或未来兼容壳。
