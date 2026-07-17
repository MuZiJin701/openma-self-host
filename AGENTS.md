# openma-self-host 项目规则

## 定位与范围

- 目标：共享 PostgreSQL 数据库承载多用户配置；保留 SQLite 作为单机/测试后端；每个用户一个由不可变 `user.id` 派生的 Workspace；Console、Anthropic SDK、项目 SDK 和 CLI/HTTP 共用核心 Managed Agents 接口。
- 唯一源码目录：`/home/chenjinchi/project/openma-self-host`；所有命令在 WSL 执行。
- 保留：Agent、Session、Workspace、Model Cards、Skills、Environment、Files、基础 auth、SQLite/localfs、PostgreSQL、可信 subprocess。
- Environment 只能是 `config.type=local`；Session 可选择当前用户下任意 local Environment。
- 删除：Vault、Memory、Dreams、Evals、CAP、ACP、Browser Harness、oma-vault、Scheduler、外部 Queue、Rate Limit、Billing、Email、Markdown、S3、Docker 扩展、Cloudflare、Integrations、OAuth、Webhook、Runtime Daemon。
- 保留 Session 的数据库 pending queue；它是核心消息恢复链，不是独立的队列服务。

## 技术与安全约束

- Node.js >=20，pnpm `11.0.8`；PostgreSQL 用于共享部署，SQLite/localfs 用于单机、开发和测试。
- 只保留可信 `subprocess`，不把它当作安全沙箱。
- 本轮明确允许删除无重要内容的本地 `data/` 和认证数据库；不做 tenant 到 user 的兼容迁移，直接重建 user_id schema。
- 所有核心资源查询必须带认证后的 `user_id`；Workspace 路径由服务端从 `DATA_DIR/<user.id>` 派生。
- 用户登录标识与内部用户 ID 分离：邮箱、手机号等仅用于认证，目录和业务归属使用不可变的 `user.id`。
- 不在代码、日志、测试输出或文档中记录 API Key、Token、Prompt 或敏感载荷。

## 精简规则

- 保持功能简单、流程简单、入口简单；优先删除重复路径，不新增预留抽象。
- 新功能不得进入默认构建、启动、测试或主文档，除非已纳入核心验收。
- 删除功能必须同时移除 package、入口 import、route、Console 页面、配置、测试和文档描述。
- 核心流程固定为：登录 → 解析 `user.id` → 创建 Agent → 创建 Session → 发送消息 → SSE 读取事件。

## 当前状态与证据

- 核心 user-scoped store、Workspace 派生路径、Session FIFO/并发、pending 恢复、取消/超时、SSE resume、Model Cards、Skills、Environment、Files 已完成 user_id 重建。
- 本轮 self-host 精简已完成：默认 workspace、Node 后端入口、Console、SDK、配置和测试只保留核心主链；旧表和历史 migration 仅作向前迁移兼容，不代表 active API。
- 已删除 S3/Cloudflare 运行时适配器、D1 工厂、LLM 全量日志/R2 入口、ACP runtime_binding、评估入口和孤立评估测试；Blob 只保留 local-fs 与 in-memory。
- Dockerfile 的 deps/runtime 构建阶段已切换 Debian APT 源到阿里云镜像，便于中国大陆 Linux 服务器构建；Docker Hub 镜像源不在本项目内配置。
- Agent active 配置只保留名称、模型、system、tools、Skills、description 和 metadata；MCP、multi-agent delegation、aux model、appendable prompts 和自定义 harness 入口已从 API、store、route、Console 移除。Environment active 配置只保留 `config.type=local`，旧 provider build 列通过新 migration 删除。
- active schema、认证、stores、routes、Console 和 SDK 已删除 tenant、membership、`x-active-tenant`、tenant switch 和 tenant_id 归属路径，直接使用 Better Auth 的不可变 `user.id`。
- 已验证：本轮删除 MCP active surface 后，`pnpm typecheck`、`pnpm db:check`、完整 `TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test`、Session Runtime 32/32、main-node 58/58（1 个既有 skip）、Console 25/25、SDK build、Console tsc/build 和 `git diff --check` 均通过；此前还验证过用户资源隔离、DATA_DIR 布局和 Docker PostgreSQL smoke。
- 本仓库未内置 CLI 可执行包；官方 `@anthropic-ai/sdk` 未安装，因此 SDK/CLI 仍只完成项目 SDK 编译和协议静态审计，未声称官方客户端真实端到端通过。
- 尚未验证：官方 Anthropic SDK/CLI 真实端到端 smoke、浏览器联调、真实认证双用户 HTTP/Workspace 完整验收；Docker smoke 使用 `AUTH_DISABLED=1` 的 `usr_local`。
- 稳定知识见 `openma-self-host-operations.md`；当前执行计划见 `docs/plans/2026-07-16-openma-self-host-next.md`；历史精简材料统一归档在 `docs/archive/`。

## 交付检查

```bash
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
git -C /mnt/d/data/projects/practice/claude_agent_cloud/open-managed-agents status --short
```

官方仓库只读，禁止修改、迁移、格式化、重置、清理或提交；不主动推送远程仓库。
