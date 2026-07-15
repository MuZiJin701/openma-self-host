import { nanoid } from "nanoid";
import type { SessionEvent } from "@open-managed-agents/shared";

export type QueueReceipt = {
  eventId: string;
  pendingSeq: number;
  enqueuedAt?: number;
  status: "queued";
};

export interface SessionTurnInput {
  sessionId: string;
  tenantId: string;
  agentId: string;
  event: SessionEvent;
  pendingSeq: number;
}

export interface SessionPendingRow {
  sessionId: string;
  pendingSeq: number;
  sessionThreadId: string;
  type: string;
  eventId: string;
  data: string;
  enqueuedAt: number;
  cancelledAt: number | null;
}

export type SessionTurnLedgerStatus = "promoted" | "running" | "completed" | "failed";

export interface SessionPendingQueue {
  enqueue(input: {
    sessionId: string;
    event: SessionEvent;
  }): Promise<QueueReceipt>;
  peek(sessionId: string): Promise<SessionPendingRow | null>;
  claim?(sessionId: string, leaseId: string, leaseMs?: number): Promise<SessionPendingRow | null>;
  promote(
    sessionId: string,
    pendingSeq: number,
  ): Promise<SessionPendingRow | null>;
  cancelAll(sessionId: string): Promise<SessionPendingRow[]>;
  list(
    sessionId: string,
    includeCancelled?: boolean,
  ): Promise<SessionPendingRow[]>;
  countActive(sessionId: string): Promise<number>;
  threadsWithPending(): Promise<string[]>;
  /** Turns promoted to the canonical log but not durably completed. */
  promoted?(sessionId: string): Promise<SessionPendingRow[]>;
  markTurn?(sessionId: string, eventId: string, status: SessionTurnLedgerStatus): Promise<void>;
}

export interface SessionTurnRunner {
  run(input: SessionTurnInput, signal: AbortSignal): Promise<void>;
}

export interface SessionTurnExecutor {
  enqueue(
    sessionId: string,
    tenantId: string,
    agentId: string,
    event: SessionEvent,
  ): Promise<QueueReceipt>;

  interrupt(sessionId: string): Promise<void>;

  recover(sessionId: string): Promise<void>;

  status(sessionId: string): Promise<{
    running: boolean;
    pending: number;
  }>;
}

/**
 * Small durable-queue-compatible adapter used by runtime unit tests.
 * The Node SQL implementation follows the same contract. Keeping this
 * implementation here makes FIFO and concurrency tests independent of a
 * native SQLite driver.
 */
export class InMemorySessionPendingQueue implements SessionPendingQueue {
  private rows: SessionPendingRow[] = [];
  private nextPendingSeq = 1;
  private ledger = new Map<string, SessionPendingRow & { status: SessionTurnLedgerStatus }>();

  async enqueue(input: {
    sessionId: string;
    event: SessionEvent;
  }): Promise<QueueReceipt> {
    const event = input.event as SessionEvent & { id?: string };
    const eventId = event.id ?? (event.id = nanoid());
    const existing = this.rows.find(
      (row) => row.sessionId === input.sessionId && row.eventId === eventId,
    );
    if (existing) {
    return {
      eventId,
      pendingSeq: existing.pendingSeq,
      enqueuedAt: existing.enqueuedAt,
      status: "queued",
      };
    }

    const row: SessionPendingRow = {
      sessionId: input.sessionId,
      pendingSeq: this.nextPendingSeq++,
      sessionThreadId:
        (event as { session_thread_id?: string }).session_thread_id ??
        "sthr_primary",
      type: event.type,
      eventId,
      data: JSON.stringify(event),
      enqueuedAt: Date.now(),
      cancelledAt: null,
    };
    this.rows.push(row);
    return {
      eventId,
      pendingSeq: row.pendingSeq,
      enqueuedAt: row.enqueuedAt,
      status: "queued",
    };
  }

  async peek(sessionId: string): Promise<SessionPendingRow | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.sessionId === sessionId && candidate.cancelledAt === null,
    );
    return row ? { ...row } : null;
  }

  async promote(
    sessionId: string,
    pendingSeq: number,
  ): Promise<SessionPendingRow | null> {
    const index = this.rows.findIndex(
      (row) =>
        row.sessionId === sessionId &&
        row.pendingSeq === pendingSeq &&
        row.cancelledAt === null,
    );
    if (index < 0) return null;
    const [row] = this.rows.splice(index, 1);
    this.ledger.set(`${row!.sessionId}:${row!.eventId}`, { ...row!, status: "promoted" });
    return { ...row };
  }

  async promoted(sessionId: string): Promise<SessionPendingRow[]> {
    return [...this.ledger.values()]
      .filter((row) => row.sessionId === sessionId && row.status !== "completed" && row.status !== "failed")
      .sort((a, b) => a.pendingSeq - b.pendingSeq)
      .map(({ status: _status, ...row }) => ({ ...row }));
  }

  async markTurn(sessionId: string, eventId: string, status: SessionTurnLedgerStatus): Promise<void> {
    const row = this.ledger.get(`${sessionId}:${eventId}`);
    if (row) row.status = status;
  }

  async cancelAll(sessionId: string): Promise<SessionPendingRow[]> {
    const cancelledAt = Date.now();
    const cancelled: SessionPendingRow[] = [];
    for (const row of this.rows) {
      if (row.sessionId === sessionId && row.cancelledAt === null) {
        row.cancelledAt = cancelledAt;
        cancelled.push({ ...row });
      }
    }
    return cancelled;
  }

  async list(
    sessionId: string,
    includeCancelled = false,
  ): Promise<SessionPendingRow[]> {
    return this.rows
      .filter(
        (row) =>
          row.sessionId === sessionId &&
          (includeCancelled || row.cancelledAt === null),
      )
      .sort((a, b) => a.pendingSeq - b.pendingSeq)
      .map((row) => ({ ...row }));
  }

  async countActive(sessionId: string): Promise<number> {
    return (await this.list(sessionId)).length;
  }

  async threadsWithPending(): Promise<string[]> {
    return [...new Set(this.rows.filter((row) => row.cancelledAt === null).map((row) => row.sessionId))];
  }
}
