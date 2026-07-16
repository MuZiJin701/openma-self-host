# openma-self-host 项目规则

## 项目边界

- 本项目是基于官方 OpenMA commit `bd1df1f506307d5d88c53534eca735608533a2d9` 建立的独立自部署项目。
- 兄弟目录 `../open-managed-agents/` 仅作为只读参考，不得在其中修改、迁移、格式化、生成、重置或提交。
- 所有实现、测试、迁移、Docker 修改和项目文档均必须位于本仓库。

## 运行时约束

- Node.js >=20，pnpm 11.0.8。
- 当前交付只支持 SQLite/localfs 单机部署；Postgres/共享 BlobStore 暂不作为交付条件。
- 当前阶段的 Session 使用 `env-local-runtime` 和 `SANDBOX_PROVIDER=subprocess`。
- `subprocess` 只适用于可信 Agent，不能作为租户安全边界。
- 不实现 `/v1/runtimes`、Runtime Daemon、强安全沙箱或完整 Cloudflare parity。

## 项目目标

- 一个用户对应一个租户和一个 Workspace；用户可以创建多个 Agent 和多个 Session。
- 同一用户的多个 Session 可以并发执行，并共享该用户的 Workspace 文件。
- 同一 Session 的消息必须按 FIFO 串行执行并保持事件顺序。
- 用户之间的 Agent、Session、事件、KV 和 Workspace 文件必须隔离。
- 优先复用 OpenMA 默认 Agent Loop、工具、事件流和恢复机制，不引入额外运行时抽象。
- Model Card、Skill 和 Environment 属于当前交付能力：Model Card 按租户保存模型配置和凭据，
  Skill 按租户保存不可变版本，Environment 当前只保留 `env-local-runtime`。

## 验证规则

- 使用增量迁移保留现有用户数据；不得清空 `data/` 或认证数据库。
- 不得在日志或文档中记录 API Key、Token、Prompt 或敏感事件载荷。
- 每项任务前后都要确认官方兄弟仓库保持干净：
  `git -C ../open-managed-agents status --short`。
- 已验证的项目状态写入本文件；稳定的部署、排障和运维知识写入
  `openma-self-host-operations.md`。

## 当前进展

- 已从官方基线初始化独立仓库。
- 已实现租户隔离的 KV 服务选择，并由单元测试覆盖。
- Node Session 队列基础已实现：用户 turn 输入写入
  `session_pending_events`，`SerialSessionTurnExecutor` 为每个 Session 提供
  FIFO，同时允许不同 Session 并发；重复 event ID 幂等处理；harness 启动前会
  promote 排队事件。
- 队列还不是完整的生产级恢复实现：SQL promote 会在 canonical insert 和删除
  pending 的同时记录持久化 turn ledger，使“已 promote 但尚未启动”的 turn 能在
  bootstrap 时重放。Postgres queue 已具备 `FOR UPDATE SKIP LOCKED` 和 JSON
  payload 解码；confirmation delivery 以及完整 crash/SSE 集成测试仍未完成。
- 已加入进程级 WorkerPool，通过 `WORKER_MAX_ACTIVE`、`TENANT_MAX_ACTIVE`
  和可选的 `TURN_TIMEOUT_MS` 限制总并发；它服务于“多个 Session 并发”，不扩展为复杂
  的分布式调度系统。
- Node 本地 sandbox 已改为按租户使用稳定的共享 Workspace；Session 自己的临时挂载放在
  `.oma-sessions/<session-id>/` 下，销毁一个 Session 不会删除用户 Workspace。共享、隔离和
  销毁保护测试已通过。
- `tool_confirmation` / `custom_tool_result` 交付、完整 crash/SSE 恢复仍未完成；这是核心
  Session 链路的一部分，应优先补齐。
- Model Cards、Skills、Environment 的基础主链已接入：Agent 校验 Model Card/Skill 归属，
  Session 固定使用 `env-local-runtime`；资源和凭据隔离测试已通过。仍需补真实 HTTP 主链
  和 Agent 实际调用验证。
- Integrations（Linear/GitHub/Slack、OAuth、Webhook、Publication、InstallBridge）已从
  self-host 构建链、Node 运行时和 Node SQLite/Postgres 数据库基线删除；`oma-vault`
  仍保留，因为它属于凭据注入链路，不是 Integrations。Cloudflare 官方应用仍携带的
  上游 Integrations 源码不属于 self-host 构建产物。
- Console 已恢复为由 `apps/main-node` 静态托管；Linear/GitHub/Slack 页面、菜单、
  集成头像和 `/v1/integrations/*` 客户端均已删除，Node 不再挂载或启动 Integrations
  服务。自部署 Console 的 MCP 凭据录入只接受显式 token，不再打开 OAuth 授权回调。
- `apps/web` 官方网站源码已从 self-host Git 工作树移除；本机曾残留的旧
  `node_modules` 目录也已清理，不属于当前项目构建图。
- 已完成第一轮瘦身：移除 RL/Terminal-Bench、旧 Cloudflare 部署脚本、顶层旧 Worker/E2E
  测试和不再使用的测试配置；保留 Node 主链测试、Session Runtime/CAP 测试和 PostgreSQL
  多副本验证脚本。
- 已验证 Node 22 下原生 SQLite 测试可运行；Windows 下 Node 24 当前没有可用的
  `better-sqlite3` 预编译二进制，推荐使用 Node 22。Workspace 文件提升测试和
  Windows subprocess shell 兼容性已通过验证；Workspace backup 的 Unix tar 测试
  仍需在 Linux/Docker 中验证。
- 本机 WSL2 Ubuntu 已运行（版本 2），但 Ubuntu 内当前没有 Docker CLI/Engine；Windows
  `docker` 命令仍连接 Docker Desktop 的 `desktop-linux` context。直接在 WSL 安装
  Docker Engine 是可行且适合本项目 Linux/Docker 测试的方向，尚未执行安装或切换。
- WSL 构建、测试和 Docker 运行固定使用 `/mnt/d/data/projects/practice/claude_agent_cloud/openma-self-host`，
  与 Windows 工作目录共享同一份文件；接受 `/mnt/d` 跨文件系统 I/O 较慢的权衡，不在 WSL
  另建项目副本。

## 当前改造顺序

1. 补 Model Card/Skill/`env-local-runtime` 的真实 HTTP 主链测试。
2. 完成同一 Session FIFO、不同 Session 并发、重复提交幂等、取消和超时。
3. 完成服务重启后的 pending queue 恢复、事件顺序和 SSE resume。
4. 用 Docker Node 22 验证单机 SQLite/localfs 主链路，形成可部署版本。

Environment 的多环境扩展、Postgres 多副本、S3 workspace backup、强沙箱和 Runtime Daemon
暂不排入当前开发。
