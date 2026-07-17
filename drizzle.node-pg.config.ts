// drizzle-kit config — Node-PG (PostgreSQL).
//
// Source: packages/db-schema/src/node-pg/index.ts (active self-host schema
//         with PG-typed columns)
// Output: apps/main-node/migrations/
//
// dbCredentials let `pnpm db:check:node-pg` verify journal consistency
// against a live PG (testcontainers in CI, dev DB locally).

import type { Config } from "drizzle-kit";

export default {
  dialect: "postgresql",
  schema: "./packages/db-schema/src/node-pg/index.ts",
  out: "./apps/main-node/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://oma:oma@localhost:5432/oma",
  },
  verbose: false,
  strict: true,
} satisfies Config;
