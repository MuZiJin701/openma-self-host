import { Hono } from "hono";
import { fileBlobKey, generateFileId } from "@open-managed-agents/shared";
import { toFileRecord, type FileService } from "@open-managed-agents/files-store";
import type { BlobStore } from "@open-managed-agents/blob-store";

interface MultipartFile {
  name?: string;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NodeFileRoutesDeps {
  files: FileService;
  filesBlob: BlobStore;
  sessionExists: (input: { userId: string; sessionId: string }) => Promise<boolean>;
}

/** Node's user-scoped multipart file surface used by the Console. */
export function buildNodeFileRoutes(deps: NodeFileRoutesDeps) {
  const app = new Hono<{ Variables: { user_id: string } }>();

  app.post("/", async (c) => {
    const form = await c.req.parseBody();
    const rawFile = form.file;
    if (!rawFile || typeof rawFile === "string" || typeof rawFile.arrayBuffer !== "function") {
      return c.json({ error: "file is required" }, 400);
    }

    const scopeId = typeof form.scope_id === "string" ? form.scope_id.trim() : "";
    if (scopeId && !(await deps.sessionExists({ userId: c.var.user_id, sessionId: scopeId }))) {
      return c.json({ error: "Session not found" }, 404);
    }

    const file = rawFile as MultipartFile;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileId = generateFileId();
    const blobKey = fileBlobKey(c.var.user_id, fileId);
    const mediaType = file.type || "application/octet-stream";
    const filename = file.name || "file";
    const downloadable = form.downloadable === undefined || form.downloadable === "true";

    try {
      await deps.filesBlob.put(blobKey, bytes, { httpMetadata: { contentType: mediaType } });
      const row = await deps.files.create({
        id: fileId,
        userId: c.var.user_id,
        sessionId: scopeId || undefined,
        filename,
        mediaType,
        sizeBytes: bytes.byteLength,
        r2Key: blobKey,
        downloadable,
      });
      return c.json(toFileRecord(row), 201);
    } catch (error) {
      await deps.filesBlob.delete(blobKey).catch(() => undefined);
      throw error;
    }
  });

  return app;
}
