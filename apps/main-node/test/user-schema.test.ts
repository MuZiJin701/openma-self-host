import { readFileSync } from "node:fs";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SELF_HOST_SKILLS_SCHEMA_SQL } from "@open-managed-agents/db-schema/node-sqlite";

const migrationPath = join(import.meta.dirname, "../migrations-sqlite/0000_tiny_proemial_gods.sql");

function applyMigration(db: BetterSqlite3.Database) {
  for (const statement of readFileSync(migrationPath, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
  db.exec(SELF_HOST_SKILLS_SCHEMA_SQL);
}

describe("user-scoped active schema", () => {
  it("uses user_id for every user-owned core table", () => {
    const db = new BetterSqlite3(":memory:");
    try {
      applyMigration(db);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      expect(names.has("membership")).toBe(false);
      expect(names.has("user")).toBe(true);

      for (const table of [
        "agents", "sessions", "model_cards", "environments", "files",
        "workspace_backups", "kv_entries", "api_keys", "skills",
        "skill_versions", "skill_blobs",
      ]) {
        const columns = db.prepare(`PRAGMA table_info(\"${table}\")`).all() as Array<{ name: string }>;
        expect(columns.some((column) => column.name === "user_id"), table).toBe(true);
      }

      const authColumns = db.prepare('PRAGMA table_info("user")').all() as Array<{ name: string }>;
      expect(authColumns.some((column) => column.name === "userId")).toBe(false);
    } finally {
      db.close();
    }
  });
});
