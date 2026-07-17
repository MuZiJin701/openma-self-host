// Runtime-agnostic SQL client port.
//
// Goal: give store packages one small SQL interface over SQLite and
// PostgreSQL. The prepared-statement shape keeps repository code independent
// from the selected driver:
//
//   db.prepare(sql).bind(...args).run()
//   db.prepare(sql).bind(...args).first<T>()
//   db.prepare(sql).bind(...args).all<T>()
//   db.batch([stmt1, stmt2, ...])
//
// A self-host deployment constructs the appropriate client for its local
// SQLite or shared PostgreSQL database.
//
// Adapters: see ./adapters/better-sqlite3.ts and ./adapters/postgres.ts.

/**
 * Per-statement metadata returned by mutation execution.
 *  - changes: rows affected by this statement.
 *  - last_row_id: AUTOINCREMENT id of the row inserted by this statement,
 *    if any. Always undefined for non-INSERT or no-AUTOINCREMENT inserts.
 */
export interface SqlExecMeta {
  changes: number;
  last_row_id?: number;
}

/**
 * SELECT result envelope for `.all()`.
 */
export interface SqlSelectResult<T> {
  results?: T[];
  meta?: SqlExecMeta;
}

/**
 * Mutation result envelope for `.run()`.
 */
export interface SqlRunResult<T = unknown> {
  results?: T[];
  meta: SqlExecMeta;
  success?: boolean;
}

/**
 * A prepared+bindable statement. Construct via SqlClient.prepare(); then
 * call exactly one of run/first/all (or hand to client.batch). Reusing one
 * SqlStatement across multiple execute calls is undefined behaviour.
 */
export interface SqlStatement {
  /** Bind positional parameters. Returns the same statement for chaining. */
  bind(...params: unknown[]): SqlStatement;

  /** Execute as a mutation. Returns rowsAffected via meta.changes. */
  run<T = unknown>(): Promise<SqlRunResult<T>>;

  /** Execute as a SELECT returning a single row, or null. */
  first<T = unknown>(): Promise<T | null>;

  /** Execute as a SELECT returning all matched rows. */
  all<T = unknown>(): Promise<SqlSelectResult<T>>;
}

/**
 * The port. self-host implementations live in adapters/.
 *
 * `batch` MUST execute the statements atomically (all succeed or all roll
 * back). Returned array is per-statement meta in the same order.
 */
export interface SqlClient {
  prepare(sql: string): SqlStatement;
  batch<T = unknown>(stmts: SqlStatement[]): Promise<Array<SqlRunResult<T>>>;
  /** Execute raw DDL/migration SQL. No params, no result rows. */
  exec(sql: string): Promise<void>;
}
