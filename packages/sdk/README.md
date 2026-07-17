# @openma/sdk

This small TypeScript client remains for local self-host compatibility tests. The preferred
external client is the official `@anthropic-ai/sdk`; both clients target the same `/v1` HTTP/SSE
contract.

```ts
import { OpenMA } from "@openma/sdk";

const client = new OpenMA({
  baseUrl: "http://localhost:8787",
  apiKey: process.env.OMA_API_KEY!,
});

const session = await client.sessions.create({
  agent: "agent-id",
  environment_id: "env-local-runtime",
});

for await (const event of client.sessions.chat(session.id, "Hello")) {
  if (event.type === "agent.message_chunk") process.stdout.write(event.delta);
}
```

The SDK exposes only the core Agents, Sessions, and Environments resources. Vault, Memory, Dreams,
Evals, Integrations, MCP, runtime daemon, OAuth, and provider-specific APIs are not part of this
self-host client.
