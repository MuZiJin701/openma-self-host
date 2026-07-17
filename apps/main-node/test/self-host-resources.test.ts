import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildModelCardRoutes } from "@open-managed-agents/http-routes";
import { createInMemoryModelCardService } from "@open-managed-agents/model-cards-store/test-fakes";
import { NodeModelResolver } from "../src/lib/node-model-resolver";

function userApp(route: ReturnType<typeof buildModelCardRoutes>, userId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user_id", userId);
    await next();
  });
  app.route("/", route as never);
  return app;
}

describe("self-host model resources", () => {
  it("isolates model cards and never returns the plaintext key", async () => {
    const { service } = createInMemoryModelCardService();
    const route = buildModelCardRoutes({ modelCards: service, internalToken: "internal", encryptionConfigured: true });
    const userA = userApp(route, "user-a");
    const userB = userApp(route, "user-b");
    const created = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: "claude-prod", provider: "anthropic", api_key: "secret-key" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { api_key_preview: string };
    expect(createdBody.api_key_preview).toBe("-key");
    expect((await (await userB.request("http://test/")).json()).data).toEqual([]);
    const cardId = (await (await userA.request("http://test/")).json()).data[0].id as string;
    expect((await userB.request(`http://test/${cardId}`)).status).toBe(404);
    expect((await userA.request(`http://test/${cardId}/key`)).status).toBe(404);
    const key = await userA.request(`http://test/${cardId}/key`, {
      headers: { "x-oma-internal-token": "internal" },
    });
    expect(await key.json()).toEqual({ api_key: "secret-key" });
  });

  it("rejects a missing user model card without environment fallback", async () => {
    const { service } = createInMemoryModelCardService();
    const resolver = new NodeModelResolver(service, { allowEnvironmentFallback: false });
    await expect(
      resolver.resolveCredentials({ userId: "user-b", agent: { model: "claude-prod" } as never }),
    ).rejects.toThrow(/No model card/);
  });

  it("uses the model card provider when resolving an Agent model", async () => {
    const { service } = createInMemoryModelCardService();
    await service.create({
      userId: "user-a",
      modelId: "oai-prod",
      model: "gpt-test",
      provider: "oai",
      apiKey: "key-oai",
    });
    const resolver = new NodeModelResolver(service, { allowEnvironmentFallback: false });

    const resolved = await resolver.resolve({
      userId: "user-a",
      agent: { model: "oai-prod" } as never,
    });

    expect(resolved.provider).toBe("oai");
    expect((resolved.model as { provider?: string }).provider).toContain("openai");
  });

  it("archives a model card without exposing it in the active list", async () => {
    const { service } = createInMemoryModelCardService();
    const route = buildModelCardRoutes({ modelCards: service, encryptionConfigured: true });
    const userA = userApp(route, "user-a");
    const created = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: "archive-me", provider: "oai", api_key: "key-oai" }),
    });
    const cardId = (await created.json() as { id: string }).id;

    const archived = await userA.request(`http://test/${cardId}/archive`, { method: "POST" });
    expect(archived.status).toBe(200);
    expect((await (await userA.request("http://test/")).json()).data).toEqual([]);
    const resolver = new NodeModelResolver(service, { allowEnvironmentFallback: false });
    await expect(resolver.resolveCredentials({ userId: "user-a", agent: { model: "archive-me" } as never }))
      .rejects.toThrow(/No model card/);
  });
});
