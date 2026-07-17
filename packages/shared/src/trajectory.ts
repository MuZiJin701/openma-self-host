import type { AgentConfig, EnvironmentConfig, SessionMeta, StoredEvent } from "@open-managed-agents/api-types";

/** Minimal trajectory contract kept by the core session HTTP surface. */
export interface SessionRecord extends SessionMeta {
  agent_snapshot?: AgentConfig;
  environment_snapshot?: EnvironmentConfig;
}

export interface BuildTrajectoryDeps {
  fetchAllEvents: () => Promise<StoredEvent[]>;
  fetchFullStatus: () => Promise<{ status: string; usage?: unknown } | null>;
  fetchEnvironmentConfig?: () => Promise<EnvironmentConfig | null>;
}

export async function buildTrajectory(
  session: SessionRecord,
  deps: BuildTrajectoryDeps,
): Promise<Record<string, unknown>> {
  const [events, status, environment] = await Promise.all([
    deps.fetchAllEvents(),
    deps.fetchFullStatus(),
    session.environment_snapshot ? Promise.resolve(session.environment_snapshot) : deps.fetchEnvironmentConfig?.(),
  ]);
  return {
    schema_version: "oma.trajectory.v1",
    trajectory_id: `tr-${session.id}`,
    session_id: session.id,
    agent_config: session.agent_snapshot,
    environment_config: environment,
    started_at: session.created_at,
    outcome: status?.status === "running" ? "running" : "success",
    events,
    summary: { num_events: events.length },
  };
}
