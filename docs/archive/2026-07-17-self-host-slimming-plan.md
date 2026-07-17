# openma-self-host 精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 删除 self-host 非核心能力，只保留共享 tenant 数据库、Workspace、Agent/Session、核心资源、Console、Anthropic 兼容 HTTP 和 SQLite/PostgreSQL 后端。

**Architecture:** `apps/main-node` 是唯一服务入口，`apps/console` 是唯一前端入口。核心资源通过 tenant-scoped stores 写入共享 SQLite 或 PostgreSQL；Session 使用 `env-local-runtime` 类型和可信 subprocess，多个 Session 共享用户 Workspace。删除的 package 不再加入 pnpm workspace、不再被入口导入、不再参与构建或测试。

**Tech Stack:** WSL/Ubuntu、Node.js >=20、pnpm 11.0.8、Hono、Drizzle、SQLite/better-sqlite3、PostgreSQL/postgres、React/Vite、SSE、localfs、可信 subprocess。

## Global Constraints

- 运行环境、源码、依赖、测试和命令全部使用 WSL，唯一项目目录是 `/home/chenjinchi/project/openma-self-host`。
- 保留 SQLite/localfs 和 PostgreSQL；本轮不删除或重写历史 migration，不清空 `data/` 或认证数据库。
- 保留 Agent、Session、Workspace、Model Cards、Skills、Environment、Files、基础 auth 和 tenant 隔离。
- Environment 记录只允许 `config.type=local`；Session 可选择当前 tenant 的 local Environment。
- 运行后端只保留可信 `subprocess`，不宣传为安全沙箱。
- 删除范围不保留兼容 route、空 package、未使用 adapter、死 UI 或“未来启用”入口。
- 功能和流程保持简单；优先删除重复路径，不新增抽象、provider 或预留兼容层。
- 不在代码、日志、测试输出、文档或提交中记录 API Key、Token、Prompt 或敏感事件载荷。

---

### Task 1: 固化全局规则和精简文档基线

**Files:**
- Create: `/home/chenjinchi/AGENTS.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `openma-self-host-operations.md`
- Modify: `docs/plans/2026-07-16-openma-self-host-next.md`
- Modify: `DUAL_TABLE_DESIGN.md`
- Modify: `ORDERING_DESIGN.md`
- Modify: `SECURITY.md`
- Modify: `docs/archive/2026-07-15-openma-self-host.md`
- Modify: `docs/archive/2026-07-17-self-host-slimming-design.md`

- [x] **Step 1: 写入全局精简规则**

在 `/home/chenjinchi/AGENTS.md` 写入以下稳定规则：

```markdown
# 全局开发规则

- 保持项目精简：只实现当前验收所需功能，优先删除而不是扩展。
- 保持功能简单、流程简单、入口简单；不为未来需求新增空壳、兼容层或多级抽象。
- 每项新增功能必须说明用户场景、最短流程、删除代价和测试证据。
- 非核心功能不得进入默认构建、默认启动、默认测试或主文档。
- 修改前先读取项目 AGENTS.md 和基础知识文档；证据不足时不臆造接口。
- 不清理与当前任务无关的用户修改，不推送远程仓库，不暴露敏感信息。
```

- [x] **Step 2: 更新项目规则的保留/删除边界**

`AGENTS.md` 只保留项目规则、状态、证据入口；明确核心主链、SQLite/PostgreSQL 和删除范围，并增加：

```markdown
- 精简优先：不增加非核心资源、provider、worker、兼容 route 或预留抽象；新流程必须能用最短路径完成。
- 默认构建只包含核心主链；删除范围不得出现在 workspace、入口 imports、Console 导航或交付命令。
```

- [x] **Step 3: 删除文档中的过时能力**

将 README、运维文档、计划、架构设计和安全文档中的 Vault/Memory/Dreams/Evals/CAP/Cloudflare/S3/Docker/Runtime Daemon 描述改为“已移出 self-host”，核心流程统一为：登录 → 选择 tenant → 创建 Agent → 创建 Session → 发送消息 → SSE 读取事件。

- [x] **Step 4: 检查文档矛盾**

Run:

```bash
grep -RInE 'Vault|Memory|Dream|Eval|CAP|ACP|Cloudflare|S3|Docker|Runtime Daemon|/v1/runtimes|TBD|TODO' AGENTS.md README.md README.zh-CN.md openma-self-host-operations.md docs DUAL_TABLE_DESIGN.md ORDERING_DESIGN.md SECURITY.md
```

Expected: 只剩明确的“删除范围/非目标/历史迁移”说明，不再把删除能力描述为可用功能。

### Task 2: 收敛 workspace 和后端依赖

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/main-node/package.json`
- Delete: `apps/oma-vault/`
- Delete packages: `acp-runtime`, `browser-harness`, `cap`, `cf-billing`, `credentials-store`, `dreams-pipeline`, `dreams-store`, `email`, `eval-core`, `evals-runner`, `evals-store`, `memory-store`, `oma-cap-adapter`, `outbound-snapshots-store`, `queue`, `quotas`, `rate-limit`, `scheduler`, `session-secrets-store`, `vault-forward`, `vaults-store`
- Delete package: `markdown`

- [x] **Step 1: 删除 workspace 成员**

保持 workspace 只包含 `packages/*`、`apps/main-node`、`apps/console`，但删除范围 package 目录，保留核心 store 和 `sql-client`。不要修改历史 migration 目录。

- [x] **Step 2: 删除 main-node 直接依赖**

从 `apps/main-node/package.json` 删除上一步所有删除范围 workspace dependency，以及 `@aws-sdk/client-s3`、`chokidar`、`croner`、`nodemailer` 等只被删除能力使用的依赖；保留 `pg`、`postgres`、`better-sqlite3`、`drizzle-*`、`hono`、`ai`、`tsx` 和核心 workspace package。

- [x] **Step 3: 收敛根脚本**

根 `test` 只运行 `session-runtime`、`main-node`、Console 核心测试；删除 CAP 专用脚本，保留 `typecheck`、`db:check`、SQLite/Postgres schema check 和 Console build。

- [x] **Step 4: 验证依赖闭包**

Run:

```bash
pnpm install --lockfile-only
pnpm typecheck
```

Expected: 删除范围 package 不再被解析；若核心 package 仍引用删除范围，只修复该引用，不恢复被删除 package。

### Task 3: 删除后端非核心 wiring 和 routes

**Files:**
- Modify: `apps/main-node/src/index.ts`
- Modify: `apps/main-node/src/registry.ts`
- Modify: `apps/main-node/src/auth/config.ts`
- Modify: `packages/http-routes/src/index.ts`
- Delete: `packages/http-routes/src/vaults/index.ts`
- Delete: `packages/http-routes/src/memory/index.ts`
- Delete: `packages/http-routes/src/dreams/index.ts`
- Delete: `packages/http-routes/src/evals/index.ts`
- Delete: `packages/http-routes/src/api-keys/index.ts`
- Delete: `packages/http-routes/src/tenants/index.ts`
- Delete: `apps/main-node/src/lib/memory-blob-watcher.ts`
- Delete: `apps/main-node/src/lib/node-memory-queue.ts`
- Delete: `apps/main-node/src/lib/node-scheduler-jobs.ts`
- Delete: `apps/main-node/src/lib/s3-memory-poller.ts`
- Keep: `apps/main-node/src/lib/web-crypto-aes-gcm.ts` (Model Card encryption)

- [x] **Step 1: 删除 main-node 非核心 imports 和初始化**

从 `apps/main-node/src/index.ts` 删除 Memory、Vault、Credentials、Dreams、Evals、S3、Browser、CAP、Email、Scheduler、Queue、Markdown 和 ApiKey wiring；保留 Agent、Session、Files、Model Cards、Skills、Environment、auth、SQL、event log、Workspace backup、WorkerPool 和 local subprocess。

- [x] **Step 2: 简化 RouteServices**

从 `packages/http-routes/src/index.ts` 和 `apps/main-node/src/index.ts` 的 services bundle 删除 `vaults`、`credentials`、`memory`、`dreams`、eval 和 api-key 专用字段；保留核心 route 所需最小字段。

- [x] **Step 3: 简化 registry 和 sandbox contract**

删除 registry 中 memory mount、vault outbound、S3 poller、非 subprocess provider 分支；`buildSandbox()` 只接受 `SANDBOX_PROVIDER=subprocess`，未知值直接返回 `sandbox_provider_not_supported`。

- [x] **Step 4: 简化 auth**

保留 API key/disabled auth 和 PostgreSQL/SQLite Better Auth 数据库连接；删除 SMTP/email sender、Google OAuth、Turnstile 和 API-key 管理 route，只保留服务端解析已有认证凭据所需最小代码。

- [x] **Step 5: 验证核心 HTTP route**

Run:

```bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/resource-routes.test.ts test/file-upload-route.test.ts test/provider-http.test.ts
pnpm typecheck
```

Expected: Agent、Session、Environment、Model Cards、Skills、Files 的核心 route 通过；删除 route 返回 404/不再注册。

### Task 4: 删除 Console 非核心页面和请求

**Files:**
- Modify: `apps/console/src/components/AppSidebar.tsx`
- Modify: `apps/console/src/main.tsx`
- Modify: `apps/console/src/pages/Dashboard.tsx`
- Modify: `apps/console/src/pages/SessionsList.tsx`
- Modify: `apps/console/src/pages/SessionDetail.tsx`
- Delete: `apps/console/src/pages/VaultDetail.tsx`
- Delete: `apps/console/src/pages/VaultsList.tsx`
- Delete: `apps/console/src/pages/MemoryStoreDetail.tsx`
- Delete: `apps/console/src/pages/MemoryStoresList.tsx`
- Delete: `apps/console/src/pages/EvalRunDetail.tsx`
- Delete: `apps/console/src/pages/EvalRunsList.tsx`
- Delete: `apps/console/src/pages/ApiKeysList.tsx`
- Delete: `apps/console/src/pages/IntegrationsGitHub.tsx`
- Delete: `apps/console/src/pages/IntegrationsLinear.tsx`
- Delete: `apps/console/src/pages/IntegrationsSlack.tsx`
- Delete: `apps/console/src/integrations/`
- Delete tests/API helpers only used by removed pages.

- [x] **Step 1: 收敛导航和路由**

只保留 Login、Dashboard、Agents、Sessions、Files、Model Cards、Skills、Environments 和 Session detail；删除 removed pages 的 route、sidebar item、quick action 和 data loader。

- [x] **Step 2: 收敛 Session 表单**

Session 创建只保留 Agent、local-runtime Environment、标题、Files/Skills；删除 Vault、Memory、eval、MCP credential 选择和对应 API 请求。

- [x] **Step 3: 收敛 Session detail**

保留消息、事件、SSE、取消、输出和文件；删除 trajectory/eval/memory/vault/integration 专用 UI 和请求。

- [x] **Step 4: 验证 Console**

Run:

```bash
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
```

Expected: Console 只显示核心页面，测试、类型检查和 build 全部通过。

### Task 5: 删除无消费者的测试、配置和数据入口

**Files:**
- Delete tests: `apps/main-node/test/dreams-route.test.ts`, `apps/main-node/test/pg-fanout.test.ts`, `apps/main-node/test/pg-queue.test.ts`, `apps/main-node/test/s3-memory.test.ts`, `apps/main-node/test/multi-replica.test.ts` and removed-feature tests under `packages/*/test*`.
- Modify: `apps/main-node/vitest.config.ts`
- Modify: `docker-compose.yml`
- Delete: `docker-compose.postgres-multi.yml`
- Keep and simplify: `docker-compose.postgres.yml`
- Modify: `.env.example`
- Modify: `apps/main-node/Dockerfile`
- Modify: `apps/main-node/migrations/` only when generated schema check requires a core-only snapshot; never delete historical migration files.

- [x] **Step 1: 删除非核心测试入口**

删除只验证 removed feature 的测试和 test setup；保留 session-runtime、main-node core routes、workspace/tenant、provider HTTP、skills mount、file upload、Postgres/SQLite schema tests。

- [x] **Step 2: 简化运行配置**

`.env.example` 只保留 `DATABASE_PATH`、`DATABASE_URL`、auth secret、Model Card encryption secret、`SANDBOX_PROVIDER=subprocess`、Workspace/Files/Outputs 路径、worker limits 和 host/port。

- [x] **Step 3: 简化 Docker 文档与 compose**

保留一个 SQLite 单机 compose 和一个 PostgreSQL compose；删除 S3、multi-replica、Cloudflare、memory/vault/eval 环境变量和服务。

- [x] **Step 4: 验证配置清洁度**

Run:

```bash
grep -RInE 'MEMORY_|VAULT_|EVAL_|DREAM_|S3_|CAP_|ACP_|OAUTH|WEBHOOK|RUNTIME_DAEMON|TURNSTILE' .env.example docker-compose*.yml apps/main-node package.json pnpm-workspace.yaml --exclude-dir=node_modules
```

Expected: 只剩核心配置；Postgres 的 `DATABASE_URL`、migration 和 schema check 仍存在。

### Task 6: 全量回归和文档收口

**Files:**
- Modify: `AGENTS.md`
- Modify: `/home/chenjinchi/AGENTS.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `openma-self-host-operations.md`
- Modify: `docs/plans/2026-07-16-openma-self-host-next.md`
- Modify: `docs/archive/2026-07-17-self-host-slimming-design.md`

- [x] **Step 1: 运行核心验证**

```bash
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
```

- [ ] **Step 2: 做最小 HTTP smoke**

启动 `AUTH_DISABLED=1` 的 main-node，使用两个 tenant header 创建 Agent、Environment、Session 和文件，验证跨 tenant 读写返回 404/403；用 SQLite 和 PostgreSQL 各执行一次 schema/health 检查。

- [x] **Step 3: 更新状态**

把已删除能力从项目状态和运维文档移除；将 Postgres 标记为保留后端，将未完成项收敛为 Anthropic 官方 SDK/CLI 真实 smoke、Workspace 完整集成验收和浏览器联调。

- [x] **Step 4: 检查官方仓库只读状态**

```bash
git -C /mnt/d/data/projects/practice/claude_agent_cloud/open-managed-agents status --short
```

只读取并报告现有状态，不修改、清理或提交官方仓库。
