import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { SessionEvent, UserMessageEvent } from "@open-managed-agents/shared";
import { describe, expect, it } from "vitest";
import { DefaultHarness } from "@open-managed-agents/agent/harness/default-loop";

function fakeStreamModel() {
  return {
    specificationVersion: "v3" as const,
    provider: "fake",
    modelId: "fake-abort-model",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("fake model only supports streaming");
    },
    doStream: async (options: { abortSignal?: AbortSignal }) => {
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({ type: "text-delta", id: "text-1", delta: "partial" });
          options.abortSignal?.addEventListener(
            "abort",
            () => {
              controller.error(new DOMException("fake provider observed abort", "AbortError"));
            },
            { once: true },
          );
        },
      });
      return { stream };
    },
  };
}

function makeRuntime(signal: AbortSignal) {
  const lifecycle: string[] = [];
  const events: SessionEvent[] = [];
  const userMessage = {
    type: "user.message",
    id: "user-1",
    content: [{ type: "text", text: "hello" }],
  } as UserMessageEvent;

  const runtime = {
    history: {
      getMessages: () => [],
      getEvents: () => [userMessage],
      append: (event: SessionEvent) => events.push(event),
    },
    sandbox: {},
    broadcast: (event: SessionEvent) => events.push(event),
    broadcastStreamStart: async (messageId: string) => {
      lifecycle.push(`start:${messageId}`);
    },
    broadcastChunk: async (messageId: string, delta: string) => {
      lifecycle.push(`chunk:${messageId}:${delta}`);
    },
    broadcastStreamEnd: async (messageId: string, status: string, errorText?: string) => {
      lifecycle.push(`end:${messageId}:${status}:${errorText ?? ""}`);
    },
    broadcastThinkingStart: async () => undefined,
    broadcastThinkingChunk: async () => undefined,
    broadcastThinkingEnd: async () => undefined,
    broadcastToolInputStart: async () => undefined,
    broadcastToolInputChunk: async () => undefined,
    broadcastToolInputEnd: async () => undefined,
    abortSignal: signal,
  };

  return { events, lifecycle, runtime, userMessage };
}

describe("DefaultHarness stream abort", () => {
  it("closes the partial message stream and aborts the model span", async () => {
    const controller = new AbortController();
    const model = fakeStreamModel();
    let chunkSeen!: () => void;
    const chunkSeenPromise = new Promise<void>((resolve) => {
      chunkSeen = resolve;
    });
    const { events, lifecycle, runtime: baseRuntime, userMessage } = makeRuntime(controller.signal);
    let releaseStreamEnd!: () => void;
    const streamEndReleased = new Promise<void>((resolve) => {
      releaseStreamEnd = resolve;
    });
    let streamEndStarted!: () => void;
    const streamEndStartedPromise = new Promise<void>((resolve) => {
      streamEndStarted = resolve;
    });
    const runtime = {
      ...baseRuntime,
      broadcastChunk: async (messageId: string, delta: string) => {
        lifecycle.push(`chunk:${messageId}:${delta}`);
        chunkSeen();
      },
      broadcastStreamEnd: async (messageId: string, status: string, errorText?: string) => {
        lifecycle.push(`end:${messageId}:${status}:${errorText ?? ""}`);
        streamEndStarted();
        await streamEndReleased;
      },
    };
    const harness = new DefaultHarness();

    const run = harness.run({
      agent: {
        id: "agent-1",
        name: "fake",
        model: "fake-abort-model",
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

    await Promise.race([
      chunkSeenPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fake provider did not start")), 2_000)),
    ]);
    controller.abort("test-interrupt");

    let settled = false;
    void run.then(() => { settled = true; }, () => { settled = true; });
    await streamEndStartedPromise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseStreamEnd();
    await expect(run).rejects.toThrow();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "span.model_request_end",
        finish_reason: "aborted",
        is_error: false,
      }),
    ]));
    expect(lifecycle.some((entry) => entry.startsWith("start:"))).toBe(true);
    expect(lifecycle.some((entry) => entry.startsWith("chunk:") && entry.endsWith(":partial"))).toBe(true);
    expect(lifecycle.some((entry) => entry.startsWith("end:") && entry.includes(":aborted:"))).toBe(true);
  });
});
