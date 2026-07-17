# openma-self-host 后续实施计划：精简核心主链

## 固定目标

共享数据库存放多用户配置和业务元数据；每个用户对应一个独立 Workspace，保存该用户的
全部内容。Console、官方 Anthropic SDK、项目 SDK、CLI 和裸 HTTP 客户端共享同一套兼容
接口。核心流程是：认证 → tenant → Agent → Model Card/Skill → local-runtime Environment
→ Session → 消息/SSE。

## 固定边界

保留 Agent、Session、Workspace、Model Cards、Skills、Environment、Files、基础 auth、tenant
隔离、SQLite/localfs、PostgreSQL 和可信本地 subprocess。Environment 接口保留，但创建时只能
选择 `env-local-runtime`；Session 可以选择当前 tenant 的任意 local Environment。

删除 Vault、Memory、Dreams、Evals、Integrations、MCP、CAP/ACP、OAuth、Webhook、Runtime
Daemon、远程 sandbox provider、S3、Cloudflare Worker、多副本 queue/fanout、计费和其他
非核心扩展。历史 migration 不删除、不回滚、不清空数据；旧表不代表 active API。

## 已完成

- WSL 规则已固定；根级和项目级 `AGENTS.md` 已加入“保持精简、功能简单、流程简单、无未来空壳”规则。
- workspace 已删除非核心 package、OMA Vault app 和远程 sandbox adapter；默认 workspace 只构建核心入口。
- Node 入口已删除 Memory/Vault/Dream/Eval/CAP/S3/调度/队列 wiring；保留已有 API key 解析，不保留管理 route。
- Agent runtime 只保留 bash/read/write/edit/glob/grep 和 custom tool 描述，移除 web/browser/MCP/scheduler/delegation。
- Console 已删除非核心页面、导航、租户外的资源选择器，Session 创建只选择 Agent、local Environment 和标题。
- SDK 已删除 Memory/Dreams resource；Docker 配置只保留 SQLite 与 PostgreSQL 两个最短入口。
- 已保留 Model Card 加密实现和历史数据库 migration。

## 本轮结果

- 精简已完成：workspace、后端 wiring/routes、可信 subprocess contract、Console、SDK、配置、测试和文档均已收敛到核心主链；非核心 package 和入口已删除。
- 依赖锁文件已重新生成；Node 与 Console 类型检查、SQLite/PostgreSQL schema check、Session Runtime、main-node、Console 测试和 Console production build 均通过。
- WSL 未接入 Docker Desktop，真实 PostgreSQL 容器 `/health` 尚未执行；官方 Anthropic SDK/CLI 真实 smoke、浏览器联调和完整双租户 HTTP/Workspace 验收仍未完成。
- 后续只补上述真实环境验收，不再扩展功能或恢复已删除模块。

## 验收命令

```bash
pnpm install --lockfile-only
pnpm typecheck
pnpm db:check
TMPDIR=/tmp TMP=/tmp TEMP=/tmp pnpm test
pnpm --filter managed-agents-console test
pnpm --filter managed-agents-console exec tsc --noEmit
pnpm --filter managed-agents-console build
git diff --check
```

已完成的隔离证据：

- main-node 核心 route 测试覆盖 tenant-scoped Environment、Skill、Model Card 和 Files 隔离，以及非 fallback local Environment 的 Session 选择。

仍需补充：

- SQLite 和 PostgreSQL 各完成一次 `/health`/schema 检查；
- Tenant A/B 在同一数据库中创建 Agent、Environment、Session 和 File，跨租户读写返回 404/403；
- 同一 tenant 的两个 Session 共享 Workspace，不同 tenant 的同名路径隔离；
- Anthropic-compatible HTTP/SDK/CLI 通过同一 Agent/Session/SSE 主链；
- 删除范围不在 workspace、入口 import、Console 导航、默认测试、默认配置或主文档中。

## 非目标

本阶段不增加新 provider、兼容层、worker、数据库双写、远程沙箱、安全隔离承诺或多副本部署能力。
