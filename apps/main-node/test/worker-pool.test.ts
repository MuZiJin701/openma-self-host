import { describe, expect, it } from "vitest";
import { WorkerPool } from "../src/lib/worker-pool.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("WorkerPool", () => {
  it("enforces global and tenant active limits while preserving runnable FIFO", async () => {
    const pool = new WorkerPool({ maxActive: 2, tenantMaxActive: 1 });
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await pool.submit({ jobId: "a1", tenantId: "a", sessionId: "s1", run: async () => { started.push("a1"); await gate; } });
    await pool.submit({ jobId: "a2", tenantId: "a", sessionId: "s2", run: async () => { started.push("a2"); } });
    await pool.submit({ jobId: "b1", tenantId: "b", sessionId: "s3", run: async () => { started.push("b1"); } });
    await wait(10);
    expect(started).toEqual(["a1", "b1"]);
    release();
    await wait(10);
    expect(started).toEqual(["a1", "b1", "a2"]);
    await pool.shutdown();
  });

  it("cancels queued and running jobs and aborts on timeout", async () => {
    const pool = new WorkerPool({ maxActive: 1, tenantMaxActive: 1, timeoutMs: 15 });
    let aborted = false;
    await pool.submit({ jobId: "run", tenantId: "a", sessionId: "s1", run: async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }));
    } });
    await pool.submit({ jobId: "queued", tenantId: "a", sessionId: "s2", run: async () => undefined });
    expect(await pool.cancel("queued")).toBe(true);
    await wait(30);
    expect(aborted).toBe(true);
    expect(await pool.cancel("missing")).toBe(false);
    await pool.shutdown();
  });
});
