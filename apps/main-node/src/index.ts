/**
 * apps/main-node — self-host Node entry for the Open Managed Agents API.
 *
 * Wiring file: build the core services, mount the Anthropic-compatible routes,
 * and start the local trusted subprocess runtime.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  createNodeLogger,
} from "@open-managed-agents/observability/logger/node";
import {
  createNodeMetricsRecorder,
  type NodeMetricsHandle,
} from "@open-managed-agents/observability/metrics/node";
import {
  createNodeTracer,
  type NodeTracerHandle,
} from "@open-managed-agents/observability/tracer/node";
import {
  requestMetrics,
  tracerMiddleware,
  setRootLogger,
  type Logger,
} from "@open-managed-agents/observability";
import {
  createBetterSqlite3SqlClient,
  createPostgresSqlClient,
  type SqlClient,
} from "@open-managed-agents/sql-client";
import { createSqliteAgentService } from "@open-managed-agents/agents-store";
import {
  type BlobStore,
} from "@open-managed-agents/blob-store";
import { LocalFsBlobStore as FilesLocalFsBlobStore } from "@open-managed-agents/blob-store/adapters/local-fs";
import { createSqliteSessionService } from "@open-managed-agents/sessions-store";
import { createSqliteFileService } from "@open-managed-agents/files-store";
import {
  createSqliteEnvironmentService,
  toEnvironmentConfig,
} from "@open-managed-agents/environments-store";
import { createSqliteModelCardService } from "@open-managed-agents/model-cards-store";
import { SqlSkillService } from "@open-managed-agents/skills-store";
import { SELF_HOST_SKILLS_SCHEMA_SQL } from "@open-managed-agents/db-schema/node-sqlite";
import { toFileRecord } from "@open-managed-agents/files-store";
import { SqlEventLog, SqlPendingQueue } from "@open-managed-agents/event-log/sql";
import type { SessionEvent } from "@open-managed-agents/shared";
import { generateEventId } from "@open-managed-agents/shared";
import { DefaultHarness } from "@open-managed-agents/agent/harness/default-loop";
import { buildTools } from "@open-managed-agents/agent/harness/tools";
import { composeSystemPrompt } from "@open-managed-agents/agent/harness/platform-guidance";
import type { HarnessContext } from "@open-managed-agents/agent/harness/interface";
import { applyBetterAuthSchema } from "@open-managed-agents/schema";
import { ensureSchema as ensureEventLogSchema } from "@open-managed-agents/event-log/sql";
import {
  buildAgentRoutes,
  buildSessionRoutes,
  buildModelCardRoutes,
  buildEnvironmentRoutes,
  buildSkillRoutes,
  type RouteServices,
} from "@open-managed-agents/http-routes";
import { WebCryptoAesGcm } from "./lib/web-crypto-aes-gcm.js";
import { NodeSessionRouter } from "./lib/node-session-router.js";
import { nodeOutputsAdapter } from "./lib/node-outputs-adapter.js";
import { nodeSessionLifecycle } from "./lib/node-session-lifecycle.js";
import { buildNodeFileRoutes } from "./lib/node-file-routes.js";
import { NodeWorkspaceBackupService } from "./lib/node-workspace-backup.js";
import { DefaultSandboxOrchestrator } from "@open-managed-agents/sandbox/orchestrator";
import { createAuthMiddleware as buildAuthMw } from "@open-managed-agents/auth";
import {
  buildBetterAuth,
  ensureTenantSqlite,
} from "@open-managed-agents/auth-config";
import { SqlKvStore } from "@open-managed-agents/kv-store/adapters/sql";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import {
  InProcessEventStreamHub,
  type EventStreamHub,
} from "./lib/event-stream-hub";
import { PgEventStreamHub } from "./lib/pg-event-stream-hub";
import { NodeHarnessRuntime } from "./lib/node-harness-runtime";
import { SessionRegistry } from "./registry.js";
import { NodeModelResolver } from "./lib/node-model-resolver.js";
import { WorkerPool } from "./lib/worker-pool.js";

// ─── Observability bootstrap ─────────────────────────────────────────────
//
// Logger is constructed first so every later step can use it instead of
// raw console.*. Metrics + tracer follow; both are no-ops by default and
// only spin up real backends when the env opts in.
//   - Prometheus metrics: always-on in-process registry; /metrics text
//     endpoint mounted below.
//   - OTel tracing: starts only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
const logger: Logger = await createNodeLogger({
  bindings: { service: "main-node", pid: process.pid },
});
setRootLogger(logger);

const metrics: NodeMetricsHandle = await createNodeMetricsRecorder();
const tracer: NodeTracerHandle = await createNodeTracer({
  serviceName: "oma-main-node",
});

// ─── Bootstrap ───────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? "";
const usePostgres = dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");
const dialect = usePostgres ? "postgres" : "sqlite";

let sql: SqlClient;
let backendDescription: string;
// drizzleDb is the dependency-inversion seam new-style adapters take.
// Constructed once at the composition root from the right concrete driver.
// Existing SqlClient is still built alongside for the legacy SQL adapters
// that have not yet moved to the Drizzle dependency-inversion seam.
import type { OmaDb } from "@open-managed-agents/db-schema";
let drizzleDb: OmaDb<Record<string, unknown>>;
if (usePostgres) {
  sql = await createPostgresSqlClient(dbUrl);
  const { drizzle: drizzlePostgresJs } = await import("drizzle-orm/postgres-js");
  const postgresMod = (await import("postgres" as string)) as { default: (dsn: string) => unknown };
  const pgClient = postgresMod.default(dbUrl);
  drizzleDb = drizzlePostgresJs(pgClient as never) as unknown as OmaDb<Record<string, unknown>>;
  const u = new URL(dbUrl);
  backendDescription = `postgres ${u.hostname}:${u.port || 5432}${u.pathname}`;
} else {
  const dbPath = process.env.DATABASE_PATH ?? "./data/oma.db";
  mkdirSync(dirname(dbPath), { recursive: true });
  sql = await createBetterSqlite3SqlClient(dbPath);
  const { drizzle: drizzleBetterSqlite3 } = await import("drizzle-orm/better-sqlite3");
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const sqliteRaw = new BetterSqlite3(dbPath);
  // Match D1's runtime default — FK enforcement off. See packages/sql-client
  // for the rationale (publication-first install + a few other paths).
  sqliteRaw.exec("PRAGMA foreign_keys = OFF");
  drizzleDb = drizzleBetterSqlite3(sqliteRaw) as unknown as OmaDb<Record<string, unknown>>;
  backendDescription = `sqlite ${dbPath}`;
}

// Apply the consolidated baseline (Drizzle migrate runner — one folder per
// dialect, generated by `pnpm db:generate:node-{pg,sqlite}`). Replaces the
// pre-Drizzle applySchema / applyTenantSchema /
// applyMemoryPollerSchema chain — those creator functions hand-wrote
// CREATE TABLE IF NOT EXISTS and ad-hoc ALTER backfills, which had been
// drifting from the canonical CF migration files.
//
// session_events (event-log) is still its own concern: its idempotent
// ensureSchema lives in @open-managed-agents/event-log/sql and runs after
// the baseline migration applies the rest.
const migrationsFolder = usePostgres
  ? fileURLToPath(new URL("../migrations", import.meta.url))
  : fileURLToPath(new URL("../migrations-sqlite", import.meta.url));
if (usePostgres) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(drizzleDb as never, { migrationsFolder });
} else {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  migrate(drizzleDb as never, { migrationsFolder });
}
await ensureEventLogSchema(sql, dialect);
await sql.exec(SELF_HOST_SKILLS_SCHEMA_SQL);
const pendingQueue = new SqlPendingQueue(sql, dialect);

// PLATFORM_ROOT_SECRET is used only for at-rest encryption of self-host
// credentials and Model Card keys. Integrations are not part of this runtime
// or its database baseline.
const platformRootSecret = process.env.PLATFORM_ROOT_SECRET;

// ─── Auth ───────────────────────────────────────────────────────────────

const authDisabled = process.env.AUTH_DISABLED === "1";
const authDbPath = process.env.AUTH_DATABASE_PATH ?? "./data/auth.db";

let auth: ReturnType<typeof buildBetterAuth> | null = null;
let authShutdown: (() => Promise<void>) | null = null;

if (!authDisabled) {
  if (usePostgres) {
    const { Pool } = (await import("pg")) as typeof import("pg");
    const pgPool = new Pool({ connectionString: dbUrl });
    await applyBetterAuthSchema({ sql, dialect: "postgres" });
    auth = buildBetterAuth({
      database: pgPool,
      secret: process.env.BETTER_AUTH_SECRET ?? randomFallback(),
      baseURL: process.env.PUBLIC_BASE_URL,
      cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
      ensureTenant: (u) => ensureTenantSqlite(sql, u.id, u.name, u.email),
    });
    authShutdown = async () => {
      await pgPool.end();
    };
  } else {
    mkdirSync(dirname(authDbPath), { recursive: true });
    const BetterSqlite3 = (await import("better-sqlite3")).default;
    const authDb = new BetterSqlite3(authDbPath);
    // Run the better-auth schema on the auth db via a thin SqlClient shim —
    // applyBetterAuthSchema only uses sql.exec which maps cleanly.
    await applyBetterAuthSchema({
      sql: betterSqliteAsSqlClient(authDb),
      dialect: "sqlite",
    });
    auth = buildBetterAuth({
      database: authDb,
      secret: process.env.BETTER_AUTH_SECRET ?? randomFallback(),
      baseURL: process.env.PUBLIC_BASE_URL,
      cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
      ensureTenant: (u) => ensureTenantSqlite(sql, u.id, u.name, u.email),
    });
    authShutdown = async () => {
      authDb.close();
    };
  }
}

// ─── Stores ─────────────────────────────────────────────────────────────

const agentsService = createSqliteAgentService({ db: drizzleDb });
const sessionsService = createSqliteSessionService({ db: drizzleDb });
const filesService = createSqliteFileService({ db: drizzleDb });
const environmentsService = createSqliteEnvironmentService({ db: drizzleDb });
const modelCardsService = createSqliteModelCardService(
  { db: drizzleDb },
  {
    crypto: platformRootSecret
      ? new WebCryptoAesGcm(platformRootSecret, "model-cards.api-keys")
      : undefined,
  },
);
const modelResolver = new NodeModelResolver(modelCardsService, {
  // Self-host model credentials come from tenant-scoped Model Cards. Do not
  // silently fall back to a process-global .env key.
  allowEnvironmentFallback: false,
});

const workerPool = new WorkerPool({
  maxActive: Math.max(1, Number(process.env.WORKER_MAX_ACTIVE ?? 4) || 4),
  tenantMaxActive: Math.max(1, Number(process.env.TENANT_MAX_ACTIVE ?? 2) || 2),
  timeoutMs: Math.max(0, Number(process.env.TURN_TIMEOUT_MS ?? 0) || 0) || undefined,
  onEvent: (event) => {
    metrics.counter("oma_worker_events_total", 1, { type: event.type });
    metrics.histogram("oma_worker_turn_duration_seconds", event.durationMs / 1000, { type: event.type });
  },
});

const outputsRoot = process.env.SESSION_OUTPUTS_DIR ?? "./data/session-outputs";
mkdirSync(outputsRoot, { recursive: true });

// ─── Files-store blob backend ────────────────────────────────────────
//
// Files and workspace backups use one local filesystem blob store.
const filesBlobDir = process.env.FILES_BLOB_DIR ?? "./data/files-blobs";
mkdirSync(filesBlobDir, { recursive: true });
const filesBlob: BlobStore = new FilesLocalFsBlobStore({ baseDir: filesBlobDir });

const skillsService = new SqlSkillService(sql, filesBlob);

const workspaceBackups = new NodeWorkspaceBackupService({
  sql,
  blobs: filesBlob,
});

const sandboxOrchestrator = new DefaultSandboxOrchestrator({
  backups: workspaceBackups,
});

// ─── Hub + event log ────────────────────────────────────────────────────

function newEventLog(sessionId: string): SqlEventLog {
  return new SqlEventLog(sql, sessionId, (e) => {
    const ev = e as SessionEvent & { id?: string; processed_at?: string };
    if (!ev.id) ev.id = `sevt_${generateEventId()}`;
    if (!ev.processed_at) ev.processed_at = new Date().toISOString();
  });
}

let hub: EventStreamHub;
if (usePostgres) {
  hub = await PgEventStreamHub.create({
    dsn: dbUrl,
    fetchEventsAfter: (sid, afterSeq) => newEventLog(sid).getEventsAsync(afterSeq),
  });
} else {
  hub = new InProcessEventStreamHub();
}

// ─── Sandbox factory ────────────────────────────────────────────────────

import { sandboxFactory } from "@open-managed-agents/sandbox/adapters/local-subprocess";

async function buildSandbox(
  sessionId: string,
  workdir: string,
): Promise<import("@open-managed-agents/sandbox").SandboxExecutor> {
  const provider = (process.env.SANDBOX_PROVIDER ?? "subprocess").toLowerCase();
  if (provider !== "subprocess") {
    throw new Error("sandbox_provider_not_supported: only subprocess is available");
  }
  return sandboxFactory(
    {
      sessionId,
      workdir,
      sharedWorkspace: true,
      outputsRoot,
    },
    process.env,
  );
}

// ─── Session registry ───────────────────────────────────────────────────

const sessionRegistry = new SessionRegistry({
  sql,
  hub,
  agentsService,
  skillsService,
  sandboxOrchestrator,
  newEventLog,
  buildSandbox,
  sandboxWorkdirRoot: process.env.SANDBOX_WORKDIR ?? "./data/sandboxes",
  sqlDialect: dialect,
  pendingQueue,
  workerPool,
  buildModel: (agent, tenantId) => {
    if (!tenantId) throw new Error("tenantId required for model resolution");
    return modelResolver.resolve({ tenantId, agent }).then((result) => result.model);
  },
  buildTools: async (agent, sandbox, tenantId, options) => {
    if (!tenantId) throw new Error("tenantId required for model resolution");
    return buildTools(agent, sandbox, {
      allowAlwaysAsk: options?.allowAlwaysAsk,
    });
  },
  buildHarness: () => {
    const h = new DefaultHarness();
    return { run: (ctx: unknown) => h.run(ctx as HarnessContext) };
  },
  buildHarnessContext: async (input) => {
    if (!input.tenantId) throw new Error("tenantId required for model resolution");
    const credentials = await modelResolver.resolveCredentials({
      tenantId: input.tenantId,
      agent: input.agent,
    });
    const runtime = new NodeHarnessRuntime({
      sessionId: input.sessionId,
      log: input.eventLog,
      hub,
      sandbox: input.sandbox,
      abortSignal: input.abortSignal,
    });
    await runtime.refreshHistory();
    const rawSystemPrompt = input.agent.system ?? "";
    return {
      agent: input.agent,
      userMessage: input.userMessage,
      session_id: input.sessionId,
      tools: input.tools as HarnessContext["tools"],
      model: input.model,
      systemPrompt: composeSystemPrompt(rawSystemPrompt),
      rawSystemPrompt,
      env: {
        ANTHROPIC_API_KEY: credentials.apiKey,
        ANTHROPIC_BASE_URL: credentials.baseUrl,
      },
      runtime,
    } satisfies HarnessContext;
  },
});

await sessionRegistry.bootstrap();

// ─── Services bundle ────────────────────────────────────────────────────

const kvForTenant = (tenantId: string) =>
  new SqlKvStore({ db: drizzleDb, tenantId });
const kv = kvForTenant("default");

const services: RouteServices = {
  sql,
  agents: agentsService,
  sessions: sessionsService,
  kv,
  kvForTenant,
  newEventLog,
  hub: {
    publish: (sid, ev) => hub.publish(sid, ev as SessionEvent),
    attach: (sid, writer) => hub.attach(sid, writer),
  },
  sessionRegistry: {
    enqueueUserMessage: (sid, tenantId, agentId, ev) => {
      void sessionRegistry
        .getOrCreate(sid, tenantId)
        .then((entry) =>
          entry.machine.runHarnessTurn(agentId, ev as import("@open-managed-agents/shared").UserMessageEvent),
        )
        .catch((err) => {
          logger.error(
            { err, op: "session.harness_turn.failed", session_id: sid, agent_id: agentId },
            "harness turn failed",
          );
          void newEventLog(sid).appendAsync({
            type: "session.error",
            error: "harness_turn_failed",
            message: err instanceof Error ? err.message : String(err),
          } as unknown as SessionEvent);
        });
    },
    interrupt: (sid) => {
      sessionRegistry.interrupt?.(sid);
    },
  },
  background: {
    run: (p) => {
      void p.catch((err) =>
        logger.error({ err, op: "main-node.background.failed" }, "background task failed"),
      );
    },
  },
  outputsRoot,
  logger,
  metrics,
  tracer,
};

// ─── Existing API-key resolution ───────────────────────────────────────
// API-key management is intentionally not exposed by the slim self-host
// surface, but already-issued keys remain valid for SDK/CLI clients.
const apiKeyStorage = {
  async findByHash(hash: string) {
    const row = await sql
      .prepare(
        `SELECT id, tenant_id, user_id, name, created_at FROM api_keys
          WHERE hash = ? AND revoked_at IS NULL`,
      )
      .bind(hash)
      .first<{
        id: string;
        tenant_id: string;
        user_id: string | null;
        name: string;
        created_at: number;
      }>();
    if (!row) return null;
    const rec = {
      id: row.id,
      tenant_id: row.tenant_id,
      ...(row.user_id ? { user_id: row.user_id } : {}),
      name: row.name,
      created_at: new Date(row.created_at).toISOString(),
    };
    return rec;
  },
};

// ─── HTTP ───────────────────────────────────────────────────────────────

const app = new Hono<{
  Variables: { tenant_id: string; user_id?: string };
}>();

// Observability middleware first so it captures auth failures, rate-limit
// rejects, and unhandled exceptions. Mirrors apps/main's CF wiring.
app.use("*", requestMetrics({ recorder: metrics }));
app.use("*", tracerMiddleware({ tracer }));

// Prometheus scrape endpoint. When METRICS_BIND_TOKEN is set, callers must
// pass it in `x-metrics-token`; absent, the endpoint is open on the same
// port (acceptable for self-host single-operator deploys, documented in
// .env.example). For prod, ops should either set the token or front the
// app with a reverse proxy that filters /metrics.
const metricsToken = process.env.METRICS_BIND_TOKEN;
app.get("/metrics", async (c) => {
  if (metricsToken && c.req.header("x-metrics-token") !== metricsToken) {
    return c.text("forbidden", 403);
  }
  const text = await metrics.getPromText();
  return new Response(text, {
    headers: { "Content-Type": metrics.promContentType() },
  });
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    runtime: "node",
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    auth: authDisabled
      ? "disabled"
      : usePostgres
        ? "better-auth-pg"
        : "better-auth-sqlite",
    backends: {
      agents: dialect,
      events: dialect,
      hub: usePostgres ? "pg-notify" : "in-process",
      files_blobs: `localfs ${filesBlobDir}`,
      db: backendDescription,
    },
  }),
);

app.get("/auth-info", (c) =>
  c.json({
    providers: authDisabled ? [] : ["email"],
    turnstile_site_key: null,
  }),
);

if (auth) {
  app.on(["GET", "POST"], "/auth/*", (c) => auth!.handler(c.req.raw));
}

// Auth middleware via packages/auth — same five-priority resolution as
// apps/main on CF.
const authMw = buildAuthMw({
  disabled: authDisabled,
  bypassPath: (path) => path === "/health" || path.startsWith("/auth/"),
  resolveSession: async (headers) => {
    if (!auth) return null;
    const session = (await auth.api.getSession({ headers })) as
      | { user?: { id: string; email?: string | null; name?: string | null } }
      | null;
    if (!session?.user) return null;
    return {
      userId: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    };
  },
  resolveApiKey: async (apiKey) => {
    const hash = sha256Hex(apiKey);
    const rec = await apiKeyStorage.findByHash(hash);
    if (!rec) return null;
    return { tenantId: rec.tenant_id, userId: rec.user_id };
  },
  defaultTenantForUser: async (userId) => {
    const row = await sql
      .prepare(
        `SELECT tenant_id FROM membership WHERE user_id = ? ORDER BY created_at ASC, tenant_id ASC LIMIT 1`,
      )
      .bind(userId)
      .first<{ tenant_id: string }>();
    return row?.tenant_id ?? null;
  },
  hasMembership: async (userId, tenantId) => {
    const row = await sql
      .prepare(
        `SELECT 1 AS one FROM membership WHERE user_id = ? AND tenant_id = ? LIMIT 1`,
      )
      .bind(userId, tenantId)
      .first<{ one: number }>();
    return row !== null;
  },
  ensureTenantForUser: (s) => ensureTenantSqlite(sql, s.userId, s.name, s.email),
});

const v1 = new Hono<{
  Variables: { tenant_id: string; user_id?: string };
}>();
v1.use("*", authMw);

v1.get("/me/tenants", async (c) => {
  const userId = c.var.user_id;
  if (!userId) {
    const row = await sql.prepare(`SELECT id, name FROM "tenant" WHERE id = ?`)
      .bind(c.var.tenant_id).first<{ id: string; name: string }>();
    return c.json({ data: row ? [{ ...row, role: "owner" }] : [] });
  }
  const result = await sql.prepare(
    `SELECT t.id, t.name, m.role, m.created_at
       FROM "membership" m JOIN "tenant" t ON t.id = m.tenant_id
      WHERE m.user_id = ? ORDER BY m.created_at ASC, t.id ASC`,
  ).bind(userId).all<{ id: string; name: string; role: string; created_at: number }>();
  return c.json({ data: result.results ?? [] });
});

v1.post("/tenants", async (c) => {
  const userId = c.var.user_id;
  if (!userId) return c.json({ error: "authentication_required" }, 401);
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const tenantId = `tenant_${nanoid(16)}`;
  const now = Date.now();
  await sql.prepare(`INSERT INTO "tenant" (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(tenantId, name, now).run();
  await sql.prepare(`INSERT INTO membership (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`)
    .bind(tenantId, userId, "owner", now).run();
  return c.json({ id: tenantId, name, role: "owner", created_at: now }, 201);
});

// Mount route bundles. Same paths CF uses; behavior preserved.
v1.route("/agents", buildAgentRoutes({
  services,
  validateModel: async (tenantId, model) => {
    const modelId = typeof model === "string" ? model : model.id;
    const cards = await modelCardsService.list({ tenantId });
    if (cards.every((card) => card.archived_at !== null)) {
      return { valid: false, error: "No active model card configured for this tenant" };
    }
    return cards.some((card) => card.archived_at === null && card.model_id === modelId)
      ? { valid: true }
      : { valid: false, error: `No model card with model_id "${modelId}" for this tenant` };
  },
  validateSkills: async (tenantId, skills) => {
    for (const binding of skills ?? []) {
      const item = binding as { skill_id?: string; version?: string };
      if (!item.skill_id) return { valid: false, error: "skill_id is required" };
      const skill = await skillsService.get(tenantId, item.skill_id);
      if (!skill || skill.archived_at) return { valid: false, error: `Skill "${item.skill_id}" is not available for this tenant` };
      if (item.version && !(await skillsService.getVersion(tenantId, item.skill_id, item.version))) {
        return { valid: false, error: `Skill version "${item.skill_id}@${item.version}" is not available for this tenant` };
      }
    }
    return { valid: true };
  },
}));
v1.route("/model_cards", buildModelCardRoutes({
  modelCards: modelCardsService,
  internalToken: process.env.INTERNAL_MODEL_CARD_TOKEN,
  encryptionConfigured: Boolean(platformRootSecret),
}));
v1.route("/environments", buildEnvironmentRoutes({ environments: environmentsService }));
v1.route("/skills", buildSkillRoutes({ skills: skillsService }));
const sessionRouter = new NodeSessionRouter({
  sql,
  hub,
  registry: sessionRegistry,
  newEventLog,
});
v1.route("/sessions", buildSessionRoutes({
  services,
  router: sessionRouter,
  outputs: nodeOutputsAdapter(outputsRoot),
  lifecycle: nodeSessionLifecycle({ files: filesService, filesBlob }),
  // Node has no cloud runtime yet — every agent is treated as local. Resolve
  // the selected Environment inside the authenticated tenant; the stable
  // sentinel remains a backwards-compatible fallback when no row is selected.
  localRuntimeEnvId: "env-local-runtime",
  forceLocalRuntime: true,
  loadEnvironment: async ({ tenantId, environmentId }) => {
    const row = await environmentsService.get({ tenantId, environmentId });
    if (row?.archived_at) return null;
    if (row) return toEnvironmentConfig(row);
    if (environmentId !== "env-local-runtime") return null;
    return {
      type: "environment",
      id: environmentId,
      name: "Local runtime",
      config: { type: "local" },
    } as import("@open-managed-agents/shared").EnvironmentConfig;
  },
}));

v1.get("/models/list", (c) =>
  c.json({
    data: [
      { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", speeds: ["standard", "fast"] },
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", speeds: ["standard"] },
      { id: "claude-opus-4-7", display_name: "Claude Opus 4.7", speeds: ["standard"] },
    ],
  }),
);
// ── Files API (subset of apps/main/src/routes/files.ts) ──
//
// CF mounts a richer files surface with synthesized session-output ids;
// Node provides tenant-scoped multipart upload plus list, download, and
// delete for the SDK and Console. Session sandbox-file promotion remains a
// separate POST /v1/sessions/:id/files path.
v1.route("/files", buildNodeFileRoutes({
  files: filesService,
  filesBlob,
  sessionExists: async ({ tenantId, sessionId }) =>
    (await sessionsService.get({ tenantId, sessionId })) !== null,
}));
v1.get("/files", async (c) => {
  const t = c.var.tenant_id;
  const scopeId = c.req.query("scope_id") ?? undefined;
  const limitParam = c.req.query("limit");
  let requested = limitParam ? parseInt(limitParam, 10) : 100;
  if (isNaN(requested) || requested < 1) requested = 100;
  if (requested > 1000) requested = 1000;
  const rows = await filesService.list({
    tenantId: t,
    sessionId: scopeId,
    limit: requested,
  });
  return c.json({ data: rows.map(toFileRecord), has_more: false });
});
v1.get("/files/:id/content", async (c) => {
  const id = c.req.param("id");
  const t = c.var.tenant_id;
  const row = await filesService.get({ tenantId: t, fileId: id });
  if (!row) return c.json({ error: "File not found" }, 404);
  if (!row.downloadable) return c.json({ error: "This file is not downloadable" }, 403);
  const obj = await filesBlob.get(row.r2_key);
  if (!obj) return c.json({ error: "File content not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": row.media_type },
  });
});
v1.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  const t = c.var.tenant_id;
  const row = await filesService.get({ tenantId: t, fileId: id });
  if (!row) return c.json({ error: "File not found" }, 404);
  return c.json(toFileRecord(row));
});
v1.delete("/files/:id", async (c) => {
  try {
    const deleted = await filesService.delete({
      tenantId: c.var.tenant_id,
      fileId: c.req.param("id"),
    });
    await filesBlob.delete(deleted.r2_key).catch(() => undefined);
    return c.json({ type: "file_deleted", id: deleted.id });
  } catch (err) {
    if ((err as { code?: string }).code === "file_not_found") {
      return c.json({ error: "File not found" }, 404);
    }
    throw err;
  }
});

app.route("/v1", v1);

const consoleDir = process.env.CONSOLE_DIR;
if (consoleDir) {
  const cwd = process.cwd();
  const rootRel = consoleDir.startsWith("/") ? relative(cwd, consoleDir) : consoleDir;
  app.use("/*", serveStatic({ root: rootRel }));
  app.get("/*", serveStatic({ root: rootRel, path: "index.html" }));
  logger.info({ op: "main-node.console_ui", dir: consoleDir, cwd_rel: rootRel }, "console UI served");
}

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  logger.error({ err, op: "main-node.unhandled" }, "unhandled error");
  return c.json({ error: "internal_error", message: err.message }, 500);
});

// ─── Listen ──────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  logger.info(
    { op: "main-node.listening", address: info.address, port: info.port, db: backendDescription },
    `listening on http://${info.address}:${info.port}`,
  );
});

const shutdown = async (signal: string) => {
  logger.info({ op: "main-node.shutdown", signal }, `received ${signal}, shutting down`);
  if (hub instanceof PgEventStreamHub) {
    try { await hub.stop(); } catch (err) { logger.warn({ err, op: "main-node.shutdown.pg_hub_stop_failed" }, "pg-hub stop failed"); }
  }
  if (authShutdown) {
    try { await authShutdown(); } catch (err) { logger.warn({ err, op: "main-node.shutdown.auth_failed" }, "auth shutdown failed"); }
  }
  try { await tracer.shutdown(); } catch { /* tracer shutdown is best-effort */ }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ─── Helpers ─────────────────────────────────────────────────────────────

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomFallback(): string {
  // Pre-bootstrap fallback — logger is built before BetterAuth in the
  // current ordering, so this can use the structured logger.
  logger.warn(
    { op: "main-node.auth_secret_missing" },
    "BETTER_AUTH_SECRET not set — generating per-process random secret. Sessions will not survive restart.",
  );
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Lightweight SqlClient shim around a better-sqlite3 Database. Used only
 * to run the better-auth schema apply against the auth db (separate
 * connection from the main SqlClient). We don't ship a full adapter — only
 * .exec() is needed.
 */
function betterSqliteAsSqlClient(
  db: import("better-sqlite3").Database,
): SqlClient {
  return {
    exec: async (s: string) => {
      db.exec(s);
    },
    prepare: () => {
      throw new Error("not implemented");
    },
    batch: async () => [],
  } as SqlClient;
}
