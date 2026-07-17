// Runtime-agnostic sandbox port. Originally lived in
// apps/agent/src/harness/interface.ts as the `SandboxExecutor` and
// `ProcessHandle` interfaces; lifted here so non-CF runtimes (Node host,
// future deployments) can implement the same shape without taking on the
// apps/agent → cloudflare:workers → @cloudflare/sandbox import chain.
//
// Implementation:
//   - LocalSubprocessSandbox (./adapters/local-subprocess.ts) — Node
//     child_process + per-session workdir. Local dev. NO security
//     isolation — runs on the host filesystem. Don't ship to prod with
//     untrusted agents.

export interface ProcessHandle {
  id: string;
  pid: number;
  kill(signal: string): Promise<void>;
  getLogs(): Promise<{ stdout: string; stderr: string }>;
  getStatus(): Promise<string>;
}

export interface SandboxExecutor {
  exec(command: string, timeout?: number): Promise<string>;
  /** Optional abort-aware execution for adapters that can kill a running
   * process. Legacy exec() remains the compatibility path. */
  execWithSignal?(command: string, timeout?: number, signal?: AbortSignal): Promise<string>;
  /** Start a process without blocking. Returns handle for kill/status/logs. */
  startProcess?(command: string): Promise<ProcessHandle | null>;
  /** Set global environment variables for all subsequent exec calls. */
  setEnvVars?(envVars: Record<string, string>): Promise<void>;
  /**
   * Hand the (user, env, session) tuple to the OmaSandbox container DO so
   * its onActivityExpired hook (sleepAfter teardown) records the final
   * /workspace snapshot scoped to this session.
   */
  setBackupContext?(opts: {
    userId: string;
    environmentId: string;
    sessionId: string;
  }): Promise<void>;
  /**
   * Trigger an immediate /workspace snapshot via OmaSandbox. Used by the
   * explicit-destroy path to capture state before sandbox.destroy() wipes
   * the container.
   */
  snapshotWorkspaceNow?(): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Read raw bytes — required for binary-safe `POST /v1/sessions/:id/files`
   *  promotion. Optional so adapters that only see text can omit it. */
  readFileBytes?(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string): Promise<string>;
  /** Mark a sandbox path read-only when the adapter can enforce it locally. */
  makeReadOnly?(path: string): Promise<void>;
  /**
   * Write raw bytes. Use this for binary files (PDFs, images, archives) —
   * the string-based writeFile would corrupt them via UTF-8 round-tripping.
   */
  writeFileBytes?(path: string, bytes: Uint8Array): Promise<string>;
  /**
   * Mount FILES_BUCKET at /mnt/session/outputs/ scoped to (userId, sessionId)
   * via R2 prefix. Anything the agent writes here appears in real time via
   * the caller-facing GET /v1/sessions/:id/outputs endpoint. AMA-aligned
   * "magic dir" pattern — agent uses standard file tools, no extra tool.
   */
  mountSessionOutputs?(opts: {
    userId: string;
    sessionId: string;
  }): Promise<void>;
  /**
   * Snapshot /workspace into durable storage. Returns a serializable
   * handle; null on failure. CF: squashfs → R2. Node: tar → S3 (when wired).
   */
  createWorkspaceBackup?(opts: {
    name?: string;
    ttlSec: number;
  }): Promise<{ id: string; dir: string; localBucket?: boolean } | null>;
  /**
   * Restore a previously-created backup into /workspace. Returns
   * `{ok:true}` on success, `{ok:false, error?}` when the backup is
   * missing/expired/etc. Best-effort: callers treat ok=false as "/workspace
   * is empty, proceed". Matches the apps/agent SandboxExecutor signature so
   * adapters can satisfy both ports without divergence.
   */
  restoreWorkspaceBackup?(handle: {
    id: string;
    dir: string;
    localBucket?: boolean;
  }): Promise<{ ok: boolean; error?: string }>;
  /** Destroy the sandbox — kills processes, unmounts, stops. */
  destroy?(): Promise<void>;
  /**
   * Tell the sandbox container "I'm still active". Resets CF Container's
   * sleepAfter inactivity timer; long-running bg tasks keep the box alive
   * via this. No-op on impls that don't auto-sleep.
   */
  renewActivityTimeout?(): Promise<void>;
}

// ─── Factory contract ──────────────────────────────────────────────────
//
// Dependency-inversion entry point. Every adapter exports a single
// `sandboxFactory: SandboxFactory`; the host (main-node, future shells)
// only knows the provider name → import path map and never reads any
// adapter-specific env var. Adding a new adapter is "create file +
// register name in the map" — host code doesn't grow.
//
// Each factory reads its own env vars off the SandboxFactoryEnv arg
// (just `process.env` repackaged for testability).

export interface SandboxFactoryContext {
  /** Per-session id — adapters use it for naming, scoping, etc. */
  sessionId: string;
  /** Host directory used as the Agent's `/workspace` and cwd. */
  workdir: string;
  /** Whether the workdir is shared by multiple session sandboxes. */
  sharedWorkspace?: boolean;
  /** Session-outputs root on the host. LocalSubprocess symlinks
   *  per-(user, session) dirs under here when mountSessionOutputs
   *  is called; remote adapters that don't host-mount can ignore it. */
  outputsRoot?: string;
}

/** Read-only view of process env handed to the factory. Whole `process.env`
 *  is fine in practice — adapters cherry-pick the keys they care about
 *  (e.g. BoxRun reads `BOXRUN_URL`, E2B reads `E2B_API_KEY`). */
export type SandboxFactoryEnv = Readonly<Record<string, string | undefined>>;

export type SandboxFactory = (
  ctx: SandboxFactoryContext,
  env: SandboxFactoryEnv,
) => Promise<SandboxExecutor>;
