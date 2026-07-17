import { describe, expect, it } from "vitest";
import { InMemorySkillService } from "@open-managed-agents/skills-store";

describe("user-scoped skills", () => {
  it("keeps immutable versions and file contents isolated by user", async () => {
    const service = new InMemorySkillService();
    const skill = await service.create({ userId: "user-a", name: "research" });

    const version = await service.createVersion({
      userId: "user-a",
      skillId: skill.id,
      files: [{ filename: "SKILL.md", content: "A-only" }],
    });

    expect(version.version).toBe("1");
    await expect(
      service.createVersion({
        userId: "user-b",
        skillId: skill.id,
        files: [{ filename: "SKILL.md", content: "leak" }],
      }),
    ).rejects.toThrow("Skill not found");
    await expect(
      service.createVersion({
        userId: "user-a",
        skillId: skill.id,
        version: "1",
        files: [{ filename: "SKILL.md", content: "mutated" }],
      }),
    ).rejects.toThrow("already exists");

    expect(await service.getVersion("user-b", skill.id, "1")).toBeNull();
    expect((await service.getVersion("user-a", skill.id, "1"))?.files[0]?.content).toBe("A-only");
  });

  it("archives a skill without deleting its immutable versions", async () => {
    const service = new InMemorySkillService();
    const skill = await service.create({ userId: "user-a", name: "docs" });
    await service.createVersion({
      userId: "user-a",
      skillId: skill.id,
      files: [{ filename: "README.md", content: "docs" }],
    });

    await service.archive("user-a", skill.id);
    expect((await service.get("user-a", skill.id))?.archived_at).not.toBeNull();
    expect(await service.getVersion("user-a", skill.id, "1")).not.toBeNull();
  });
});
