// @open-managed-agents/db-schema
//
// All table definitions live here, organized by which physical database
// they target on Cloudflare. Node-PG re-exports the self-host union with
// PG-typed columns.
//
// Subpackages — each maps to one drizzle-kit config + one migrations dir:
//   ./cf-auth          → MAIN_DB / openma-auth (control plane + business)
//   ./cf-router        → ROUTER_DB / openma-router
//   ./node-pg          → single PG database (self-host union)
//
// Adding a table:
//   1. Pick the correct subpackage(s) based on which D1 it lives on
//   2. Define using pgTable / sqliteTable with conventions from
//      packages/db-schema/README.md
//   3. Run `pnpm db:generate:<dialect>` — drizzle-kit emits the
//      migration SQL into the right apps/main/migrations*/ dir
//   4. Commit both the schema source and the generated SQL

export * as cfAuth from "./cf-auth";
export * as cfRouter from "./cf-router";
export * as nodePg from "./node-pg";

// Dependency-inversion port for adapters: Drizzle DB type union + helpers
// that paper over SQLite vs PG terminator differences (`.get()/.all()` vs
// awaitable chains). Adapters import `OmaDb` and `getOne`/`getAll`/`runOnce`
// from here and depend on no concrete driver.
export * from "./_shared/oma-db";
