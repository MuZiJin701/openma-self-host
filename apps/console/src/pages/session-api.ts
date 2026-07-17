export const LOCAL_RUNTIME_ENV_ID = "env-local-runtime";

export interface SessionCreateBodyInput {
  agent: string;
  title?: string;
  environmentId?: string;
  isLocalRuntime: boolean;
}

export function buildSessionCreateBody(input: SessionCreateBodyInput): Record<string, unknown> {
  return {
    agent: input.agent,
    title: input.title || undefined,
    environment_id: input.environmentId || (input.isLocalRuntime ? LOCAL_RUNTIME_ENV_ID : undefined),
  };
}
