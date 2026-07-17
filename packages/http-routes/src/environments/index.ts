import { Hono } from "hono";
import type { Context } from "hono";
import {
  EnvironmentNotFoundError,
  type EnvironmentService,
  type EnvironmentRow,
} from "@open-managed-agents/environments-store";

function toApiShape(row: EnvironmentRow) {
  const { tenant_id: _tenant, ...publicRow } = row;
  return publicRow;
}

export function buildEnvironmentRoutes(deps: { environments: EnvironmentService }) {
  const app = new Hono<{ Variables: { tenant_id: string } }>();

  const unsupported = (c: Context, id: string) =>
    c.json({ error: "environment_not_supported", environment_id: id }, 501);

  const isLocalRuntimeConfig = (config: Record<string, unknown> | undefined) =>
    config?.type === "local";

  app.post("/", async (c) => {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown> | null;
    }>();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const config = body.config ?? { type: "local" };
    if (!isLocalRuntimeConfig(config)) return unsupported(c, "env-cloud");
    const row = await deps.environments.create({
      tenantId: c.var.tenant_id,
      name: body.name,
      description: body.description,
      config: config as never,
      metadata: body.metadata,
      status: "ready",
    });
    return c.json(toApiShape(row), 201);
  });

  app.get("/", async (c) => {
    const rows = await deps.environments.list({
      tenantId: c.var.tenant_id,
      includeArchived: false,
    });
    return c.json({ data: rows.filter((row) => isLocalRuntimeConfig(row.config)).map(toApiShape) });
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const row = await deps.environments.get({ tenantId: c.var.tenant_id, environmentId: id });
    if (!row) return c.json({ error: "Environment not found" }, 404);
    if (!isLocalRuntimeConfig(row.config)) return unsupported(c, id);
    return c.json(toApiShape(row));
  });

  app.post("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown> | null;
      status?: "building" | "ready" | "error";
    }>();
    if (body.config !== undefined && !isLocalRuntimeConfig(body.config)) {
      return unsupported(c, "env-cloud");
    }
    try {
      const existing = await deps.environments.get({ tenantId: c.var.tenant_id, environmentId: id });
      if (existing && !isLocalRuntimeConfig(existing.config)) return unsupported(c, id);
      const row = await deps.environments.update({
        tenantId: c.var.tenant_id,
        environmentId: id,
        name: body.name,
        description: body.description,
        config: body.config as never,
        metadata: body.metadata,
        status: body.status,
      });
      return c.json(toApiShape(row));
    } catch (error) {
      if (error instanceof EnvironmentNotFoundError) return c.json({ error: "Environment not found" }, 404);
      throw error;
    }
  });

  app.post("/:id/archive", async (c) => {
    const id = c.req.param("id");
    try {
      const row = await deps.environments.archive({ tenantId: c.var.tenant_id, environmentId: id });
      return c.json(toApiShape(row));
    } catch (error) {
      if (error instanceof EnvironmentNotFoundError) return c.json({ error: "Environment not found" }, 404);
      throw error;
    }
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await deps.environments.delete({ tenantId: c.var.tenant_id, environmentId: id });
      return c.json({ type: "environment_deleted", id });
    } catch (error) {
      if (error instanceof EnvironmentNotFoundError) return c.json({ error: "Environment not found" }, 404);
      throw error;
    }
  });

  return app;
}
