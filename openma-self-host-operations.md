# openma-self-host 运维与技术知识

## 本地部署

- SQLite 部署：`docker compose -f docker-compose.yml up --build`。
- Postgres 部署：`docker compose -f docker-compose.postgres.yml up --build`。
- Node 默认端口为 `8787`；工作区级部署可能将宿主机 `8008` 映射到容器端口。
- 持久化状态位于 `data/`；日常开发或迁移过程中不得删除该目录。

## 运行时默认值

- `SANDBOX_PROVIDER=subprocess`。
- 当前每个 Node Session 都使用 `env-local-runtime`。
- 第一阶段使用 localfs 作为 BlobStore；多副本共享文件必须使用兼容 S3 的存储。

## 验证命令

```text
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:e2e
```

本环境已验证 Docker Desktop 4.82.0、Docker Engine 29.6.1、Compose v5.3.0
和 WSL2 backend。双副本测试环境不发布 Postgres 端口到宿主机，测试命令在 Node
容器内执行；运行镜像默认用户是 `node`，Vitest 临时目录需要使用专用测试镜像
或测试时显式使用 root。

官方兄弟仓库是只读参考。只有在手动评估 upstream 改动后，才允许选择性集成。

## 租户范围服务

Node 为兼容旧测试 fixture 保留 `kv`，同时在生产路由中提供
`kvForTenant(tenantId)`。经过认证的请求必须根据当前请求租户解析 KV，不能继续
复用进程级的 `default` 适配器。

## Session 队列

传入的 `user.message`、`user.tool_confirmation` 和
`user.custom_tool_result` 事件会写入增量表 `session_pending_events`。
`SerialSessionTurnExecutor` 每次只处理一个 Session 的 FIFO 队列，同时允许互相
独立的 Session 并行运行。

Promote 会在同一个 SQL batch 中写入 canonical `session_events` 记录并删除
pending 记录，同时记录 `session_turn_runs` ledger；重复的 event ID 会被忽略。
服务启动时，Registry 会重新唤醒仍有 active pending 记录的 Session，以及已经
promote 或运行中但尚未完成的 ledger 记录。

纯调度器检查命令：

```text
pnpm --filter @open-managed-agents/main-node exec vitest run test/session-queue.test.ts
```

SQLite 集成测试需要可用的 `better-sqlite3` 原生绑定。

## WorkerPool 与可观测性

Node 使用一个进程级 WorkerPool。`WORKER_MAX_ACTIVE` 限制全局 active turn 数量，
`TENANT_MAX_ACTIVE` 限制单个租户的 active turn 数量，`TURN_TIMEOUT_MS` 在达到
配置时长后中止 turn；设置为 `0` 表示禁用超时。队列和 turn 生命周期的计数器及
直方图通过 `/metrics` 暴露；当该接口没有位于可信反向代理之后时，应设置
`METRICS_BIND_TOKEN`。

## Postgres 多副本验证

目标验证拓扑位于 `docker-compose.postgres-multi.yml`：两个 Node 副本共享
Postgres 和兼容 MinIO 的 BlobStore bucket。该 Compose 文件使用 API-only 构建，
副本 B 等待副本 A 的 `/health` 通过后才启动，以避免两个副本首次并发执行
Drizzle migration。

启动和测试：

```text
docker compose -f docker-compose.postgres-multi.yml up --build -d
docker compose -f docker-compose.postgres-multi.yml exec -T --user root oma-server-a sh -lc "cd /app/apps/main-node && MULTI_REPLICA_A_URL=http://oma-server-a:8787 MULTI_REPLICA_B_URL=http://oma-server-b:8787 PG_TEST_URL=postgres://oma:oma@postgres:5432/oma /app/node_modules/.bin/vitest run --config vitest.config.ts test/multi-replica.test.ts"
docker compose -f docker-compose.postgres-multi.yml down
```

已验证 `multi-replica.test.ts` 通过 3/3：A/B 健康和共享后端、12 条 queue
消息无重复领取、跨 hub fanout。已有 `pg-queue.test.ts` 与 `pg-fanout.test.ts`
合计通过 6/6。该 Compose 文件是验证工具，不是生产密钥配置；目前仍未验证真实
跨副本 Session turn、crash recovery、SSE resume 和 S3-compatible workspace backup。

## Model Cards 与 Environments

Model Card 按租户隔离，由 Node 运行时通过 Model Card Store 解析。创建 Model Card
前必须设置 `PLATFORM_ROOT_SECRET`；服务用它保护 Provider 凭据。API 响应只返回
安全的卡片元数据和 Key preview。进程级 Provider Key 只允许在
`AUTH_DISABLED=1` 的本地单用户开发模式下使用。

Environment 资源是按租户隔离的 CRUD 记录。当前 Session 执行仅支持内置的
`env-local-runtime`；请求其他 Environment 会返回 `environment_not_supported`。

## Skills

Skill 使用带租户前缀的 SQL 行和 BlobStore key 保存，路径格式为
`t/<tenant>/skills/<skill>/<version>/`。版本不可覆盖。Node 服务默认通过
`FILES_BLOB_DIR` 使用 localfs；配置 `FILES_S3_*` 后可以使用现有的兼容 S3
后端。Session provision 阶段会把 Agent 选中的 Skill 版本复制到
`/mnt/skills/<skill>/<version>/`；Node subprocess 适配器会尝试将该目录设置为
只读。这是可信 Agent 的便利功能，不是安全沙箱。
