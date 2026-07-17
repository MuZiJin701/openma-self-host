import { randomUUID } from "node:crypto";
import type { BlobStore } from "@open-managed-agents/blob-store";
import { skillFileBlobKey } from "@open-managed-agents/shared";
import type { SqlClient } from "@open-managed-agents/sql-client";

export interface SkillFileInput {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
}

export interface SkillFile {
  filename: string;
  content: string;
  content_type: string;
  size: number;
}

export interface Skill {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  latest_version: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface SkillVersion {
  skill_id: string;
  user_id: string;
  version: string;
  description: string | null;
  files: SkillFile[];
  created_at: string;
}

export interface CreateSkillInput {
  userId: string;
  name: string;
  description?: string | null;
}

export interface CreateSkillVersionInput {
  userId: string;
  skillId: string;
  version?: string;
  description?: string | null;
  files: SkillFileInput[];
}

export interface SkillService {
  create(input: CreateSkillInput): Promise<Skill>;
  list(userId: string): Promise<Skill[]>;
  get(userId: string, skillId: string): Promise<Skill | null>;
  createVersion(input: CreateSkillVersionInput): Promise<SkillVersion>;
  getVersion(userId: string, skillId: string, version: string): Promise<SkillVersion | null>;
  archive(userId: string, skillId: string): Promise<void>;
}

export class SkillNotFoundError extends Error {
  constructor() { super("Skill not found"); }
}

export class SkillVersionExistsError extends Error {
  constructor() { super("Skill version already exists"); }
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

export class InMemorySkillService implements SkillService {
  private skills = new Map<string, Skill>();
  private versions = new Map<string, SkillVersion>();

  async create(input: CreateSkillInput): Promise<Skill> {
    const row: Skill = {
      id: id("skill"), user_id: input.userId, name: input.name,
      description: input.description ?? null, latest_version: null,
      archived_at: null, created_at: now(),
    };
    this.skills.set(`${row.user_id}:${row.id}`, row);
    return { ...row };
  }

  async list(userId: string): Promise<Skill[]> {
    return [...this.skills.values()].filter((s) => s.user_id === userId).map((s) => ({ ...s }));
  }

  async get(userId: string, skillId: string): Promise<Skill | null> {
    const row = this.skills.get(`${userId}:${skillId}`);
    return row ? { ...row } : null;
  }

  async createVersion(input: CreateSkillVersionInput): Promise<SkillVersion> {
    const skill = this.skills.get(`${input.userId}:${input.skillId}`);
    if (!skill) throw new SkillNotFoundError();
    const version = input.version ?? String(Number(skill.latest_version ?? "0") + 1);
    const key = `${input.userId}:${input.skillId}:${version}`;
    if (this.versions.has(key)) throw new SkillVersionExistsError();
    const row: SkillVersion = {
      user_id: input.userId, skill_id: input.skillId, version,
      description: input.description ?? null,
      files: input.files.map((file) => ({
        filename: file.filename,
        content: typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content),
        content_type: file.contentType ?? "text/plain",
        size: typeof file.content === "string" ? new TextEncoder().encode(file.content).byteLength : file.content.byteLength,
      })),
      created_at: now(),
    };
    this.versions.set(key, row);
    skill.latest_version = version;
    return cloneVersion(row);
  }

  async getVersion(userId: string, skillId: string, version: string): Promise<SkillVersion | null> {
    const row = this.versions.get(`${userId}:${skillId}:${version}`);
    return row ? cloneVersion(row) : null;
  }

  async archive(userId: string, skillId: string): Promise<void> {
    const row = this.skills.get(`${userId}:${skillId}`);
    if (!row) throw new SkillNotFoundError();
    row.archived_at = now();
  }
}

/** Durable SQL-backed implementation. Bytes live behind the shared BlobStore. */
export class SqlSkillService implements SkillService {
  constructor(private sql: SqlClient, private blobs: BlobStore) {}

  async create(input: CreateSkillInput): Promise<Skill> {
    const skillId = id("skill");
    await this.sql.prepare(
      `INSERT INTO skills (id, user_id, name, description, latest_version, archived_at, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`
    ).bind(skillId, input.userId, input.name, input.description ?? null, Date.now()).run();
    const row = await this.get(input.userId, skillId);
    if (!row) throw new Error("skill vanished after insert");
    return row;
  }

  async list(userId: string): Promise<Skill[]> {
    const result = await this.sql.prepare(
      `SELECT id, user_id, name, description, latest_version, archived_at, created_at
         FROM skills WHERE user_id = ? ORDER BY created_at ASC, id ASC`
    ).bind(userId).all<DbSkill>();
    return (result.results ?? []).map(toSkill);
  }

  async get(userId: string, skillId: string): Promise<Skill | null> {
    const row = await this.sql.prepare(
      `SELECT id, user_id, name, description, latest_version, archived_at, created_at
         FROM skills WHERE user_id = ? AND id = ?`
    ).bind(userId, skillId).first<DbSkill>();
    return row ? toSkill(row) : null;
  }

  async createVersion(input: CreateSkillVersionInput): Promise<SkillVersion> {
    const skill = await this.get(input.userId, input.skillId);
    if (!skill) throw new SkillNotFoundError();
    const next = input.version ?? String(Number(skill.latest_version ?? "0") + 1);
    const existing = await this.sql.prepare(
      `SELECT 1 AS one FROM skill_versions WHERE user_id = ? AND skill_id = ? AND version = ?`
    ).bind(input.userId, input.skillId, next).first();
    if (existing) throw new SkillVersionExistsError();

    const stamp = Date.now();
    const metadata: Array<{ file: SkillFileInput; key: string; size: number; contentType: string }> = [];
    for (const file of input.files) {
      validateFilename(file.filename);
      const contentType = file.contentType ?? "text/plain";
      const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
      const key = skillFileBlobKey(input.userId, input.skillId, next, file.filename);
      await this.blobs.put(key, bytes, { httpMetadata: { contentType } });
      metadata.push({ file, key, size: bytes.byteLength, contentType });
    }
    const statements = [this.sql.prepare(
      `INSERT INTO skill_versions (user_id, skill_id, version, description, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(input.userId, input.skillId, next, input.description ?? null, stamp)];
    statements.push(...metadata.map((item) => this.sql.prepare(
      `INSERT INTO skill_blobs (user_id, skill_id, version, filename, storage_key, content_type, size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(input.userId, input.skillId, next, item.file.filename, item.key, item.contentType, item.size)));
    statements.push(this.sql.prepare(
      `UPDATE skills SET latest_version = ? WHERE user_id = ? AND id = ?`
    ).bind(next, input.userId, input.skillId));
    await this.sql.batch(statements);
    const row = await this.getVersion(input.userId, input.skillId, next);
    if (!row) throw new Error("skill version vanished after insert");
    return row;
  }

  async getVersion(userId: string, skillId: string, version: string): Promise<SkillVersion | null> {
    const row = await this.sql.prepare(
      `SELECT user_id, skill_id, version, description, created_at
         FROM skill_versions WHERE user_id = ? AND skill_id = ? AND version = ?`
    ).bind(userId, skillId, version).first<DbVersion>();
    if (!row) return null;
    const files = await this.sql.prepare(
      `SELECT filename, storage_key, content_type, size FROM skill_blobs
         WHERE user_id = ? AND skill_id = ? AND version = ? ORDER BY filename`
    ).bind(userId, skillId, version).all<DbBlob>();
    const content = await Promise.all((files.results ?? []).map(async (file) => {
      const object = await this.blobs.get(file.storage_key);
      return { filename: file.filename, content: object ? await object.text() : "", content_type: file.content_type, size: file.size };
    }));
    return { ...toVersion(row), files: content };
  }

  async archive(userId: string, skillId: string): Promise<void> {
    const skill = await this.get(userId, skillId);
    if (!skill) throw new SkillNotFoundError();
    await this.sql.prepare(`UPDATE skills SET archived_at = ? WHERE user_id = ? AND id = ?`)
      .bind(Date.now(), userId, skillId).run();
  }
}

interface DbSkill { id: string; user_id: string; name: string; description: string | null; latest_version: string | null; archived_at: number | null; created_at: number; }
interface DbVersion { user_id: string; skill_id: string; version: string; description: string | null; created_at: number; }
interface DbBlob { filename: string; storage_key: string; content_type: string; size: number; }

function toSkill(row: DbSkill): Skill {
  return { ...row, archived_at: row.archived_at === null ? null : new Date(row.archived_at).toISOString(), created_at: new Date(row.created_at).toISOString() };
}
function toVersion(row: DbVersion): Omit<SkillVersion, "files"> {
  return { ...row, created_at: new Date(row.created_at).toISOString() };
}
function cloneVersion(row: SkillVersion): SkillVersion { return { ...row, files: row.files.map((file) => ({ ...file })) }; }
function validateFilename(filename: string): void {
  if (!filename || filename.includes("..") || filename.startsWith("/") || filename.includes("\\")) throw new Error("invalid skill filename");
}
