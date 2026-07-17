import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("user workspace", () => {
  it("shares files between sessions of the same user", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const sessionA = new LocalSubprocessSandbox({
      workdir: join(root, "user-a"),
      sessionId: "session-a",
      sharedWorkspace: true,
    });
    const sessionB = new LocalSubprocessSandbox({
      workdir: join(root, "user-a"),
      sessionId: "session-b",
      sharedWorkspace: true,
    });

    await sessionA.writeFile("/workspace/shared.txt", "hello");

    await expect(sessionB.readFile("/workspace/shared.txt")).resolves.toBe("hello");
  });

  it("does not expose one user's workspace to another user", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const userA = new LocalSubprocessSandbox({
      workdir: join(root, "user-a"),
      sessionId: "session-a",
      sharedWorkspace: true,
    });
    const userB = new LocalSubprocessSandbox({
      workdir: join(root, "user-b"),
      sessionId: "session-b",
      sharedWorkspace: true,
    });

    await userA.writeFile("/workspace/private.txt", "secret");

    await expect(userB.readFile("/workspace/private.txt")).rejects.toThrow();
  });

  it("does not delete a user workspace when one session is destroyed", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const workspace = join(root, "user-a");
    const sessionA = new LocalSubprocessSandbox({
      workdir: workspace,
      sessionId: "session-a",
      sharedWorkspace: true,
    });
    const sessionB = new LocalSubprocessSandbox({
      workdir: workspace,
      sessionId: "session-b",
      sharedWorkspace: true,
    });

    await sessionA.writeFile("/workspace/keep.txt", "keep");
    await sessionA.destroy();

    await expect(sessionB.readFile("/workspace/keep.txt")).resolves.toBe("keep");
    await sessionB.destroy();
  });
});
