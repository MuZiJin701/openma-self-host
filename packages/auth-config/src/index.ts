// Build a better-auth instance with the OMA-shared config.
//
// CF passes a drizzle-adapter wrapping MAIN_DB; Node passes either a
// better-sqlite3 db or a pg.Pool — kysely-adapter inside better-auth
// detects the dialect from the shape (`aggregate in db` → SqliteDialect,
// `connect in db` → PostgresDialect).
//
// Email-OTP / sendResetPassword / sendVerificationEmail mount only when
// the caller passes a non-null `sender` — preserves P0-followup default-off
// behavior.

import { betterAuth } from "better-auth";

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
  });
}
