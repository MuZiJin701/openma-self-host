// Abstract ports the EnvironmentService depends on.
//
// Keep these tiny and runtime-agnostic: no Cloudflare types, no D1 query
// language. Pass plain data + return plain data.
//
// User routing: every method takes `userId` as the first argument so all
// resource ownership checks remain explicit at the store boundary.

import type { EnvironmentConfig } from "@open-managed-agents/shared";
import type { PageCursor } from "@open-managed-agents/shared";
import type { EnvironmentRow, EnvironmentStatus } from "./types";

export interface NewEnvironmentInput {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: EnvironmentStatus;
  config: EnvironmentConfig["config"];
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

/**
 * Update fields for an existing environment row. All optional except
 * `updatedAt`. Tri-state semantics for nullable fields:
 *   - undefined : leave column untouched
 *   - null      : clear the column (set to NULL)
 *   - value     : set the column
 *
 * Pulled apart from create input so the route layer can express nullable
 * field updates without conflating them with leave-as-is.
 */
export interface EnvironmentUpdateFields {
  name?: string;
  description?: string | null;
  status?: EnvironmentStatus;
  config?: EnvironmentConfig["config"];
  metadata?: Record<string, unknown> | null;
  updatedAt: number;
}

export interface EnvironmentRepo {
  insert(input: NewEnvironmentInput): Promise<EnvironmentRow>;

  get(userId: string, environmentId: string): Promise<EnvironmentRow | null>;

  list(
    userId: string,
    opts: { includeArchived: boolean },
  ): Promise<EnvironmentRow[]>;

  /**
   * Cursor-paginated list. Order: created_at DESC, id DESC.
   *
   * `status` and the createdAt range filters stack as extra WHERE
   * conditions on top of the cursor query — the (created_at, id)
   * ordering they're keyed against is unchanged, so cursors stay
   * valid across all filter combinations.
   */
  listPage(
    userId: string,
    opts: {
      /** Row archive state. `'active'` → archived_at IS NULL,
       *  `'archived'` → archived_at IS NOT NULL, `'any'` → no filter.
       *  When unset, falls back to `includeArchived` (back-compat). */
      status?: "active" | "archived" | "any";
      /** Legacy 2-way archive toggle. Used only when `status` is unset. */
      includeArchived: boolean;
      /** Lower bound on environments.created_at (epoch ms, inclusive).
       *  Driven by the Created filter chip in the UI. */
      createdAfter?: number;
      /** Upper bound on environments.created_at (epoch ms, exclusive). */
      createdBefore?: number;
      limit: number;
      after?: PageCursor;
      /** Case-insensitive substring filter against environment name.
       *  Trimmed blank → unfiltered. Used by Combobox typeahead. */
      q?: string;
    },
  ): Promise<{ items: EnvironmentRow[]; hasMore: boolean }>;

  /** Cheap COUNT(*) for /v1/stats. Index `idx_environments_user` covers it. */
  count(userId: string, opts: { includeArchived: boolean }): Promise<number>;

  update(
    userId: string,
    environmentId: string,
    update: EnvironmentUpdateFields,
  ): Promise<EnvironmentRow>;

  archive(
    userId: string,
    environmentId: string,
    archivedAt: number,
  ): Promise<EnvironmentRow>;

  delete(userId: string, environmentId: string): Promise<void>;
}

export interface Clock {
  nowMs(): number;
}

export interface IdGenerator {
  environmentId(): string;
}

export interface Logger {
  warn(msg: string, ctx?: unknown): void;
}
