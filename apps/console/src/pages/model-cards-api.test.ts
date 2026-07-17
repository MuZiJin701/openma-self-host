import { describe, expect, it } from "vitest";

import { listAvailableModels } from "./model-cards-api";

describe("self-host model cards API contract", () => {
  it("lists model suggestions with the Node GET endpoint", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { data: [] } as T;
    };

    await listAvailableModels(api);

    expect(calls).toEqual([{ path: "/v1/models/list", init: undefined }]);
  });
});
