# openma-self-host 项目规则

## 项目边界

- 本项目是基于官方 OpenMA commit `bd1df1f506307d5d88c53534eca735608533a2d9` 建立的独立自部署项目。
- 兄弟目录 `../open-managed-agents/` 仅作为只读参考，不得在其中修改、迁移、格式化、生成、重置或提交。
- 所有实现、测试、迁移、Docker 修改和项目文档均必须位于本仓库。

## 运行时约束

- Node.js >=20，pnpm 11.0.8。
- 第一阶段支持 SQLite/localfs 部署；Postgres/共享 BlobStore 作为后续验证目标。
- 当前阶段的 Session 使用 `env-local-runtime` 和 `SANDBOX_PROVIDER=subprocess`。
- `subprocess` 只适用于可信 Agent，不能作为租户安全边界。
- 不实现 `/v1/runtimes`、Runtime Daemon、强安全沙箱或完整 Cloudflare parity。

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
- 租户级 Model Cards 和 Environment CRUD 已接入 Node 服务。创建 Model Card
  需要 `PLATFORM_ROOT_SECRET`；公开 API 不返回明文凭据；全局环境变量回退仅在
  `AUTH_DISABLED=1` 时允许。
- 租户级 Skills Store/API 已实现。Skill 版本不可变，文件使用共享 BlobStore
  的 key 布局，Agent 绑定会校验租户和版本归属；启动时选中的文件会挂载到
  sandbox 的固定只读视图 `/mnt/skills/<skill>/<version>/`。
  除 `env-local-runtime` 之外的 Environment 执行仍未实现。
- 已加入进程级 WorkerPool，通过 `WORKER_MAX_ACTIVE`、`TENANT_MAX_ACTIVE`
  和可选的 `TURN_TIMEOUT_MS` 限制总并发和租户并发；队列生命周期指标通过已有
  `/metrics` 暴露。
- Postgres 租约语义和双副本 fanout 已通过 Docker Compose 实际验证；完整
  crash/SSE 恢复和真实跨副本 Session turn 仍未验证。
- `docker-compose.postgres-multi.yml` 已实际启动双 Node 副本、Postgres 和 MinIO；
  `multi-replica.test.ts` 通过 3/3，PG queue/fanout 通过 6/6。
- 多副本 Compose 使用 API-only 镜像（`SKIP_CONSOLE=1`），并让副本 B 等待副本 A
  健康后启动，以避免首次迁移竞态。
- 当前工作区的原生 SQLite 测试受限于：没有可用的 Node 24
  `better-sqlite3` 原生二进制，且缺少 C++ 构建工具链；纯队列测试和 TypeScript
  检查仍可运行。
