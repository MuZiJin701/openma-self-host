import { describe, expect, it } from "vitest";
import { InMemorySkillService } from "@open-managed-agents/skills-store";

describe("tenant-scoped skills", () => {
  it("keeps immutable versions and file contents isolated by tenant", async () => {
    const service = new InMemorySkillService();
    const skill = await service.create({ tenantId: "tenant-a", name: "research" });

    const version = await service.createVersion({
      tenantId: "tenant-a",
      skillId: skill.id,
      files: [{ filename: "SKILL.md", content: "A-only" }],
    });

    expect(version.version).toBe("1");
    await expect(
      service.createVersion({
        tenantId: "tenant-b",
        skillId: skill.id,
        files: [{ filename: "SKILL.md", content: "leak" }],
      }),
    ).rejects.toThrow("Skill not found");
    await expect(
      service.createVersion({
        tenantId: "tenant-a",
        skillId: skill.id,
        version: "1",
        files: [{ filename: "SKILL.md", content: "mutated" }],
      }),
    ).rejects.toThrow("already exists");

    expect(await service.getVersion("tenant-b", skill.id, "1")).toBeNull();
    expect((await service.getVersion("tenant-a", skill.id, "1"))?.files[0]?.content).toBe("A-only");
  });

  it("archives a skill without deleting its immutable versions", async () => {
    const service = new InMemorySkillService();
    const skill = await service.create({ tenantId: "tenant-a", name: "docs" });
    await service.createVersion({
      tenantId: "tenant-a",
      skillId: skill.id,
      files: [{ filename: "README.md", content: "docs" }],
    });

    await service.archive("tenant-a", skill.id);
    expect((await service.get("tenant-a", skill.id))?.archived_at).not.toBeNull();
    expect(await service.getVersion("tenant-a", skill.id, "1")).not.toBeNull();
  });
});
