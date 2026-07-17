// Node session-lifecycle hooks for file promotion and cleanup.
//
// Implements only the hooks Node actually needs: `promoteSandboxFile`
// (close the 500 from POST /v1/sessions/:id/files), and `cascadeDeleteFiles`
// (delete file rows + blobs on session DELETE).
//
import {
  generateFileId,
  fileBlobKey,
  logWarn,
} from "@open-managed-agents/shared";
import {
  toFileRecord,
  type FileService,
} from "@open-managed-agents/files-store";
import type { BlobStore } from "@open-managed-agents/blob-store";
import type { SessionLifecycleHooks } from "@open-managed-agents/http-routes";

export interface NodeSessionLifecycleDeps {
  files: FileService;
  filesBlob: BlobStore;
}

/** Build the per-process lifecycle hooks bundle for main-node. */
export function nodeSessionLifecycle(deps: NodeSessionLifecycleDeps): SessionLifecycleHooks {
  return {
    promoteSandboxFile: async ({
      userId,
      sessionId,
      sandboxPath,
      filename,
      mediaType,
      downloadable,
      bytes,
    }) => {
      const newFileId = generateFileId();
      const blobKey = fileBlobKey(userId, newFileId);
      await deps.filesBlob.put(blobKey, bytes, {
        httpMetadata: { contentType: mediaType },
      });
      const row = await deps.files.create({
        id: newFileId,
        userId,
        sessionId,
        filename,
        mediaType,
        sizeBytes: bytes.byteLength,
        r2Key: blobKey,
        downloadable,
      });
      void sandboxPath;
      return toFileRecord(row);
    },
    fileExists: async ({ userId, fileId }) => {
      return (await deps.files.get({ userId, fileId })) !== null;
    },
    cascadeDeleteFiles: async ({ userId, sessionId }) => {
      try {
        const orphans = await deps.files.deleteBySession({ sessionId });
        if (!orphans.length) return;
        await Promise.all(
          orphans.map((f) =>
            deps.filesBlob.delete(f.r2_key).catch((err) => {
              logWarn(
                {
                  op: "session.delete.blob_cleanup",
                  session_id: sessionId,
                  user_id: userId,
                  blob_key: f.r2_key,
                  err,
                },
                "orphan blob delete failed",
              );
            }),
          ),
        );
      } catch (err) {
        logWarn(
          {
            op: "session.delete.metadata_cleanup",
            session_id: sessionId,
            user_id: userId,
            err,
          },
          "files metadata cleanup failed",
        );
      }
    },
  };
}
