import { describe, expect, it } from "vitest";
import { createInMemoryAgentService } from "@open-managed-agents/agents-store/test-fakes";
import { createInMemoryEnvironmentService } from "@open-managed-agents/environments-store/test-fakes";
import { createInMemoryFileService } from "@open-managed-agents/files-store/test-fakes";
import { createInMemoryModelCardService } from "@open-managed-agents/model-cards-store/test-fakes";
import { createInMemorySessionService } from "@open-managed-agents/sessions-store/test-fakes";
import { InMemorySkillService } from "@open-managed-agents/skills-store";

describe("user-owned resources", () => {
  it("does not expose one user's resources through another user's key", async () => {
    const agents = createInMemoryAgentService();
    const environments = createInMemoryEnvironmentService();
    const files = createInMemoryFileService();
    const modelCards = createInMemoryModelCardService();
    const sessions = createInMemorySessionService();
    const skills = new InMemorySkillService();
    const userA = "usr_a";
    const userB = "usr_b";

    const agentA = await agents.service.create({
      userId: userA,
      input: { name: "Agent A", model: "test-model" },
    });
    const envA = await environments.service.create({
      userId: userA,
      name: "Local A",
      config: { type: "local" },
    });
    const fileA = await files.service.create({
      id: "file_a",
      userId: userA,
      filename: "a.txt",
      mediaType: "text/plain",
      sizeBytes: 1,
      r2Key: "usr_a/.openma/files/file_a",
    });
    const cardA = await modelCards.service.create({
      userId: userA,
      modelId: "model-a",
      provider: "anthropic",
      apiKey: "test-key-a",
    });
    const sessionA = await sessions.service.create({
      userId: userA,
      agentId: agentA.id,
      environmentId: envA.id,
      title: "Session A",
    });
    const skillA = await skills.create({ userId: userA, name: "Skill A" });

    const agentB = await agents.service.create({
      userId: userB,
      input: { name: "Agent B", model: "test-model" },
    });
    const envB = await environments.service.create({
      userId: userB,
      name: "Local B",
      config: { type: "local" },
    });
    const fileB = await files.service.create({
      id: "file_b",
      userId: userB,
      filename: "b.txt",
      mediaType: "text/plain",
      sizeBytes: 1,
      r2Key: "usr_b/.openma/files/file_b",
    });
    const cardB = await modelCards.service.create({
      userId: userB,
      modelId: "model-b",
      provider: "anthropic",
      apiKey: "test-key-b",
    });
    const sessionB = await sessions.service.create({
      userId: userB,
      agentId: agentB.id,
      environmentId: envB.id,
      title: "Session B",
    });
    const skillB = await skills.create({ userId: userB, name: "Skill B" });

    expect((await agents.service.list({ userId: userB })).map((row) => row.id)).toEqual([agentB.id]);
    expect(await agents.service.get({ userId: userB, agentId: agentA.id })).toBeNull();
    expect((await environments.service.list({ userId: userB })).map((row) => row.id)).toEqual([envB.id]);
    expect(await environments.service.get({ userId: userB, environmentId: envA.id })).toBeNull();
    expect((await files.service.list({ userId: userB })).map((row) => row.id)).toEqual([fileB.id]);
    expect(await files.service.get({ userId: userB, fileId: fileA.id })).toBeNull();
    expect((await modelCards.service.list({ userId: userB })).map((row) => row.id)).toEqual([cardB.id]);
    expect(await modelCards.service.get({ userId: userB, cardId: cardA.id })).toBeNull();
    expect((await sessions.service.list({ userId: userB })).map((row) => row.id)).toEqual([sessionB.session.id]);
    expect(await sessions.service.get({ userId: userB, sessionId: sessionA.session.id })).toBeNull();
    expect((await skills.list(userB)).map((row) => row.id)).toEqual([skillB.id]);
    expect(await skills.get(userB, skillA.id)).toBeNull();
  });
});
