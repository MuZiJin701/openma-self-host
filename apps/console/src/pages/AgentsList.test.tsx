import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { AgentsList } from "./AgentsList";
import { server } from "../mocks/server";

describe("AgentsList self-host integration", () => {
  it("loads agent pickers from the core APIs", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/v1/agents", ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: [], has_more: false });
      }),
      http.get("/v1/skills", ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: [] });
      }),
      http.get("/v1/model_cards", ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: [] });
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsList />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(requested).toContain("/v1/skills"));
    expect(requested).toContain("/v1/model_cards");
  });
});
