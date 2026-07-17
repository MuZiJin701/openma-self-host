// Runtime-agnostic auth Hono middleware.
//
// Resolution priority:
//
//   1. AUTH_DISABLED → user_id="usr_local".
//   2. x-api-key header → resolveApiKey() → {user_id}.
//   3. Cookie session → resolveSession() → {user_id}.
//   4. Otherwise 401.
//
// The middleware is intentionally user-scoped only. It does not resolve,
// validate or repair application state.

import { createMiddleware } from "hono/factory";

export interface AuthSession {
  userId: string;
  email?: string | null;
  name?: string | null;
}

export interface ApiKeyResolution {
  userId: string;
}

export interface AuthMiddlewareDeps {
  /** True bypasses auth entirely and injects the local test user. */
  disabled: boolean;
  /** Resolve a session cookie → user info. Return null on miss. */
  resolveSession(headers: Headers): Promise<AuthSession | null>;
  /** Resolve an x-api-key value → user. Null on miss. */
  resolveApiKey(apiKey: string): Promise<ApiKeyResolution | null>;
  /** Path-prefix predicate — request paths matching are allowed through
   *  without auth. Default: /health and /auth/*.  Used for /v1/internal
   *  (header-secret) and /v1/mcp-proxy (Bearer-on-every-request). */
  bypassPath?(path: string): boolean;
}

const DEFAULT_BYPASS = (path: string) =>
  path === "/health" || path.startsWith("/auth/");

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  const bypassPath = deps.bypassPath ?? DEFAULT_BYPASS;
  return createMiddleware<{
    Variables: { user_id: string };
  }>(async (c, next) => {
    if (bypassPath(c.req.path)) return next();

    if (deps.disabled) {
      c.set("user_id", "usr_local");
      return next();
    }

    // 1. API key
    const apiKey = c.req.header("x-api-key");
    if (apiKey) {
      const r = await deps.resolveApiKey(apiKey);
      if (!r) return c.json({ error: "Invalid API key" }, 401);
      c.set("user_id", r.userId);
      return next();
    }

    // 2. Cookie session
    let session: AuthSession | null = null;
    try {
      session = await deps.resolveSession(c.req.raw.headers);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    c.set("user_id", session.userId);
    return next();
  });
}
