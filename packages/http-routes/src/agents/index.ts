// Agents — full CRUD with AMA-shape envelope.
//
// Agents — full CRUD with the AMA-shaped envelope.

import { Hono } from "hono";
import type {
  AgentConfig,
} from "@open-managed-agents/shared";
import {
  AgentNotFoundError,
  AgentVersionMismatchError,
} from "@open-managed-agents/agents-store";
import type { RouteServicesArg } from "../types";
import { resolveServices } from "../types";

interface Vars {
  Variables: { user_id: string };
}

function formatAgent(agent: AgentConfig) {
  const model =
    !agent.model || typeof agent.model === "string"
      ? { id: agent.model || "", speed: "standard" as const }
      : { id: agent.model.id, speed: agent.model.speed || ("standard" as const) };

  return {
    type: "agent" as const,
    ...agent,
    model,
    system: agent.system || null,
    description: agent.description || null,
    skills: agent.skills || [],
    metadata: agent.metadata || {},
    archived_at: agent.archived_at || null,
  };
}

function toApiAgent(row: AgentConfig & { user_id?: string }) {
  const { user_id: _t, ...rest } = row;
  return formatAgent(rest);
}

export interface AgentRoutesDeps {
  services: RouteServicesArg;
  /** Optional model card validation. CF passes a function backed by
   *  services.modelCards; Node passes nothing → validation skipped. */
  validateModel?: (
    userId: string,
    model: string | { id: string; speed?: string },
  ) => Promise<{ valid: boolean; error?: string }>;
  /** Optional user-scoped skill/version validation for self-host. */
  validateSkills?: (
    userId: string,
    skills: AgentConfig["skills"],
  ) => Promise<{ valid: boolean; error?: string }>;
  /** Optional field-size cap check. CF passes apps/main/src/lib/limits;
   *  Node currently passes nothing. */
  validateAgentLimits?: (body: unknown) => { ok: boolean; error?: string };
  /** Active-sessions guard for DELETE — true means "refuse with 409". */
  hasActiveSessionsByAgent?: (
    userId: string,
    agentId: string,
  ) => Promise<boolean>;
}

export function buildAgentRoutes(deps: AgentRoutesDeps) {
  const app = new Hono<Vars>();

  // POST /v1/agents — create
  app.post("/", async (c) => {
    const services = resolveServices(deps.services, c);
    const raw = await c.req.json<{
      name: string;
      model: string | { id: string; speed?: "standard" | "fast" };
      system?: string;
      tools?: AgentConfig["tools"];
      description?: string;
      skills?: AgentConfig["skills"];
      metadata?: Record<string, unknown>;
    }>();

    const body = raw;

    if (!body.name) return c.json({ error: "name is required" }, 400);
    if (!body.model) return c.json({ error: "model is required" }, 400);

    if (deps.validateAgentLimits) {
      const limitCheck = deps.validateAgentLimits(body);
      if (!limitCheck.ok) return c.json({ error: limitCheck.error }, 400);
    }

    const userId = c.var.user_id;
    if (deps.validateModel) {
      const r = await deps.validateModel(userId, body.model);
      if (!r.valid) return c.json({ error: r.error }, 400);
    }
    if (deps.validateSkills && body.skills) {
      const skills = await deps.validateSkills(userId, body.skills);
      if (!skills.valid) return c.json({ error: skills.error }, 400);
    }

    const row = await services.agents.create({
      userId,
      input: {
        name: body.name,
        model: body.model ?? "",
        system: body.system,
        tools: body.tools,
        description: body.description,
        skills: body.skills,
        metadata: body.metadata,
      },
    });
    return c.json(toApiAgent(row), 201);
  });

  // GET /v1/agents — cursor-paginated list
  app.get("/", async (c) => {
    const services = resolveServices(deps.services, c);
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Math.min(Math.max(1, Number(limitStr)), 100) : 50;
    const cursor = c.req.query("cursor") ?? undefined;
    const includeArchivedRaw = c.req.query("include_archived");
    const includeArchived = includeArchivedRaw === "true";
    const q = c.req.query("q") ?? undefined;
    const orderRaw = c.req.query("order");
    if (orderRaw !== undefined && orderRaw !== "asc" && orderRaw !== "desc") {
      return c.json({ error: "order must be asc or desc" }, 400);
    }

    // status: enum filter on archive state. Whitelist strictly — any
    // unknown value is a 400, NOT a silent fallback to "any". Allowing
    // arbitrary strings here would mask client bugs (typo'd "active "
    // returning every row looks like a feature).
    const statusRaw = c.req.query("status");
    let status: "active" | "archived" | "any" | undefined;
    if (statusRaw !== undefined) {
      if (statusRaw === "active" || statusRaw === "archived" || statusRaw === "any") {
        status = statusRaw;
      } else {
        return c.json(
          {
            error: {
              type: "invalid_request_error",
              code: "invalid_status",
              message: `Invalid status '${statusRaw}'; expected one of active|archived|any.`,
            },
          },
          400,
        );
      }
    }

    // created_after / created_before: ISO timestamps → epoch ms. Reject
    // unparseable values explicitly so the client knows it's a malformed
    // request, not just "no results".
    const parseMs = (
      raw: string | undefined,
      field: string,
    ): { value: number | undefined; err?: Response } => {
      if (raw === undefined) return { value: undefined };
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) {
        return {
          value: undefined,
          err: c.json(
            {
              error: {
                type: "invalid_request_error",
                code: "invalid_timestamp",
                message: `Invalid ${field} '${raw}'; expected ISO-8601 timestamp.`,
              },
            },
            400,
          ),
        };
      }
      return { value: ms };
    };
    const createdAfterRes = parseMs(c.req.query("created_after"), "created_after");
    if (createdAfterRes.err) return createdAfterRes.err;
    const createdBeforeRes = parseMs(c.req.query("created_before"), "created_before");
    if (createdBeforeRes.err) return createdBeforeRes.err;

    const page = await services.agents.listPage({
      userId: c.var.user_id,
      limit,
      ...(cursor ? { cursor } : {}),
      // Prefer the new `status` filter. Keep includeArchived as a back-
      // compat fallback (used by older console builds that only know the
      // checkbox). The service layer maps includeArchived→status when
      // status is unset, so passing both is fine.
      ...(status !== undefined ? { status } : {}),
      ...(includeArchivedRaw !== undefined ? { includeArchived } : {}),
      ...(q ? { q } : {}),
      ...(createdAfterRes.value !== undefined
        ? { createdAfter: createdAfterRes.value }
        : {}),
      ...(createdBeforeRes.value !== undefined
        ? { createdBefore: createdBeforeRes.value }
        : {}),
    });
    const items = [...page.items];
    if (orderRaw === "asc") {
      items.sort((a, b) => {
        const created = a.created_at.localeCompare(b.created_at);
        return created !== 0 ? created : a.id.localeCompare(b.id);
      });
    }
    return c.json({
      data: items.map(toApiAgent),
      ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
      has_more: !!page.nextCursor,
    });
  });

  // GET /v1/agents/:id — get
  app.get("/:id", async (c) => {
    const services = resolveServices(deps.services, c);
    const row = await services.agents.get({
      userId: c.var.user_id,
      agentId: c.req.param("id"),
    });
    if (!row) return c.json({ error: "Agent not found" }, 404);
    return c.json(toApiAgent(row));
  });

  // POST/PUT /v1/agents/:id — update
  const updateAgent = async (
    c: import("hono").Context<Vars, "/:id">,
  ): Promise<Response> => {
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const userId = c.var.user_id;
    const existing = await services.agents.get({ userId, agentId: id });
    if (!existing) return c.json({ error: "Agent not found" }, 404);

    const raw = (await c.req.json()) as {
      name?: string;
      model?: string | { id: string; speed?: "standard" | "fast" };
      system?: string | null;
      tools?: AgentConfig["tools"];
      description?: string | null;
      skills?: AgentConfig["skills"] | null;
      metadata?: Record<string, unknown>;
      version?: number;
    };
    const body = raw;

    if (deps.validateAgentLimits) {
      const limitCheck = deps.validateAgentLimits(body);
      if (!limitCheck.ok) return c.json({ error: limitCheck.error }, 400);
    }

    if (deps.validateModel && body.model !== undefined) {
      const eff = body.model ?? existing.model;
      const r = await deps.validateModel(userId, eff);
      if (!r.valid) return c.json({ error: r.error }, 400);
    }
    if (deps.validateSkills && body.skills !== undefined && body.skills !== null) {
      const skills = await deps.validateSkills(userId, body.skills);
      if (!skills.valid) return c.json({ error: skills.error }, 400);
    }
    try {
      const row = await services.agents.update({
        userId,
        agentId: id,
        expectedVersion: body.version,
        input: {
          name: body.name,
          model: body.model,
          system: body.system,
          tools: body.tools,
          description: body.description,
          skills: body.skills,
          metadata: body.metadata,
        },
      });
      return c.json(toApiAgent(row));
    } catch (err) {
      if (err instanceof AgentVersionMismatchError) {
        return c.json(
          { error: "Version mismatch. Agent has been updated since you last read it." },
          409,
        );
      }
      if (err instanceof AgentNotFoundError) {
        return c.json({ error: "Agent not found" }, 404);
      }
      throw err;
    }
  };
  app.post("/:id", updateAgent);
  app.put("/:id", updateAgent);

  // GET /v1/agents/:id/versions — list all versions
  app.get("/:id/versions", async (c) => {
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const userId = c.var.user_id;
    const exists = await services.agents.get({ userId, agentId: id });
    if (!exists) return c.json({ error: "Agent not found" }, 404);
    const versions = await services.agents.listVersions({ userId, agentId: id });
    const data = versions
      .map((v) => formatAgent(v.snapshot))
      .sort((a, b) => a.version - b.version);
    return c.json({ data });
  });

  // GET /v1/agents/:id/versions/:version
  app.get("/:id/versions/:version", async (c) => {
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const v = parseInt(c.req.param("version"), 10);
    if (Number.isNaN(v)) return c.json({ error: "Version not found" }, 404);
    const row = await services.agents.getVersion({
      userId: c.var.user_id,
      agentId: id,
      version: v,
    });
    if (!row) return c.json({ error: "Version not found" }, 404);
    return c.json(formatAgent(row.snapshot));
  });

  // POST /v1/agents/:id/archive
  app.post("/:id/archive", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      const row = await services.agents.archive({
        userId: c.var.user_id,
        agentId: c.req.param("id"),
      });
      return c.json(toApiAgent(row));
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        return c.json({ error: "Agent not found" }, 404);
      }
      throw err;
    }
  });

  // DELETE /v1/agents/:id
  app.delete("/:id", async (c) => {
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const userId = c.var.user_id;
    const existing = await services.agents.get({ userId, agentId: id });
    if (!existing) return c.json({ error: "Agent not found" }, 404);

    if (deps.hasActiveSessionsByAgent) {
      const has = await deps.hasActiveSessionsByAgent(userId, id);
      if (has) {
        return c.json(
          {
            error:
              "Cannot delete agent with active sessions. Archive or delete sessions first.",
          },
          409,
        );
      }
    }

    await services.agents.delete({ userId, agentId: id });
    return c.json({ type: "agent_deleted", id });
  });

  return app;
}
