import { Hono, type Context } from "hono";
import {
  ModelCardDuplicateModelIdError,
  ModelCardNotFoundError,
  type ModelCardService,
  type ModelCardRow,
} from "@open-managed-agents/model-cards-store";

function toApiShape(card: ModelCardRow) {
  return {
    id: card.id,
    model_id: card.model_id,
    model: card.model,
    provider: card.provider,
    api_key_preview: card.api_key_preview,
    base_url: card.base_url ?? undefined,
    custom_headers: card.custom_headers ?? undefined,
    is_default: card.is_default,
    created_at: card.created_at,
    updated_at: card.updated_at ?? undefined,
    archived_at: card.archived_at,
  };
}

export function buildModelCardRoutes(deps: {
  modelCards: ModelCardService;
  /** Internal callers may use /:id/key; public callers never receive it. */
  internalToken?: string;
  encryptionConfigured?: boolean;
}) {
  const app = new Hono<{ Variables: { tenant_id: string } }>();

  app.post("/", async (c) => {
    const body = await c.req.json<{
      model_id: string;
      model?: string;
      provider: string;
      api_key: string;
      base_url?: string | null;
      custom_headers?: Record<string, string> | null;
      is_default?: boolean;
    }>();
    if (!body.model_id || !body.provider || !body.api_key) {
      return c.json({ error: "model_id, provider, and api_key are required" }, 400);
    }
    if (deps.encryptionConfigured === false) {
      return c.json({ error: "model_cards_encryption_not_configured" }, 503);
    }
    try {
      const card = await deps.modelCards.create({
        tenantId: c.var.tenant_id,
        modelId: body.model_id,
        model: body.model,
        provider: body.provider,
        apiKey: body.api_key,
        baseUrl: body.base_url ?? null,
        customHeaders: body.custom_headers ?? null,
        makeDefault: body.is_default,
      });
      return c.json(toApiShape(card), 201);
    } catch (error) {
      if (error instanceof ModelCardDuplicateModelIdError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  app.get("/", async (c) => {
    const cards = await deps.modelCards.list({ tenantId: c.var.tenant_id });
    return c.json({ data: cards.filter((card) => card.archived_at === null).map(toApiShape) });
  });

  app.get("/:id", async (c) => {
    const card = await deps.modelCards.get({
      tenantId: c.var.tenant_id,
      cardId: c.req.param("id"),
    });
    return card ? c.json(toApiShape(card)) : c.json({ error: "Model card not found" }, 404);
  });

  const update = async (c: Context<{ Variables: { tenant_id: string } }>) => {
    const cardId = c.req.param("id") ?? "";
    const body = await c.req.json<{
      model_id?: string;
      model?: string;
      provider?: string;
      api_key?: string;
      base_url?: string | null;
      custom_headers?: Record<string, string> | null;
      is_default?: boolean;
    }>();
    try {
      const card = await deps.modelCards.update({
        tenantId: c.var.tenant_id,
        cardId,
        modelId: body.model_id,
        model: body.model,
        provider: body.provider,
        apiKey: body.api_key,
        baseUrl: body.base_url === undefined ? undefined : body.base_url || null,
        customHeaders:
          body.custom_headers === undefined ? undefined : body.custom_headers || null,
        isDefault: body.is_default,
      });
      return c.json(toApiShape(card));
    } catch (error) {
      if (error instanceof ModelCardNotFoundError) return c.json({ error: "Model card not found" }, 404);
      if (error instanceof ModelCardDuplicateModelIdError) return c.json({ error: error.message }, 409);
      throw error;
    }
  };
  app.post("/:id", update);
  app.patch("/:id", update);

  app.delete("/:id", async (c) => {
    try {
      await deps.modelCards.delete({ tenantId: c.var.tenant_id, cardId: c.req.param("id") });
      return c.json({ type: "model_card_deleted", id: c.req.param("id") });
    } catch (error) {
      if (error instanceof ModelCardNotFoundError) return c.json({ error: "Model card not found" }, 404);
      throw error;
    }
  });

  app.get("/:id/key", async (c) => {
    if (!deps.internalToken || c.req.header("x-oma-internal-token") !== deps.internalToken) {
      return c.json({ error: "not found" }, 404);
    }
    const apiKey = await deps.modelCards.getApiKey({
      tenantId: c.var.tenant_id,
      cardId: c.req.param("id"),
    });
    return apiKey === null ? c.json({ error: "Key not found" }, 404) : c.json({ api_key: apiKey });
  });

  return app;
}
