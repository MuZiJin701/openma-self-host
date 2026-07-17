// Build a better-auth instance with the OMA-shared config.
//
// CF passes a drizzle-adapter wrapping MAIN_DB; Node passes either a
// better-sqlite3 db or a pg.Pool — kysely-adapter inside better-auth
// detects the dialect from the shape (`aggregate in db` → SqliteDialect,
// `connect in db` → PostgresDialect).
//
// Email-OTP / sendResetPassword / sendVerificationEmail mount only when
// the caller passes a non-null `sender` — preserves P0-followup default-off
// behavior. The tenant-create databaseHook lives here so the same
// "sign up auto-creates a workspace" flow runs on either runtime.

import { betterAuth } from "better-auth";
import type { SqlClient } from "@open-managed-agents/sql-client";

export interface BuildBetterAuthOpts {
  /** Driver handle. better-sqlite3 Database, pg.Pool, or a drizzle adapter
   *  (CF). better-auth's kysely-adapter detects the dialect; CF callers
   *  pass `drizzleAdapter(db, { provider: "sqlite", schema })` — that
   *  satisfies the same `database` slot. */
  database: unknown;
  /** Cookie signing + token HMAC. Required in prod; main-node mints a
   *  per-process random one when omitted (callers SHOULD warn). */
  secret: string;
  /** Public origin (used for redirect URLs + cookie domain). */
  baseURL?: string;
  /** Cross-subdomain cookie domain (e.g. ".example.test"). */
  cookieDomain?: string;
  /** Idempotent ensure-tenant; called from databaseHooks.user.create.after.
   *  Runtimes pass their own implementation: CF writes to the legacy
   *  `tenant` + `membership` + `tenant_shard` tables; Node writes to the
   *  packages/schema tenant tables only (no shard router). */
  ensureTenant: (user: {
    id: string;
    name?: string | null;
    email?: string | null;
  }) => Promise<unknown>;
  /** Optional drizzle-adapter pre-built by CF; pass `database` instead
   *  on Node. Ignored when not provided. */
  drizzleProvider?: "sqlite" | "pg";
}

export type BetterAuth = ReturnType<typeof betterAuth>;

export function buildBetterAuth(opts: BuildBetterAuthOpts) {
  return betterAuth({
    basePath: "/auth",
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: opts.database as never,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [],
    trustedOrigins: opts.baseURL ? [opts.baseURL] : ["*"],
    ...(opts.cookieDomain
      ? {
          advanced: {
            crossSubDomainCookies: {
              enabled: true,
              domain: opts.cookieDomain,
            },
            defaultCookieAttributes: {
              domain: opts.cookieDomain,
              sameSite: "lax" as const,
              secure: true,
            },
          },
        }
      : {}),
    user: {
      additionalFields: {
        tenantId: { type: "string", required: false },
        role: { type: "string", required: false, defaultValue: "member" },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; name?: string | null; email?: string | null }) => {
            try {
              await opts.ensureTenant(user);
            } catch (err) {
              // Don't block sign-up on tenant creation — auth middleware's
              // self-heal path retries on first authenticated request.
              console.error("[auth-config] ensureTenant hook failed:", err);
            }
          },
        },
      },
    },
  });
}

/** Run an idempotent ensure-tenant against an arbitrary SqlClient (the
 *  Node-style flow). Used by both apps/main-node's auth-config hook and
 *  the auth-middleware self-heal path. CF runs an analogous helper that
 *  also assigns a shard — see apps/main/src/auth-config.ts:ensureTenant. */
export async function ensureTenantSqlite(
  sql: SqlClient,
  userId: string,
  userName: string | null | undefined,
  userEmail: string | null | undefined,
): Promise<string> {
  const existing = await sql
    .prepare(
      `SELECT tenant_id FROM membership WHERE user_id = ? ORDER BY created_at ASC, tenant_id ASC LIMIT 1`,
    )
    .bind(userId)
    .first<{ tenant_id: string }>();
  if (existing) return existing.tenant_id;

  const tenantId = `tn_${randomHex(16)}`;
  const now = Date.now();
  const trimmedName = (userName ?? "").trim();
  const emailPrefix = (userEmail ?? "").split("@")[0]?.trim() ?? "";
  const display = trimmedName || emailPrefix || "User";
  const tenantName = `${display}'s workspace`;

  await sql
    .prepare(`INSERT INTO "tenant" (id, name, "createdAt", "updatedAt") VALUES (?, ?, ?, ?)`)
    .bind(tenantId, tenantName, now, now)
    .run();

  await sql
    .prepare(
      `INSERT INTO "membership" (user_id, tenant_id, role, created_at)
       VALUES (?, ?, 'owner', ?)
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    )
    .bind(userId, tenantId, now)
    .run();

  // Re-read in case a concurrent caller raced.
  const final = await sql
    .prepare(
      `SELECT tenant_id FROM membership WHERE user_id = ? ORDER BY created_at ASC, tenant_id ASC LIMIT 1`,
    )
    .bind(userId)
    .first<{ tenant_id: string }>();
  return final?.tenant_id ?? tenantId;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
