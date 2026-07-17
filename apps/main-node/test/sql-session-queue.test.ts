import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SqlPendingQueue,
  ensureSchema as ensureEventLogSchema,
} from "@open-managed-agents/event-log/sql";
import type { SessionEvent } from "@open-managed-agents/shared";
import { bootstrapTestDb, type TestDb } from "./_helpers/bootstrap-test-db";

describe("SqlPendingQueue crash-safe cancellation", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await bootstrapTestDb();
    await ensureEventLogSchema(testDb.sql, "sqlite");
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("does not re-arm a promoted turn cancelled before process death", async () => {
    const queue = new SqlPendingQueue(testDb.sql, "sqlite");
    const sessionId = "session-cancelled-after-promote";
    const event = {
      id: "event-cancelled-after-promote",
      type: "user.message",
      content: [{ type: "text", text: "cancel me" }],
    } as SessionEvent;

    const receipt = await queue.enqueue({ sessionId, event });
    await queue.promote(sessionId, receipt.pendingSeq);
    await testDb.sql
      .prepare(`UPDATE session_turn_runs SET status = 'running' WHERE session_id = ? AND event_id = ?`)
      .bind(sessionId, receipt.eventId)
      .run();

    await queue.cancelAll(sessionId);

    expect(await queue.promoted(sessionId)).toEqual([]);
    const ledger = await testDb.sql
      .prepare(`SELECT status FROM session_turn_runs WHERE session_id = ? AND event_id = ?`)
      .bind(sessionId, receipt.eventId)
      .first<{ status: string }>();
    expect(ledger?.status).toBe("failed");
  });

  it("duplicate promote keeps one canonical event and completes the duplicate ledger", async () => {
    const queue = new SqlPendingQueue(testDb.sql, "sqlite");
    const sessionId = "session-duplicate-promote";
    const event = {
      id: "event-duplicate-promote",
      type: "user.message",
      content: [{ type: "text", text: "once" }],
    } as SessionEvent;

    const first = await queue.enqueue({ sessionId, event });
    await queue.promote(sessionId, first.pendingSeq);
    await queue.markTurn(sessionId, first.eventId, "completed");
    const duplicate = await queue.enqueue({ sessionId, event });
    expect(await queue.promote(sessionId, duplicate.pendingSeq)).toBeNull();

    const events = await testDb.sql
      .prepare(`SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?`)
      .bind(sessionId)
      .first<{ count: number }>();
    const active = await queue.promoted(sessionId);
    expect(Number(events?.count ?? 0)).toBe(1);
    expect(active).toEqual([]);
  });
});
