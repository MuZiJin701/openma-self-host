import { describe, expect, it } from "vitest";

import { buildSessionCreateBody, LOCAL_RUNTIME_ENV_ID } from "./session-api";

describe("self-host session environment contract", () => {
  it("preserves the selected local runtime Environment record", () => {
    expect(
      buildSessionCreateBody({
        agent: "agent_1",
        title: "Local task",
        environmentId: "env-some-other-row",
        isLocalRuntime: true,
      }),
    ).toEqual({
      agent: "agent_1",
      title: "Local task",
      environment_id: "env-some-other-row",
    });
  });

  it("uses the stable local fallback when no local Environment is selected", () => {
    expect(
      buildSessionCreateBody({
        agent: "agent_1",
        title: "Local task",
        isLocalRuntime: true,
      }),
    ).toEqual({
      agent: "agent_1",
      title: "Local task",
      environment_id: LOCAL_RUNTIME_ENV_ID,
    });
  });
});
