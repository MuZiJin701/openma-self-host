// LocalSubprocessSandbox — Node child_process backed SandboxExecutor.
//
// Per-session workdir under <baseDir>/<sessionId>/. exec spawns
// `/bin/sh -c <cmd>` with cwd=workdir and a timeout watchdog. read/write
// resolve relative paths inside workdir; absolute paths are accepted as-is
// (so the harness's existing /workspace/foo conventions still land
// somewhere — we transparently rewrite /workspace → workdir).
//
// /mnt/session/outputs: when running inside the `openma/main-node`
// container, we create a symlink at that root path pointing into the
// workdir's `.mnt/...` tree.
// Outside a container the host's `/mnt` is usually not writable as the
// `node` user — we fall back to the workdir-relative `.mnt/...` path
// rewriter so dev workflows still work.
//
// SECURITY: this adapter has zero process isolation. An agent that runs
// `rm -rf /` will hit the host. ONLY use for trusted local development.
// This adapter is for trusted local execution only.

import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { promises as fs } from "node:fs";
import {
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ProcessHandle, SandboxExecutor, SandboxFactory } from "../ports";
import { getLogger } from "@open-managed-agents/observability";

const moduleLogger = getLogger("local-sandbox");

export interface LocalSubprocessSandboxOptions {
  /** Agent workspace directory. Created if missing. */
  workdir: string;
  /** Session id used to isolate temporary mounts when workdir is shared. */
  sessionId?: string;
  /** Preserve workdir on destroy because another session may use it. */
  sharedWorkspace?: boolean;
  /**
   * Default command timeout in milliseconds (matches the SandboxExecutor
   * port contract). Per-call timeout overrides this.
   */
  defaultTimeoutMs?: number;
  /** Logger for debug/warn output. Defaults to console. */
  logger?: { warn: (msg: string, ctx?: unknown) => void; log: (msg: string) => void };
  /**
   * Absolute path to the directory backing per-session output deliveries
   * (the `/mnt/session/outputs/` magic dir). Required to support
   * mountSessionOutputs — when set, mountSessionOutputs symlinks
   * <workdir>/.mnt/session/outputs → <outputsRoot>/<userId>/<sessionId>/.
   * main-node's GET /v1/sessions/:id/outputs reads from the same root.
   * When omitted, mountSessionOutputs is a hard error (matches CF
   * behaviour without FILES_BUCKET).
   */
  outputsRoot?: string;
}

interface OutputsMount {
  userId: string;
  sessionId: string;
  /** Real path the symlink targets — `<outputsRoot>/<userId>/<sessionId>/`. */
  targetDir: string;
  /** Workdir-relative mount path — `.mnt/session/outputs`. */
  mountRel: string;
}

export class LocalSubprocessSandbox implements SandboxExecutor {
  private workdir: string;
  private mountRoot: string;
  private sharedWorkspace: boolean;
  private defaultTimeoutMs: number;
  private envVars: Record<string, string> = {};
  private processes = new Map<string, BackgroundProcess>();
  private outputsMount: OutputsMount | null = null;
  private outputsRoot: string | null;
  private logger: NonNullable<LocalSubprocessSandboxOptions["logger"]>;
  private readOnlyPaths = new Set<string>();

  constructor(opts: LocalSubprocessSandboxOptions) {
    this.workdir = resolve(opts.workdir);
    this.sharedWorkspace = opts.sharedWorkspace ?? false;
    const mountSession = (opts.sessionId ?? "default").replace(/[^A-Za-z0-9_.-]/g, "_");
    this.mountRoot = this.sharedWorkspace
      ? join(this.workdir, ".oma-sessions", mountSession)
      : this.workdir;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
    this.outputsRoot = opts.outputsRoot ? resolve(opts.outputsRoot) : null;
    this.logger = opts.logger ?? {
      warn: (msg, ctx) => moduleLogger.warn({ ...(ctx as Record<string, unknown> ?? {}) }, msg),
      log: (msg) => moduleLogger.info(msg),
    };
    mkdirSync(this.workdir, { recursive: true });
    mkdirSync(this.mountRoot, { recursive: true });
  }

  async exec(command: string, timeout?: number): Promise<string> {
    return this.execWithSignal(command, timeout);
  }

  async execWithSignal(command: string, timeout?: number, signal?: AbortSignal): Promise<string> {
    const timeoutMs = timeout ?? this.defaultTimeoutMs;
    const env = this.buildEnv();
    const shell = process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-c", command];

    return new Promise<string>((resolveExec) => {
      const child = spawn(shell, shellArgs, {
        cwd: this.workdir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        // Put the shell and its descendants in one group so timeout/abort
        // cannot leave a grandchild (for example `sleep`) holding stdout.
        detached: process.platform !== "win32",
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let forcedKillTimer: ReturnType<typeof setTimeout> | undefined;

      const killProcessGroup = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) {
            process.kill(-child.pid, signal);
          } else {
            child.kill(signal);
          }
        } catch (err) {
          this.logger.warn(`exec kill failed: ${(err as Error).message}`);
        }
      };

      const onAbort = () => {
        if (settled) return;
        killProcessGroup("SIGTERM");
        forcedKillTimer = setTimeout(() => killProcessGroup("SIGKILL"), 1_000);
      };

      const cleanup = () => {
        clearTimeout(killer);
        if (forcedKillTimer) clearTimeout(forcedKillTimer);
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = (code: number | null, childSignal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        const exit = childSignal ? `signal=${childSignal}` : `exit=${code}`;
        // Match @cloudflare/sandbox's behaviour: combined stdout+stderr,
        // newline-trimmed, plus an exit-code suffix the harness can parse.
        const combined =
          (stdout + (stderr ? `\n${stderr}` : "")).replace(/\s+$/, "") +
          (code !== 0 ? `\n[exit ${exit}]` : "");
        resolveExec(combined);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const killer = setTimeout(() => {
        onAbort();
      }, timeoutMs);

      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();

      child.on("close", (code, signal) => {
        finish(code, signal);
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveExec(`[error: ${err.message}]`);
      });
    });
  }

  async startProcess(command: string): Promise<ProcessHandle | null> {
    const env = this.buildEnv();
    const shell = process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-c", command];
    const child = spawn(shell, shellArgs, {
      cwd: this.workdir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    if (!child.pid) return null;
    const id = `proc_${child.pid}_${Date.now()}`;
    const proc = new BackgroundProcess(id, child);
    this.processes.set(id, proc);
    child.on("close", () => this.processes.delete(id));
    return proc;
  }

  async setEnvVars(envVars: Record<string, string>): Promise<void> {
    this.envVars = { ...this.envVars, ...envVars };
  }

  async mountSessionOutputs(opts: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    if (!this.outputsRoot) {
      throw new Error(
        `LocalSubprocessSandbox.mountSessionOutputs: outputsRoot not configured — ` +
        `pass it to the constructor or skip outputs mounts`,
      );
    }
    const targetDir = join(
      this.outputsRoot,
      encodeURIComponent(opts.userId),
      ".openma",
      "outputs",
      encodeURIComponent(opts.sessionId),
    );
    mkdirSync(targetDir, { recursive: true });

    const mountParent = join(this.mountRoot, ".mnt", "session");
    mkdirSync(mountParent, { recursive: true });

    const workdirSymlink = join(mountParent, "outputs");
    try {
      rmSync(workdirSymlink, { recursive: true, force: true });
    } catch { /* best-effort */ }
    try {
      symlinkSync(targetDir, workdirSymlink, "dir");
    } catch (err) {
      throw new Error(
        `mountSessionOutputs: symlink ${workdirSymlink} → ${targetDir} failed: ` +
        (err as Error).message,
      );
    }

    const rootSymlink = `/mnt/session/outputs`;
    if (!this.sharedWorkspace && this.tryEnsureRootMountDir("/mnt/session")) {
      try {
        rmSync(rootSymlink, { recursive: true, force: true });
      } catch { /* best-effort */ }
      try {
        symlinkSync(targetDir, rootSymlink, "dir");
      } catch (err) {
        this.logger.warn(
          `root symlink /mnt/session/outputs skipped: ${(err as Error).message}`,
        );
      }
    }

    this.outputsMount = {
      userId: opts.userId,
      sessionId: opts.sessionId,
      targetDir,
      mountRel: join(".mnt", "session", "outputs"),
    };

    await this.setEnvVars({ OMA_OUTPUTS_DIR: workdirSymlink });
  }

  async readFile(path: string): Promise<string> {
    return fs.readFile(this.resolvePath(path), "utf8");
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const buf = await fs.readFile(this.resolvePath(path));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async writeFile(path: string, content: string): Promise<string> {
    this.assertWritable(path);
    const full = this.resolvePath(path);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return full;
  }

  async makeReadOnly(path: string): Promise<void> {
    const full = this.resolvePath(path);
    await this.chmodReadOnly(full);
    this.readOnlyPaths.add(full);
  }

  async writeFileBytes(path: string, bytes: Uint8Array): Promise<string> {
    this.assertWritable(path);
    const full = this.resolvePath(path);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return full;
  }

  async destroy(): Promise<void> {
    for (const proc of this.processes.values()) {
      try { await proc.kill("SIGKILL"); } catch { /* best-effort */ }
    }
    this.processes.clear();
    try {
      rmSync(this.sharedWorkspace ? this.mountRoot : this.workdir, {
        recursive: true,
        force: true,
      });
    } catch (err) {
      this.logger.warn(`destroy: failed to remove workdir ${this.workdir}`, err);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * Resolve a sandbox-relative path to a host absolute path inside workdir.
   * The harness emits /workspace/foo conventions assuming a real container
   * mount; we transparently rewrite /workspace → workdir so existing tools
   * keep working without changes.
   *
   * /mnt/session/outputs paths use the root symlink when available and
   * otherwise fall back to the workdir-relative `.mnt/...` mirror.
   */
  private resolvePath(p: string): string {
    let normalised = p;
    if (
      normalised.startsWith("/mnt/session/outputs/") ||
      normalised === "/mnt/session/outputs"
    ) {
      if (!this.sharedWorkspace && this.rootMountExists("/mnt/session/outputs")) return normalised;
      normalised = normalised === "/mnt/session/outputs"
        ? ".mnt/session/outputs"
        : ".mnt/session/outputs/" + normalised.slice("/mnt/session/outputs/".length);
    } else if (normalised.startsWith("/workspace/")) normalised = normalised.slice("/workspace/".length);
    else if (normalised === "/workspace") normalised = "";
    else if (normalised.startsWith("/")) normalised = normalised.slice(1);
    if (isAbsolute(normalised)) return normalised; // explicit absolute escape — caller's responsibility
    const base = normalised.startsWith(".mnt/") || normalised === ".mnt"
      ? this.mountRoot
      : this.workdir;
    return join(base, normalised);
  }

  /** True if a path exists on the host filesystem (symlink-followed). */
  private rootMountExists(p: string): boolean {
    if (this.rootMountCache.has(p)) return this.rootMountCache.get(p)!;
    let ok = false;
    try {
      statSync(p);
      ok = true;
    } catch {
      ok = false;
    }
    this.rootMountCache.set(p, ok);
    return ok;
  }
  private rootMountCache = new Map<string, boolean>();

  /**
   * Best-effort: ensure `/mnt/<x>` exists and is writable so we can
   * symlink children into it. Returns false (no throw) when the
   * filesystem refuses — caller falls back to the workdir-relative
   * `.mnt/...` path. This is the typical state outside the container.
   */
  private tryEnsureRootMountDir(parent: string): boolean {
    try {
      mkdirSync(parent, { recursive: true });
      // Touch — if mkdir succeeded but writes are blocked (e.g. read-only
      // tmpfs), the symlink call below would also fail.
      this.rootMountCache.set(parent, true);
      return true;
    } catch (err) {
      this.logger.warn(
        `mkdir ${parent} not allowed (${(err as Error).message}); falling back to workdir-relative mounts`,
      );
      return false;
    }
  }

  private assertWritable(p: string): void {
    const full = this.resolvePath(p);
    for (const root of this.readOnlyPaths) {
      if (full === root || full.startsWith(`${root}/`)) {
        throw new Error(`EACCES: path mounted read-only at ${p}`);
      }
    }
  }

  private async chmodReadOnly(path: string): Promise<void> {
    const info = await fs.stat(path);
    if (!info.isDirectory()) {
      await fs.chmod(path, 0o444);
      return;
    }
    await fs.chmod(path, 0o555);
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      await this.chmodReadOnly(join(path, entry.name));
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const base: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...this.envVars,
      PWD: this.workdir,
    };
    return base;
  }
}

class BackgroundProcess implements ProcessHandle {
  pid: number;
  private child: ChildProcess;
  private stdout = "";
  private stderr = "";
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  constructor(public id: string, child: ChildProcess) {
    this.child = child;
    this.pid = child.pid ?? 0;
    child.stdout?.on("data", (b: Buffer) => { this.stdout += b.toString("utf8"); });
    child.stderr?.on("data", (b: Buffer) => { this.stderr += b.toString("utf8"); });
    child.on("close", (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal as NodeJS.Signals | null;
    });
  }

  async kill(signal: string): Promise<void> {
    try {
      const nodeSignal = signal as NodeJS.Signals;
      if (process.platform !== "win32" && this.child.pid) {
        process.kill(-this.child.pid, nodeSignal);
      } else {
        this.child.kill(nodeSignal);
      }
    } catch (err) {
      throw new Error(`kill failed: ${(err as Error).message}`);
    }
  }

  async getLogs(): Promise<{ stdout: string; stderr: string }> {
    return { stdout: this.stdout, stderr: this.stderr };
  }

  async getStatus(): Promise<string> {
    if (this.exitCode === null && this.exitSignal === null) return "running";
    // Match the status vocabulary @cloudflare/sandbox uses — pollWithStrategies
    // in apps/agent/src/harness/tools.ts checks for "completed" / "error" /
    // "killed" exactly. Returning "exited:0" / "signaled:SIGTERM" silently
    // hangs the harness's tool-call wait loop until the watchdog fires.
    if (this.exitSignal) return "killed";
    return this.exitCode === 0 ? "completed" : "error";
  }
}

// ── Factory (DIP entry point) ───────────────────────────────────────

export const sandboxFactory: SandboxFactory = async (ctx) => {
  return new LocalSubprocessSandbox({
    workdir: ctx.workdir,
    sessionId: ctx.sessionId,
    sharedWorkspace: ctx.sharedWorkspace,
    outputsRoot: ctx.outputsRoot,
  });
};
