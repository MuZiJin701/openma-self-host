# openma-self-host 独立项目实施计划

## Goal

在 `openma-self-host/` 中构建单机优先、多租户、Session 串行且跨 Session 并发的 OpenMA 自部署服务；官方 `open-managed-agents/` 仅作为只读 upstream 基线。

## Implemented scope

- 独立 Git 副本、只读 `upstream`、项目规则和运维知识文档。
- tenant-scoped KV/资源访问、持久 Session pending queue、promote ledger、FIFO executor、取消和启动恢复。
- Model Cards/Environment API 与 Node model resolver；Session 当前只支持 `env-local-runtime`。
- tenant-scoped Skills Store/API、不可变版本、BlobStore 文件和 sandbox `/mnt/skills` 挂载。
- 全局 WorkerPool、租户/全局并发限制、超时和 `/metrics` 生命周期指标。
- Postgres lease/`SKIP LOCKED` claim 路径和双副本 Postgres/MinIO Compose 验证拓扑。

## Constraints and open validation

- 不修改官方 sibling repository；所有变更只在本项目。
- `subprocess` 仅面向可信 Agent，不是安全沙箱。
- Docker/双副本实际执行、完整 crash/SSE 集成验证、tool confirmation delivery 和强 sandbox 尚未在本环境验证。
- 本机 `better-sqlite3` 缺少 Node 24 native binding，且没有可用 C++ 构建工具链；纯 Node 测试、typecheck 和 schema check 可运行。

## Verification record

- `pnpm typecheck`: PASS
- `pnpm db:check`: PASS
- Node focused tests: 11 tests PASS
- `pnpm test`: attempted; official Cloudflare worker tests hit multiple 30-second environment timeouts.
- Docker command: unavailable in the current environment.
