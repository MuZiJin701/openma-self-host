# openma-self-host 项目规则

## 定位与范围

- 目标：共享 SQLite/PostgreSQL 数据库承载多用户配置；每个用户一个隔离 tenant/Workspace；Console、Anthropic SDK、项目 SDK 和 CLI/HTTP 共用核心 Managed Agents 接口。
- 唯一源码目录：`/home/chenjinchi/project/openma-self-host`；所有命令在 WSL 执行。
- 保留：Agent、Session、Workspace、Model Cards、Skills、Environment、Files、基础 auth、SQLite/localfs、PostgreSQL、可信 subprocess。
- Environment 只能是 `config.type=local`；Session 可选择当前 tenant 下任意 local Environment。
- 删除：Vault、Memory、Dreams、Evals、CAP、ACP、Browser Harness、oma-vault、Scheduler、Queue、Rate Limit、Billing、Email、Markdown、S3、Docker 扩展、Cloudflare、Integrations、OAuth、Webhook、Runtime Daemon。

## 技术与安全约束

- Node.js >=20，pnpm `11.0.8`；SQLite/localfs 用于单机，PostgreSQL 用于共享部署。
- 只保留可信 `subprocess`，不把它当作安全沙箱。
- 迁移只向前执行；不删除历史 migration，不清空 `data/` 或认证数据库。
- 所有核心资源查询必须带认证后的 `tenant_id`；Workspace 路径由服务端派生。
- 不在代码、日志、测试输出或文档中记录 API Key、Token、Prompt 或敏感载荷。

## 精简规则

- 保持功能简单、流程简单、入口简单；优先删除重复路径，不新增预留抽象。
- 新功能不得进入默认构建、启动、测试或主文档，除非已纳入核心验收。
- 删除功能必须同时移除 package、入口 import、route、Console 页面、配置、测试和文档描述。
- 核心流程固定为：登录 → 选择 tenant → 创建 Agent → 创建 Session → 发送消息 → SSE 读取事件。

## 当前状态与证据

- 核心 tenant store、Workspace 派生路径、Session FIFO/并发、pending 恢复、取消/超时、SSE resume、Model Cards、Skills、Environment、Files 已有基础实现。
- 本轮 self-host 精简已完成：默认 workspace、后端入口、Console、SDK、配置和测试只保留核心主链；旧表和历史 migration 仅作向前迁移兼容，不代表 active API。
- 已验证：Node/Console 类型检查、SQLite/PostgreSQL schema check、Session Runtime 34/34、main-node 52/52（1 个既有 skip）、Console 25/25、Console production build。
- 尚未验证：官方 Anthropic SDK/CLI 真实端到端 smoke、浏览器联调、Docker 中真实 PostgreSQL `/health`、两租户真实 HTTP/Workspace 完整验收；当前 WSL 未接入 Docker Desktop。
- 稳定知识见 `openma-self-host-operations.md`；执行计划见 `docs/superpowers/plans/2026-07-17-self-host-slimming.md`；设计见 `docs/superpowers/specs/2026-07-17-self-host-slimming-design.md`。

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
