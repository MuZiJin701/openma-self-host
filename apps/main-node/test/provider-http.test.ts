import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import type { SessionEvent, UserMessageEvent } from "@open-managed-agents/shared";
import { resolveModel } from "@open-managed-agents/agent/harness/provider";
import { DefaultHarness } from "@open-managed-agents/agent/harness/default-loop";

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}/v1`;
}

describe("self-host provider HTTP path", () => {
  it("streams a local OpenAI-compatible response through DefaultHarness", async () => {
    const requests: Array<{ path: string; authorization: string | undefined; body: string }> = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({
          path: req.url ?? "",
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "close",
        });
        res.write(sse({
          id: "chatcmpl-local-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }],
        }));
        res.write(sse({
          id: "chatcmpl-local-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake-model",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        }));
        res.write(sse({
          id: "chatcmpl-local-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "fake-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }));
        res.end("data: [DONE]\n\n");
      });
    });
    const baseUrl = await listen(server);

    try {
      const controller = new AbortController();
      const model = resolveModel("fake-model", "test-key", baseUrl, "oai");
      const events: SessionEvent[] = [];
      const userMessage = {
        type: "user.message",
        id: "user-1",
        content: [{ type: "text", text: "say hello" }],
      } as UserMessageEvent;
      const runtime = {
        history: {
          getMessages: () => [],
          getEvents: () => [userMessage],
          append: (event: SessionEvent) => events.push(event),
        },
        sandbox: {},
        broadcast: (event: SessionEvent) => events.push(event),
        broadcastStreamStart: async () => undefined,
        broadcastChunk: async () => undefined,
        broadcastStreamEnd: async () => undefined,
        broadcastThinkingStart: async () => undefined,
        broadcastThinkingChunk: async () => undefined,
        broadcastThinkingEnd: async () => undefined,
        broadcastToolInputStart: async () => undefined,
        broadcastToolInputChunk: async () => undefined,
        broadcastToolInputEnd: async () => undefined,
        abortSignal: controller.signal,
      };

      await new DefaultHarness().run({
        agent: {
          id: "agent-1",
          name: "fake",
          model: "fake-model",
          system: "",
          tools: [],
        },
        userMessage,
        tools: {},
        model,
        systemPrompt: "",
        env: { ANTHROPIC_API_KEY: "" },
        runtime,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].path).toBe("/v1/chat/completions");
      expect(requests[0].authorization).toBe("Bearer test-key");
      expect(JSON.parse(requests[0].body)).toMatchObject({ model: "fake-model", stream: true });
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "agent.message", content: [{ type: "text", text: "hello world" }] }),
        expect.objectContaining({ type: "span.model_request_end", finish_reason: "stop", is_error: false }),
      ]));
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
