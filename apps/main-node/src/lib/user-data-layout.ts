import { join, relative, resolve } from "node:path";

export interface UserDataLayout {
  dataDir: string;
  userRoot(userId: string): string;
  workspaceRoot(userId: string): string;
  filesRoot(userId: string): string;
  outputsRoot(userId: string, sessionId: string): string;
  backupsRoot(userId: string): string;
  tempRoot(userId: string, sessionId?: string): string;
}

/**
 * Resolve every user-owned path below DATA_DIR. Better Auth user ids are
 * opaque values, so reject path syntax instead of treating ids as paths.
 */
export function createUserDataLayout(dataDir: string): UserDataLayout {
  const root = resolve(dataDir);

  const userRoot = (userId: string) => {
    if (!userId || userId === "." || userId === ".." || /[\\/]/.test(userId)) {
      throw new Error("invalid user id for workspace path");
    }
    const encoded = encodeURIComponent(userId);
    const candidate = resolve(root, encoded);
    const outside = relative(root, candidate);
    if (outside.startsWith("..") || outside.includes("/" + "..")) {
      throw new Error("user workspace escapes DATA_DIR");
    }
    return candidate;
  };

  return {
    dataDir: root,
    userRoot,
    workspaceRoot: userRoot,
    filesRoot: (userId) => join(userRoot(userId), ".openma", "files"),
    outputsRoot: (userId, sessionId) => {
      if (!sessionId || sessionId === "." || sessionId === ".." || /[\\/]/.test(sessionId)) {
        throw new Error("invalid session id for output path");
      }
      return join(userRoot(userId), ".openma", "outputs", encodeURIComponent(sessionId));
    },
    backupsRoot: (userId) => join(userRoot(userId), ".openma", "backups"),
    tempRoot: (userId, sessionId) => join(
      userRoot(userId),
      ".openma",
      "temp",
      sessionId ? encodeURIComponent(sessionId) : "shared",
    ),
  };
}
