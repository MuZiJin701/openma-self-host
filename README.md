# OpenMA Self-Host

OpenMA Self-Host is a small multi-user Agent service. A shared SQLite or PostgreSQL
database stores tenant configuration and metadata; each tenant gets one derived
Workspace directory for all of its content. Console, the project SDK, CLI, and
Anthropic-compatible HTTP clients use the same `/v1` API.

## Core surface

- Agents, Sessions, tenant/workspace isolation, Model Cards, Skills, Environments, and Files
- Environment records are available through CRUD, but only `env-local-runtime` is accepted
- Sessions run in the trusted local `subprocess` backend
- Local filesystem blobs; SQLite for simple deployments and PostgreSQL for shared deployments
- Local or remote Anthropic-compatible model providers configured through tenant Model Cards

Vaults, Memory, Dreams, Evals, Integrations, MCP, OAuth, Webhook, Runtime Daemon, remote
sandbox providers, S3, and Cloudflare Workers are outside this self-host project.
Historical database migrations are retained for forward compatibility; they are not active API
surfaces and are not removed or rolled back.

## Development

Codex, source, commands, dependencies, and tests run in WSL at:
`/home/chenjinchi/project/openma-self-host`.

```bash
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

Copy `.env.example` to `.env`. Set `PLATFORM_ROOT_SECRET` and `BETTER_AUTH_SECRET` for an
authenticated deployment. Use `DATABASE_URL` for PostgreSQL, or `DATABASE_PATH` for SQLite.

```bash
pnpm dev
docker compose -f docker-compose.postgres.yml up --build
```

The Console can be built to `apps/console/dist` and served by setting `CONSOLE_DIR`.

## Rules

Keep the project small: prefer the shortest working flow, delete unused entry points, and do
not add future providers, adapters, workers, or compatibility shells without an active user
requirement and a test.
