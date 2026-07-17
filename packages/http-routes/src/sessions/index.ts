// Sessions routes for the Node self-host. Storage and file operations are
// supplied through small hooks so the API remains testable.

import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { Context } from "hono";
import {
  generateFileId,
  generateEventId,
  guessSessionOutputMime,
} from "@open-managed-agents/shared";
import type {
  AgentConfig,
  ContentBlock,
  EnvironmentConfig,
  SessionEvent,
  SessionResource,
  UserMessageEvent,
} from "@open-managed-agents/shared";
import {
  SessionArchivedError,
  SessionNotFoundError,
  SessionResourceMaxExceededError,
  SessionResourceNotFoundError,
} from "@open-managed-agents/sessions-store";
import type { SessionRouter, SessionInitParams } from "@open-managed-agents/session-runtime";
import type { RouteServicesArg } from "../types";
import { resolveServices } from "../types";

interface Vars {
  Variables: { user_id: string };
}

const ALLOWED_EVENT_TYPES = new Set<string>([
  "user.message",
  "user.interrupt",
  "user.tool_confirmation",
  "user.custom_tool_result",
]);

function isLocalRuntimeEnvironment(environment: EnvironmentConfig): boolean {
  const legacy = environment as EnvironmentConfig & { runtime?: string };
  return environment.config?.type === "local" || legacy.runtime === "local";
}

interface BlobObjectListing {
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  media_type: string;
}

export interface OutputsAdapter {
  /** Listing for GET /v1/sessions/:id/outputs. */
  list(userId: string, sessionId: string): Promise<BlobObjectListing[] | null>;
  /** Streaming download for GET /v1/sessions/:id/outputs/:filename. */
  read(
    userId: string,
    sessionId: string,
    filename: string,
  ): Promise<{
    body: ReadableStream<Uint8Array> | ArrayBuffer;
    size: number;
    contentType: string;
  } | null>;
  /** Cascade-delete on session DELETE — best-effort. */
  deleteAll(userId: string, sessionId: string): Promise<void>;
}

export interface SessionLifecycleHooks {
  /** Resolve {file_id} ContentBlocks to inline base64 + return mount ids
   *  for the sandbox. CF: reads bytes from FILES_BUCKET. Node: returns
   *  blocks unchanged (file_id resolution lands in the Node port later). */
  resolveFileIds?: (input: {
    userId: string;
    blocks: ContentBlock[];
  }) => Promise<{ blocks: ContentBlock[]; mountFileIds: string[] }>;
  /** Copy a file from the global filesBlob into a per-session scope on
   *  POST /v1/sessions resources. CF: R2 copy. Node: filesystem copy
   *  or alias. */
  cloneSessionFile?: (input: {
    userId: string;
    sessionId: string;
    sourceFileId: string;
  }) => Promise<{
    fileId: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
  } | null>;
  fileExists?: (input: {
    userId: string;
    fileId: string;
  }) => Promise<boolean>;
  /** Delete a session's blob storage (R2 prefix or local files) on
   *  session DELETE. */
  cascadeDeleteFiles?: (input: {
    userId: string;
    sessionId: string;
  }) => Promise<void>;
  /** Promote a sandbox path to a first-class file_id (POST /sessions/:id/files). */
  promoteSandboxFile?: (input: {
    userId: string;
    sessionId: string;
    sandboxPath: string;
    filename: string;
    mediaType: string;
    downloadable: boolean;
    bytes: ArrayBuffer;
  }) => Promise<unknown>;
}

export interface SessionRoutesDeps {
  services: RouteServicesArg;
  /** Per-request SessionRouter — CF resolves per-user; Node returns
   *  the singleton router built at process start. */
  router: SessionRouter | ((c: Context) => SessionRouter);
  /** Environment lookup for session create. Returns the snapshot the
   *  runtime needs at /init. */
  loadEnvironment?: (input: {
    userId: string;
    environmentId: string;
  }) => Promise<EnvironmentConfig | null>;
  /** Default local environment used when the request omits environment_id. */
  localRuntimeEnvId?: string;
  /** Outputs surface — CF wraps R2; Node wraps the local FS in
   *  outputsRoot. Null disables /outputs routes. */
  outputs?: OutputsAdapter | null;
  /** Optional debug-token gate for POST /v1/sessions/:id/__debug_recovery__.
   *  When unset the route 404s. */
  debugRecoveryToken?: string;
  /** Optional file/session lifecycle hooks used by the Node composition root. */
  lifecycle?: SessionLifecycleHooks;
}

function resolveRouter(
  arg: SessionRouter | ((c: Context) => SessionRouter),
  c: Context,
): SessionRouter {
  return typeof arg === "function" ? arg(c) : arg;
}

function mapSessionError(c: Context, err: unknown): Response {
  if (err instanceof SessionNotFoundError) return c.json({ error: "Session not found" }, 404);
  if (err instanceof SessionResourceNotFoundError) return c.json({ error: "Resource not found" }, 404);
  if (err instanceof SessionArchivedError) return c.json({ error: err.message }, 409);
  if (err instanceof SessionResourceMaxExceededError) return c.json({ error: err.message }, 400);
  throw err;
}

function snapshotToSessionAgent(
  agentId: string,
  snapshot: AgentConfig | null,
): Record<string, unknown> {
  if (!snapshot) return { type: "agent", id: agentId, version: 1 };
  const {
    archived_at: _ar,
    created_at: _ca,
    updated_at: _ua,
    metadata: _md,
    ...rest
  } = snapshot;
  return {
    type: "agent",
    ...rest,
    id: agentId,
    version: snapshot.version ?? 1,
  };
}

function toApiSession(row: {
  id: string;
  user_id?: string;
  agent_id: string;
  agent_snapshot?: AgentConfig | null;
  environment_id?: string;
  environment_snapshot?: EnvironmentConfig | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
  terminated_at?: string | null;
}): Record<string, unknown> {
  const {
    user_id: _t,
    agent_id,
    agent_snapshot,
    environment_snapshot: _es,
    title,
    metadata,
    ...rest
  } = row;
  const createdMs = Date.parse(row.created_at);
  const terminatedMs = row.terminated_at ? Date.parse(row.terminated_at) : null;
  const refMs = terminatedMs ?? Date.now();
  const durationSeconds = Number.isFinite(createdMs)
    ? Math.max(0, Math.round((refMs - createdMs) / 1000))
    : undefined;
  return {
    ...rest,
    type: "session" as const,
    title: title ?? null,
    agent_id,
    agent: snapshotToSessionAgent(agent_id, agent_snapshot ?? null),
    metadata: metadata ?? {},
    resources: [] as unknown[],
    usage: {} as Record<string, unknown>,
    stats: durationSeconds !== undefined ? { duration_seconds: durationSeconds } : {},
  };
}

export function buildSessionRoutes(deps: SessionRoutesDeps) {
  const app = new Hono<Vars>();

  // ── Create ────────────────────────────────────────────────────────────
  app.post("/", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const t = c.var.user_id;

    const body = await c.req.json<{
      agent: string | { id: string; version?: number };
      environment_id?: string;
      environment?: string | { id: string };
      title?: string;
      resources?: Array<{
        type: "file" | "env" | "env_secret";
        file_id?: string;
        mount_path?: string;
        name?: string;
        value?: string;
      }>;
    }>();

    const agentId = typeof body.agent === "string" ? body.agent : body.agent?.id;
    const wrappedEnv =
      typeof body.environment === "string" ? body.environment : body.environment?.id;
    if (!agentId) return c.json({ error: "agent is required" }, 400);

    const agentRow = await services.agents.get({ userId: t, agentId });
    if (!agentRow) return c.json({ error: "Agent not found" }, 404);

    const agentIsLocalRuntime = true;

    let envId = body.environment_id ?? wrappedEnv;
    if (!envId) {
      if (!agentIsLocalRuntime) {
        return c.json({ error: "environment_id is required for cloud agents" }, 400);
      }
      envId = deps.localRuntimeEnvId ?? "env_local_runtime";
    }

    const { user_id: _atid, ...agentSnapshot } = agentRow;
    const envSnap = deps.loadEnvironment
      ? await deps.loadEnvironment({ userId: t, environmentId: envId })
      : null;
    if (deps.loadEnvironment && !envSnap) {
      return c.json({ error: "Environment not found" }, 404);
    }
    if (agentIsLocalRuntime && envSnap && !isLocalRuntimeEnvironment(envSnap)) {
      return c.json({ error: "environment_not_supported", environment_id: envId }, 501);
    }
    // Build initial resource inputs (non-file).
    const nonFileInputs: Array<{
      type: "env";
      [k: string]: unknown;
    }> = [];
    for (const res of body.resources ?? []) {
      if ((res.type === "env" || res.type === "env_secret") && res.name && res.value) {
        nonFileInputs.push({ type: "env", name: res.name });
      }
    }

    let session;
    let createdResources: Array<{ id: string; type: string; resource: SessionResource }>;
    try {
      const result = await services.sessions.create({
        userId: t,
        agentId,
        environmentId: envId,
        title: body.title ?? "",
        agentSnapshot: agentSnapshot as AgentConfig,
        environmentSnapshot: envSnap ?? undefined,
        resources: nonFileInputs as never,
      });
      session = result.session;
      createdResources = result.resources as never;
    } catch (err) {
      return mapSessionError(c, err);
    }
    const sessionId = session.id;

    // Init the runtime layer (DO PUT /init or Node warm + init events).
    const initParams: SessionInitParams = {
      agentId,
      environmentId: envId,
      title: body.title ?? "",
      userId: t,
      agentSnapshot: agentSnapshot as AgentConfig,
      environmentSnapshot: envSnap ?? undefined,
    };
    await router.init(sessionId, initParams).catch((err) => {
      console.warn(`[sessions] router.init failed for ${sessionId}:`, err);
    });

    // File resource cloning (per-session R2 copy / FS link).
    if (deps.lifecycle?.cloneSessionFile) {
      for (const res of body.resources ?? []) {
        if (res.type === "file" && res.file_id) {
          const cloned = await deps.lifecycle.cloneSessionFile({
            userId: t,
            sessionId,
            sourceFileId: res.file_id,
          });
          if (cloned) {
            try {
              const added = await services.sessions.addResource({
                userId: t,
                sessionId,
                resource: {
                  type: "file",
                  file_id: cloned.fileId,
                  mount_path: res.mount_path,
                } as never,
              });
              createdResources.push(added as never);
            } catch (err) {
              return mapSessionError(c, err);
            }
          }
        }
      }
    }

    const response: Record<string, unknown> = { ...toApiSession(session as never) };
    if (createdResources.length > 0) {
      response.resources = createdResources.map((r) => r.resource);
    }
    return c.json(response, 201);
  });

  // ── List / Get / Update / Archive / Delete ────────────────────────────
  app.get("/", async (c) => {
    const services = resolveServices(deps.services, c);
    const agentIdFilter = c.req.query("agent_id") || undefined;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
    const cursor = c.req.query("cursor") ?? c.req.query("page");
    const q = c.req.query("q") ?? undefined;
    const includeArchived = c.req.query("include_archived") === "true";

    // status: session lifecycle filter (idle | running | rescheduling |
    // terminated). Whitelist strictly — unknown value is a 400, NOT a
    // silent fallback. Mirrors the agents-route pattern; allowing arbitrary
    // strings here would mask client bugs.
    const statusRaw = c.req.query("status");
    let status: "idle" | "running" | "rescheduling" | "terminated" | undefined;
    if (statusRaw !== undefined) {
      if (
        statusRaw === "idle" ||
        statusRaw === "running" ||
        statusRaw === "rescheduling" ||
        statusRaw === "terminated"
      ) {
        status = statusRaw;
      } else {
        return c.json(
          {
            error: {
              type: "invalid_request_error",
              code: "invalid_status",
              message: `Invalid status '${statusRaw}'; expected one of idle|running|rescheduling|terminated.`,
            },
          },
          400,
        );
      }
    }

    const page = await services.sessions.listPage({
      userId: c.var.user_id,
      agentId: agentIdFilter,
      limit,
      cursor: cursor ?? undefined,
      includeArchived,
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
    });
    return c.json({
      data: page.items.map((row) => toApiSession(row as never)),
      ...(page.nextCursor ? { next_page: page.nextCursor, next_cursor: page.nextCursor } : {}),
    });
  });

  app.get("/:id", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const response: Record<string, unknown> = { ...toApiSession(sess as never) };
    const live = await router.getFullStatus(id);
    if (live) {
      response.status = live.status;
      response.usage = live.usage;
      if (live.resources) response.resources = live.resources;
    }
    return c.json(response);
  });

  app.post("/:id/archive", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      const sess = await services.sessions.archive({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
      });
      return c.json(toApiSession(sess as never));
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.post("/:id", async (c) => {
    const services = resolveServices(deps.services, c);
    const body = await c.req.json<{
      title?: string;
      metadata?: Record<string, unknown>;
    }>();
    try {
      const updated = await services.sessions.update({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
        title: body.title,
        metadata: body.metadata,
      });
      return c.json(toApiSession(updated as never));
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.delete("/:id", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const t = c.var.user_id;
    const sess = await services.sessions.get({ userId: t, sessionId: id });
    if (!sess) return c.json({ error: "Session not found" }, 404);

    // Best-effort runtime teardown — never blocks the row delete.
    await router.destroy(id).catch(() => undefined);

    try {
      await services.sessions.delete({ userId: t, sessionId: id });
    } catch (err) {
      return mapSessionError(c, err);
    }

    if (deps.lifecycle?.cascadeDeleteFiles) {
      await deps.lifecycle
        .cascadeDeleteFiles({ userId: t, sessionId: id })
        .catch((err) => console.warn("[sessions] cascade-delete failed:", err));
    }

    return c.json({ type: "session_deleted", id });
  });

  // ── Events ────────────────────────────────────────────────────────────
  app.post("/:id/events", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const t = c.var.user_id;
    const sess = await services.sessions.get({ userId: t, sessionId: id });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    if ((sess as unknown as { archived_at?: string | null }).archived_at) {
      return c.json({ error: "Session is archived and cannot receive new events" }, 409);
    }
    const body = await c.req.json<{ events: SessionEvent[] }>();
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: "events array is required" }, 400);
    }
    for (const ev of body.events) {
      if (!ALLOWED_EVENT_TYPES.has(ev.type)) {
        return c.json({ error: `Unsupported event type: ${ev.type}` }, 400);
      }
    }

    for (const ev of body.events) {
      let outgoing: SessionEvent = ev;
      if (
        (ev.type === "user.message" || ev.type === "user.custom_tool_result") &&
        deps.lifecycle?.resolveFileIds
      ) {
        const e = ev as { content?: ContentBlock[] };
        if (Array.isArray(e.content)) {
          try {
            const { blocks, mountFileIds } = await deps.lifecycle.resolveFileIds({
              userId: t,
              blocks: e.content,
            });
            outgoing = {
              ...ev,
              content: blocks,
              ...(mountFileIds.length > 0 ? { _mount_file_ids: mountFileIds } : {}),
            } as SessionEvent;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return c.json({ error: `file_id resolution failed: ${msg}` }, 400);
          }
        }
      }
      const result = await router.appendEvent(id, outgoing);
      if (result.status >= 400) {
        return new Response(result.body, {
          status: result.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return c.body(null, 202);
  });

  // ── Messages convenience (one-shot user.message + stream) ─────────────
  app.post("/:id/messages", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const t = c.var.user_id;
    const sess = await services.sessions.get({ userId: t, sessionId: id });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const body = await c.req
      .json<{ content: string | ContentBlock[] }>()
      .catch(() => ({ content: "" as string | ContentBlock[] }));
    const content: ContentBlock[] = typeof body.content === "string"
      ? [{ type: "text", text: body.content } as ContentBlock]
      : Array.isArray(body.content) ? body.content : [];
    if (content.length === 0) {
      return c.json({ error: "content is required (string or ContentBlock[])" }, 400);
    }
    const userMessageId = generateEventId();
    const ev = {
      type: "user.message",
      id: userMessageId,
      content,
    } as unknown as UserMessageEvent;

    // /messages is OMA-only sugar (Anthropic spec doesn't have it). Always
    // open the underlying stream with chunks admitted so the in-turn matcher
    // below sees the full chunk lifecycle and the SDK's onText/onThinking
    // hooks fire. **Open the stream BEFORE appending the user.message** —
    // post-stream-split the default streamEvents doesn't replay history,
    // so a user.message broadcast before the stream attaches would be
    // lost and inTurn would never trigger.
    const handle = await router.streamEvents(id, { include: ["chunks"] });
    const append = await router.appendEvent(id, ev);
    if (append.status >= 400) {
      handle.close();
      return new Response(append.body, {
        status: append.status,
        headers: { "content-type": "application/json" },
      });
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let inTurn = false;
        let closed = false;
        const closeOnce = () => {
          if (closed) return;
          closed = true;
          handle.close();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        try {
          for await (const frame of handle) {
            let parsed: { type?: string; id?: string } | null = null;
            try {
              parsed = JSON.parse(frame.data) as { type?: string; id?: string };
            } catch {
              /* ignore */
            }
            // Same SSE-named-event format as openSse() — Anthropic SDKs
            // discriminate on the SSE event name field, not on data.type.
            const eventLine = parsed?.type ? `event: ${parsed.type}\n` : "";
            if (!inTurn) {
              if (parsed?.type === "user.message" && parsed.id === userMessageId) {
                inTurn = true;
                controller.enqueue(enc.encode(`${eventLine}data: ${frame.data}\n\n`));
              }
              continue;
            }
            controller.enqueue(enc.encode(`${eventLine}data: ${frame.data}\n\n`));
            if (parsed?.type === "session.status_idle") {
              closeOnce();
              return;
            }
          }
        } finally {
          closeOnce();
        }
      },
      cancel: () => handle.close(),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  app.get("/:id/events", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const accept = c.req.header("Accept") || "";
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    if (accept.includes("text/event-stream")) {
      return openSse(c, router, id);
    }
    const after = c.req.query("after_seq");
    const limit = c.req.query("limit");
    const order = c.req.query("order") as "asc" | "desc" | undefined;
    const page = await router.getEvents(id, {
      afterSeq: after !== undefined ? Number(after) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      order,
    });
    return c.json(page);
  });

  app.get("/:id/stream", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    return openSse(c, router, id);
  });

  app.get("/:id/events/stream", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    return openSse(c, router, id);
  });

  // ── Trajectory ────────────────────────────────────────────────────────
  app.get("/:id/trajectory", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    try {
      const trajectory = await router.getTrajectory(sess as never, {
        fetchEnvironmentConfig: () =>
          deps.loadEnvironment
            ? deps.loadEnvironment({
                userId: c.var.user_id,
                environmentId: (sess as unknown as { environment_id: string }).environment_id,
              })
            : Promise.resolve(null),
      });
      return c.json(trajectory);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // ── Pending events (AMA) ──────────────────────────────────────────────
  // GET /v1/sessions/:id/pending — list user.* events enqueued but not
  // yet drained by the harness. Forwards opaque query string (?session_
  // thread_id, ?include_cancelled) to the SessionRouter.
  app.get("/:id/pending", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const userId = c.var.user_id;
    const sessionId = c.req.param("id");
    const sess = await services.sessions.get({ userId, sessionId });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const url = new URL(c.req.url);
    const result = await router.getPending(sessionId, { rawSearch: url.search });
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  });

  // ── Debug recovery ────────────────────────────────────────────────────
  app.post("/:id/__debug_recovery__", async (c) => {
    if (!deps.debugRecoveryToken) return c.json({ error: "not found" }, 404);
    const provided =
      c.req.header("x-debug-token") ??
      (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (provided !== deps.debugRecoveryToken) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const r = await router.triggerDebugRecovery(id, provided);
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  });

  // ── Exec ──────────────────────────────────────────────────────────────
  app.post("/:id/exec", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const body = await c.req
      .json<{ command: string; timeout_ms?: number }>()
      .catch(() => ({ command: "" }));
    if (!body.command) return c.json({ error: "command is required" }, 400);
    try {
      const r = await router.exec(id, body);
      return c.json(r);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ── Files (sandbox path → file_id promotion) ──────────────────────────
  app.post("/:id/files", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const t = c.var.user_id;
    const sess = await services.sessions.get({ userId: t, sessionId: id });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json<{
      path: string;
      filename?: string;
      media_type?: string;
      downloadable?: boolean;
    }>();
    if (!body.path) return c.json({ error: "path is required" }, 400);
    if (!deps.lifecycle?.promoteSandboxFile) {
      return c.json({ error: "filesBlob not configured on this server" }, 500);
    }
    const buf = await router.readSandboxFile(id, body.path);
    if (!buf) return c.json({ error: "Cannot read sandbox path" }, 400);
    const filename = body.filename || body.path.split("/").pop() || "file";
    const ext = filename.toLowerCase().split(".").pop() || "";
    const guess: Record<string, string> = {
      pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown",
      csv: "text/csv", json: "application/json",
    };
    const mediaType = body.media_type || guess[ext] || "application/octet-stream";
    const downloadable = body.downloadable === undefined ? true : body.downloadable === true;
    const row = await deps.lifecycle.promoteSandboxFile({
      userId: t,
      sessionId: id,
      sandboxPath: body.path,
      filename,
      mediaType,
      downloadable,
      bytes: buf,
    });
    return c.json(row, 201);
  });

  // ── Resources ─────────────────────────────────────────────────────────
  app.post("/:id/resources", async (c) => {
    const services = resolveServices(deps.services, c);
    const sessionId = c.req.param("id");
    const t = c.var.user_id;
    const body = await c.req.json<{
      type: "file";
      file_id?: string;
      mount_path?: string;
    }>();
    if (!body.type) return c.json({ error: "type is required" }, 400);
    if (body.type === "file") {
      if (!body.file_id) return c.json({ error: "file_id is required for file resources" }, 400);
    }
    try {
      let fileId = body.file_id;
      if (body.type === "file" && body.file_id && deps.lifecycle?.fileExists) {
        const exists = await deps.lifecycle.fileExists({
          userId: t,
          fileId: body.file_id,
        });
        if (!exists) return c.json({ error: "File not found" }, 404);
      }
      const added = await services.sessions.addResource({
        userId: t,
        sessionId,
        resource: {
          type: body.type,
          file_id: fileId,
          mount_path: body.mount_path,
        } as never,
      });
      return c.json(added.resource, 201);
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.get("/:id/resources", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      const rs = await services.sessions.listResources({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
      });
      return c.json({ data: rs.map((r) => r.resource) });
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.get("/:id/resources/:resource_id", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      const row = await services.sessions.getResource({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
        resourceId: c.req.param("resource_id"),
      });
      if (!row) return c.json({ error: "Resource not found" }, 404);
      return c.json(row.resource);
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.post("/:id/resources/:resource_id", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      const body = await c.req.json<SessionResource>();
      if (!body || typeof body !== "object" || !body.type) {
        return c.json({ error: "resource body with `type` field is required" }, 400);
      }
      const row = await services.sessions.updateResource({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
        resourceId: c.req.param("resource_id"),
        resource: body,
      });
      return c.json(row.resource);
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  app.delete("/:id/resources/:resource_id", async (c) => {
    const services = resolveServices(deps.services, c);
    try {
      await services.sessions.deleteResource({
        userId: c.var.user_id,
        sessionId: c.req.param("id"),
        resourceId: c.req.param("resource_id"),
      });
      return c.json({ type: "resource_deleted", id: c.req.param("resource_id") });
    } catch (err) {
      return mapSessionError(c, err);
    }
  });

  // ── Threads ───────────────────────────────────────────────────────────
  app.get("/:id/threads", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const list = await router.listThreads(id);
    return c.json(list);
  });

  app.get("/:id/threads/:thread_id", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const r = await router.getThread(id, c.req.param("thread_id"));
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  });

  app.post("/:id/threads/:thread_id/archive", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const r = await router.archiveThread(id, c.req.param("thread_id"));
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  });

  app.get("/:id/threads/:thread_id/events", async (c) => {
    const services = resolveServices(deps.services, c);
    const router = resolveRouter(deps.router, c);
    const id = c.req.param("id");
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const after = c.req.query("after_seq");
    const limit = c.req.query("limit");
    const page = await router.getThreadEvents(id, c.req.param("thread_id"), {
      afterSeq: after !== undefined ? Number(after) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    return c.json(page);
  });

  app.get("/:id/threads/:thread_id/stream", (c) =>
    openSse(c, resolveRouter(deps.router, c), c.req.param("id"), c.req.param("thread_id")),
  );
  app.get("/:id/threads/:thread_id/events/stream", (c) =>
    openSse(c, resolveRouter(deps.router, c), c.req.param("id"), c.req.param("thread_id")),
  );

  // ── Outputs (R2 / local FS — adapter-driven) ──────────────────────────
  app.get("/:id/outputs", async (c) => {
    if (!deps.outputs) return c.json({ data: [], has_more: false });
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const t = c.var.user_id;
    const sess = await services.sessions.get({ userId: t, sessionId: id });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const data = await deps.outputs.list(t, id);
    return c.json({ data: data ?? [], has_more: false });
  });

  app.get("/:id/outputs/:filename", async (c) => {
    if (!deps.outputs) return c.json({ error: "outputs not configured" }, 404);
    const services = resolveServices(deps.services, c);
    const id = c.req.param("id");
    const filename = c.req.param("filename");
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return c.json({ error: "Invalid filename" }, 400);
    }
    const sess = await services.sessions.get({
      userId: c.var.user_id,
      sessionId: id,
    });
    if (!sess) return c.json({ error: "Session not found" }, 404);
    const obj = await deps.outputs.read(c.var.user_id, id, filename);
    if (!obj) return c.json({ error: "Output file not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.contentType,
        "Content-Length": String(obj.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // Re-export utility imports referenced only when no path hits — keeps
  // the bundler from tree-shaking shared/file-storage symbols that
  // CF callers expect at runtime.
  void generateFileId;
  void guessSessionOutputMime;
  void nanoid;

  return app;
}

async function openSse(
  c: Context<Vars>,
  router: SessionRouter,
  sessionId: string,
  threadId?: string,
): Promise<Response> {
  const lastEventId = parseInt(c.req.header("Last-Event-ID") ?? "", 10);
  // Spec-vs-extension opt-in (default = Anthropic-spec wire behavior):
  //   ?include=chunks  → admit OMA extension events (chunks, lifecycle,
  //                      system.*, session.warning, extra spans)
  //   ?replay=1        → replay full persisted history before tailing
  //                      (Last-Event-ID also implies replay-from-seq, so
  //                      callers can resume cleanly without flag awareness)
  // See SPEC_EVENT_TYPES in @open-managed-agents/api-types for the spec set.
  const include = (c.req.query("include") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const replay = c.req.query("replay") === "1";
  const handle = await router.streamEvents(sessionId, {
    threadId,
    lastEventId: Number.isFinite(lastEventId) ? lastEventId : undefined,
    replay,
    include,
  });
  const enc = new TextEncoder();
  let closed = false;
  const closeHandle = () => {
    if (closed) return;
    closed = true;
    handle.close();
  };
  const safeEnqueue = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: string) => {
    if (closed) return false;
    try {
      controller.enqueue(enc.encode(chunk));
      return true;
    } catch {
      closeHandle();
      return false;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!safeEnqueue(controller, "retry: 1000\n\n")) return;
        for await (const frame of handle) {
          let seq: number | undefined;
          let evType: string | undefined;
          try {
            const parsed = JSON.parse(frame.data) as { seq?: number; type?: string };
            seq = parsed.seq;
            evType = parsed.type;
          } catch {
            /* ignore */
          }
          // Emit SSE-named events ("event: <type>") in addition to the
          // data line. Anthropic's official SDKs use the SSE event-name
          // field as the discriminator (see anthropic-sdk-python
          // _streaming.py:84-130) and never yield frames where it's
          // missing — without this line the SDK's iterator hangs forever
          // even though the wire is delivering events.
          const eventLine = evType ? `event: ${evType}\n` : "";
          const idLine = seq !== undefined ? `id: ${seq}\n` : "";
          if (!safeEnqueue(controller, `${eventLine}${idLine}data: ${frame.data}\n\n`)) return;
        }
      } finally {
        closeHandle();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel: () => closeHandle(),
  });
  c.req.raw.signal?.addEventListener("abort", () => closeHandle());
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
