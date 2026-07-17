import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware } from "@open-managed-agents/auth";

function buildApp(deps: {
  disabled: boolean;
  resolveSession: (headers: Headers) => Promise<{ userId: string; email?: string | null; name?: string | null } | null>;
  resolveApiKey: (apiKey: string) => Promise<{ userId: string } | null>;
}) {
  const app = new Hono();
  app.use("*", createAuthMiddleware({ ...deps, bypassPath: () => false }));
  app.get("/", (c) => c.json({ user_id: c.var.user_id }));
  return app;
}

describe("auth user scope", () => {
  it("uses only session.user.id for authenticated requests", async () => {
    const app = buildApp({
      disabled: false,
      resolveSession: async () => ({ userId: "usr_a", email: "a@example.test", name: "User A" }),
      resolveApiKey: async () => null,
    });
    const response = await app.request("http://test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: "usr_a" });
  });

  it("uses usr_local when AUTH_DISABLED-style bypass is enabled", async () => {
    const app = buildApp({
      disabled: true,
      resolveSession: async () => { throw new Error("resolveSession should not be called"); },
      resolveApiKey: async () => { throw new Error("resolveApiKey should not be called"); },
    });
    const response = await app.request("http://test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: "usr_local" });
  });

  it("resolves API keys directly to user_id", async () => {
    const app = buildApp({
      disabled: false,
      resolveSession: async () => null,
      resolveApiKey: async (apiKey) => apiKey === "key_usr_a" ? { userId: "usr_a" } : null,
    });
    const response = await app.request("http://test/", { headers: { "x-api-key": "key_usr_a" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: "usr_a" });
  });
});
