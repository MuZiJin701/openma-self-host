import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildEnvironmentRoutes, buildSessionRoutes, buildSkillRoutes } from "@open-managed-agents/http-routes";
import { createInMemoryEnvironmentService } from "@open-managed-agents/environments-store/test-fakes";
import { InMemorySkillService } from "@open-managed-agents/skills-store";

function userApp(route: unknown, userId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user_id", userId);
    await next();
  });
  app.route("/", route as never);
  return app;
}

describe("self-host resource routes", () => {
  it("supports user-scoped environment CRUD and archive", async () => {
    const { service } = createInMemoryEnvironmentService();
    const userA = userApp(buildEnvironmentRoutes({ environments: service }), "user-a");
    const userB = userApp(buildEnvironmentRoutes({ environments: service }), "user-b");

    const created = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "local", config: { type: "local" } }),
    });
    expect(created.status).toBe(201);
    const environmentId = (await created.json() as { id: string }).id;
    expect(environmentId).toMatch(/^env-/);

    const second = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "another-local", config: { type: "local" } }),
    });
    expect(second.status).toBe(201);
    const secondEnvironmentId = (await second.json() as { id: string }).id;
    expect(secondEnvironmentId).toMatch(/^env-/);
    expect(secondEnvironmentId).not.toBe(environmentId);

    const listed = await userA.request("http://test/");
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: Array<{ id: string }> }).data.map((row) => row.id))
      .toEqual(expect.arrayContaining([environmentId, secondEnvironmentId]));

    expect((await userB.request(`http://test/${environmentId}`)).status).toBe(404);
    const updated = await userA.request(`http://test/${environmentId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "local-updated", status: "ready" }),
    });
    expect((await updated.json() as { name: string }).name).toBe("local-updated");

    const archived = await userA.request(`http://test/${environmentId}/archive`, { method: "POST" });
    expect(archived.status).toBe(200);
    expect((await (await userA.request("http://test/")).json()).data.map((row: { id: string }) => row.id))
      .toEqual([secondEnvironmentId]);
  });

  it("rejects non-local Environment IDs and configurations", async () => {
    const { service } = createInMemoryEnvironmentService();
    const route = buildEnvironmentRoutes({ environments: service });
    const userA = userApp(route, "user-a");

    const unsupportedConfig = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cloud", config: { type: "cloud" } }),
    });
    expect(unsupportedConfig.status).toBe(501);
    expect(await unsupportedConfig.json()).toEqual({
      error: "environment_not_supported",
      environment_id: "env-cloud",
    });

    const unknownId = await userA.request("http://test/env-cloud", { method: "GET" });
    expect(unknownId.status).toBe(404);
  });

  it("reads skill versions only within the owning user", async () => {
    const service = new InMemorySkillService();
    const route = buildSkillRoutes({ skills: service });
    const userA = userApp(route, "user-a");
    const userB = userApp(route, "user-b");

    const created = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "research" }),
    });
    const skillId = (await created.json() as { id: string }).id;
    const version = await userA.request(`http://test/${skillId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ filename: "SKILL.md", content: "user-a" }] }),
    });
    expect(version.status).toBe(201);
    expect((await (await userA.request(`http://test/${skillId}/versions/1`)).json()).files[0].content)
      .toBe("user-a");
    expect((await userB.request(`http://test/${skillId}`)).status).toBe(404);
    expect((await userB.request(`http://test/${skillId}/versions/1`)).status).toBe(404);
  });

  it("rejects unsupported environments for local-runtime Agents", async () => {
    const route = buildSessionRoutes({
      services: {
        agents: {
          get: async () => ({
            id: "agent-1",
            user_id: "user-a",
            runtime_binding: null,
          }),
        },
      } as never,
      router: {} as never,
      forceLocalRuntime: true,
      localRuntimeEnvId: "env-local-runtime",
      loadEnvironment: async ({ environmentId }) => environmentId === "env-cloud"
        ? {
            id: environmentId,
            name: "cloud",
            config: { type: "cloud" },
          }
        : null,
    });
    const userA = userApp(route, "user-a");

    const response = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "agent-1", environment_id: "env-cloud" }),
    });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "environment_not_supported", environment_id: "env-cloud" });
  });

  it("accepts a user-owned local Environment record that is not the fallback ID", async () => {
    const route = buildSessionRoutes({
      services: {
        agents: {
          get: async () => ({
            id: "agent-1",
            user_id: "user-a",
            runtime_binding: null,
          }),
        },
        sessions: {
          create: async ({ environmentId }: { environmentId: string }) => ({
            session: {
              id: "session-1",
              user_id: "user-a",
              agent_id: "agent-1",
              environment_id: environmentId,
              title: "",
              status: "idle",
              created_at: "2026-07-17T00:00:00.000Z",
              archived_at: null,
            },
            resources: [],
          }),
        },
      } as never,
      router: { init: async () => undefined } as never,
      forceLocalRuntime: true,
      loadEnvironment: async ({ environmentId }) => ({
        type: "environment",
        id: environmentId,
        name: "Local test",
        config: { type: "local" },
      }),
    });
    const userA = userApp(route, "user-a");

    const response = await userA.request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "agent-1", environment_id: "env-user-a-2" }),
    });

    expect(response.status).toBe(201);
    expect((await response.json() as { environment_id: string }).environment_id).toBe("env-user-a-2");
  });
});
