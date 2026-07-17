// drizzle-kit config — Node-SQLite (better-sqlite3 self-host).
//
// Source: packages/db-schema/src/node-sqlite/index.ts (active self-host
//         SQLite schemas in one flat barrel)
// Output: apps/main-node/migrations-sqlite/
//
// Node self-host uses one database and one migration folder.

import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./packages/db-schema/src/node-sqlite/index.ts",
  out: "./apps/main-node/migrations-sqlite",
  verbose: false,
  strict: true,
} satisfies Config;
