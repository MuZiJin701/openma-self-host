// Files + workspace_backups (Node-PG variant of cf-auth/files).
//
// Diverges from CF in two places:
//   - workspace_backups.id is TEXT on PG (matches applySchema source),
//     not the AUTOINCREMENT INTEGER from CF migration 0011.
//   - PG variant adds session_id + blob_key columns that CF lacks
//     (CF stores backup_handle as a JSON blob with id/dir inside it).
// Both deltas are tracked drift; Phase 3 will reconcile.

import { bigint, index, pgTable, serial, text } from "drizzle-orm/pg-core";

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    session_id: text("session_id"),
    scope: text("scope").notNull(),
    filename: text("filename").notNull(),
    media_type: text("media_type").notNull(),
    size_bytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // Integer flag (NOT boolean) to mirror CF / source SQL.
    downloadable: bigint("downloadable", { mode: "number" }).notNull().default(0),
    r2_key: text("r2_key").notNull(),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_files_user_created").on(t.user_id, t.created_at),
    index("idx_files_user_session_created").on(t.user_id, t.session_id, t.created_at),
    index("idx_files_session").on(t.session_id),
  ],
);

export const workspace_backups = pgTable(
  "workspace_backups",
  {
    id: serial("id").primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    environment_id: text("environment_id").notNull(),
    backup_handle: text("backup_handle").notNull(),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    expires_at: bigint("expires_at", { mode: "number" }).notNull(),
    source_session_id: text("source_session_id"),
  },
  (t) => [
    index("idx_workspace_backups_scope_recent").on(
      t.user_id,
      t.environment_id,
      t.created_at,
    ),
    index("idx_workspace_backups_expires").on(t.expires_at),
  ],
);
