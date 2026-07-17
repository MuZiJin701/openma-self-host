export function buildEnvironmentCreateBody(name: string, description: string) {
  return {
    name,
    description: description || undefined,
    config: { type: "local" },
  };
}
