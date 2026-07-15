# openma-self-host Agents Guide

## Project boundary

- This is an independent self-host project based on official OpenMA commit `bd1df1f506307d5d88c53534eca735608533a2d9`.
- The sibling `../open-managed-agents/` repository is read-only reference material. Do not edit, migrate, format, generate, reset, or commit there.
- All implementation, tests, migrations, Docker changes, and project documentation belong in this repository.

## Runtime constraints

- Node.js >=20 and pnpm 11.0.8.
- SQLite/localfs is the first supported deployment; Postgres/shared blobs are a later validation target.
- Sessions use `env-local-runtime` and `SANDBOX_PROVIDER=subprocess` during the current phase.
- `subprocess` is for trusted agents only and is not a tenant security boundary.
- Do not implement `/v1/runtimes`, Runtime Daemon, strong sandboxing, or full Cloudflare parity.

## Verification rules

- Preserve existing user data with additive migrations; never clear `data/` or authentication databases.
- Do not record API keys, tokens, prompts, or sensitive event payloads in logs or documentation.
- Before and after every task, verify the sibling official repository remains clean:
  `git -C ../open-managed-agents status --short`.
- Update this file with verified project state and update `openma-self-host-operations.md` with stable operational knowledge.

## Current progress

- Independent repository initialized from the official baseline.
- Tenant-scoped KV service selection is implemented and covered by unit tests.
- The Node session queue foundation is implemented: user turn inputs use
  `session_pending_events`, `SerialSessionTurnExecutor` provides per-session
  FIFO with cross-session concurrency, duplicate event IDs are idempotent, and
  queued events are promoted before the harness starts.
- The queue is not yet a complete production recovery implementation: SQL
  promotion now records a durable turn ledger alongside canonical insert +
  queue delete, allowing a promoted-but-not-started turn to be replayed on
  bootstrap. Cross-replica leasing/`SKIP LOCKED`, confirmation delivery, and
  crash/SSE integration tests remain open.
- Tenant-scoped Model Cards and Environment CRUD are now wired into the Node
  service. Model Card creation requires `PLATFORM_ROOT_SECRET`; the public API
  never returns plaintext credentials, and global environment-variable fallback
  is limited to `AUTH_DISABLED=1`.
- Tenant-scoped Skills Store/API is now implemented. Skill versions are
  immutable, files use the shared BlobStore key layout, Agent bindings are
  tenant/version validated, and selected files are provisioned under the
  sandbox's fixed `/mnt/skills/<skill>/<version>/` read-only view on startup.
  Environment execution beyond `env-local-runtime` and multi-replica
  validation remain to be implemented.
- A process-wide WorkerPool now bounds total and per-tenant active turns using
  `WORKER_MAX_ACTIVE`, `TENANT_MAX_ACTIVE`, and optional `TURN_TIMEOUT_MS`;
  queue lifecycle metrics are emitted through the existing `/metrics` surface.
- Postgres lease semantics, crash/SSE integration tests, and multi-replica
  validation remain open.
- A two-replica Postgres/MinIO Compose topology is provided for Task 8; it is
  not yet locally executed in this environment.
- Native SQLite-backed tests are currently blocked in this workspace because
  `better-sqlite3` has no installed Node 24 binary and the C++ build toolchain
  is unavailable; pure queue tests and TypeScript checks remain runnable.
