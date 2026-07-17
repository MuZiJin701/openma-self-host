# openma-self-host 基础知识与运维

## 运行边界

- 唯一源码和 Git 目录：`/home/chenjinchi/project/openma-self-host`
- Codex、终端、依赖、命令和测试全部在 WSL/Ubuntu 执行
- PostgreSQL 是共享部署的主数据库；SQLite 是单机、开发和测试后端
- 所有用户共享数据库，核心业务表使用不可变 `user_id` 隔离
- 邮箱、手机号或其他账号只用于登录；Better Auth 的不可变 `user.id` 才是业务归属和目录名
- 每个用户的 Workspace 根目录是 `DATA_DIR/<user.id>`，由服务端派生
- Environment 接口保留，但每条记录只能是 `config.type=local`；Session 可选择当前用户的任意 local Environment
- 唯一执行后端是可信 `subprocess`，不提供安全沙箱隔离

## 数据目录

```text
data/
├── oma.db                         # SQLite 业务数据库
├── auth.db                        # SQLite Better Auth 数据库
├── usr_xxxxx/                     # user.id，同时是该用户 Workspace 根目录
│   ├── 用户创建的文件和项目/
│   └── .openma/
│       ├── files/                 # Files 内容
│       ├── outputs/<session-id>/  # Session 输出
│       ├── backups/               # Workspace backup
│       └── temp/                  # Session 临时内容
└── usr_yyyyy/
```

PostgreSQL 模式下，`oma.db` 和 `auth.db` 不使用；业务表和 Better Auth 表位于共享 PostgreSQL 数据库中，用户 Workspace 仍位于 `DATA_DIR/<user.id>`。

本阶段明确允许删除无重要内容的本地 `data/` 和认证数据库。不要把邮箱、手机号、显示名或可变账号标识直接作为目录名。

## 认证与归属

```text
邮箱/手机号/其他登录账号
        ↓ Better Auth
不可变 user.id
        ↓
数据库 user_id + DATA_DIR/<user.id>
```

不再使用 tenant、membership、`x-active-tenant`、tenant switch 或 tenant 创建接口。一个登录用户对应一个 Workspace；团队/组织级共享空间不属于当前范围。

## 关键配置

| 配置 | 作用 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串；设置后使用 PostgreSQL |
| `DATABASE_PATH` | SQLite 业务数据库路径，默认 `./data/oma.db` |
| `AUTH_DATABASE_PATH` | SQLite Better Auth 数据库路径，默认 `./data/auth.db` |
| `DATA_DIR` | 用户 Workspace、Files、Outputs、Backups 的统一根目录，默认 `./data` |
| `BETTER_AUTH_SECRET` | Cookie/session 签名密钥 |
| `PLATFORM_ROOT_SECRET` | Model Card API key 加密密钥 |
| `SANDBOX_PROVIDER=subprocess` | 唯一支持的运行后端 |

不再使用 `SANDBOX_WORKDIR`、`FILES_BLOB_DIR`、`SESSION_OUTPUTS_DIR` 三个并列数据根目录。完整示例见 `.env.example`；不要把密钥写入源码、日志、测试输出或文档。

## 最短开发流程

```bash
cd /home/chenjinchi/project/openma-self-host
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

启动：

```bash
pnpm dev
# 或
docker compose -f docker-compose.yml up --build
docker compose -f docker-compose.postgres.yml up --build
```

主链是：登录/认证 → 解析 `user.id` → 创建 Agent → 配置 Model Card/Skill → 创建 local Environment → 创建 Session → 发送消息 → 通过 SSE 读取事件。

## 数据与重建

- 本轮不迁移旧 tenant 数据；本地无重要内容时直接删除 `data/` 后重新初始化。
- SQLite 和 PostgreSQL 使用各自的 schema 检查；不做双写。
- 新 schema 不创建 tenant、membership 或 `tenant_id` 业务字段；核心表直接使用 `user_id`。
- 认证登录标识仍由 Better Auth 管理，不能把登录邮箱/手机号写入 Workspace 路径。

## 明确不启用

Vault、Memory、Dreams、Evals、Integrations、OAuth、Webhook、Runtime Daemon、远程 sandbox provider、S3、Cloudflare Worker、多副本 fanout 和多副本专用 compose 均不构建、不启动、不作为交付条件。Session pending queue 仍保留，用于消息恢复。

## 排障顺序

1. 检查 `node -v`、`pnpm -v` 和当前路径是否为 WSL 项目目录。
2. 检查 `DATABASE_URL`、`DATABASE_PATH`、`DATA_DIR`、auth secret 和 `PLATFORM_ROOT_SECRET`。
3. 运行 `pnpm typecheck`、`pnpm db:check`、`git diff --check`。
4. 查看 `/health`；它应报告 `sqlite` 或 `postgres`，Blob 应报告 `localfs`。
5. 使用两个不同 `user.id` 验证 Agent、Session、File 和 Workspace 不能跨用户读取。

## 当前验证状态

- 本轮已验证 `pnpm typecheck`、`pnpm db:check`、完整 `TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test`、Session Runtime 32/32、main-node 58/58（1 个既有 skip）、Console 25/25、SDK build、Console tsc/build 和 `git diff --check`；此前还验证 Node/Console 类型检查、用户资源隔离和 Docker PostgreSQL smoke。
- user_id schema、认证归属和新的单用户目录布局已实现；核心验证结果记录在 `docs/plans/2026-07-16-openma-self-host-next.md`。
- 已完成 SQLite 双用户资源隔离、Workspace 布局和本地回归；Docker Desktop PostgreSQL 容器已通过 `/health`、核心资源 HTTP 创建、Session `/exec` 和 `data/usr_local` Workspace 写入验收。该 smoke 使用 `AUTH_DISABLED=1`，不等同于真实认证双用户 HTTP 验收。
- Agent 与 Environment 的 active surface 已进一步收窄：不再接受 MCP/multi-agent/aux model/custom harness 或 cloud/Docker environment 字段；历史 migration 中的旧列只由向前 migration 清理，不再由运行时读取。
