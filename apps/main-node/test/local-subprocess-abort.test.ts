import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTools } from "@open-managed-agents/agent/harness/tools";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";

describe("LocalSubprocessSandbox cancellation", () => {
  it("kills the whole process group on timeout", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "oma-local-subprocess-timeout-"));
    const sandbox = new LocalSubprocessSandbox({
      workdir,
      defaultTimeoutMs: 10_000,
      logger: { warn: () => undefined, log: () => undefined },
    });
    const startedAt = Date.now();

    const result = await sandbox.exec("sleep 30", 50);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result).toMatch(/signal=SIGTERM/i);
    await sandbox.destroy();
  });

  it("kills an in-flight command when its AbortSignal trips", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "oma-local-subprocess-"));
    const sandbox = new LocalSubprocessSandbox({
      workdir,
      defaultTimeoutMs: 10_000,
      logger: { warn: () => undefined, log: () => undefined },
    });
    const controller = new AbortController();
    const startedAt = Date.now();

    const execWithSignal = (sandbox as unknown as {
      execWithSignal?: (command: string, timeout?: number, signal?: AbortSignal) => Promise<string>;
    }).execWithSignal;
    expect(execWithSignal).toBeTypeOf("function");

    const resultPromise = execWithSignal!.call(sandbox, "sleep 30", 10_000, controller.signal);
    setTimeout(() => controller.abort("test-interrupt"), 50);
    const result = await resultPromise;

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result).toMatch(/signal=SIGTERM|cancelled/i);
    await sandbox.destroy();
  });

  it("passes the model tool AbortSignal through the bash tool", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "oma-local-subprocess-tool-"));
    const sandbox = new LocalSubprocessSandbox({
      workdir,
      defaultTimeoutMs: 10_000,
      logger: { warn: () => undefined, log: () => undefined },
    });
    const tools = await buildTools({
      id: "agent-1",
      name: "fake",
      model: "fake",
      system: "",
      tools: [],
    }, sandbox);
    const controller = new AbortController();
    const resultPromise = tools.bash.execute(
      { command: "sleep 30", timeout: 10_000 },
      { toolCallId: "tool-1", messages: [], abortSignal: controller.signal },
    );
    setTimeout(() => controller.abort("test-interrupt"), 50);

    await expect(resultPromise).resolves.toMatch(/exit=130|cancelled/i);
    await sandbox.destroy();
  });
});
