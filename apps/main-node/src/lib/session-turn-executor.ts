import type {
  QueueReceipt,
  SessionPendingQueue,
  SessionTurnExecutor,
  SessionTurnInput,
  SessionTurnRunner,
  SessionPendingRow,
} from "@open-managed-agents/session-runtime";
import type { SessionEvent } from "@open-managed-agents/shared";

interface ExecutorLogger {
  error?(context: unknown, message: string): void;
}

interface ExecutorHooks {
  onCancelled?(rows: SessionPendingRow[]): void;
  resolveContext?(sessionId: string): Promise<{
    tenantId: string;
    agentId: string;
  }>;
}

interface ActiveTurn {
  controller: AbortController;
  pendingSeq: number;
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
    this.active.get(sessionId)?.controller.abort();
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
      const row = await this.queue.peek(sessionId);
      if (!row) return;
      const promoted = await this.queue.promote(sessionId, row.pendingSeq);
      if (!promoted) continue;

      const controller = new AbortController();
      this.active.set(sessionId, {
        controller,
        pendingSeq: promoted.pendingSeq,
      });
      try {
        const event = JSON.parse(promoted.data) as SessionEvent;
        const context =
          defaults.tenantId && defaults.agentId
            ? { tenantId: defaults.tenantId, agentId: defaults.agentId }
            : await this.hooks.resolveContext?.(sessionId);
        if (!context?.tenantId || !context.agentId) {
          throw new Error(`missing turn routing context for session ${sessionId}`);
        }
        await this.runner.run(
          {
            sessionId,
            tenantId: context.tenantId,
            agentId: context.agentId,
            event,
            pendingSeq: promoted.pendingSeq,
          },
          controller.signal,
        );
      } catch (error) {
        this.logger.error?.(
          { error, sessionId, pendingSeq: promoted.pendingSeq },
          "session turn failed",
        );
      } finally {
        this.active.delete(sessionId);
      }
    }
  }
}
