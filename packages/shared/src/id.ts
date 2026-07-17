import { customAlphabet } from "nanoid";

// Lowercase + digits only — safe for Docker tags, wrangler names, URLs
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export const generateId = () => nanoid();
export const generateAgentId = () => `agent-${nanoid()}`;
export const generateEnvId = () => `env-${nanoid()}`;
export const generateSessionId = () => `sess-${nanoid()}`;
export const generateVaultId = () => `vlt-${nanoid()}`;
export const generateCredentialId = () => `cred-${nanoid()}`;
export const generateMemoryStoreId = () => `memstore-${nanoid()}`;
export const generateMemoryId = () => `mem-${nanoid()}`;
export const generateMemoryVersionId = () => `memver-${nanoid()}`;
export const generateFileId = () => `file-${nanoid()}`;
export const generateResourceId = () => `sesrsc-${nanoid()}`;
export const generateEventId = () => `sevt-${nanoid()}`;
export const generateModelCardId = () => `mdl-${nanoid()}`;
export const generateEvalRunId = () => `evrun-${nanoid()}`;
export const generateDreamId = () => `drm-${nanoid()}`;
// Outcome id — Anthropic Managed Agents spec uses an `outc_` prefix on every
// `user.define_outcome` echo so subsequent `span.outcome_evaluation_*`
// events can name which outcome they pertain to (sessions can chain
// outcomes sequentially; same session, different outcome ids).
export const generateOutcomeId = () => `outc_${nanoid()}`;

/**
 * Stable fallback environment_id for self-host sessions when no user-owned
 * Environment record is selected. Anthropic's Managed Agents API requires
 * environment_id on every session; explicit sessions may instead reference
 * any user-owned Environment whose config type is `local`.
 *
 * The value remains stable for backwards compatibility with existing rows and
 * local development clients. It is not a singleton Environment record.
 *
 * Stable string so existing rows survive across deploys; do not change
 * without a backfill plan for sessions that already point at this id.
 */
export const LOCAL_RUNTIME_ENV_ID = "env-local-runtime";
