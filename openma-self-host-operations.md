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

This environment has verified Docker Desktop 4.82.0, Docker Engine 29.6.1,
Compose v5.3.0, and the WSL2 backend. The multi-replica test environment does
not publish Postgres to the host; tests run inside a Node container. The runtime
image uses the `node` user, so Vitest's temporary directory requires a test
image or an explicit root user when running tests.

The official sibling repository is a read-only reference. Upstream changes are fetched and manually evaluated before selective integration.

## Tenant-scoped services

Node keeps a legacy `kv` fixture for compatibility but production route wiring also exposes `kvForTenant(tenantId)`. Authenticated request paths should resolve KV through the request tenant and must not reuse the process-wide `default` adapter.

## Session queue

Inbound `user.message`, `user.tool_confirmation`, and
`user.custom_tool_result` events are written to the additive
`session_pending_events` table. `SerialSessionTurnExecutor` drains one
Session FIFO at a time while allowing independent Sessions to run in parallel.
Promotion writes the canonical `session_events` row and removes the pending row
in one SQL batch and records a `session_turn_runs` ledger row; duplicate event
IDs are ignored. The startup registry scan re-arms Sessions with active pending
rows and promoted/running ledger rows that did not reach completion.

The pure scheduler check is:

```text
pnpm --filter @open-managed-agents/main-node exec vitest run test/session-queue.test.ts
```

The SQLite integration tests require a working `better-sqlite3` native binding.

## WorkerPool and observability

Node uses one process-wide WorkerPool. `WORKER_MAX_ACTIVE` bounds total active
turns, `TENANT_MAX_ACTIVE` bounds a tenant's active turns, and
`TURN_TIMEOUT_MS` aborts a turn after the configured duration (`0` disables the
timeout). Queue and turn lifecycle counters/histograms are exposed at
`/metrics`; set `METRICS_BIND_TOKEN` when the endpoint is not behind a trusted
reverse proxy.

## Postgres multi-replica validation

The intended validation topology is in `docker-compose.postgres-multi.yml`: two
Node replicas share Postgres and MinIO-compatible BlobStore buckets. The Compose
file uses an API-only build, and replica B waits for replica A's `/health` before
starting to avoid concurrent initial Drizzle migrations. Start and test it with:

```text
docker compose -f docker-compose.postgres-multi.yml up --build -d
docker compose -f docker-compose.postgres-multi.yml exec -T --user root oma-server-a sh -lc "cd /app/apps/main-node && MULTI_REPLICA_A_URL=http://oma-server-a:8787 MULTI_REPLICA_B_URL=http://oma-server-b:8787 PG_TEST_URL=postgres://oma:oma@postgres:5432/oma /app/node_modules/.bin/vitest run --config vitest.config.ts test/multi-replica.test.ts"
docker compose -f docker-compose.postgres-multi.yml down
```

`multi-replica.test.ts` passes 3/3: A/B health and shared backends, 12 queue
messages claimed without duplicates, and cross-hub fanout. The existing
`pg-queue.test.ts` and `pg-fanout.test.ts` pass 6/6 together. The Compose file is
a validation harness, not a production secret configuration. Real cross-replica
Session turns, crash recovery, SSE resume, and S3-compatible workspace backup
remain unverified.

## Model Cards and Environments

Model Cards are tenant-scoped and are resolved by the Node runtime through the
Model Card store. Set `PLATFORM_ROOT_SECRET` before creating cards; the service
uses it to protect provider credentials. API responses expose only safe card
metadata and key previews. A process-level provider key is accepted only when
`AUTH_DISABLED=1`, for local single-user development.

Environment resources are tenant-scoped CRUD records. Session execution is
currently restricted to the built-in `env-local-runtime`; requesting another
environment returns `environment_not_supported`.

## Skills

Skills are stored with tenant-qualified SQL rows and BlobStore keys under
`t/<tenant>/skills/<skill>/<version>/`. A version cannot be overwritten. The
Node service uses localfs through `FILES_BLOB_DIR` by default and can use the
existing S3-compatible backend when `FILES_S3_*` is configured. During session
provisioning, an Agent's selected skill versions are copied to
`/mnt/skills/<skill>/<version>/`; the Node subprocess adapter attempts to make
that tree read-only. This is a trusted-Agent convenience, not a security
sandbox.
