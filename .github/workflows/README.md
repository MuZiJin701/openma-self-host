# GitHub Actions in this repo

This repo's CI contains only generic checks and changeset-driven package
release automation. The self-host runtime is built and deployed by the
operator using Node.js, SQLite, PostgreSQL, and Docker Compose.

| Workflow | Purpose |
|---|---|
| `release.yml` | changeset-driven npm publish for packages that are explicitly released |

## Self-host deploy

Use the documented `pnpm dev` or Docker Compose flows in the root README and
`openma-self-host-operations.md`. No hosted-platform bindings or remote
sandbox image are part of this repository.
