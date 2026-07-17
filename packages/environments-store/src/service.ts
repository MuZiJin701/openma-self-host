import {
  generateEnvId,
  type EnvironmentConfig,
} from "@open-managed-agents/shared";
import { paginateVia } from "@open-managed-agents/shared";
import { EnvironmentNotFoundError } from "./errors";
import type {
  Clock,
  EnvironmentRepo,
  EnvironmentUpdateFields,
  IdGenerator,
  Logger,
  NewEnvironmentInput,
} from "./ports";
import type { EnvironmentRow, EnvironmentStatus } from "./types";

export interface EnvironmentServiceDeps {
  repo: EnvironmentRepo;
  clock?: Clock;
  ids?: IdGenerator;
  logger?: Logger;
}

/**
 * EnvironmentService — pure business logic over abstract ports.
 *
 * Owns the environment entity (id, name, status, config, timestamps). Replaces
 * the KV layout `t:{user}:env:{id}` previously used by
 * routes/environments.ts.
 *
 * Does NOT own active-session safety checks on delete; those remain route
 * concerns.
 */
export class EnvironmentService {
  private readonly repo: EnvironmentRepo;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly logger: Logger;

  constructor(deps: EnvironmentServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? defaultClock;
    this.ids = deps.ids ?? defaultIds;
    this.logger = deps.logger ?? consoleLogger;
  }

  // ============================================================
  // Write paths
  // ============================================================

  async create(opts: {
    userId: string;
    /** Optional stable ID for deployments that expose a fixed environment. */
    id?: string;
    name: string;
    description?: string | null;
    config: EnvironmentConfig["config"];
    /** Defaults to "ready" — set to "building" when triggering a CI build. */
    status?: EnvironmentStatus;
    metadata?: Record<string, unknown> | null;
  }): Promise<EnvironmentRow> {
    const input: NewEnvironmentInput = {
      id: opts.id ?? this.ids.environmentId(),
      userId: opts.userId,
      name: opts.name,
      description: opts.description ?? null,
      status: opts.status ?? "ready",
      config: opts.config,
      metadata: opts.metadata ?? null,
      createdAt: this.clock.nowMs(),
    };
    return await this.repo.insert(input);
  }

  /**
   * Generic update — every field is optional. Pass `null` to clear a nullable
   * field (description / metadata). Pass `undefined` (omit) to leave it
   * untouched.
   *
   * `updated_at` is bumped automatically on every call; callers don't pass it.
   */
  async update(opts: {
    userId: string;
    environmentId: string;
    name?: string;
    description?: string | null;
    config?: EnvironmentConfig["config"];
    status?: EnvironmentStatus;
    metadata?: Record<string, unknown> | null;
  }): Promise<EnvironmentRow> {
    await this.requireEnvironment(opts);
    const update: EnvironmentUpdateFields = { updatedAt: this.clock.nowMs() };
    if (opts.name !== undefined) update.name = opts.name;
    if (opts.description !== undefined) update.description = opts.description;
    if (opts.config !== undefined) update.config = opts.config;
    if (opts.status !== undefined) update.status = opts.status;
    if (opts.metadata !== undefined) update.metadata = opts.metadata;
    return this.repo.update(opts.userId, opts.environmentId, update);
  }

  async archive(opts: {
    userId: string;
    environmentId: string;
  }): Promise<EnvironmentRow> {
    await this.requireEnvironment(opts);
    return this.repo.archive(
      opts.userId,
      opts.environmentId,
      this.clock.nowMs(),
    );
  }

  async delete(opts: {
    userId: string;
    environmentId: string;
  }): Promise<void> {
    await this.requireEnvironment(opts);
    await this.repo.delete(opts.userId, opts.environmentId);
  }

  // ============================================================
  // Read paths
  // ============================================================

  async get(opts: {
    userId: string;
    environmentId: string;
  }): Promise<EnvironmentRow | null> {
    return this.repo.get(opts.userId, opts.environmentId);
  }

  /**
   * List environments. Defaults to `includeArchived: true` to preserve the
   * historical KV behavior — the previous routes/environments.ts list path
   * scanned `t:{user}:env:` and returned every row regardless of
   * `archived_at`. Pass `false` from a route that wants to hide archived.
   */
  async list(opts: {
    userId: string;
    includeArchived?: boolean;
  }): Promise<EnvironmentRow[]> {
    return this.repo.list(opts.userId, {
      includeArchived: opts.includeArchived ?? true,
    });
  }

  /**
   * Cursor-paginated list. Pass the previous response's `nextCursor` back
   * as `cursor` to fetch the next page; omit for the first page. Order:
   * created_at DESC (newest first), id DESC tie-break.
   */
  async listPage(opts: {
    userId: string;
    /** Row archive state. Pass `'active'` to exclude archived,
     *  `'archived'` for only-archived, `'any'` for both. Replaces the
     *  legacy `includeArchived` boolean for any 3-way intent. */
    status?: "active" | "archived" | "any";
    /** Legacy 2-way archive toggle. Maps to status when status is unset:
     *  true→any, false→active. Prefer `status` for new callers. */
    includeArchived?: boolean;
    /** Lower bound on created_at (epoch ms, inclusive). */
    createdAfter?: number;
    /** Upper bound on created_at (epoch ms, exclusive). */
    createdBefore?: number;
    limit?: number;
    cursor?: string;
    q?: string;
  }): Promise<{ items: EnvironmentRow[]; nextCursor?: string }> {
    // Default keeps the legacy "includes archived" behavior — same default
    // as `list()` above — when neither status nor includeArchived is set.
    const status: "active" | "archived" | "any" =
      opts.status ?? (opts.includeArchived === false ? "active" : "any");
    return paginateVia({
      cursor: opts.cursor,
      limit: opts.limit,
      fetch: (after, limit) =>
        this.repo.listPage(opts.userId, {
          status,
          includeArchived: opts.includeArchived ?? true,
          limit,
          after,
          q: opts.q,
          createdAfter: opts.createdAfter,
          createdBefore: opts.createdBefore,
        }),
      extractCursor: (r) => ({
        createdAt: new Date(r.created_at).getTime(),
        id: r.id,
      }),
    });
  }

  /** Cheap COUNT for /v1/stats. Default counts only non-archived rows. */
  async count(opts: {
    userId: string;
    includeArchived?: boolean;
  }): Promise<number> {
    return this.repo.count(opts.userId, {
      includeArchived: opts.includeArchived ?? false,
    });
  }

  // ============================================================
  // Internals
  // ============================================================

  private async requireEnvironment(opts: {
    userId: string;
    environmentId: string;
  }): Promise<EnvironmentRow> {
    const row = await this.repo.get(opts.userId, opts.environmentId);
    if (!row) throw new EnvironmentNotFoundError();
    return row;
  }
}

// ============================================================
// toEnvironmentConfig — exported helper used by HTTP handlers
// ============================================================

/**
 * Convert an internal {@link EnvironmentRow} to the API-shape
 * {@link EnvironmentConfig} from packages/shared. Drops `user_id`, drops
 * dedicated `null` columns the historical KV shape didn't expose (the legacy
 * EnvironmentConfig allowed optional description, metadata, and timestamps.
 * Returns the same shape the
 * sessions store / eval runner persist as `environment_snapshot`.
 */
export function toEnvironmentConfig(row: EnvironmentRow): EnvironmentConfig {
  const env: EnvironmentConfig = {
    type: "environment",
    id: row.id,
    name: row.name,
    config: row.config,
    created_at: row.created_at,
  };
  if (row.description !== null) env.description = row.description;
  if (row.metadata !== null) env.metadata = row.metadata;
  if (row.updated_at !== null) env.updated_at = row.updated_at;
  if (row.archived_at !== null) env.archived_at = row.archived_at;
  return env;
}

// ============================================================
// Default infra (used when callers don't override)
// ============================================================

const defaultClock: Clock = { nowMs: () => Date.now() };

const defaultIds: IdGenerator = { environmentId: generateEnvId };

const consoleLogger: Logger = { warn: (msg, ctx) => console.warn(msg, ctx) };
