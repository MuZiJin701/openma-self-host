import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("tenant workspace", () => {
  it("shares files between sessions of the same tenant", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const sessionA = new LocalSubprocessSandbox({
      workdir: join(root, "tenant-a"),
      sessionId: "session-a",
      sharedWorkspace: true,
    });
    const sessionB = new LocalSubprocessSandbox({
      workdir: join(root, "tenant-a"),
      sessionId: "session-b",
      sharedWorkspace: true,
    });

    await sessionA.writeFile("/workspace/shared.txt", "hello");

    await expect(sessionB.readFile("/workspace/shared.txt")).resolves.toBe("hello");
  });

  it("does not expose one tenant's workspace to another tenant", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const tenantA = new LocalSubprocessSandbox({
      workdir: join(root, "tenant-a"),
      sessionId: "session-a",
      sharedWorkspace: true,
    });
    const tenantB = new LocalSubprocessSandbox({
      workdir: join(root, "tenant-b"),
      sessionId: "session-b",
      sharedWorkspace: true,
    });

    await tenantA.writeFile("/workspace/private.txt", "secret");

    await expect(tenantB.readFile("/workspace/private.txt")).rejects.toThrow();
  });

  it("does not delete a tenant workspace when one session is destroyed", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-workspace-"));
    created.push(root);
    const workspace = join(root, "tenant-a");
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
