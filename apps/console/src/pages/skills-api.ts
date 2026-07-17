export type SkillsApi = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

export interface CreateSkillWithVersionInput {
  name: string;
  description?: string;
  content: string;
}

interface CreatedSkill {
  id: string;
}

export async function createSkillWithVersion(
  api: SkillsApi,
  input: CreateSkillWithVersionInput,
): Promise<CreatedSkill> {
  const skill = await api<CreatedSkill>("/v1/skills", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description || undefined,
    }),
  });
  await api(`/v1/skills/${skill.id}/versions`, {
    method: "POST",
    body: JSON.stringify({
      files: [
        {
          filename: "SKILL.md",
          content: input.content,
          content_type: "text/markdown",
        },
      ],
    }),
  });
  return skill;
}

export function archiveSkill(api: SkillsApi, skillId: string): Promise<unknown> {
  return api(`/v1/skills/${skillId}/archive`, { method: "POST" });
}
