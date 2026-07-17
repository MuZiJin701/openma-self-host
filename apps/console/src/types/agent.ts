/**
 * Console-side Agent record. Wider than `@open-managed-agents/api-types`'
 * `AgentConfig` (the wire-format) — adds the runtime metadata the list
 * and detail endpoints return on top of the config (`version`,
 * `created_at`, `archived_at`) plus the `_oma` console extension.
 *
 * Lifted out of AgentDetail.tsx + AgentsList.tsx where two copies had
 * drifted (AgentDetail had `tools`, AgentsList had `_oma`; both had the
 * common metadata fields).
 */
export interface AgentRecord {
  id: string;
  name: string;
  model: string | { id: string; speed?: string };
  system?: string;
  version: number;
  description?: string;
  tools?: unknown[];
  skills?: unknown[];
  multiagent?: {
    type: "coordinator";
    agents: Array<{ type: "agent"; id: string; version: number }>;
  } | null;
  created_at: string;
  updated_at?: string;
  archived_at?: string;
}
