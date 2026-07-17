// Public types for the environments store service. Mirrors the self-host
// environments schema.
//
// Design choices:
//   - EnvironmentRow holds the full environment record (id, user_id, name,
//     description, status, config, metadata,
//     timestamps). Adapters JSON.parse the `config` and `metadata` columns.
//   - The shared `EnvironmentConfig` type (packages/shared/src/types.ts) has
//     every field except `user_id`. Routes returning this row to API
//     clients should strip `user_id` first (see sessions.ts toApiSession
//     for the pattern). Sessions store snapshots reuse the EnvironmentConfig
//     shape — see toEnvironmentConfig() helper in service.ts.
//   - status is intentionally TEXT in SQL (no CHECK constraint per project
//     convention). Service layer is the source of truth for the enum.

import type { EnvironmentConfig } from "@open-managed-agents/shared";

/**
 * Lifecycle status for a local environment. Local environments are ready
 * immediately; the other values remain only for explicit lifecycle errors.
 */
export type EnvironmentStatus = "building" | "ready" | "error";

export interface EnvironmentRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: EnvironmentStatus;
  /** Local environment definition. */
  config: EnvironmentConfig["config"];
  /** Caller-supplied free-form metadata. */
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}
