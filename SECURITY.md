# Security and deployment boundary

## Reporting

Report vulnerabilities privately through the repository's security channel. Do not publish API
keys, tokens, prompts, database files, or sensitive event payloads in issues or logs.

## Self-host boundary

- Tenant membership and `tenant_id` checks are required for every resource route.
- Workspace paths are derived by the server; request bodies cannot select arbitrary host paths.
- Model Card API keys are encrypted with `PLATFORM_ROOT_SECRET` and never returned in full.
- `AUTH_DISABLED=1` is for local single-user development only.
- `subprocess` is trusted host execution, not a security sandbox. Only run agents and prompts you
  trust, and isolate the host at the deployment level when needed.
- Blob storage is localfs in this project. PostgreSQL is supported as the shared database; S3,
  remote sandbox providers, Vault proxy, OAuth, Webhook, and Cloudflare deployment are out of scope.

## Data handling

Do not delete or expose `data/`, auth databases, Workspace files, or historical migrations during
normal maintenance. Migrations are forward-only. Keep secrets in environment/configuration stores,
not source, tests, docs, or error messages.
