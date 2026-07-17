# openma-self-host 精简与瘦身设计

**日期：** 2026-07-17

**状态：** 已确认，进入实施计划

## 目标

将仓库收敛为可维护的 self-host 核心运行时：登录用户通过 Better Auth 获得不可变的 `user.id`，核心资源直接按 `user_id` 隔离，每个用户使用 `DATA_DIR/<user.id>` 作为 Workspace；删除不属于当前交付范围的历史实现、入口、schema、依赖、测试和文档残留。

## 当前证据

- 当前分支 `main` 的 HEAD 已是 self-host 核心运行时精简提交，但工作区仍有约 125 个与 `tenant → user.id` 重建相关的未提交改动。
- 当前有效入口是 `apps/main-node` 和 `apps/console`；pnpm 实际识别的核心 workspace 已包含 Agent、Session、Store、Schema、Auth、Sandbox、SDK 等必要包。
- 仓库仍保留 `apps/oma-vault` 以及一批未作为 active workspace 入口使用的历史目录，包括 Vault、Memory、Dreams、Evals、CAP、ACP、Browser Harness、Scheduler、Rate Limit 等。
- active self-host schema barrel 已开始只导出核心表，但旧 schema 文件、旧 Cloudflare/多租户文档和 CI 仍可从仓库检索到，容易误导后续维护。

## 设计决策

### 保留的运行时

保留以下用户场景及其必要基础设施：

1. 登录并解析当前用户的 `user.id`。
2. 创建和管理 Agent、Model Card、Skill、local Environment、Session、Files。
3. Session 使用 FIFO/pending/恢复/取消/超时和 SSE 事件流。
4. Workspace 位于 `DATA_DIR/<user.id>`；Files、outputs、backups、temp 位于该用户目录的 `.openma/` 下。
5. SQLite 用于单机、开发和测试；PostgreSQL 用于共享部署。
6. 执行后端只保留可信的 local `subprocess`，不把它宣传为安全沙箱。

必要基础包包括 `agent-runtime`、`session-runtime`、`event-log`、`sandbox`、`blob-store`、`observability`、`api-types`、`shared`、`sql-client`、各核心 store、`db-schema`、`schema`、`auth`、`auth-config`、`sdk` 和两个应用入口。

### 删除的运行时

删除实现、workspace 入口、active schema 导出、配置、测试、文档和 CI 残留：

- `apps/oma-vault`
- `acp-runtime`、`browser-harness`、`cap`、`oma-cap-adapter`
- `credentials-store`、`vault-forward`、`vaults-store`
- `memory-store`、`dreams-store`、`dreams-pipeline`
- `eval-core`、`evals-runner`、`evals-store`
- `scheduler`、`queue`、`quotas`、`rate-limit`
- `session-secrets-store`、`outbound-snapshots-store`
- self-host 不使用的 `email`、后端 `markdown`、Cloudflare Worker/多副本/远程 sandbox 入口

Console 仍可保留 Markdown 渲染，因为它属于 Session 展示链路；删除范围中的 `markdown` 指独立后端 package，不影响 Console 的用户界面能力。

### Schema 与数据策略

- active SQLite/PostgreSQL schema 只保留 Better Auth、Agent、Session、Session event/pending、Model Card、Environment、File、Workspace backup、KV、Skill 所需表。
- 不再导出 eval、memory、runtime、usage、vault、tenant shard 等表。
- 不做 tenant 到 user 的兼容迁移。项目规则已允许在本地数据无重要内容时删除 `data/` 和认证数据库并从新 schema 初始化。
- 历史说明仅在 archive 中保留，不放入 active migration/schema/config 入口。

### 文档与配置策略

- `AGENTS.md` 记录项目边界、当前状态、证据入口和验证结果。
- `README.md`、`README.zh-CN.md`、`openma-self-host-operations.md` 只描述当前 self-host 主链。
- `SECURITY.md`、`DUAL_TABLE_DESIGN.md`、`ORDERING_DESIGN.md` 若仍服务核心能力，则改写为 `user_id`/Session 语义；只描述已删除平台的文档归档或删除。
- 清理 root `tsconfig`、pnpm workspace、Docker Compose、Dockerfile、脚本和 `.github` 中对删除功能的引用。

## 实施边界

### 阶段 A：建立现有重建基线

先独立验证当前工作区中的 `tenant → user.id` 重建、Workspace 派生路径、核心 schema、Console 和 Docker 配置，再将这批已有改动作为基线提交。不得 reset、checkout、清理或覆盖已有工作。

### 阶段 B：删除非核心代码路径

按上述删除清单移除目录和入口，随后更新 package/workspace 引用、schema barrel、TypeScript include/exclude、测试入口和 lockfile。删除后用源码检索确认没有 active import、route、配置或文档引用。

### 阶段 C：文档和验证收口

更新项目状态和运维知识，执行与风险相称的检查：

```bash
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
```

必须额外确认：

- active 源码和配置不再引用已删除 package、tenant/membership/`tenant_id` 或 Cloudflare 入口；
- SQLite/PostgreSQL schema check 仍通过；
- 两个用户的核心资源和 Workspace 不能互相读取；
- Session 主链仍能创建、发送消息并通过 SSE 读取事件；
- 未把 `AUTH_DISABLED=1` 的 smoke 误报为真实双用户认证验收。

## 非目标

- 不实现组织、团队共享 Workspace、角色权限或 tenant 兼容层。
- 不新增远程 sandbox、S3、Cloudflare、MCP、Integrations、Scheduler、Queue、Billing、OAuth、Webhook 或 Runtime Daemon。
- 不修改官方只读仓库，不主动推送远程仓库。
- 不承诺官方 Anthropic SDK/CLI 真实端到端、浏览器联调或真实认证双用户 HTTP，除非实际执行并取得证据。

## 结果判定

精简完成的判据是：仓库只有当前核心入口和必要基础包；默认安装、类型检查、schema check、测试和 Console 构建不再加载已删除能力；文档、配置、schema、migration 和 CI 对当前 user-scoped self-host 模型保持一致；所有报告的验证结果均有本轮命令输出支持。
