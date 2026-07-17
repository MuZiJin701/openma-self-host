import { Hono } from "hono";
import {
  SkillNotFoundError,
  SkillVersionExistsError,
  type SkillService,
} from "@open-managed-agents/skills-store";

interface Vars { Variables: { user_id: string } }

export function buildSkillRoutes(deps: { skills: SkillService }) {
  const app = new Hono<Vars>();

  app.post("/", async (c) => {
    const body = await c.req.json<{ name?: string; description?: string | null }>();
    if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
    const skill = await deps.skills.create({ userId: c.var.user_id, name: body.name.trim(), description: body.description });
    return c.json(skill, 201);
  });
  app.get("/", async (c) => c.json({ data: await deps.skills.list(c.var.user_id) }));

  app.post("/:id/versions", async (c) => {
    try {
      const body = await c.req.json<{ version?: string; description?: string | null; files?: Array<{ filename: string; content: string; content_type?: string }> }>();
      if (!Array.isArray(body.files)) return c.json({ error: "files is required" }, 400);
      const version = await deps.skills.createVersion({
        userId: c.var.user_id, skillId: c.req.param("id"), version: body.version,
        description: body.description,
        files: body.files.map((file) => ({ filename: file.filename, content: file.content, contentType: file.content_type })),
      });
      return c.json(version, 201);
    } catch (error) {
      if (error instanceof SkillNotFoundError) return c.json({ error: error.message }, 404);
      if (error instanceof SkillVersionExistsError) return c.json({ error: error.message }, 409);
      if (error instanceof Error && error.message === "invalid skill filename") return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.get("/:id/versions", async (c) => {
    const skill = await deps.skills.get(c.var.user_id, c.req.param("id"));
    if (!skill) return c.json({ error: "Skill not found" }, 404);
    const versions: Array<unknown> = [];
    for (let n = 1; n <= Number(skill.latest_version ?? "0"); n++) {
      const version = await deps.skills.getVersion(c.var.user_id, skill.id, String(n));
      if (version) versions.push({ version: version.version, description: version.description, file_count: version.files.length, created_at: version.created_at });
    }
    return c.json({ data: versions.reverse() });
  });
  app.get("/:id/versions/:version", async (c) => {
    const version = await deps.skills.getVersion(c.var.user_id, c.req.param("id"), c.req.param("version"));
    return version ? c.json(version) : c.json({ error: "Version not found" }, 404);
  });
  app.get("/:id", async (c) => {
    const skill = await deps.skills.get(c.var.user_id, c.req.param("id"));
    return skill ? c.json(skill) : c.json({ error: "Skill not found" }, 404);
  });
  app.post("/:id/archive", async (c) => {
    try {
      await deps.skills.archive(c.var.user_id, c.req.param("id"));
      return c.json({ type: "skill_archived", id: c.req.param("id") });
    } catch (error) {
      if (error instanceof SkillNotFoundError) return c.json({ error: error.message }, 404);
      throw error;
    }
  });
  return app;
}
