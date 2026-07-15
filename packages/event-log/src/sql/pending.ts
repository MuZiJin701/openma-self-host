import type { SessionEvent } from "@open-managed-agents/shared";
import type { SqlClient } from "@open-managed-agents/sql-client";
import type { SqlDialect } from "./index";

export interface SqlQueueReceipt {
  eventId: string;
  pendingSeq: number;
  status: "queued";
}

export interface SqlPendingRow {
  sessionId: string;
  pendingSeq: number;
  sessionThreadId: string;
  type: string;
  eventId: string;
  data: string;
  enqueuedAt: number;
  cancelledAt: number | null;
}

interface DbPendingRow {
  session_id: string;
  pending_seq: number;
  session_thread_id: string;
  type: string;
  event_id: string;
  data: string;
  enqueued_at: number;
  cancelled_at: number | null;
}

/** SQL-backed pending queue for the Node runtime. */
export class SqlPendingQueue {
  constructor(
    private readonly sql: SqlClient,
    private readonly dialect: SqlDialect = "sqlite",
  ) {}

  async enqueue(input: {
    sessionId: string;
    event: SessionEvent;
  }): Promise<SqlQueueReceipt> {
    const event = input.event as SessionEvent & { id?: string };
    const eventId =
      event.id ??
      (event.id = `sevt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`);
    const threadId =
      (event as { session_thread_id?: string }).session_thread_id ??
      "sthr_primary";
    const enqueuedAt = Date.now();

    await this.sql
      .prepare(
        `INSERT INTO session_pending_events
           (session_id, session_thread_id, type, event_id, data, enqueued_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, event_id) DO NOTHING`,
      )
      .bind(
        input.sessionId,
        threadId,
        event.type,
        eventId,
        JSON.stringify(event),
        enqueuedAt,
      )
      .run();

    const row = await this.sql
      .prepare(
        `SELECT session_id, pending_seq, session_thread_id, type, event_id,
                data, enqueued_at, cancelled_at
           FROM session_pending_events
          WHERE session_id = ? AND event_id = ?`,
      )
      .bind(input.sessionId, eventId)
      .first<DbPendingRow>();
    if (!row) throw new Error("pending queue insert was not durable");
    return { eventId, pendingSeq: Number(row.pending_seq), status: "queued" };
  }

  async peek(sessionId: string): Promise<SqlPendingRow | null> {
    const row = await this.sql
      .prepare(
        `SELECT session_id, pending_seq, session_thread_id, type, event_id,
                data, enqueued_at, cancelled_at
           FROM session_pending_events
          WHERE session_id = ? AND cancelled_at IS NULL
          ORDER BY pending_seq ASC LIMIT 1`,
      )
      .bind(sessionId)
      .first<DbPendingRow>();
    return row ? toPendingRow(row) : null;
  }

  /**
   * Promote one row to the canonical event log. The canonical INSERT and
   * queue DELETE share one SQL batch, so a process crash cannot lose an
   * event after it has been removed from the queue.
   */
  async promote(
    sessionId: string,
    pendingSeq: number,
  ): Promise<SqlPendingRow | null> {
    const row = await this.sql
      .prepare(
        `SELECT session_id, pending_seq, session_thread_id, type, event_id,
                data, enqueued_at, cancelled_at
           FROM session_pending_events
          WHERE session_id = ? AND pending_seq = ? AND cancelled_at IS NULL`,
      )
      .bind(sessionId, pendingSeq)
      .first<DbPendingRow>();
    if (!row) return null;

    const duplicateQuery =
      this.dialect === "postgres"
        ? `SELECT seq FROM session_events
             WHERE session_id = ? AND (data::jsonb ->> 'id') = ? LIMIT 1`
        : `SELECT seq FROM session_events
             WHERE session_id = ? AND json_extract(data, '$.id') = ? LIMIT 1`;
    const duplicate = await this.sql
      .prepare(duplicateQuery)
      .bind(sessionId, row.event_id)
      .first<{ seq: number }>();

    if (duplicate) {
      await this.sql
        .batch([
          this.sql
            .prepare(
              `DELETE FROM session_pending_events
                WHERE session_id = ? AND pending_seq = ?`,
            )
            .bind(sessionId, pendingSeq),
        ]);
      return null;
    }

    const event = JSON.parse(row.data) as SessionEvent & {
      processed_at?: string;
      session_thread_id?: string;
    };
    event.processed_at ??= new Date().toISOString();
    event.session_thread_id ??= row.session_thread_id;
    const data = JSON.stringify(event);
    const processedAt = Date.now();

    await this.sql.batch([
      this.sql
        .prepare(
          `INSERT INTO session_events
             (session_id, seq, type, data, ts, processed_at, session_thread_id)
           SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?
             FROM session_events WHERE session_id = ?`,
        )
        .bind(
          sessionId,
          event.type,
          data,
          processedAt,
          processedAt,
          row.session_thread_id,
          sessionId,
        ),
      this.sql
        .prepare(
          `DELETE FROM session_pending_events
            WHERE session_id = ? AND pending_seq = ?`,
        )
        .bind(sessionId, pendingSeq),
    ]);
    return toPendingRow({ ...row, data });
  }

  async cancelAll(sessionId: string): Promise<SqlPendingRow[]> {
    const rows = await this.list(sessionId, false);
    if (rows.length === 0) return [];
    const cancelledAt = Date.now();
    await this.sql
      .prepare(
        `UPDATE session_pending_events SET cancelled_at = ?
          WHERE session_id = ? AND cancelled_at IS NULL`,
      )
      .bind(cancelledAt, sessionId)
      .run();
    return rows.map((row) => ({ ...row, cancelledAt }));
  }

  async list(
    sessionId: string,
    includeCancelled = false,
  ): Promise<SqlPendingRow[]> {
    const where = includeCancelled
      ? "session_id = ?"
      : "session_id = ? AND cancelled_at IS NULL";
    const rows = await this.sql
      .prepare(
        `SELECT session_id, pending_seq, session_thread_id, type, event_id,
                data, enqueued_at, cancelled_at
           FROM session_pending_events
          WHERE ${where} ORDER BY pending_seq ASC`,
      )
      .bind(sessionId)
      .all<DbPendingRow>();
    return (rows.results ?? []).map(toPendingRow);
  }

  async countActive(sessionId: string): Promise<number> {
    const row = await this.sql
      .prepare(
        `SELECT COUNT(*) AS count FROM session_pending_events
          WHERE session_id = ? AND cancelled_at IS NULL`,
      )
      .bind(sessionId)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async threadsWithPending(): Promise<string[]> {
    const rows = await this.sql
      .prepare(
        `SELECT DISTINCT session_id FROM session_pending_events
          WHERE cancelled_at IS NULL ORDER BY session_id`,
      )
      .all<{ session_id: string }>();
    return (rows.results ?? []).map((row) => row.session_id);
  }
}

function toPendingRow(row: DbPendingRow): SqlPendingRow {
  return {
    sessionId: row.session_id,
    pendingSeq: Number(row.pending_seq),
    sessionThreadId: row.session_thread_id,
    type: row.type,
    eventId: row.event_id,
    data: row.data,
    enqueuedAt: Number(row.enqueued_at),
    cancelledAt: row.cancelled_at == null ? null : Number(row.cancelled_at),
  };
}
