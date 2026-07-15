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

interface ExecutorLogger {
  error?(context: unknown, message: string): void;
}

interface ExecutorHooks {
  onCancelled?(rows: SessionPendingRow[]): void;
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
    active?.controller.abort();
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
        const input = {
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
            run: (signal) => this.runner.run(input, signal),
          });
          await this.hooks.workerPool.waitFor(jobId);
        } else {
          await this.runner.run(input, controller.signal);
        }
        await this.queue.markTurn?.(sessionId, promoted.eventId, "completed");
      } catch (error) {
        await this.queue.markTurn?.(sessionId, promoted.eventId, "failed");
        this.logger.error?.(
          { error, sessionId, pendingSeq: promoted.pendingSeq },
          "session turn failed",
        );
      } finally {
        const current = this.active.get(sessionId);
        if (current?.jobId) await this.hooks.workerPool?.waitFor(current.jobId);
        this.active.delete(sessionId);
      }
    }
  }
}
