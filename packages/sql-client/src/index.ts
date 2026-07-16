export type {
  SqlClient,
  SqlStatement,
  SqlExecMeta,
  SqlSelectResult,
  SqlRunResult,
} from "./ports";

// better-sqlite3 / postgres adapters are exported here; the drivers themselves
// are peer deps so this remains
// import-safe when neither is installed (the createXxxClient calls are the
// only things that touch them).
export { createBetterSqlite3SqlClient } from "./adapters/better-sqlite3";
export { createPostgresSqlClient } from "./adapters/postgres";
