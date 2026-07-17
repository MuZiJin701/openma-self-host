import { describe, expect, it } from "vitest";
import {
  InMemorySessionPendingQueue,
  type SessionTurnInput,
  type SessionTurnLedgerStatus,
} from "@open-managed-agents/session-runtime";
import type { SessionEvent } from "@open-managed-agents/shared";
import {
  SerialSessionTurnExecutor,
  findPendingToolAction,
  listPendingToolActions,
} from "../src/lib/session-turn-executor";
import { WorkerPool } from "../src/lib/worker-pool.js";

function message(id: string, text = id) {
  return {
    id,
    type: "user.message" as const,
    content: [{ type: "text" as const, text }],
  };
}

class RecordingQueue extends InMemorySessionPendingQueue {
  readonly turnStatuses: SessionTurnLedgerStatus[] = [];

  override async markTurn(
    sessionId: string,
    eventId: string,
    status: SessionTurnLedgerStatus,
  ): Promise<void> {
    this.turnStatuses.push(status);
    await super.markTurn(sessionId, eventId, status);
  }
}

describe("SerialSessionTurnExecutor", () => {
  it("matches a tool confirmation only to an unresolved tool use", () => {
    const action = findPendingToolAction(
      [
        {
          type: "agent.tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
        } as SessionEvent,
      ],
      {
        type: "user.tool_confirmation",
        tool_use_id: "tool-1",
        result: "allow",
      } as SessionEvent,
    );

    expect(action).toMatchObject({
      kind: "tool_confirmation",
      toolUseId: "tool-1",
      toolName: "bash",
    });
  });

  it("matches a custom tool result only to an unresolved custom tool use", () => {
    const action = findPendingToolAction(
      [
        {
          type: "agent.custom_tool_use",
          id: "custom-1",
          name: "approve_purchase",
          input: { amount: 10 },
        } as SessionEvent,
      ],
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: "custom-1",
        content: [{ type: "text", text: "approved" }],
      } as SessionEvent,
    );

    expect(action).toMatchObject({
      kind: "custom_tool_result",
      toolUseId: "custom-1",
      toolName: "approve_purchase",
    });
  });

  it("does not match an action after its tool result is already canonical", () => {
    const action = findPendingToolAction(
      [
        {
          type: "agent.tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
        } as SessionEvent,
        {
          type: "agent.tool_result",
          tool_use_id: "tool-1",
          content: "hi",
        } as SessionEvent,
      ],
      {
        type: "user.tool_confirmation",
        tool_use_id: "tool-1",
        result: "allow",
      } as SessionEvent,
    );

    expect(action).toBeNull();
  });

  it("lists unresolved confirmations in canonical order", () => {
    const pending = listPendingToolActions([
      {
        type: "agent.tool_use",
        id: "tool-1",
        name: "bash",
        input: { command: "echo one" },
      } as SessionEvent,
      {
        type: "agent.custom_tool_use",
        id: "custom-1",
        name: "approve_purchase",
        input: { amount: 10 },
      } as SessionEvent,
      {
        type: "agent.tool_result",
        tool_use_id: "tool-1",
        content: "one",
      } as SessionEvent,
    ]);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "custom_tool_result",
      toolUseId: "custom-1",
    });
  });

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

  it("notifies the session shell after an active turn is cancelled", async () => {
    const queue = new InMemorySessionPendingQueue();
    const cancellations: string[] = [];
    const hooks = {
      onTurnCancelled: (_input: SessionTurnInput, reason: "cancelled" | "timeout") => {
        cancellations.push(reason);
      },
    };
    const executor = new SerialSessionTurnExecutor(
      queue,
      {
        run: async (_input, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      {},
      hooks as never,
    );

    await executor.enqueue("session-a", "tenant-a", "agent-a", message("cancel-1"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await executor.interrupt("session-a");
    await executor.waitForIdle("session-a");

    expect(cancellations).toEqual(["cancelled"]);
  });

  it("does not mark a timed out worker turn as completed", async () => {
    const queue = new RecordingQueue();
    const pool = new WorkerPool({
      maxActive: 1,
      tenantMaxActive: 1,
      timeoutMs: 10,
    });
    const executor = new SerialSessionTurnExecutor(
      queue,
      {
        run: async (_input, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      {},
      { workerPool: pool },
    );

    await executor.enqueue("session-a", "tenant-a", "agent-a", message("timeout-1"));
    await executor.waitForIdle("session-a");

    expect(queue.turnStatuses).toEqual(["running", "failed"]);
    await pool.shutdown();
  });
});
