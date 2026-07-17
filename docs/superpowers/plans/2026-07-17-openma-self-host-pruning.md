# openma-self-host 精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 删除 self-host 不需要的历史实现和平台入口，保留 user-scoped Agent/Session/Workspace 核心链路，并让源码、schema、配置、文档和验证入口一致。

**Architecture:** 以当前工作区已有的 \`tenant → user.id\` 重建为基线，先验证并提交，再删除非核心 package、应用、schema 和 CI。active self-host 只从 \`apps/main-node\`、\`apps/console\` 和必要核心 packages 组装；所有资源使用 Better Auth 的不可变 \`user.id\`，Workspace 使用 \`DATA_DIR/<user.id>\`。

**Tech Stack:** WSL/Ubuntu、Node.js >=20、pnpm 11.0.8、TypeScript、Vitest、Drizzle、Better Auth、Hono、SQLite/better-sqlite3、PostgreSQL、React/Vite、SSE、localfs、可信 subprocess。

## Global Constraints

- PostgreSQL 用于共享部署；SQLite 用于单机、开发和测试。
- 邮箱、手机号或其他账号只属于认证层；目录和业务归属只使用不可变 \`user.id\`。
- 不保留 tenant、membership、\`tenant_id\`、\`x-active-tenant\`、tenant switch 或 tenant 创建接口。
- 用户没有重要数据时允许删除本地 \`data/\` 和认证数据库；不做 tenant 到 user 的兼容迁移。
- Environment 只能是 \`config.type=local\`；Session 可选择当前用户的任意 local Environment。
- 只保留可信 \`subprocess\`，不把它当作安全沙箱。
- 不修改官方只读仓库，不主动推送远程仓库。
- 每个阶段在独立验证后提交 Git；不得使用 \`git reset --hard\`、\`git checkout --\` 或未经授权的批量清理。

---

### Task 1: 建立现有 user-scoped 重建的安全基线

**Files:**
- Verify only: current worktree changes reported by \`git status --short\` and \`git diff --name-status\`
- Commit after verification: all current user-scoped self-host changes already present in the worktree

**Interfaces:**
- Consumes: existing uncommitted \`user.id\` auth, schema, stores, routes, Workspace, Console, migration and test changes.
- Produces: a clean commit containing the current user-scoped runtime; later deletion tasks build on this exact baseline.

- [ ] **Step 1: Confirm the worktree scope without discarding changes**

Run:

\`\`\`bash
git status --short
git diff --name-status
git diff --cached --name-status
\`\`\`

Expected: changes are limited to the existing self-host slimming/user-scoping work; do not reset, checkout, or delete them.

- [ ] **Step 2: Run baseline verification**

Run:

\`\`\`bash
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
\`\`\`

Expected: the current migration is verified before any obsolete source is deleted. Record actual test counts and any pre-existing skip in \`AGENTS.md\` only after reading command output.

- [ ] **Step 3: Commit the verified baseline**

After confirming the status contains only this task's existing project changes, run:

\`\`\`bash
git add -A
git commit -m "refactor: scope self-host resources to users"
\`\`\`

Expected: a new baseline commit is created; no remote push occurs.

### Task 2: 删除非核心应用、package 源码和平台 CI

**Files:**
- Delete: \`apps/oma-vault/\`
- Delete: \`packages/acp-runtime/\`, \`packages/browser-harness/\`, \`packages/cap/\`
- Delete: \`packages/credentials-store/\`, \`packages/vault-forward/\`, \`packages/vaults-store/\`
- Delete: \`packages/dreams-pipeline/\`, \`packages/dreams-store/\`
- Delete: \`packages/email/\`, \`packages/markdown/\`
- Delete: \`packages/eval-core/\`, \`packages/evals-runner/\`, \`packages/evals-store/\`
- Delete: \`packages/memory-store/\`, \`packages/oma-cap-adapter/\`
- Delete: \`packages/outbound-snapshots-store/\`, \`packages/queue/\`, \`packages/quotas/\`, \`packages/rate-limit/\`, \`packages/scheduler/\`
- Delete: \`packages/session-secrets-store/\`
- Delete: \`packages/agent-runtime/Dockerfile\`, \`packages/agent-runtime/Dockerfile.sandbox\`
- Delete: \`.github/workflows/build-sandbox-image.yml\`
- Modify: \`.github/workflows/README.md\`, \`.github/dependabot.yml\`, \`.github/repository-metadata.yml\` to remove stale Cloudflare/sandbox metadata while preserving any generic release workflow that still serves this repository.

**Interfaces:**
- Consumes: the verified core baseline from Task 1.
- Produces: a source tree containing only core runtime packages and generic project automation; no active import may depend on a deleted directory.

- [ ] **Step 1: Prove the deletion set has no active imports**

\`\`\`bash
git grep -n -I -E '@open-managed-agents/(acp-runtime|browser-harness|cap|credentials-store|dreams-pipeline|dreams-store|email|eval-core|evals-runner|evals-store|markdown|memory-store|oma-cap-adapter|outbound-snapshots-store|queue|quotas|rate-limit|scheduler|session-secrets-store|vault-forward|vaults-store)' -- ':!docs/archive/**'
\`\`\`

Expected: no active source import is returned. An unexpected runtime import must be handled before deletion.

- [ ] **Step 2: Delete the obsolete source and sandbox image paths**

\`\`\`bash
git rm -r -- apps/oma-vault packages/acp-runtime packages/browser-harness packages/cap packages/credentials-store packages/dreams-pipeline packages/dreams-store packages/email packages/eval-core packages/evals-runner packages/evals-store packages/markdown packages/memory-store packages/oma-cap-adapter packages/outbound-snapshots-store packages/queue packages/quotas packages/rate-limit packages/scheduler packages/session-secrets-store packages/vault-forward packages/vaults-store packages/agent-runtime/Dockerfile packages/agent-runtime/Dockerfile.sandbox .github/workflows/build-sandbox-image.yml
\`\`\`

Expected: only the named paths are deleted; core \`agent-runtime\` TypeScript source remains.

- [ ] **Step 3: Remove stale automation references and commit the source deletion**

Update the three \`.github\` metadata/readme files so they mention only current self-host automation. Then run:

\`\`\`bash
git diff --check
git add .github
git commit -m "chore: remove non-core self-host integrations"
\`\`\`

Expected: no Cloudflare sandbox build remains in active CI; generic release automation is unchanged unless its file explicitly depends on deleted paths.

### Task 3: 收紧 active schema 和 Drizzle 配置

**Files:**
- Delete: \`packages/db-schema/src/cf-auth/evals.ts\`, \`memory.ts\`, \`runtimes.ts\`, \`usage.ts\`, \`vaults.ts\`
- Delete: \`packages/db-schema/src/node-pg/cf-auth-evals.ts\`, \`cf-auth-memory.ts\`, \`cf-auth-runtimes.ts\`, \`cf-auth-usage.ts\`, \`cf-auth-vaults.ts\`
- Delete: \`packages/db-schema/src/cf-router/\`, \`packages/db-schema/src/node-pg/cf-router-sharding.ts\`
- Modify: \`packages/db-schema/src/cf-auth/sessions.ts\`, \`packages/db-schema/src/node-pg/cf-auth-sessions.ts\` to remove \`session_memory_stores\` and its indexes.
- Modify: \`packages/db-schema/src/cf-auth/index.ts\`, \`packages/db-schema/src/node-pg/index.ts\`, \`packages/db-schema/src/node-sqlite/index.ts\`, \`packages/db-schema/src/index.ts\`, \`packages/db-schema/package.json\`
- Modify: \`drizzle.node-pg.config.ts\`, \`drizzle.node-sqlite.config.ts\`
- Modify: \`apps/main-node/migrations/\`, \`apps/main-node/migrations-sqlite/\` only if regenerated active baselines require synchronized metadata.

**Interfaces:**
- Consumes: core stores and \`packages/schema\` imports of \`@open-managed-agents/db-schema\`.
- Produces: node-pg and node-sqlite schema barrels that export only active self-host tables; \`@open-managed-agents/db-schema/cf-router\` is no longer an active export.

- [ ] **Step 1: Capture the current active schema surface**

\`\`\`bash
git grep -n -I -E 'cfRouter|cf-router|eval_runs|memory_stores|session_memory_stores|runtime_tokens|usage_events|vaults|credentials|tenant_shard|shard_pool' -- packages apps/main-node drizzle.node-*.ts ':!apps/main-node/migrations/**' ':!apps/main-node/migrations-sqlite/**'
\`\`\`

Expected: results are limited to schema comments/files and the memory join table that this task removes; an active store/route dependency must be resolved before deleting its schema.

- [ ] **Step 2: Delete obsolete schema definitions**

\`\`\`bash
git rm -r -- packages/db-schema/src/cf-auth/evals.ts packages/db-schema/src/cf-auth/memory.ts packages/db-schema/src/cf-auth/runtimes.ts packages/db-schema/src/cf-auth/usage.ts packages/db-schema/src/cf-auth/vaults.ts packages/db-schema/src/node-pg/cf-auth-evals.ts packages/db-schema/src/node-pg/cf-auth-memory.ts packages/db-schema/src/node-pg/cf-auth-runtimes.ts packages/db-schema/src/node-pg/cf-auth-usage.ts packages/db-schema/src/node-pg/cf-auth-vaults.ts packages/db-schema/src/cf-router packages/db-schema/src/node-pg/cf-router-sharding.ts
\`\`\`

Expected: no eval, memory, runtime, usage, vault, credential, or shard table definition remains under the active schema source.

- [ ] **Step 3: Edit schema barrels and session tables**

Remove only the \`session_memory_stores\` declaration/indexes from both session schema variants, remove the \`cfRouter\` export and package subpath, and rewrite comments/config descriptions from “CF union/router” to “self-host core”. Keep exports for \`auth\`, \`agents\`, \`sessions\`, \`model_cards\`, \`environments\`, \`files\`, \`kv\`, and self-host skills.

- [ ] **Step 4: Regenerate/check schema metadata from an empty local database**

If the edited schema changes Drizzle snapshots, remove only the ignored local \`data/\` directory, regenerate both active migrations, and run:

\`\`\`bash
pnpm db:generate:node-pg
pnpm db:generate:node-sqlite
pnpm db:check
\`\`\`

Expected: both checks pass and the generated active schema contains no deleted table names. Do not preserve tenant-to-user compatibility tables.

- [ ] **Step 5: Commit the schema reduction**

\`\`\`bash
git diff --check
git add packages/db-schema drizzle.node-pg.config.ts drizzle.node-sqlite.config.ts apps/main-node/migrations apps/main-node/migrations-sqlite
git commit -m "chore: reduce self-host schema to core tables"
\`\`\`

### Task 4: 清理 workspace、TypeScript、脚本和 active 文档

**Files:**
- Modify: \`package.json\`, \`pnpm-workspace.yaml\`, \`pnpm-lock.yaml\`, \`tsconfig.json\`
- Modify: \`.env.example\`, \`docker-compose.yml\`, \`docker-compose.postgres.yml\`, \`apps/main-node/Dockerfile\`
- Delete or rewrite stale self-host-only scripts under \`apps/main-node/scripts/\`, including the PG fanout measurement script if it has no active caller.
- Modify: \`README.md\`, \`README.zh-CN.md\`, \`AGENTS.md\`, \`openma-self-host-operations.md\`
- Modify: \`SECURITY.md\`, \`DUAL_TABLE_DESIGN.md\`, \`ORDERING_DESIGN.md\`
- Modify: \`.impeccable.md\`, \`skills/create-agent/SKILL.md\`, \`skills/openma/SKILL.md\` to remove claims about deleted vault, OAuth, MCP, Cloudflare, or hosted capabilities.

**Interfaces:**
- Consumes: the core-only source and schema from Tasks 1–3.
- Produces: one unambiguous installation/build/test surface and active documentation describing login → \`user.id\` → Agent → Session → SSE.

- [ ] **Step 1: Remove stale workspace and compiler exclusions**

Remove the explicit \`apps/oma-vault\` workspace entry, remove the redundant npm \`workspaces\` field if pnpm is the sole supported workspace manager, and remove \`tsconfig.json\` excludes for directories deleted in Task 2. Keep excludes only for active app/test boundaries required by the existing build.

- [ ] **Step 2: Reconcile dependency metadata**

\`\`\`bash
pnpm install --lockfile-only
pnpm list --depth -1 --only-projects
\`\`\`

Expected: only \`apps/main-node\`, \`apps/console\`, and retained core packages are listed; no deleted package appears in \`pnpm-lock.yaml\` or workspace links.

- [ ] **Step 3: Remove stale active documentation and examples**

Rewrite active docs so they state: Better Auth identifiers are authentication-only, business ownership is immutable \`user.id\`, Workspace is \`DATA_DIR/<user.id>\`, Environment is local-only, and subprocess is trusted execution rather than isolation. Move obsolete historical design notes to \`docs/archive/\` only when useful for history; otherwise delete them. Leave archived documents out of active grep checks.

- [ ] **Step 4: Commit configuration and documentation cleanup**

\`\`\`bash
git diff --check
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json .env.example docker-compose.yml docker-compose.postgres.yml apps/main-node/Dockerfile apps/main-node/scripts README.md README.zh-CN.md AGENTS.md openma-self-host-operations.md SECURITY.md DUAL_TABLE_DESIGN.md ORDERING_DESIGN.md .impeccable.md skills .github
git commit -m "docs: align self-host project surface with core runtime"
\`\`\`

### Task 5: 完成核心回归和状态交付

**Files:**
- Modify: \`AGENTS.md\`, \`openma-self-host-operations.md\`, \`docs/plans/2026-07-16-openma-self-host-next.md\` only with actual final evidence and known limitations.
- Test: retained package tests and \`apps/main-node/test/\` user isolation/Workspace tests.

**Interfaces:**
- Consumes: the core-only repository after Tasks 1–4.
- Produces: fresh verification evidence and a truthful current-state handoff.

- [ ] **Step 1: Run the full required checks**

\`\`\`bash
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
\`\`\`

Expected: all commands exit 0; report actual test totals and preserve any explicitly reported existing skip.

- [ ] **Step 2: Run active-surface and deleted-surface audits**

\`\`\`bash
git grep -n -I -E '@open-managed-agents/(acp-runtime|browser-harness|cap|credentials-store|dreams-pipeline|dreams-store|email|eval-core|evals-runner|evals-store|markdown|memory-store|oma-cap-adapter|outbound-snapshots-store|queue|quotas|rate-limit|scheduler|session-secrets-store|vault-forward|vaults-store)|tenant|membership|tenant_id|x-active-tenant|cloudflare/sandbox|wrangler' -- ':!docs/archive/**' ':!pnpm-lock.yaml'
\`\`\`

Expected: only explicit historical deletion notes and unavoidable authentication email fields remain; remove or rewrite any active capability claim or import found.

- [ ] **Step 3: Run user isolation and Workspace checks**

\`\`\`bash
pnpm --filter @open-managed-agents/main-node exec vitest run test/auth-user-scope.test.ts test/user-schema.test.ts test/user-resource-isolation.test.ts test/user-data-layout.test.ts test/shared-workspace.test.ts
\`\`\`

Expected: different \`user.id\` values cannot read one another's Agents, Sessions, Files, Skills, Environments, Model Cards, or Workspace paths; the local smoke user remains \`usr_local\` only when \`AUTH_DISABLED=1\`.

- [ ] **Step 4: Update status evidence and commit the final handoff**

Record only commands actually run, their observed totals, Docker/HTTP smoke limitations, and remaining official SDK/CLI or browser gaps in \`AGENTS.md\` and \`openma-self-host-operations.md\`. Then run:

\`\`\`bash
git diff --check
git add AGENTS.md openma-self-host-operations.md docs/plans/2026-07-16-openma-self-host-next.md
git commit -m "docs: record self-host slimming verification"
git status --short
\`\`\`

Expected: the final worktree is clean; no unverified claim is added to project documentation.

## Scope self-review

- All requested retained capabilities map to retained packages and core tests in Tasks 1, 3, and 5.
- Every deleted capability named in the confirmed design has a source/config/CI cleanup entry in Tasks 2–4.
- Active schema, workspace metadata, documentation, and verification commands are updated together, so deletion cannot silently leave an install or build path behind.
- No task introduces a compatibility layer, new provider, team Workspace, or unrelated feature.
