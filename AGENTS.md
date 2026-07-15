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
- Session queue, tenant resource APIs, Model Cards, Skills, Environment execution, WorkerPool, and multi-replica validation remain to be implemented.
