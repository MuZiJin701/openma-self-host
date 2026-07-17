import { describe, expect, it } from "vitest";
import type { SessionStreamFrame } from "@open-managed-agents/session-runtime";
import type { SessionEvent } from "@open-managed-agents/shared";
import { NodeSessionRouter } from "../src/lib/node-session-router";
import { InProcessEventStreamHub } from "../src/lib/event-stream-hub";

function message(id: string, text: string): SessionEvent & { seq: number } {
  return {
    id,
    type: "user.message",
    content: [{ type: "text", text }],
    seq: Number(id.slice(-1)),
  } as SessionEvent & { seq: number };
}

async function nextWithTimeout(
  iterator: AsyncIterator<SessionStreamFrame>,
): Promise<IteratorResult<SessionStreamFrame>> {
  return Promise.race([
    iterator.next(),
    new Promise<IteratorResult<SessionStreamFrame>>((resolve) => {
      setTimeout(
        () => resolve({ done: true, value: undefined as never }),
        50,
      );
    }),
  ]);
}

describe("NodeSessionRouter SSE replay", () => {
  it("does not lose an event published while replay history is being read", async () => {
    const hub = new InProcessEventStreamHub();
    const first = message("event-1", "first");
    const second = message("event-2", "second");
    let historyReads = 0;
    const eventLog = {
      getEventsAsync: async () => {
        historyReads += 1;
        if (historyReads === 1) {
          // This event lands during the replay read. A correct implementation
          // must already be subscribed before it starts reading history.
          hub.publish("session-1", second);
        }
        return [first];
      },
    };

    const router = new NodeSessionRouter({
      sql: {} as never,
      hub,
      registry: {} as never,
      newEventLog: () => eventLog as never,
    });
    const handle = await router.streamEvents("session-1", {
      replay: true,
      include: ["chunks"],
    });

    try {
      const iterator = handle[Symbol.asyncIterator]();
      const replayed = await iterator.next();
      expect(replayed.done).toBe(false);
      expect(JSON.parse(replayed.value.data).id).toBe("event-1");

      const caughtUp = await nextWithTimeout(iterator);
      expect(caughtUp.done).toBe(false);
      expect(JSON.parse(caughtUp.value.data).id).toBe("event-2");
    } finally {
      handle.close();
    }
  });
});
