// Public types for the files store service. Mirrors the D1 schema in
// apps/main/migrations/0011_files_table.sql.
//
// Design choices:
//   - FileRow holds metadata only — the blob store owns the bytes under
//     `r2_key`. Service is intentionally storage-blind: routes own blob PUT/GET/DELETE.
//   - `scope` is a denormalized enum ("session" | "user") that mirrors the
//     session_id NULL/non-NULL state. Kept explicit so a future "agent_scope"
//     or "user_scope" extension fits without a schema migration.
//   - `r2_key` is stored explicitly (instead of recomputed from
//     fileBlobKey(user, id) every time) so the delete cascade can return the
//     blob keys without needing a user-aware helper. The column name is kept
//     for schema compatibility.
//   - `downloadable` is a boolean stored as INTEGER (SQLite has no BOOL).
//     Adapter does the 0/1 ↔ false/true conversion.

import type { FileRecord } from "@open-managed-agents/shared";

export type FileScope = "session" | "user";

export interface FileRow {
  id: string;
  user_id: string;
  /** NULL when scope === "user". */
  session_id: string | null;
  scope: FileScope;
  filename: string;
  media_type: string;
  size_bytes: number;
  /** Whether the file content can be served back via GET /v1/files/:id/content. */
  downloadable: boolean;
  /** Blob key. Stored so cascade-delete can return it without recomputing. */
  r2_key: string;
  created_at: string;
}

/**
 * Map a FileRow to the public FileRecord API shape that
 * apps/main/src/routes/files.ts returns. r2_key + scope + user_id are
 * server-internal — they don't show up in the API surface.
 */
export function toFileRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    type: "file",
    filename: row.filename,
    media_type: row.media_type,
    size_bytes: row.size_bytes,
    scope_id: row.session_id ?? undefined,
    downloadable: row.downloadable,
    created_at: row.created_at,
  };
}

/** Default page size (matches files.ts:101). */
export const DEFAULT_LIST_LIMIT = 100;

/** Hard cap on per-request page size (matches files.ts:103). */
export const MAX_LIST_LIMIT = 1000;
