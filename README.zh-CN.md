# OpenMA Self-Host

OpenMA Self-Host 是一个面向多用户的最小化、自部署 Agent 服务。
每个用户对应一个租户和一个独立 Workspace；一个用户可以创建多个 Agent 和多个 Session。

## 保留功能

- Agent、Session API 和 Console 聊天界面
- 每个用户独立的 Workspace 存储
- 租户隔离的 Model Cards 和 Skills
- `env-local-runtime` 及可信的本地 `subprocess` 执行器
- 通过 Model Cards 调用本地或云端模型 API
- SQLite 本地部署，以及用于共享部署的 PostgreSQL 支持

## 已移除功能

本项目不再包含 Integrations。Linear、GitHub、Slack 页面、菜单、前端 API 客户端、
provider 包、OAuth 回调、Webhook 接收接口、集成专用静态素材以及
`apps/integrations` Worker 均已删除。官方站点、Cloudflare Worker 应用和集成部署脚本
不会被构建或启动。

## 开发与验证

推荐使用 Node.js 22 或更高版本，以及 pnpm 11。Windows 下推荐 Node.js 22，
因为 SQLite 原生依赖对该运行时提供预编译包。

```bash
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

也可以在 WSL2 Ubuntu 内直接安装 Docker Engine 和 Compose plugin 运行项目。这个方向
是可行的，并且比 Docker Desktop 更接近 Linux 部署环境；建议把项目放在 WSL 的 Linux
文件系统（例如 `~/src/openma-self-host`），不要放在 `/mnt/d` 上进行高频构建。当前本机
WSL 已运行，但 Ubuntu 内的 Docker Engine 尚未安装；暂时仍可使用 Windows Docker Desktop。

配置数据库和 `PLATFORM_ROOT_SECRET` 后，使用仓库现有的开发或启动命令运行 Node 服务。
Node 服务会从 `apps/console/dist` 提供 Console 静态文件。

常用运行配置：

- `DATABASE_PATH`：SQLite 文件路径
- `DATABASE_URL`：PostgreSQL 连接串
- `PLATFORM_ROOT_SECRET`：用于加密凭据和 Model Card key
- `SANDBOX_PROVIDER=subprocess`
- `CONSOLE_DIR`：覆盖 Console 构建目录

## 许可证

项目保留官方许可证和声明文件，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
