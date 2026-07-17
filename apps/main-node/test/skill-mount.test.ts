import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemorySkillService } from "@open-managed-agents/skills-store";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";
import { SessionRegistry } from "../src/registry";

const sandboxes: LocalSubprocessSandbox[] = [];

afterEach(async () => {
  for (const sandbox of sandboxes.splice(0)) await sandbox.destroy();
});

describe("self-host skill mounting", () => {
  it("makes the mounted skill version read-only in LocalSubprocess", async () => {
    const service = new InMemorySkillService();
    const skill = await service.create({ userId: "user-a", name: "research" });
    await service.createVersion({
      userId: "user-a",
      skillId: skill.id,
      files: [{ filename: "SKILL.md", content: "immutable skill" }],
    });
    const sandbox = new LocalSubprocessSandbox({
      workdir: await mkdtemp(join(tmpdir(), "oma-skill-mount-")),
      logger: { warn: () => undefined, log: () => undefined },
    });
    sandboxes.push(sandbox);
    const registry = new SessionRegistry({ skillsService: service } as never);

    await (registry as unknown as {
      mountAgentSkills(
        sandbox: LocalSubprocessSandbox,
        userId: string,
        bindings: unknown,
      ): Promise<void>;
    }).mountAgentSkills(sandbox, "user-a", [{ skill_id: skill.id, type: "skill" }]);

    await expect(sandbox.readFile(`/mnt/skills/${skill.id}/1/SKILL.md`)).resolves.toBe("immutable skill");
    await expect(
      sandbox.writeFile(`/mnt/skills/${skill.id}/1/SKILL.md`, "mutated"),
    ).rejects.toThrow(/read-only/i);
  });
});
