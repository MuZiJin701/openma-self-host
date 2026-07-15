import { describe, expect, it } from "vitest";
import {
  InMemorySessionPendingQueue,
  type SessionTurnInput,
} from "@open-managed-agents/session-runtime";
import { SerialSessionTurnExecutor } from "../src/lib/session-turn-executor";

function message(id: string, text = id) {
  return {
    id,
    type: "user.message" as const,
    content: [{ type: "text" as const, text }],
  };
}

describe("SerialSessionTurnExecutor", () => {
  it("replays a promoted turn after a crash before harness start", async () => {
    const queue = new InMemorySessionPendingQueue();
    const receipt = await queue.enqueue({ sessionId: "crash", event: message("crash-1") });
    await queue.promote("crash", receipt.pendingSeq);
    const seen: string[] = [];
    const executor = new SerialSessionTurnExecutor(queue, {
      run: async (input) => { seen.push(input.event.id!); },
    }, {}, { resolveContext: async () => ({ tenantId: "tenant-a", agentId: "agent-a" }) });
    await executor.recover("crash");
    await executor.waitForIdle("crash");
    expect(seen).toEqual(["crash-1"]);
    expect(await queue.promoted?.("crash")).toEqual([]);
  });

  it("runs messages FIFO and never overlaps within one session", async () => {
    const queue = new InMemorySessionPendingQueue();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const runner = {
      async run(input: SessionTurnInput): Promise<void> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(input.event.id!);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
    };
    const executor = new SerialSessionTurnExecutor(queue, runner);

    await executor.enqueue("session-a", "tenant-a", "agent-a", message("a1"));
    await executor.enqueue("session-a", "tenant-a", "agent-a", message("a2"));
    await executor.waitForIdle("session-a");

    expect(order).toEqual(["a1", "a2"]);
    expect(maxActive).toBe(1);
  });

  it("allows different sessions to run concurrently", async () => {
    const queue = new InMemorySessionPendingQueue();
    let active = 0;
    let maxActive = 0;
    const runner = {
      async run(): Promise<void> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      },
    };
    const executor = new SerialSessionTurnExecutor(queue, runner);

    await Promise.all([
      executor.enqueue("session-a", "tenant-a", "agent-a", message("a1")),
      executor.enqueue("session-b", "tenant-b", "agent-b", message("b1")),
    ]);
    await Promise.all([
      executor.waitForIdle("session-a"),
      executor.waitForIdle("session-b"),
    ]);

    expect(maxActive).toBe(2);
  });

  it("does not execute a duplicate event id twice", async () => {
    const queue = new InMemorySessionPendingQueue();
    const executed: string[] = [];
    const runner = {
      async run(input: SessionTurnInput): Promise<void> {
        executed.push(input.event.id!);
      },
    };
    const executor = new SerialSessionTurnExecutor(queue, runner);

    const first = await executor.enqueue("session-a", "tenant-a", "agent-a", message("same"));
    const second = await executor.enqueue("session-a", "tenant-a", "agent-a", message("same"));
    await executor.waitForIdle("session-a");

    expect(second.pendingSeq).toBe(first.pendingSeq);
    expect(executed).toEqual(["same"]);
  });

  it("cancels queued work and aborts the running turn", async () => {
    const queue = new InMemorySessionPendingQueue();
    let aborted = false;
    const runner = {
      async run(_input: SessionTurnInput, signal: AbortSignal): Promise<void> {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }, { once: true });
        });
      },
    };
    const executor = new SerialSessionTurnExecutor(queue, runner);

    await executor.enqueue("session-a", "tenant-a", "agent-a", message("a1"));
    await executor.enqueue("session-a", "tenant-a", "agent-a", message("a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await executor.interrupt("session-a");
    await executor.waitForIdle("session-a");

    expect(aborted).toBe(true);
    expect(await queue.countActive("session-a")).toBe(0);
  });
});
