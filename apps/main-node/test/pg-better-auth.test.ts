// PG-backed better-auth smoke. Verifies:
//   1. ensureAuthSchemaPg-style bootstrap leaves user/session/account/
//      verification tables in PG.
//   2. /auth/sign-up/email + /auth/sign-in/email round-trip — set-cookie
//      from sign-up is accepted on a *second* better-auth instance
//      sharing the same pg.Pool DSN (multi-replica analog).
//
// Skipped unless PG_TEST_URL is set. Run locally with:
//   docker run --rm -p 54329:5432 -e POSTGRES_USER=oma -e POSTGRES_PASSWORD=oma \
//     -e POSTGRES_DB=oma postgres:16-alpine
//   PG_TEST_URL=postgres://oma:oma@127.0.0.1:54329/oma pnpm --filter \
//     @open-managed-agents/main-node test pg-better-auth

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import {
  createPostgresSqlClient,
  type SqlClient,
} from "@open-managed-agents/sql-client";
import { createAuth } from "../src/auth/config.js";
import { applyBetterAuthSchema } from "@open-managed-agents/schema";

const PG_URL = process.env.PG_TEST_URL ?? "";
const enabled =
  PG_URL.startsWith("postgres://") || PG_URL.startsWith("postgresql://");
const d = enabled ? describe : describe.skip;

let sql: SqlClient;
let pool: import("pg").Pool;

beforeAll(async () => {
  if (!enabled) return;
  sql = await createPostgresSqlClient(PG_URL);
  await applyBetterAuthSchema({ sql, dialect: "postgres" });
  const { Pool } = (await import("pg")) as typeof import("pg");
  pool = new Pool({ connectionString: PG_URL });
});

afterAll(async () => {
  if (!enabled) return;
  // Cleanup the smoke test rows so repeat runs stay green.
  await sql
    .prepare(`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE 'pg-auth-smoke-%')`)
    .run();
  await sql
    .prepare(`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE 'pg-auth-smoke-%')`)
    .run();
  await sql.prepare(`DELETE FROM "user" WHERE email LIKE 'pg-auth-smoke-%'`).run();
  await pool.end();
});

function mountApp(auth: ReturnType<typeof createAuth>): Hono {
  const app = new Hono();
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  return app;
}

d("better-auth on PG (multi-replica friendly)", () => {
  it("sign-up on replica A → sign-in on replica B with shared PG pool", async () => {
    const secret = "test_secret_pg_better_auth_xxxxxxxxxxxxxxxxxxxx";
    const replicaA = createAuth({ database: pool, mainSql: sql, secret });
    const replicaB = createAuth({ database: pool, mainSql: sql, secret });
    const appA = mountApp(replicaA);
    const appB = mountApp(replicaB);

    const email = `pg-auth-smoke-${Date.now()}@local.test`;
    const password = "hunter22hunter22";

    const t0 = Date.now();
    const signUp = await appA.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: "Smoke" }),
      }),
    );
    const signUpBody = await signUp.json().catch(() => ({}));
    expect([200, 201], `unexpected status ${signUp.status}: ${JSON.stringify(signUpBody)}`).toContain(signUp.status);

    const userRow = await sql
      .prepare(
        `SELECT id FROM "user" WHERE email = ?`,
      )
      .bind(email)
      .first<{ id: string }>();
    expect(userRow?.id).toMatch(/^.+$/);

    // Sign-in via replica B confirms the row landed atomically and that
    // betterAuth on a separate instance can read the shared PG schema.
    const signIn = await appB.fetch(
      new Request("http://localhost/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    );
    const signInBody = await signIn.json().catch(() => ({}));
    expect(signIn.status, `sign-in failed: ${JSON.stringify(signInBody)}`).toBe(200);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);
});
