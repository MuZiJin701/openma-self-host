// SessionRegistry — Node thin shell around the unified SessionStateMachine.
//
// One SessionRegistry per process; one SessionStateMachine per active
// session, lazily created on first request. The shell's job is:
//
//   1. Hold the per-process deps (sql, hub, services, env-derived
//      config) in its closure.
//   2. Lazily build a SessionStateMachine on first access. The machine
//      itself owns the per-session sandbox + adapter.
//   3. Run a one-shot bootstrap() at process start to wake any session
//      whose row was left status='running' by a prior process (orphan
//      recovery via the unified machine.onWake path).
//
// Mirrors what apps/agent's SessionDO will become in Phase 3 (a thin
// shell around the same machine, with `alarm()` instead of bootstrap()
// as the orphan-detection trigger).
//
// Sandbox provisioning (workspace outputs and optional backup restore) is delegated to the
// SandboxOrchestrator from `@open-managed-agents/sandbox/orchestrator`
// — same interface CF wires for the OmaSandbox path. Per-runtime
// mounters were removed in P5.

import {
  RuntimeAdapterImpl,
  SessionStateMachine,
} from "@open-managed-agents/session-runtime";
import type { SqlClient } from "@open-managed-agents/sql-client";
import { SqlStreamRepo, type SqlEventLog } from "@open-managed-agents/event-log/sql";
import { SqlPendingQueue } from "@open-managed-agents/event-log/sql";
import {
  findPendingToolAction,
  listPendingToolActions,
  SerialSessionTurnExecutor,
} from "./lib/session-turn-executor.js";
import type { QueueReceipt, SessionTurnExecutor } from "@open-managed-agents/session-runtime";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import type { SandboxOrchestrator } from "@open-managed-agents/sandbox/orchestrator";
import type { AgentService } from "@open-managed-agents/agents-store";
import type { SkillService } from "@open-managed-agents/skills-store";
import type {
  AgentConfig,
  ContentBlock,
  SessionEvent,
  UserMessageEvent,
} from "@open-managed-agents/shared";
import type { LanguageModel } from "ai";
import { getLogger } from "@open-managed-agents/observability";
import type { EventStreamHub } from "./lib/event-stream-hub.js";
import type { WorkerPool } from "./lib/worker-pool.js";
import { createUserDataLayout } from "./lib/user-data-layout.js";

const log = getLogger("session-registry");

export interface SessionRegistryDeps {
  sql: SqlClient;
  hub: EventStreamHub;
  agentsService: AgentService;
  /** User-scoped immutable skill store used during sandbox provisioning. */
  skillsService?: SkillService;
  /** Sandbox provisioning — outputs and backup-restore.
   *  Replaces the per-runtime buildMemoryMounter / buildSessionOutputsMounter
   *  hooks from before P5. */
  sandboxOrchestrator: SandboxOrchestrator;

  /** Build the per-session event log. Mirrors main-node's existing
   *  newEventLog(sid) — keeps the stamp closure local to the shell. */
  newEventLog(sessionId: string): SqlEventLog;

  /** Build the per-session sandbox. The shell knows how to assemble a
   *  LocalSubprocess / E2B / Daytona / etc., the machine doesn't. */
  buildSandbox(sessionId: string, userId: string, workdir: string): Promise<SandboxExecutor>;

  /** Build the LanguageModel for the agent. Reads env, applies custom
   *  headers, picks the right provider. */
  buildModel(agent: AgentConfig, userId?: string): LanguageModel | Promise<LanguageModel>;

  /** Build harness tools. Returns the tools dict the harness expects. */
  buildTools(
    agent: AgentConfig,
    sandbox: SandboxExecutor,
    userId?: string,
    options?: { allowAlwaysAsk?: boolean },
  ): Promise<unknown>;

  /** Build harness instance + context. Each is platform-neutral so the
   *  machine just calls .run(ctx). */
  buildHarness(): { run: (ctx: unknown) => Promise<void> };
  buildHarnessContext(input: {
    agent: AgentConfig;
    userMessage: UserMessageEvent;
    sandbox: SandboxExecutor;
    tools: unknown;
    model: LanguageModel;
    sessionId: string;
    eventLog: SqlEventLog;
    abortSignal?: AbortSignal;
    userId?: string;
  }): Promise<unknown>;

  /** DATA_DIR. Each user's shared workspace is derived below it. */
  sandboxWorkdirRoot: string;

  /** SQL dialect under the SqlClient. Threaded through to SqlStreamRepo
   *  so its appendChunk picks the right JSON-array append (json_insert
   *  on sqlite, jsonb concat on postgres). */
  sqlDialect?: "sqlite" | "postgres";

  pendingQueue: SqlPendingQueue;
  workerPool?: WorkerPool;
}

export interface SessionEntry {
  machine: SessionStateMachine;
  sandbox: SandboxExecutor;
  eventLog: SqlEventLog;
  executor: SessionTurnExecutor;
}

export class SessionRegistry {
  private map = new Map<string, Promise<SessionEntry>>();

  constructor(private deps: SessionRegistryDeps) {}

  /**
   * Get-or-create the SessionStateMachine for a session. Lazy: the
   * sandbox + adapter aren't built until first access. Cached: the same
   * machine is reused across HTTP requests (so chokidar watcher /
   * recovery / repeated user.messages all hit the same in-memory state).
   */
  async getOrCreate(sessionId: string, userId: string): Promise<SessionEntry> {
    let p = this.map.get(sessionId);
    if (!p) {
      p = this.build(sessionId, userId);
      this.map.set(sessionId, p);
    }
    return p;
  }

  /**
   * Process-startup orphan reconciliation. Reads sessions WHERE
   * status='running' and calls onWake() on each. Survivors of a prior
   * crash get their event log cleaned up (placeholder agent.message +
   * tool_result events injected) and the row flips back to 'idle'.
   *
   * No automatic re-execution of the interrupted turn — the user gets
   * a clean state and can retry by sending a new user.message. Mirrors
   * what apps/main-node did inline before this refactor.
   */
  async bootstrap(): Promise<void> {
    const r = await this.deps.sql
      .prepare(
        `SELECT id, user_id FROM sessions WHERE status='running' AND turn_id IS NOT NULL`,
      )
      .all<{ id: string; user_id: string }>();
    const rows = r.results ?? [];
    if (rows.length > 0) {
      log.info({ op: "session_registry.bootstrap", recovering: rows.length }, `bootstrap: recovering ${rows.length} interrupted session(s)`);
      for (const row of rows) {
        const entry = await this.getOrCreate(row.id, row.user_id);
        try {
          await entry.machine.onWake();
        } catch (err) {
          log.error(
            { err, op: "session_registry.bootstrap.on_wake_failed", session_id: row.id },
            `bootstrap onWake(${row.id}) failed`,
          );
        }
      }
    }

    // Durable queue/ledger rows survive a process crash independently of the
    // in-memory registry. Re-arm every session that still has pending work or
    // a promoted turn whose harness did not reach completion.
    const pendingSessions = await this.deps.pendingQueue.threadsWithPending();
    const promotedSessions = await this.deps.sql
      .prepare(`SELECT DISTINCT session_id FROM session_turn_runs WHERE status IN ('promoted', 'running')`)
      .all<{ session_id: string }>();
    const recoverySessions = new Set([
      ...pendingSessions,
      ...(promotedSessions.results ?? []).map((row) => row.session_id),
    ]);
    for (const sessionId of recoverySessions) {
      const row = await this.deps.sql
        .prepare(`SELECT user_id, agent_id FROM sessions WHERE id = ?`)
        .bind(sessionId)
        .first<{ user_id: string; agent_id: string | null }>();
      if (!row?.agent_id) continue;
      const entry = await this.getOrCreate(sessionId, row.user_id);
      await entry.executor.recover(sessionId);
    }
  }

  /**
   * Tear down all in-process sessions on shutdown. Best-effort; the
   * sessions row stays as-is (status='idle' for normal exits, status=
   * 'running' for kill -9, which the next bootstrap will handle).
   */
  async shutdown(): Promise<void> {
    for (const p of this.map.values()) {
      try {
        const entry = await p;
        if (entry.sandbox.destroy) await entry.sandbox.destroy();
      } catch {
        /* best-effort */
      }
    }
    this.map.clear();
  }

  /**
   * Abort the in-flight harness for a session. Routed from
   * POST /v1/sessions/:id/events when the body contains a `user.interrupt`
   * event. No-op if the session has no machine yet (nothing to interrupt).
   * The machine's adapter handles emitting the session-side
   * agent.message_stream_end(status="aborted") event chain.
   */
  async interrupt(sessionId: string): Promise<void> {
    const p = this.map.get(sessionId);
    if (!p) {
      await this.deps.pendingQueue.cancelAll(sessionId);
      return;
    }
    const entry = await p;
    await entry.executor.interrupt(sessionId);
  }

  async enqueueEvent(
    sessionId: string,
    userId: string,
    agentId: string,
    event: SessionEvent,
  ): Promise<QueueReceipt> {
    const entry = await this.getOrCreate(sessionId, userId);
    if (event.type === "user.interrupt") {
      throw new SessionTurnConflictError(
        `session ${sessionId} interrupt must use the interrupt route`,
      );
    }
    if (event.type !== "user.message") {
      const events = await entry.eventLog.getEventsAsync();
      if (!findPendingToolAction(events, event)) {
        throw new SessionTurnConflictError(
          `session ${sessionId} has no pending action for ${event.type}`,
        );
      }
    }
    return entry.executor.enqueue(sessionId, userId, agentId, event);
  }

  async listPending(sessionId: string, includeCancelled = false) {
    return this.deps.pendingQueue.list(sessionId, includeCancelled);
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async build(
    sessionId: string,
    userId: string,
  ): Promise<SessionEntry> {
    // One stable workspace per user. Session-specific temporary mounts are
    // kept inside the sandbox adapter and are cleaned up independently.
    const layout = createUserDataLayout(this.deps.sandboxWorkdirRoot);
    const sandboxWorkdir = layout.workspaceRoot(userId);
    const sandbox = await this.deps.buildSandbox(sessionId, userId, sandboxWorkdir);
    const sessionRow = await this.deps.sql
      .prepare(`SELECT agent_id FROM sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
      .first<{ agent_id: string | null }>();
    const sessionAgent = sessionRow?.agent_id
      ? await this.deps.agentsService.get({ userId, agentId: sessionRow.agent_id })
      : null;

    await this.deps.sandboxOrchestrator.provision(sandbox, {
      sessionId,
      userId,
      mountOutputs: true,
      backup: { restoreOnWarm: true },
    });
    await this.mountAgentSkills(sandbox, userId, sessionAgent?.skills);

    const eventLog = this.deps.newEventLog(sessionId);
    const streams = new SqlStreamRepo(this.deps.sql, sessionId, this.deps.sqlDialect ?? "sqlite");

    const adapter = new RuntimeAdapterImpl({
      sql: this.deps.sql,
      eventLog,
      streams,
      sandbox,
      // Node has no eviction — leave hintTurnInFlight unset.
    });

    const machine = new SessionStateMachine({
      sessionId,
      userId,
      adapter,
      sandbox,
      loadAgent: async (agentId) => {
        const row = await this.deps.agentsService.get({ userId, agentId });
        return row ?? null;
      },
      // Memory + outputs mounting happens in the orchestrator above.
      // SessionStateMachine still accepts the hooks for CF parity but
      // Node passes no-ops since the work has already been done.
      mountMemoryStores: async () => {},
      mountSessionOutputs: async () => {},
      buildModel: (agent) => this.deps.buildModel(agent, userId),
      buildTools: (agent, sb) => this.deps.buildTools(agent, sb, userId),
      buildHarness: () => this.deps.buildHarness(),
      buildHarnessContext: (input) =>
        this.deps.buildHarnessContext({
          ...input,
          sessionId,
          eventLog,
          userId,
        }),
      publish: (event: SessionEvent) => this.deps.hub.publish(sessionId, event),
      afterHarnessRun: async (ctx) => {
        const runtime = (ctx as { runtime?: { flush?: () => Promise<void> } }).runtime;
        await runtime?.flush?.();
      },
    });

    const executor = new SerialSessionTurnExecutor(
      this.deps.pendingQueue,
      {
        run: async (input, signal) => {
          // Promotion makes the user event canonical. Broadcast the
          // persisted row before starting the harness so /messages streams
          // can observe the exact event-log sequence and resume from it.
          const canonical = (await eventLog.getEventsAsync()).find(
            (event) =>
              (event as { id?: string }).id ===
              (input.event as { id?: string }).id,
          );
          this.deps.hub.publish(sessionId, canonical ?? input.event);
          this.deps.hub.publish(sessionId, {
            type: "system.user_message_promoted",
            event_id: (input.event as { id?: string }).id ?? "",
            pending_seq: input.pendingSeq,
            seq: (canonical as { seq?: number } | undefined)?.seq,
            processed_at:
              (canonical as { processed_at?: string } | undefined)?.processed_at ??
              new Date().toISOString(),
            session_thread_id:
              (input.event as { session_thread_id?: string }).session_thread_id ??
              "sthr_primary",
          } as unknown as SessionEvent);
          const canonicalEvents = await eventLog.getEventsAsync();
          const action = input.event.type === "user.message"
            ? null
            : findPendingToolAction(canonicalEvents, input.event);
          if (input.event.type !== "user.message" && !action) {
            throw new SessionTurnConflictError(
              `session ${sessionId} has no unresolved tool use for ${input.event.type}`,
            );
          }
          if (action) {
            await this.deliverToolAction(
              sessionId,
              userId,
              sessionAgent,
              sandbox,
              eventLog,
              action,
              input.event,
              signal,
            );
          }
          await machine.runHarnessTurn(
            input.agentId,
            input.event.type === "user.message"
              ? input.event as UserMessageEvent
              : { type: "user.message", content: [] },
            signal,
          );
          await this.publishIdleStatus(sessionId, eventLog);
        },
      },
      {
        error: (context, message) =>
          log.error(context as Record<string, unknown>, message),
      },
      {
        onCancelled: (rows) => {
          for (const row of rows) {
            this.deps.hub.publish(sessionId, {
              type: "system.user_message_cancelled",
              event_id: row.eventId,
              pending_seq: row.pendingSeq,
              session_thread_id: row.sessionThreadId,
              cancelled_at: row.cancelledAt ?? Date.now(),
            } as unknown as SessionEvent);
          }
        },
        onTurnCancelled: async (_input, _reason) => {
          await appendAndPublish(sessionId, eventLog, this.deps.hub, {
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          } as SessionEvent);
        },
        resolveContext: async (sid) => {
          const row = await this.deps.sql
            .prepare(`SELECT user_id, agent_id FROM sessions WHERE id = ?`)
            .bind(sid)
            .first<{ user_id: string; agent_id: string | null }>();
          if (!row?.agent_id) {
            throw new Error(`session ${sid} has no agent routing context`);
          }
          return { userId: row.user_id, agentId: row.agent_id };
        },
        workerPool: this.deps.workerPool,
      },
    );

    return { machine, sandbox, eventLog, executor };
  }

  private async mountAgentSkills(
    sandbox: SandboxExecutor,
    userId: string,
    bindings: AgentConfig["skills"],
  ): Promise<void> {
    if (!this.deps.skillsService || !bindings?.length) return;
    for (const binding of bindings) {
      const item = binding as unknown as { skill_id?: string; version?: string };
      if (!item.skill_id) continue;
      const skill = await this.deps.skillsService.get(userId, item.skill_id);
      if (!skill || skill.archived_at) continue;
      const version = item.version ?? skill.latest_version;
      if (!version) continue;
      const row = await this.deps.skillsService.getVersion(userId, skill.id, version);
      if (!row) continue;
      for (const file of row.files) {
        await sandbox.writeFile(`/mnt/skills/${skill.id}/${version}/${file.filename}`, file.content);
      }
    }
    // The directory is a fixed, provisioned read-only view for the Agent.
    // subprocess is trusted-only; failure to chmod is surfaced as a warning
    // rather than pretending it is a security boundary.
    try {
      if (sandbox.makeReadOnly) {
        await sandbox.makeReadOnly("/mnt/skills");
      } else {
        await sandbox.exec("chmod -R a-w -- /mnt/skills 2>/dev/null || true", 5_000);
      }
    } catch (error) {
      log.warn({ op: "skills.mount_readonly_failed", user_id: userId, err: error }, "skill mount could not be made read-only");
    }
  }

  private async deliverToolAction(
    sessionId: string,
    userId: string,
    agent: AgentConfig | null | undefined,
    sandbox: SandboxExecutor,
    eventLog: SqlEventLog,
    pending: NonNullable<ReturnType<typeof findPendingToolAction>>,
    event: SessionEvent,
    abortSignal: AbortSignal,
  ): Promise<void> {
    let content: string | ContentBlock[] = "";
    let isError = false;
    if (event.type === "user.custom_tool_result") {
      content = event.content;
      isError = event.is_error === true;
    } else if (event.type === "user.tool_confirmation" && event.result === "deny") {
      content = `Tool call denied${event.deny_message ? `: ${event.deny_message}` : ""}`;
      isError = true;
    } else {
      if (!agent) throw new Error(`agent unavailable for tool ${pending.toolName}`);
      const tools = await this.deps.buildTools(agent, sandbox, userId, {
        allowAlwaysAsk: true,
      });
      const tool = (tools as Record<string, {
        execute?: (
          input: Record<string, unknown>,
          options: { toolCallId: string; messages: unknown[]; abortSignal: AbortSignal },
        ) => Promise<unknown>;
      }>)[pending.toolName];
      if (!tool?.execute) {
        content = `Error: tool ${pending.toolName} is unavailable`;
        isError = true;
      } else {
        try {
          const result = await tool.execute(pending.input, {
            toolCallId: pending.toolUseId,
            messages: [],
            abortSignal,
          });
          content = serializeToolResult(result);
        } catch (error) {
          content = `Error: ${error instanceof Error ? error.message : String(error)}`;
          isError = true;
        }
      }
    }

    const resultEvent = pending.resultType === "agent.mcp_tool_result"
      ? {
          type: "agent.mcp_tool_result" as const,
          mcp_tool_use_id: pending.toolUseId,
          content: serializeToolResult(content),
          parent_event_id: pending.toolUseId,
          ...(isError ? { is_error: true } : {}),
        }
      : {
          type: "agent.tool_result" as const,
          tool_use_id: pending.toolUseId,
          content,
          parent_event_id: pending.toolUseId,
        };
    await appendAndPublish(sessionId, eventLog, this.deps.hub, resultEvent as SessionEvent);
  }

  private async publishIdleStatus(
    sessionId: string,
    eventLog: SqlEventLog,
  ): Promise<void> {
    const pending = listPendingToolActions(await eventLog.getEventsAsync());
    const status: SessionEvent = {
      type: "session.status_idle",
      stop_reason: pending.length > 0
        ? {
            type: "requires_action",
            action_type: pending[0]!.kind,
            event_ids: pending.map((item) => item.toolUseId),
          }
        : { type: "end_turn" },
    } as SessionEvent;
    await appendAndPublish(sessionId, eventLog, this.deps.hub, status);
  }
}

async function appendAndPublish(
  sessionId: string,
  eventLog: SqlEventLog,
  hub: EventStreamHub,
  event: SessionEvent,
): Promise<void> {
  await eventLog.appendAsync(event);
  const persisted = (await eventLog.getEventsAsync()).at(-1) ?? event;
  hub.publish(sessionId, persisted);
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export class SessionTurnConflictError extends Error {
  readonly code = "session_turn_conflict";
}
