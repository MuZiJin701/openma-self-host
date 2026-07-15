import { Hono } from "hono";
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

  app.post("/", async (c) => {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown> | null;
    }>();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const row = await deps.environments.create({
      tenantId: c.var.tenant_id,
      name: body.name,
      description: body.description,
      config: (body.config ?? {}) as never,
      metadata: body.metadata,
      status: "ready",
    });
    return c.json(toApiShape(row), 201);
  });

  app.get("/", async (c) => {
    const rows = await deps.environments.list({ tenantId: c.var.tenant_id, includeArchived: false });
    return c.json({ data: rows.map(toApiShape) });
  });

  app.get("/:id", async (c) => {
    const row = await deps.environments.get({ tenantId: c.var.tenant_id, environmentId: c.req.param("id") });
    return row ? c.json(toApiShape(row)) : c.json({ error: "Environment not found" }, 404);
  });

  app.post("/:id", async (c) => {
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown> | null;
      status?: "building" | "ready" | "error";
    }>();
    try {
      const row = await deps.environments.update({
        tenantId: c.var.tenant_id,
        environmentId: c.req.param("id"),
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
    try {
      const row = await deps.environments.archive({ tenantId: c.var.tenant_id, environmentId: c.req.param("id") });
      return c.json(toApiShape(row));
    } catch (error) {
      if (error instanceof EnvironmentNotFoundError) return c.json({ error: "Environment not found" }, 404);
      throw error;
    }
  });

  app.delete("/:id", async (c) => {
    try {
      await deps.environments.delete({ tenantId: c.var.tenant_id, environmentId: c.req.param("id") });
      return c.json({ type: "environment_deleted", id: c.req.param("id") });
    } catch (error) {
      if (error instanceof EnvironmentNotFoundError) return c.json({ error: "Environment not found" }, 404);
      throw error;
    }
  });

  return app;
}
