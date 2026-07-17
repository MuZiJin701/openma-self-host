/**
 * User-scoped blob key scheme for file storage.
 *
 * Single bucket (FILES_BUCKET), user isolation by key prefix.
 * Used by:
 * - apps/main/src/routes/files.ts        (upload/download/delete)
 * - apps/main/src/routes/sessions.ts     (file_id resolver in events POST,
 *                                         scoped-copy in createSession resources)
 * - apps/agent/src/runtime/resource-mounter.ts (mount file_id to sandbox FS)
 */
export function fileBlobKey(userId: string, fileId: string): string {
  return `${encodeURIComponent(userId)}/.openma/files/${encodeURIComponent(fileId)}`;
}

/**
 * Blob key for a single file inside a custom skill version.
 * One blob per skill file — keeps individual file size bounded and lets
 * us stream them into the sandbox without loading the whole bundle.
 */
export function skillFileBlobKey(
  userId: string,
  skillId: string,
  version: string,
  filename: string,
): string {
  return `${encodeURIComponent(userId)}/.openma/files/skills/${encodeURIComponent(skillId)}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`;
}

/**
 * Blob key prefix for files the agent writes to /mnt/session/outputs/. Same
 * user-isolated layout as fileBlobKey but a separate top-level namespace
 * so the regular /files surface and the magic-dir surface can't collide.
 *
 * Used by apps/main's session-outputs routes + cascade-delete cleanup;
 * self-host Node uses the host filesystem under the equivalent path
 * (<outputsRoot>/<userId>/<sessionId>/).
 */
export function sessionOutputsPrefix(userId: string, sessionId: string): string {
  return `${encodeURIComponent(userId)}/.openma/outputs/${encodeURIComponent(sessionId)}/`;
}

/** Filename → media-type guess for `/mnt/session/outputs/` listings. Used
 *  by the list endpoints when the blob store / fs didn't record a contentType. */
export const SESSION_OUTPUT_MIME_GUESS: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown",
  csv: "text/csv", json: "application/json", html: "text/html", htm: "text/html",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
};

export function guessSessionOutputMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  return SESSION_OUTPUT_MIME_GUESS[ext] || "application/octet-stream";
}
