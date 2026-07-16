# openma-self-host 运维与技术知识

## 本地部署

- SQLite 部署：`docker compose -f docker-compose.yml up --build`。
- Postgres 部署：`docker compose -f docker-compose.postgres.yml up --build`。
- Node 默认端口为 `8787`；工作区级部署可能将宿主机 `8008` 映射到容器端口。
- 持久化状态位于 `data/`；日常开发或迁移过程中不得删除该目录。

## WSL2 与 Docker Desktop

本机已验证 WSL2 Ubuntu 正在运行，版本为 2；但 Ubuntu 内尚未安装 Docker CLI/Engine。
Windows 侧的 `docker version` 当前连接的是 Docker Desktop 的 `desktop-linux` context；
Docker Desktop 的 `docker-desktop` 内部发行版拒绝直接执行 Docker CLI，这是预期行为。

当前推荐使用 Docker Desktop 自带的 WSL2 Engine，但让 Ubuntu 作为工作发行版：在 Docker
Desktop 中打开 `Settings > Resources > WSL Integration`，启用 `Ubuntu` 后 Apply。之后
在 Ubuntu 中应能直接执行 `docker version` 和 `docker compose version`。项目仍然在 Ubuntu
的 `/mnt/d/.../openma-self-host` 中构建，Docker Desktop 只提供 Engine，不承载项目副本。

不要在 `docker-desktop` 内部发行版中开发或保存项目，也不要同时在 Ubuntu 内安装独立的
Docker Engine 并启用 Docker Desktop WSL Integration；两套 daemon 容易造成 context、socket
和数据目录混淆。Docker Desktop WSL Integration 的说明见
[Docker 官方文档](https://docs.docker.com/desktop/features/wsl/)。

推荐准备步骤（WSL Integration 尚未在本机启用）：

```bash
# Docker Desktop 设置完成后，在 Ubuntu 中确认 CLI 来自 WSL Integration。
docker version
docker compose version
docker context ls
```

本项目约定 WSL 内统一使用 Windows 共享工作副本，不再另建 Linux 文件系统副本：

```text
/mnt/d/data/projects/practice/claude_agent_cloud/openma-self-host
```

这样 WSL 构建、测试、Docker 运行与 Windows 工作目录保持一致，也避免维护两份副本。
代价是 `/mnt/d` 的跨文件系统 I/O 可能比 WSL Linux 文件系统慢，尤其是 TypeScript、
`node_modules`、SQLite 和 Docker build context；当前项目优先保证路径和数据一致性。官方仓库
仍只读，不在 WSL 中复制或克隆第二份项目。完成准备后可运行：

```bash
cd /mnt/d/data/projects/practice/claude_agent_cloud/openma-self-host
pnpm install
pnpm typecheck
pnpm db:check
docker compose -f docker-compose.yml up --build
```

如果后续需要完全不依赖 Docker Desktop，也可以改为在 Ubuntu 内安装 Docker Engine；切换前
应先关闭 Docker Desktop 的 Ubuntu WSL Integration，并在文档中明确当前使用的 daemon。

## 运行时默认值

- `SANDBOX_PROVIDER=subprocess`。
- 当前每个 Node Session 都使用 `env-local-runtime`。
- 当前交付使用 SQLite、localfs 和单个 Node 实例；不要求多副本共享文件。

## 用户 Workspace

一个认证用户对应一个租户，也对应一个稳定的 Workspace 根目录。目录不得使用
Session ID 作为根路径；同一用户创建的多个 Session 必须指向同一个 Workspace，
因此一个 Session 写入的文件可以被该用户的其他 Session 看到。

推荐目录布局：

```text
data/sandboxes/workspaces/<tenant-id>/
data/sandboxes/workspaces/<tenant-id>/.oma-sessions/<session-id>/  # Session 临时挂载
```

所有 Workspace 路径必须由服务端根据认证后的租户 ID 生成，不能直接接受请求体中的
任意宿主机路径。不同租户的 Workspace 必须使用不同目录，并通过集成测试验证不可见。

## 验证命令

```text
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:e2e
```

Windows 侧已验证 Docker Desktop 4.82.0、Docker Engine 29.6.1、Compose v5.3.0
和 WSL2 backend；Ubuntu 的 Docker Desktop WSL Integration 尚未启用。WSL Node
24.18.0 + pnpm 11.0.8 已完成依赖安装，`typecheck`、`db:check` 通过，5 个 Node focused
测试文件共 14 个测试通过；`crash-recovery.test.ts` 在 `/mnt/d` 上的真实子进程回收仍会
卡住，需单独修复或改为 Docker 测试。双副本测试环境不发布 Postgres
端口到宿主机，测试命令在 Node 容器内执行；运行镜像默认用户是 `node`，Vitest 临时目录
需要使用专用测试镜像或测试时显式使用 root。

官方兄弟仓库是只读参考。只有在手动评估 upstream 改动后，才允许选择性集成。

## 当前不启用的功能

Self-host 构建链和 Node 运行时不包含 Linear、GitHub、Slack Integrations，也不启动 OAuth、
Webhook、Publication、InstallBridge 或 Integrations scheduler。Node SQLite/Postgres 的
全新数据库基线也不再创建这些表。`oma-vault` 仍然启用，用于租户凭据的出站注入。
Cloudflare 官方应用目录中的上游 Integrations 源码不参与 self-host 构建。

Console 当前只提供 Agent、Session、Workspace、Model Cards、Skills、
`env-local-runtime` 和必要的凭据/API 设置页面。集成专用页面、菜单、客户端、头像素材、
OAuth 授权回调和 Webhook 接收入口均不存在；Node 服务只托管 Console 静态文件，不启动
任何 Integrations Worker。

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

## 后续可选：Postgres 多副本验证

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

Model Card 是当前交付能力，按租户隔离，由 Node 运行时通过 Model Card Store 解析。创建 Model Card
前必须设置 `PLATFORM_ROOT_SECRET`；服务用它保护 Provider 凭据。API 响应只返回
安全的卡片元数据和 Key preview。进程级 Provider Key 只允许在
`AUTH_DISABLED=1` 的本地单用户开发模式下使用。

Environment 资源是按租户隔离的 CRUD 记录，当前交付只支持内置的
`env-local-runtime`；请求其他 Environment 会返回 `environment_not_supported`。
默认执行后端为可信 Agent 使用的 `subprocess`，它不是安全沙箱。

## Skills

Skill 使用带租户前缀的 SQL 行和 BlobStore key 保存，路径格式为
`t/<tenant>/skills/<skill>/<version>/`。版本不可覆盖。Node 服务默认通过
`FILES_BLOB_DIR` 使用 localfs；配置 `FILES_S3_*` 后可以使用现有的兼容 S3
后端。Session provision 阶段会把 Agent 选中的 Skill 版本复制到
`/mnt/skills/<skill>/<version>/`；Node subprocess 适配器会尝试将该目录设置为
只读。这是可信 Agent 的便利功能，不是安全沙箱。

## 瘦身边界

当前仓库只保留 self-host 所需的 Node、Console、oma-vault、基础 packages、项目文档、
Session/Runtime 测试和 Postgres 多副本验证脚本。官方网站 `apps/web`、Cloudflare Worker
应用、Integrations、RL/Terminal-Bench、旧顶层 Worker/E2E 测试及对应部署配置均不属于
当前构建图。若后续继续瘦身，优先审计 Console 中非核心的 Vault、Memory、Evals 和 Dreams
页面及其 API；在确认不影响 Agent/Session/Workspace/Model Cards/Skills 后再删除，避免
误删默认 Agent Loop 的共享 store。

## 构建检查

推荐在 Node 22 下运行：

```text
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console typecheck
pnpm --filter managed-agents-console build
```

Node 22 下可运行 better-sqlite3 原生测试；Windows 下的 Workspace backup tar 流程仍应
在 Linux/Docker 环境中验证，因为其底层命令使用 Unix 风格 tar。官方兄弟仓库始终只读，
交付前使用 `git -C ../open-managed-agents status --short` 复核为空。
