import type {
  QueueReceipt,
  SessionPendingQueue,
  SessionTurnExecutor,
  SessionTurnInput,
  SessionTurnRunner,
  SessionPendingRow,
} from "@open-managed-agents/session-runtime";
import type { SessionEvent } from "@open-managed-agents/shared";
import type { WorkerPool } from "./worker-pool.js";

export interface PendingToolAction {
  kind: "tool_confirmation" | "custom_tool_result";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  resultType: "agent.tool_result" | "agent.mcp_tool_result";
}

function pendingToolActionFromUse(
  use: SessionEvent,
): PendingToolAction | null {
  if (
    use.type !== "agent.tool_use" &&
    use.type !== "agent.mcp_tool_use" &&
    use.type !== "agent.custom_tool_use"
  ) {
    return null;
  }
  return {
    kind: use.type === "agent.custom_tool_use"
      ? "custom_tool_result"
      : "tool_confirmation",
    toolUseId: use.id,
    toolName: use.name,
    input: use.input,
    resultType: use.type === "agent.mcp_tool_use"
      ? "agent.mcp_tool_result"
      : "agent.tool_result",
  };
}

function hasToolResult(events: SessionEvent[], pending: PendingToolAction): boolean {
  return events.some((event) => {
    if (pending.resultType === "agent.mcp_tool_result") {
      return event.type === "agent.mcp_tool_result" &&
        event.mcp_tool_use_id === pending.toolUseId;
    }
    return event.type === "agent.tool_result" &&
      event.tool_use_id === pending.toolUseId;
  });
}

/** Return unresolved tool calls in canonical event order. */
export function listPendingToolActions(
  events: SessionEvent[],
): PendingToolAction[] {
  const pending: PendingToolAction[] = [];
  for (const event of events) {
    const candidate = pendingToolActionFromUse(event);
    if (candidate && !hasToolResult(events, candidate)) {
      pending.push(candidate);
    }
  }
  return pending;
}

/**
 * Resolve a user action against the canonical event history. Action events
 * are accepted only while their matching agent tool use has no result yet.
 * This keeps a stale confirmation/result from being delivered to a later
 * turn that happens to reuse the same session.
 */
export function findPendingToolAction(
  events: SessionEvent[],
  action: SessionEvent,
): PendingToolAction | null {
  if (
    action.type !== "user.tool_confirmation" &&
    action.type !== "user.custom_tool_result"
  ) {
    return null;
  }

  const actionId = action.type === "user.tool_confirmation"
    ? (action as { tool_use_id: string }).tool_use_id
    : (action as { custom_tool_use_id: string }).custom_tool_use_id;
  if (!actionId) return null;

  const use = [...events].reverse().find((event) => {
    if (action.type === "user.custom_tool_result") {
      return event.type === "agent.custom_tool_use" &&
        event.id === actionId;
    }
    return (
      (event.type === "agent.tool_use" || event.type === "agent.mcp_tool_use") &&
      event.id === actionId
    );
  });
  if (!use) return null;

  const pending = pendingToolActionFromUse(use);
  if (!pending || pending.kind !== (action.type === "user.tool_confirmation"
    ? "tool_confirmation"
    : "custom_tool_result") || hasToolResult(events, pending)) {
    return null;
  }
  return pending;
}

interface ExecutorLogger {
  error?(context: unknown, message: string): void;
}

interface ExecutorHooks {
  onCancelled?(rows: SessionPendingRow[]): void;
  onTurnCancelled?(
    input: SessionTurnInput,
    reason: "cancelled" | "timeout",
  ): void | Promise<void>;
  resolveContext?(sessionId: string): Promise<{
    tenantId: string;
    agentId: string;
  }>;
  workerPool?: WorkerPool;
}

interface ActiveTurn {
  controller: AbortController;
  pendingSeq: number;
  jobId?: string;
}

/**
 * Per-session FIFO dispatcher. Each session owns one promise chain, while
 * chains for different sessions are allowed to run independently.
 */
export class SerialSessionTurnExecutor implements SessionTurnExecutor {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly active = new Map<string, ActiveTurn>();

  constructor(
    private readonly queue: SessionPendingQueue,
    private readonly runner: SessionTurnRunner,
    private readonly logger: ExecutorLogger = {},
    private readonly hooks: ExecutorHooks = {},
  ) {}

  async enqueue(
    sessionId: string,
    tenantId: string,
    agentId: string,
    event: SessionEvent,
  ): Promise<QueueReceipt> {
    const receipt = await this.queue.enqueue({ sessionId, event });
    this.schedule(sessionId, { sessionId, tenantId, agentId });
    return receipt;
  }

  async interrupt(sessionId: string): Promise<void> {
    const cancelled = await this.queue.cancelAll(sessionId);
    if (cancelled.length > 0) this.hooks.onCancelled?.(cancelled);
    const active = this.active.get(sessionId);
    active?.controller.abort("cancelled");
    if (active?.jobId) await this.hooks.workerPool?.cancel(active.jobId);
  }

  async recover(sessionId: string): Promise<void> {
    this.schedule(sessionId, { sessionId });
  }

  async status(sessionId: string): Promise<{
    running: boolean;
    pending: number;
  }> {
    return {
      running: this.active.has(sessionId),
      pending: await this.queue.countActive(sessionId),
    };
  }

  /** Test and shutdown helper: wait until the current session chain drains. */
  async waitForIdle(sessionId: string): Promise<void> {
    await this.chains.get(sessionId);
  }

  private schedule(
    sessionId: string,
    defaults: Partial<Pick<SessionTurnInput, "tenantId" | "agentId">> & {
      sessionId: string;
    },
  ): void {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.drain(sessionId, defaults))
      .catch((error) => {
        this.logger.error?.(
          { error, sessionId },
          "session turn queue drain failed",
        );
      });
    this.chains.set(sessionId, next);
    void next.finally(() => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
    });
  }

  private async drain(
    sessionId: string,
    defaults: Partial<Pick<SessionTurnInput, "tenantId" | "agentId">> & {
      sessionId: string;
    },
  ): Promise<void> {
    while (true) {
      const leaseId = `lease:${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const row = this.queue.claim
        ? await this.queue.claim(sessionId, leaseId)
        : await this.queue.peek(sessionId);
      let promoted = row ? await this.queue.promote(sessionId, row.pendingSeq) : null;
      if (!promoted) {
        const recovered = await this.queue.promoted?.(sessionId);
        if (!recovered?.length) return;
        promoted = recovered[0]!;
      }

      const controller = new AbortController();
      this.active.set(sessionId, {
        controller,
        pendingSeq: promoted.pendingSeq,
      });
      let input: SessionTurnInput | undefined;
      try {
        await this.queue.markTurn?.(sessionId, (promoted.eventId), "running");
        const event = JSON.parse(promoted.data) as SessionEvent;
        const context =
          defaults.tenantId && defaults.agentId
            ? { tenantId: defaults.tenantId, agentId: defaults.agentId }
            : await this.hooks.resolveContext?.(sessionId);
        if (!context?.tenantId || !context.agentId) {
          throw new Error(`missing turn routing context for session ${sessionId}`);
        }
        input = {
          sessionId,
          tenantId: context.tenantId,
          agentId: context.agentId,
          event,
          pendingSeq: promoted.pendingSeq,
        };
        const jobId = `turn:${sessionId}:${promoted.pendingSeq}`;
        if (this.hooks.workerPool) {
          this.active.get(sessionId)!.jobId = jobId;
          await this.hooks.workerPool.submit({
            jobId,
            tenantId: context.tenantId,
            sessionId,
            run: (signal) => this.runner.run(input!, signal),
          });
          const outcome = await this.hooks.workerPool.waitFor(jobId);
          if (outcome && outcome !== "completed") {
            await this.queue.markTurn?.(sessionId, promoted.eventId, "failed");
            await this.hooks.onTurnCancelled?.(
              input!,
              outcome === "timeout" ? "timeout" : "cancelled",
            );
            continue;
          }
        } else {
          await this.runner.run(input, controller.signal);
          if (controller.signal.aborted) {
            await this.queue.markTurn?.(sessionId, promoted.eventId, "failed");
            await this.hooks.onTurnCancelled?.(input, cancellationReason(controller.signal));
            continue;
          }
        }
        await this.queue.markTurn?.(sessionId, promoted.eventId, "completed");
      } catch (error) {
        await this.queue.markTurn?.(sessionId, promoted.eventId, "failed");
        if (controller.signal.aborted && input) {
          await this.hooks.onTurnCancelled?.(input, cancellationReason(controller.signal));
        } else {
          this.logger.error?.(
            { error, sessionId, pendingSeq: promoted.pendingSeq },
            "session turn failed",
          );
        }
      } finally {
        const current = this.active.get(sessionId);
        if (current?.jobId) await this.hooks.workerPool?.waitFor(current.jobId);
        this.active.delete(sessionId);
      }
    }
  }
}

function cancellationReason(signal: AbortSignal): "cancelled" | "timeout" {
  return signal.reason === "timeout" ? "timeout" : "cancelled";
}
