# openma-self-host 独立项目实施计划

## Goal（已按当前目标收敛）

在 `openma-self-host/` 中构建一个单机优先的多用户 OpenMA 服务：每个用户对应一个租户和
一个共享 Workspace，可以创建多个 Session；不同 Session 并发执行，同一 Session 内消息
FIFO 串行；官方 `open-managed-agents/` 仅作为只读 upstream 基线。

## 已完成或已有实验代码

- 独立 Git 副本、只读 `upstream`、项目规则和运维知识文档。
- tenant-scoped KV/资源访问、持久 Session pending queue、promote ledger、FIFO executor、取消和启动恢复。
- Model Cards/Environment、Skills、WorkerPool、Postgres/MinIO 双副本等已有实验代码，暂不
  作为当前交付条件，也不继续扩展。

## 当前只做的核心范围

1. 租户隔离：用户只能访问自己的 Agent、Session、事件和文件。
2. Model Card：模型配置和凭据按租户保存，Agent/Session 通过 Model Card 解析，不依赖
   `.env` 中的全局 Provider Key。
3. Skills：Skill 按租户保存不可变版本和文件，Agent 绑定后在 Session 中挂载。
4. Environment：只保留默认 `env-local-runtime`，执行后端固定为可信 `subprocess`。
5. 共享 Workspace：路径按租户稳定映射；同一租户的多个 Session 使用同一工作目录。
6. Session 调度：同一 Session FIFO，不同 Session 可并发，重复 event ID 不重复执行。
7. 生命周期：取消、超时、重启恢复和 SSE resume。
8. 单机部署：SQLite、localfs，并通过 Docker 验证。

## Constraints and open validation

- 不修改官方 sibling repository；所有变更只在本项目。
- `subprocess` 仅面向可信 Agent，不是安全沙箱。
- Model Card、Skill、Environment 主链的完整集成验证、共享 Workspace、完整 crash/SSE
  集成验证和 tool confirmation delivery 尚未完成。
- 不新增 Environment 执行后端、Runtime 或分布式调度抽象。
- 不启用 Linear/GitHub/Slack Integrations、OAuth、Webhook、Publication 或 InstallBridge；
  它们已从 self-host 构建链、Node 运行时和 Node 数据库基线移除。
- 本机 `better-sqlite3` 缺少 Node 24 native binding，且没有可用 C++ 构建工具链；纯 Node 测试、typecheck 和 schema check 可运行。

## Verification record

- `pnpm typecheck`: PASS
- `pnpm db:check`: PASS
- Node focused tests: 11 tests PASS
- `pnpm test`: attempted; official Cloudflare worker tests hit multiple 30-second environment timeouts.
- `docker compose -f docker-compose.postgres-multi.yml up --build -d`: PASS。
- `multi-replica.test.ts`: 3/3 PASS；A/B health、共享 PG queue 无重复领取、PG hub fanout 均已验证。
- `pg-queue.test.ts` + `pg-fanout.test.ts`: 6/6 PASS。
- 双副本 Compose 使用 API-only build、`SESSION_OUTPUTS_DIR=/app/data/session-outputs`，并让 B 等待 A 健康以避免迁移竞态。
