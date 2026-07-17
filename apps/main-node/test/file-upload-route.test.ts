import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { InMemoryBlobStore } from "@open-managed-agents/blob-store";
import { createInMemoryFileService } from "@open-managed-agents/files-store/test-fakes";
import { buildNodeFileRoutes } from "../src/lib/node-file-routes";

function tenantApp(route: unknown, tenantId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenant_id", tenantId);
    await next();
  });
  app.route("/", route as never);
  return app;
}

describe("Node file upload route", () => {
  it("stores a multipart upload in the tenant and session scope", async () => {
    const { service } = createInMemoryFileService();
    const blob = new InMemoryBlobStore();
    const route = buildNodeFileRoutes({
      files: service,
      filesBlob: blob,
      sessionExists: async ({ tenantId, sessionId }) =>
        tenantId === "tenant-a" && sessionId === "sess-1",
    });
    const tenantA = tenantApp(route, "tenant-a");
    const form = new FormData();
    form.append("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    form.append("scope_id", "sess-1");
    form.append("downloadable", "true");

    const response = await tenantA.request("http://test/", { method: "POST", body: form });

    expect(response.status).toBe(201);
    const file = await response.json() as { id: string; filename: string; scope_id?: string };
    expect(file.filename).toBe("hello.txt");
    expect(file.scope_id).toBe("sess-1");
    const row = await service.get({ tenantId: "tenant-a", fileId: file.id });
    expect(row?.size_bytes).toBe(5);
    expect(await (await blob.get(row!.r2_key))!.text()).toBe("hello");
  });

  it("rejects an upload scoped to another tenant's or missing Session", async () => {
    const { service } = createInMemoryFileService();
    const route = buildNodeFileRoutes({
      files: service,
      filesBlob: new InMemoryBlobStore(),
      sessionExists: async () => false,
    });
    const tenantA = tenantApp(route, "tenant-a");
    const form = new FormData();
    form.append("file", new File(["hello"], "hello.txt"));
    form.append("scope_id", "sess-other");

    const response = await tenantA.request("http://test/", { method: "POST", body: form });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });
});
