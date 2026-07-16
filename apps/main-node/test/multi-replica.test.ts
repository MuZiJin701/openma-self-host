// Compose-backed multi-replica smoke test.
//
// Enable with:
//   MULTI_REPLICA_A_URL=http://oma-server-a:8787
//   MULTI_REPLICA_B_URL=http://oma-server-b:8787
//   PG_TEST_URL=postgres://oma:oma@postgres:5432/oma
//
// The test is skipped when these values are absent so normal local/unit test
// runs do not require Docker.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresSqlClient, type SqlClient } from "@open-managed-agents/sql-client";
import { createPgQueue, ensureQueueSchema } from "@open-managed-agents/queue";
import {
  SqlEventLog,
  ensureSchema as ensureEventLogSchema,
} from "@open-managed-agents/event-log/sql";
import type { SessionEvent } from "@open-managed-agents/shared";
import { PgEventStreamHub } from "../src/lib/pg-event-stream-hub";
import type { EventWriter } from "../src/lib/event-stream-hub";

const A_URL = process.env.MULTI_REPLICA_A_URL ?? "";
const B_URL = process.env.MULTI_REPLICA_B_URL ?? "";
const PG_URL = process.env.PG_TEST_URL ?? "";
const enabled =
  A_URL.length > 0 &&
  B_URL.length > 0 &&
  (PG_URL.startsWith("postgres://") || PG_URL.startsWith("postgresql://"));
const d = enabled ? describe : describe.skip;

let sql: SqlClient;
const sessions: string[] = [];

beforeAll(async () => {
  if (!enabled) return;
  sql = await createPostgresSqlClient(PG_URL);
  await ensureQueueSchema(sql);
  await ensureEventLogSchema(sql, "postgres");
});

afterAll(async () => {
  if (!enabled || !sql) return;
  for (const sessionId of sessions) {
    await sql.prepare(`DELETE FROM session_events WHERE session_id = ?`).bind(sessionId).run();
    await sql.prepare(`DELETE FROM session_streams WHERE session_id = ?`).bind(sessionId).run();
  }
  await sql.prepare(`DELETE FROM queue_messages WHERE queue_name LIKE ?`).bind("multi-replica-%").run();
});

d("Postgres multi-replica runtime", () => {
  it("keeps both Node replicas healthy on shared Postgres and MinIO backends", async () => {
    const [a, b] = await Promise.all([fetchHealth(A_URL), fetchHealth(B_URL)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.status).toBe("ok");
    expect(b.body.status).toBe("ok");
    expect(a.body.backends.db).toContain("postgres");
    expect(b.body.backends.db).toContain("postgres");
    expect(a.body.backends.hub).toBe("pg-notify");
    expect(b.body.backends.hub).toBe("pg-notify");
    expect(a.body.backends.memory_blobs).toContain("s3");
    expect(b.body.backends.memory_blobs).toContain("s3");
  });

  it("claims each shared queue event once across two replica workers", async () => {
    const queueName = `multi-replica-queue-${Date.now()}`;
    const queueA = createPgQueue<{ id: string }>({
      name: queueName,
      sql,
      workerId: "replica-a",
      pollIntervalMs: 25,
      batchSize: 1,
    });
    const queueB = createPgQueue<{ id: string }>({
      name: queueName,
      sql,
      workerId: "replica-b",
      pollIntervalMs: 25,
      batchSize: 1,
    });
    const seen = new Map<string, string[]>();
    seen.set("a", []);
    seen.set("b", []);

    for (let i = 0; i < 12; i++) await queueA.enqueue({ id: `event-${i}` });

    const stopA = queueA.subscribe(async (message) => {
      seen.get("a")!.push(message.body.id);
      await sleep(5);
    });
    const stopB = queueB.subscribe(async (message) => {
      seen.get("b")!.push(message.body.id);
      await sleep(5);
    });

    await waitFor(() => seen.get("a")!.length + seen.get("b")!.length === 12, 8_000);
    await Promise.resolve(stopA());
    await Promise.resolve(stopB());

    const all = [...seen.get("a")!, ...seen.get("b")!];
    expect(new Set(all).size).toBe(12);
    expect(all.sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `event-${i}`).sort(),
    );
  });

  it("fans an event written through one hub to the other replica hub", async () => {
    const sessionId = uniqSessionId();
    sessions.push(sessionId);
    const fetchEventsAfter = (id: string, after: number) =>
      new SqlEventLog(sql, id, () => {}).getEventsAsync(after);
    const hubA = await PgEventStreamHub.create({ dsn: PG_URL, fetchEventsAfter });
    const hubB = await PgEventStreamHub.create({ dsn: PG_URL, fetchEventsAfter });

    try {
      const received: SessionEvent[] = [];
      const writer: EventWriter = {
        closed: false,
        write(event) { received.push(event as SessionEvent); },
        close() { this.closed = true; },
      };
      hubB.attach(sessionId, writer);

      const log = new SqlEventLog(sql, sessionId, () => {});
      await log.appendAsync({
        type: "agent.message",
        content: [{ type: "text", text: "multi-replica" }],
      } as SessionEvent);
      const events = await log.getEventsAsync();
      hubA.publish(sessionId, events.at(-1)!);

      await waitFor(() => received.length === 1, 2_000);
      expect(received[0]?.type).toBe("agent.message");
    } finally {
      await hubA.stop();
      await hubB.stop();
    }
  });
});

async function fetchHealth(baseUrl: string): Promise<{
  status: number;
  body: {
    status?: string;
    backends: {
      db?: string;
      hub?: string;
      memory_blobs?: string;
    };
  };
}> {
  const response = await fetch(new URL("/health", baseUrl));
  return { status: response.status, body: await response.json() as never };
}

function uniqSessionId(): string {
  return `multi_replica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
