import { describe, expect, it } from "vitest";

import { buildEnvironmentCreateBody } from "./environment-api";

describe("self-host environment API contract", () => {
  it("creates a local environment record", () => {
    expect(buildEnvironmentCreateBody("Local workspace", "For local sessions")).toEqual({
      name: "Local workspace",
      description: "For local sessions",
      config: { type: "local" },
    });
  });
});
