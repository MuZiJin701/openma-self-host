import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildModelCardRoutes } from "@open-managed-agents/http-routes";
import { createInMemoryModelCardService } from "@open-managed-agents/model-cards-store/test-fakes";
import { NodeModelResolver } from "../src/lib/node-model-resolver";

function tenantApp(route: ReturnType<typeof buildModelCardRoutes>, tenantId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenant_id", tenantId);
    await next();
  });
  app.route("/", route as never);
  return app;
}

describe("self-host model resources", () => {
  it("isolates model cards and never returns the plaintext key", async () => {
    const { service } = createInMemoryModelCardService();
    const route = buildModelCardRoutes({ modelCards: service, internalToken: "internal", encryptionConfigured: true });
    const tenantA = tenantApp(route, "tenant-a");
    const tenantB = tenantApp(route, "tenant-b");
    const created = await tenantA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: "claude-prod", provider: "anthropic", api_key: "secret-key" }),
    });
    expect(created.status).toBe(201);
    expect(await created.text()).not.toContain("secret-key");
    expect((await (await tenantB.request("http://test/")).json()).data).toEqual([]);
    const cardId = (await (await tenantA.request("http://test/")).json()).data[0].id as string;
    expect((await tenantB.request(`http://test/${cardId}`)).status).toBe(404);
    expect((await tenantA.request(`http://test/${cardId}/key`)).status).toBe(404);
    const key = await tenantA.request(`http://test/${cardId}/key`, {
      headers: { "x-oma-internal-token": "internal" },
    });
    expect(await key.json()).toEqual({ api_key: "secret-key" });
  });

  it("rejects a missing tenant model card without environment fallback", async () => {
    const { service } = createInMemoryModelCardService();
    const resolver = new NodeModelResolver(service, { allowEnvironmentFallback: false });
    await expect(
      resolver.resolveCredentials({ tenantId: "tenant-b", agent: { model: "claude-prod" } as never }),
    ).rejects.toThrow(/No model card/);
  });
});
