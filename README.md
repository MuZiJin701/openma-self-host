# OpenMA Self-Host

OpenMA Self-Host is a minimal, single-node-first Agent service for multiple users.
Each user is isolated by tenant and workspace, and can create multiple Agents and Sessions.

## Retained capabilities

- Agent and Session APIs with the Console chat interface
- Per-user Workspace storage
- Tenant-scoped Model Cards and Skills
- `env-local-runtime` with the trusted local `subprocess` runner
- Local or cloud model APIs through Model Cards
- SQLite for local deployment, with PostgreSQL support for shared deployments

## Removed from this project

Integrations are not part of this self-hosted project. The Linear, GitHub and Slack
pages, client APIs, provider packages, OAuth callbacks, webhook receivers, integration
assets and the `apps/integrations` Worker are removed. The official website, Cloudflare
Worker applications and integration deployment scripts are not built or started.

## Development

Node.js 22 or newer and pnpm 11 are recommended. On Windows, Node 22 is recommended
because the SQLite native dependency has a prebuilt binary for that runtime.

```bash
pnpm install
pnpm typecheck
pnpm db:check
pnpm --filter managed-agents-console build
```

Run the Node service with the repository's normal development/start command after
configuring the database and `PLATFORM_ROOT_SECRET`. The Node service serves the
Console from `apps/console/dist`.

Useful runtime settings:

- `DATABASE_PATH` for SQLite
- `DATABASE_URL` for PostgreSQL
- `PLATFORM_ROOT_SECRET` for encrypted credentials and Model Card keys
- `SANDBOX_PROVIDER=subprocess`
- `CONSOLE_DIR` to override the built Console directory

## License

This project retains the upstream license and notices. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
