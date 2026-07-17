import type { LanguageModel } from "ai";
import type { AgentConfig } from "@open-managed-agents/shared";
import type { ModelCardService } from "@open-managed-agents/model-cards-store";
import { resolveModel, type ApiCompat } from "@open-managed-agents/agent/harness/provider";

export interface NodeModelResolverOptions {
  fallbackApiKey?: string;
  fallbackBaseUrl?: string;
  fallbackCustomHeaders?: Record<string, string>;
  allowEnvironmentFallback: boolean;
}

export interface NodeModelResolverResult {
  model: LanguageModel;
  provider: string;
  modelId: string;
}

export class NodeModelResolver {
  constructor(
    private readonly modelCards: ModelCardService,
    private readonly options: NodeModelResolverOptions,
  ) {}

  async resolve(input: {
    userId: string;
    agent: AgentConfig;
  }): Promise<NodeModelResolverResult> {
    const credentials = await this.resolveCredentials(input);
    return {
      model: resolveModel(
        credentials.model,
        credentials.apiKey,
        credentials.baseUrl,
        providerToApiCompat(credentials.provider),
        credentials.customHeaders,
      ),
      provider: credentials.provider,
      modelId: credentials.modelId,
    };
  }

  async resolveCredentials(input: {
    userId: string;
    agent: AgentConfig;
  }): Promise<{
    provider: string;
    modelId: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
    customHeaders?: Record<string, string>;
  }> {
    const modelId = typeof input.agent.model === "string"
      ? input.agent.model
      : input.agent.model?.id ?? "";
    const card = await this.modelCards.findByModelId({
      userId: input.userId,
      modelId,
    });
    if (card) {
      const apiKey = await this.modelCards.getApiKey({
        userId: input.userId,
        cardId: card.id,
      });
      if (!apiKey) throw new Error(`model card ${card.model_id} has no usable API key`);
      return {
        provider: card.provider,
        modelId: card.model_id,
        model: card.model,
        apiKey,
        ...(card.base_url ? { baseUrl: card.base_url } : {}),
        ...(card.custom_headers ? { customHeaders: card.custom_headers } : {}),
      };
    }

    if (!this.options.allowEnvironmentFallback || !this.options.fallbackApiKey) {
      throw new Error(
        `No model card with model_id "${modelId}" for user ${input.userId}`,
      );
    }
    return {
      provider: "anthropic",
      modelId,
      model: modelId,
      apiKey: this.options.fallbackApiKey,
      ...(this.options.fallbackBaseUrl ? { baseUrl: this.options.fallbackBaseUrl } : {}),
      ...(this.options.fallbackCustomHeaders
        ? { customHeaders: this.options.fallbackCustomHeaders }
        : {}),
    };
  }
}

/**
 * Model cards store the provider/protocol selector. Keep the short API
 * compatibility values as the canonical form, while accepting the readable
 * provider names used by older self-host cards.
 */
function providerToApiCompat(provider: string): ApiCompat {
  switch (provider.trim().toLowerCase()) {
    case "ant":
    case "anthropic":
      return "ant";
    case "ant-compatible":
    case "anthropic-compatible":
      return "ant-compatible";
    case "oai":
    case "openai":
      return "oai";
    case "oai-compatible":
    case "openai-compatible":
      return "oai-compatible";
    default:
      throw new Error(`Unsupported model provider "${provider}"`);
  }
}
