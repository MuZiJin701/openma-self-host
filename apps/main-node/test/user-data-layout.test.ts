import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUserDataLayout } from "../src/lib/user-data-layout.js";

describe("user data layout", () => {
  const dataDir = "/tmp/openma-layout";
  const layout = createUserDataLayout(dataDir);

  it("derives one workspace and internal roots per user", () => {
    expect(layout.userRoot("usr_a")).toBe(join(dataDir, "usr_a"));
    expect(layout.workspaceRoot("usr_a")).toBe(join(dataDir, "usr_a"));
    expect(layout.filesRoot("usr_a")).toBe(join(dataDir, "usr_a", ".openma", "files"));
    expect(layout.outputsRoot("usr_a", "sess_1")).toBe(
      join(dataDir, "usr_a", ".openma", "outputs", "sess_1"),
    );
    expect(layout.backupsRoot("usr_a")).toBe(join(dataDir, "usr_a", ".openma", "backups"));
    expect(layout.userRoot("usr_a")).not.toBe(layout.userRoot("usr_b"));
  });

  it("rejects ids that could escape DATA_DIR", () => {
    expect(() => layout.userRoot("../outside")).toThrow();
    expect(() => layout.userRoot("a/b")).toThrow();
    expect(() => layout.outputsRoot("usr_a", "../outside")).toThrow();
  });
});
