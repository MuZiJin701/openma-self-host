# openma-self-host 精简设计

## 目标

把 self-host 收敛为一条可以被普通用户理解、部署和维护的主链：共享数据库承载多用户配置，每个用户拥有隔离的 tenant/Workspace，用户通过 Console、Anthropic SDK、项目 SDK 或 CLI/HTTP 创建 Agent、Session 并在本地可信 subprocess 中运行。

SQLite/localfs 用于单机开发和测试，PostgreSQL 用于共享部署。两者都属于保留范围；其他扩展能力不参与 self-host 构建。

## 保留范围

运行入口：

- `apps/main-node`：唯一后端和服务进程。
- `apps/console`：只保留核心配置、Session 聊天和 Workspace 内容入口。

核心资源：

- Agent、Session、Workspace。
- Model Cards、Skills、Environment、Files。
- 基础认证、tenant 隔离、共享数据库和本地 Blob/Workspace 存储。

运行时：

- `env-local-runtime` 类型。
- 可信 `subprocess`，明确不是安全沙箱。
- 本地或兼容 OpenAI/Anthropic 的模型 HTTP 调用。
- SQLite 和 PostgreSQL SQL adapter。

客户端合同：

- `/v1` 核心 HTTP API。
- Console、官方 Anthropic SDK、项目 SDK、curl/CLI 使用同一合同。
- Session 的基本消息、事件、SSE resume、取消和文件操作。

## 删除范围

从 workspace、后端入口、Console、测试和文档中删除以下能力：

- Vault、Credentials、Memory、Dreams、Evals。
- CAP、ACP、Browser Harness、oma-vault。
- Scheduler、Queue、Rate Limit、Billing、Email、Markdown、Outbound Snapshots。
- S3 Blob、Docker、多副本 fanout 和 Cloudflare Worker 扩展。
- Integrations、OAuth、Webhook、Runtime Daemon、`/v1/runtimes`。

删除意味着：不再加入 workspace，不再被入口导入，不再参与 typecheck/test/build，不保留“未来启用”的空壳 route 或 compatibility adapter。

## 数据与迁移策略

- 不删除、不重置、不回滚现有 SQLite/PostgreSQL migration 文件。
- 不清空 `data/`、认证数据库或 Workspace。
- 本轮不执行破坏性 DROP TABLE；已删除功能的旧表只作为历史数据保留，不再由应用读写。
- 新的 schema 检查只验证核心资源和 SQLite/Postgres 两种 dialect。

## 代码组织

- `apps/main-node/src/index.ts` 只负责配置、核心 service wiring 和核心 route mount。
- 删除因扩展功能产生的 watcher、poller、scheduler、vault、eval、memory 和 S3 wiring。
- 保留现有核心 store；只有在删除功能后仍无消费者的 store 才删除。
- 不为了“将来可能扩展”新增接口、注册表或 provider 抽象。
- 保持现有核心大文件行为稳定；本轮优先删除功能和依赖，不做无关重构。

## Console 设计

只保留：Agents、Sessions、Session detail/chat、Files、Model Cards、Skills、Environments、基础 Tenant/Workspace 信息。

删除：Vault、Memory、Dreams、Eval、Integrations、Runtime 页面和对应导航/请求。Session 创建只配置 Agent、Environment、标题和核心文件/Skill 资源；不显示未实现后端的候选功能。

## 验收

精简完成必须同时满足：

1. workspace 只包含保留范围 package，删除范围不再出现在 `pnpm-workspace.yaml`、入口 imports、build scripts 或 Console 路由。
2. `pnpm typecheck`、`pnpm db:check`、核心测试和 Console build 通过。
3. SQLite 与 PostgreSQL schema check 通过，核心 tenant/workspace 查询仍带 tenant 条件。
4. 两个 tenant 可以各自创建 Agent、Session、Environment 和 Workspace 文件，不能跨 tenant 读取。
5. 官方 Anthropic SDK/裸 HTTP 至少能完成 Agent → Session → message → SSE 的核心流程。
6. 文档只描述保留范围、两种数据库和实际可用流程，不再把删除功能写成 self-host 能力。

## 非目标

本轮不重写 Agent harness，不重新设计 Anthropic 协议，不实现安全沙箱，不做 Postgres 多副本扩展，不做 Docker 镜像优化，不迁移历史数据，不保留删除功能的兼容 API。
