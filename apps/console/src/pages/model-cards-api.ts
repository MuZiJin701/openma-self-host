export type ModelCardsApi = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

export function listAvailableModels<T = { data: Array<{ id: string; name: string }> }>(
  api: ModelCardsApi,
): Promise<T> {
  return api<T>("/v1/models/list");
}
