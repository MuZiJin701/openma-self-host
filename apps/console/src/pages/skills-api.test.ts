import { describe, expect, it } from "vitest";

import { archiveSkill, createSkillWithVersion } from "./skills-api";

describe("self-host skills API contract", () => {
  it("creates a skill and publishes its first version through JSON routes", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { id: "skill_1" } as T;
    };

    await createSkillWithVersion(api, {
      name: "release-notes",
      description: "Release note guidance",
      content: "# Release notes",
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/v1/skills",
      "/v1/skills/skill_1/versions",
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: "release-notes",
      description: "Release note guidance",
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      files: [{ filename: "SKILL.md", content: "# Release notes", content_type: "text/markdown" }],
    });
  });

  it("archives a skill instead of calling an unsupported delete route", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return {} as T;
    };

    await archiveSkill(api, "skill_1");

    expect(calls).toEqual([
      { path: "/v1/skills/skill_1/archive", init: { method: "POST" } },
    ]);
  });
});
