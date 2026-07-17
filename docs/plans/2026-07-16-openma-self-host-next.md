# openma-self-host user_id 与单用户 Workspace 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 active tenant 模型，改用 Better Auth 的不可变 `user.id` 作为共享数据库、HTTP 资源和用户 Workspace 的唯一归属键；PostgreSQL 为主后端，SQLite 继续保留。

**Architecture:** Better Auth 负责邮箱、手机号或其他登录标识，并生成不可变 `user.id`。所有核心业务表直接保存 `user_id`；服务端将用户 Workspace 派生为 `DATA_DIR/<user.id>`。用户文件直接位于该目录，系统内部 Files、Session outputs、Workspace backups 和临时文件位于其 `.openma/` 子目录。SQLite 与 PostgreSQL 使用同一逻辑 schema。

**Tech Stack:** WSL/Ubuntu、Node.js >=20、pnpm 11.0.8、Better Auth、Hono、Drizzle、PostgreSQL、SQLite/better-sqlite3、React/Vite、SSE、localfs、可信 subprocess。

## Global Constraints

- PostgreSQL 用于共享部署；SQLite 用于单机、开发和测试。
- 邮箱、手机号或其他账号只属于认证层；目录和业务归属只使用不可变 `user.id`。
- 不保留 tenant、membership、`tenant_id`、`x-active-tenant`、tenant switch 或 tenant 创建接口。
- 用户没有重要数据，本轮允许直接删除本地 `data/` 和认证数据库，不做 tenant 到 user 的数据迁移。
- 新 schema 和代码直接使用 `user_id`；不新增兼容层、预留 provider 或团队级 Workspace 抽象。
- `DATA_DIR/<user.id>` 是用户 Workspace 根目录；系统内部文件只能位于该用户目录下。
- Environment 只能使用 `config.type=local`；Session 可选择当前用户的任意 local Environment。
- 执行后端只保留可信 `subprocess`，不宣传为安全沙箱。

---

### Task 1: 固化 user_id 与数据目录契约

**Files:** `/home/chenjinchi/AGENTS.md`, `AGENTS.md`, `openma-self-host-operations.md`, `README.md`, `README.zh-CN.md`, `.env.example`, `docker-compose.yml`, `docker-compose.postgres.yml`, `apps/main-node/Dockerfile`

- [x] **Step 1: 固定目录和配置**

```text
data/
├── oma.db
├── auth.db
└── <user.id>/
    ├── 用户 Workspace 内容
    └── .openma/{files,outputs,backups,temp}
```

统一使用 `DATA_DIR`、`DATABASE_PATH`、`AUTH_DATABASE_PATH`、`DATABASE_URL` 和核心密钥；移除 `SANDBOX_WORKDIR`、`FILES_BLOB_DIR`、`SESSION_OUTPUTS_DIR`。

- [x] **Step 2: 检查文档和配置残留**

```bash
grep -RInE 'tenant|membership|SANDBOX_WORKDIR|FILES_BLOB_DIR|SESSION_OUTPUTS_DIR|sandboxes/workspaces|files-blobs|session-outputs' AGENTS.md README.md README.zh-CN.md openma-self-host-operations.md docs .env.example docker-compose*.yml
```

Expected：只剩明确的删除范围说明，不再把旧 tenant 或旧目录描述为 active 能力。

### Task 2: 重建 Better Auth 用户归属

**Files:** `packages/auth/src/index.ts`, `packages/auth-config/src/index.ts`, `packages/schema/src/index.ts`, `apps/main-node/src/auth/config.ts`, `apps/main-node/src/index.ts`, `apps/main-node/test/auth-user-scope.test.ts`

- [x] **Step 1: 写失败测试**

测试认证 session `user.id=usr_a` 后，请求 context 只有 `user_id=usr_a`；`AUTH_DISABLED=1` 使用固定 `usr_local`；认证流程不查询或创建 tenant/membership。

- [x] **Step 2: 验证测试按预期失败**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/auth-user-scope.test.ts
```

Expected：FAIL，因为当前 middleware 仍解析 tenant 和 membership。

- [x] **Step 3: 删除 tenant 认证分支**

`AuthMiddlewareDeps` 只保留 session、API key 和 bypass 配置；删除默认 tenant、membership、`x-active-tenant`、tenant 自愈、`/v1/me/tenants` 和 `POST /v1/tenants`。Better Auth 继续负责邮箱密码登录，手机号或其他 provider 只属于认证层。

- [x] **Step 4: 验证认证测试通过**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/auth-user-scope.test.ts
```

### Task 3: 重建 PostgreSQL/SQLite 核心 schema

**Files:** `packages/db-schema/src/cf-auth/`, `packages/db-schema/src/node-pg/`, `packages/schema/src/index.ts`, `apps/main-node/migrations/`, `apps/main-node/migrations-sqlite/`, `apps/main-node/test/user-schema.test.ts`

- [x] **Step 1: 写失败 schema 测试**

检查核心表 `agents`、`sessions`、`model_cards`、`environments`、`files`、`workspace_backups`、`kv_entries`、`api_keys` 和 Skills 使用 `user_id`；`user` 表保留登录字段但不含 `tenantId`；不存在 tenant/membership active 表。

- [x] **Step 2: 验证测试失败**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-schema.test.ts
```

- [x] **Step 3: 修改两种 dialect 的 active schema**

删除 tenant、membership、`user.tenantId`、tenant shard 等定义；核心表直接使用 `user_id`。历史非核心表不再从 self-host schema barrel 导出。

- [x] **Step 4: 从空数据重生成 migration**

```bash
rm -rf data
pnpm db:generate:node-pg
pnpm db:generate:node-sqlite
pnpm db:check
```

Expected：空 SQLite/PostgreSQL 数据库只建立核心表，不建立 tenant、membership 或 `tenant_id`。

- [x] **Step 5: 验证 schema 测试通过**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-schema.test.ts
pnpm db:check
```

### Task 4: 将 stores、routes 和运行时改为 user_id

**Files:** `packages/agents-store/src/`, `packages/sessions-store/src/`, `packages/files-store/src/`, `packages/environments-store/src/`, `packages/model-cards-store/src/`, `packages/skills-store/src/`, `packages/kv-store/src/`, `packages/http-routes/src/`, `apps/main-node/src/registry.ts`, `apps/main-node/src/lib/node-session-router.ts`, `apps/main-node/src/lib/node-session-lifecycle.ts`, `apps/main-node/src/lib/node-model-resolver.ts`, `apps/main-node/src/lib/node-file-routes.ts`, `apps/main-node/test/user-resource-isolation.test.ts`

- [x] **Step 1: 写失败隔离测试**

使用 `usr_a` 和 `usr_b` 创建 Agent、Environment、Skill、Model Card、Session、File；跨 user 查询必须返回 404 或空结果。

- [x] **Step 2: 验证测试失败**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-resource-isolation.test.ts
```

- [x] **Step 3: 改 owner contract**

所有 store 方法、Hono context、router registry、worker queue、model resolver 和 lifecycle 使用 `userId`/`user_id`；删除 tenant switch 相关 API 和 UI。

- [x] **Step 4: 验证隔离和类型**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-resource-isolation.test.ts
pnpm typecheck
```

### Task 5: 收敛用户 Workspace 和本地文件布局

**Files:** `apps/main-node/src/lib/user-data-layout.ts`（新建）、`apps/main-node/src/index.ts`, `apps/main-node/src/registry.ts`, `apps/main-node/src/lib/node-outputs-adapter.ts`, `apps/main-node/src/lib/node-workspace-backup.ts`, `packages/blob-store/src/adapters/local-fs.ts`, `packages/sandbox/src/adapters/local-subprocess.ts`, `apps/main-node/test/user-data-layout.test.ts`, `apps/main-node/test/shared-workspace.test.ts`

- [x] **Step 1: 写失败路径测试**

```ts
layout.userRoot("usr_a") === `${dataDir}/usr_a`;
layout.workspaceRoot("usr_a") === `${dataDir}/usr_a`;
layout.filesRoot("usr_a") === `${dataDir}/usr_a/.openma/files`;
layout.outputsRoot("usr_a", "sess_1") === `${dataDir}/usr_a/.openma/outputs/sess_1`;
layout.backupsRoot("usr_a") === `${dataDir}/usr_a/.openma/backups`;
layout.userRoot("usr_a") !== layout.userRoot("usr_b");
```

- [x] **Step 2: 验证测试失败**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-data-layout.test.ts
```

- [x] **Step 3: 实现 DATA_DIR 布局**

`DATA_DIR` 默认 `./data`；sandbox workdir 直接为 `DATA_DIR/<user.id>`；Files、outputs、backups、session temp 均位于该 user root 的 `.openma/` 下。user id 必须经过安全路径编码，拒绝 `..`、`/` 和反向逃逸。

- [x] **Step 4: 验证路径和 Workspace**

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/user-data-layout.test.ts test/shared-workspace.test.ts
```

### Task 6: 收敛 Console、SDK、配置和启动入口

**Files:** `apps/console/src/components/TenantSwitcher.tsx`, `apps/console/src/components/AppSidebar.tsx`, `apps/console/src/main.tsx`, `apps/console/src/pages/SessionsList.tsx`, `packages/sdk/src/`, `.env.example`, `docker-compose.yml`, `docker-compose.postgres.yml`, `apps/main-node/Dockerfile`

- [x] **Step 1: 删除 Console tenant 入口**

删除 TenantSwitcher、tenant 列表、tenant 创建和 active tenant 请求；登录后直接使用当前 session 的 `user.id`。

- [x] **Step 2: 收敛启动配置**

所有入口只传 `DATA_DIR`；PostgreSQL compose 保留 postgres 服务，SQLite compose 保留单 Node 服务。

- [x] **Step 3: 回归 Console 和 SDK**

```bash
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
pnpm typecheck
```

### Task 7: 清空数据并完成双后端验收

**Files:** `apps/main-node/test/`, `AGENTS.md`, `openma-self-host-operations.md`, `README.md`, `README.zh-CN.md`, this plan

- [x] **Step 1: 清理本地无重要数据**

```bash
rm -rf data
```

Expected：启动后只创建 `oma.db`、`auth.db` 和 `data/<user.id>/`，不创建旧并列目录。

- [x] **Step 2: 运行完整验证**

```bash
pnpm install --lockfile-only
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
```

- [x] **Step 3: SQLite 验收**

使用两个认证用户验证资源互不可见、同一用户两个 Session 共享 Workspace，目录只创建 `data/<user.id>`。

- [x] **Step 4: PostgreSQL 验收**

使用 `docker-compose.postgres.yml` 检查 `/health` 报告 `postgres`，并通过真实 HTTP 链路创建 Model Card、Agent、local Environment、Session，执行命令写入 `data/usr_local/greeting.txt`；双用户隔离仍由 SQLite/内存隔离测试覆盖。Docker Desktop 4.82.0 / Engine 29.6.1 / Compose v5.3.0 已完成容器验收。

- [x] **Step 5: 更新最终证据**

记录实际通过的命令、测试数量和已知限制；不得把 tenant、旧目录、官方 SDK/CLI 或 Docker 验收写成已完成能力。

## 非目标

- 不实现组织、团队、多人共享 Workspace 或角色权限。
- 不保留 tenant 兼容 API、tenant_id 别名字段或旧目录自动迁移。
- 不使用邮箱、手机号、用户名或显示名作为文件系统目录名。
- 不新增远程 sandbox、S3、Cloudflare、MCP、Integrations、Scheduler、Queue、Billing 或其他非核心功能。

## 执行结果（2026-07-17）

- 已完成 Task 1–7，以及 SQLite、PostgreSQL、schema、类型、测试和文档验收。
- `pnpm typecheck`、`pnpm db:check`、`pnpm install --lockfile-only`、`TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test`、Console test/tsc/build 和 `git diff --check` 已执行并通过。
- Session Runtime：34/34；main-node：59/59，另有 1 个既有 skip；Console：25/25。
- Docker Desktop PostgreSQL 验收：镜像构建通过；全新 PostgreSQL 卷启动后 `/health` 报告 `postgres`；Model Card、Agent、local Environment、Session HTTP 创建通过；Session `/exec` 返回 `exit_code=0`，并写入 `data/usr_local/greeting.txt`；PG `workspace_backups` 字段与运行时契约一致。
- Docker 验收使用 `AUTH_DISABLED=1` 的 `usr_local` smoke 用户；真实认证双用户 HTTP/Workspace、官方 Anthropic SDK/CLI 端到端和浏览器联调仍未验证。
