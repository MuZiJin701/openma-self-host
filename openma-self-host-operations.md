# openma-self-host Operations

## Local deployment

- SQLite deployment: `docker compose -f docker-compose.yml up --build`.
- Postgres deployment: `docker compose -f docker-compose.postgres.yml up --build`.
- The default Node port is `8787`; the workspace-level deployment may map host port `8008` to the container.
- Persistent state is under `data/`; do not delete it during normal development or migration work.

## Runtime defaults

- `SANDBOX_PROVIDER=subprocess`.
- Every Node session currently executes against `env-local-runtime`.
- localfs is the first BlobStore backend; S3-compatible storage is required for shared multi-replica files.

## Verification

```text
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:e2e
```

The official sibling repository is a read-only reference. Upstream changes are fetched and manually evaluated before selective integration.

## Tenant-scoped services

Node keeps a legacy `kv` fixture for compatibility but production route wiring also exposes `kvForTenant(tenantId)`. Authenticated request paths should resolve KV through the request tenant and must not reuse the process-wide `default` adapter.

## Session queue

Inbound `user.message`, `user.tool_confirmation`, and
`user.custom_tool_result` events are written to the additive
`session_pending_events` table. `SerialSessionTurnExecutor` drains one
Session FIFO at a time while allowing independent Sessions to run in parallel.
Promotion writes the canonical `session_events` row and removes the pending row
in one SQL batch; duplicate event IDs are ignored. The startup registry scan
re-arms Sessions with active pending rows.

The pure scheduler check is:

```text
pnpm --filter @open-managed-agents/main-node exec vitest run test/session-queue.test.ts
```

The SQLite integration tests require a working `better-sqlite3` native binding.
