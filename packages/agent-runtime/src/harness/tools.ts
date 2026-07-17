import { tool } from "ai";
import { z } from "zod";
import type {
  AgentConfig,
  CustomToolConfig,
  ToolsetConfig,
} from "@open-managed-agents/shared";
import type { ProcessHandle, SandboxExecutor } from "./interface";

/** The deliberately small trusted-local toolset used by self-host. */
export const DEFAULT_TOOLS = ["bash", "read", "write", "edit", "glob", "grep"];
export const OPT_IN_TOOLS: string[] = [];
export const ALL_TOOLS = [...DEFAULT_TOOLS];

const MAX_TOOL_RESULT_CHARS = 50_000;
const DEFAULT_BASH_TIMEOUT = 120_000;
const MAX_BASH_TIMEOUT = 600_000;

function truncateResult(value: string): string {
  return value.length > MAX_TOOL_RESULT_CHARS
    ? `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n...(truncated, total ${value.length} chars)`
    : value;
}

async function pollProcess(
  proc: ProcessHandle,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (prefix: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
      let output = "";
      try {
        const logs = await proc.getLogs();
        output = `${logs.stdout ?? ""}${logs.stderr ? `\nstderr: ${logs.stderr}` : ""}`;
      } catch {
        // The process result is still useful when logs are unavailable.
      }
      resolve(truncateResult(`${prefix}${output ? `\n${output}` : ""}`.trim()));
    };
    const abort = () => {
      void proc.kill("SIGTERM").catch(() => undefined);
      void finish("exit=130\nCommand cancelled");
    };
    const timer = setTimeout(() => {
      void proc.kill("SIGTERM").catch(() => undefined);
      void finish(`exit=143\nCommand timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    abortSignal?.addEventListener("abort", abort, { once: true });
    if (abortSignal?.aborted) abort();

    const poll = async () => {
      while (!settled) {
        const status = await proc.getStatus();
        if (!["starting", "running"].includes(status)) {
          const exitCode = (proc as ProcessHandle & { exitCode?: number }).exitCode;
          const code = typeof exitCode === "number"
            ? exitCode
            : status === "killed" ? 137 : status === "completed" ? 0 : 1;
          await finish(`exit=${code}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    void poll().catch(() => void finish("exit=1\nProcess polling failed"));
  });
}

type ToolResult = string | Record<string, unknown>;
function safe<T>(fn: (args: T, options?: { abortSignal?: AbortSignal }) => Promise<ToolResult>) {
  return async (args: T, options?: { abortSignal?: AbortSignal }): Promise<ToolResult> => {
    try {
      const result = await fn(args, options);
      return typeof result === "string" && !result.trim() ? "(completed with no output)" : result;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[] | undefined) ?? [];
  if (!properties) return z.record(z.string(), z.unknown());
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, property] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (property.type) {
      case "string": field = z.string(); break;
      case "number":
      case "integer": field = z.number(); break;
      case "boolean": field = z.boolean(); break;
      case "array": field = z.array(z.unknown()); break;
      default: field = z.unknown();
    }
    shape[name] = required.includes(name) ? field : field.optional();
  }
  return z.object(shape);
}

export function getToolPermission(agentConfig: AgentConfig, toolName: string): string {
  for (const item of agentConfig.tools ?? []) {
    if (item.type === "custom") continue;
    const config = item as ToolsetConfig;
    const selected = config.configs?.find((entry) => entry.name === toolName);
    return selected?.permission_policy?.type ?? config.default_config?.permission_policy?.type ?? "always_allow";
  }
  return "always_allow";
}

function getEnabledTools(configs: AgentConfig["tools"]): Set<string> {
  const enabled = new Set(DEFAULT_TOOLS);
  for (const item of configs ?? []) {
    if (item.type === "custom") continue;
    const config = item as ToolsetConfig;
    for (const entry of config.configs ?? []) {
      if (entry.enabled) enabled.add(entry.name);
      else enabled.delete(entry.name);
    }
  }
  return enabled;
}

export async function buildTools(
  agentConfig: AgentConfig,
  sandbox: SandboxExecutor,
  env?: { allowAlwaysAsk?: boolean },
): Promise<Record<string, unknown>> {
  const enabled = getEnabledTools(agentConfig.tools);
  const tools: Record<string, any> = {};

  if (enabled.has("bash")) {
    tools.bash = tool({
      description: "Execute a bounded bash command in the trusted local subprocess workspace.",
      inputSchema: z.object({
        command: z.string(),
        timeout: z.number().optional(),
      }),
      execute: safe(async ({ command, timeout }: { command: string; timeout?: number }, options) => {
        const timeoutMs = Math.min(timeout ?? DEFAULT_BASH_TIMEOUT, MAX_BASH_TIMEOUT);
        if (sandbox.startProcess) {
          const proc = await sandbox.startProcess(command);
          if (proc) return pollProcess(proc, timeoutMs, options?.abortSignal);
        }
        return sandbox.execWithSignal
          ? sandbox.execWithSignal(command, timeoutMs, options?.abortSignal)
          : sandbox.exec(command, timeoutMs);
      }),
    });
  }

  if (enabled.has("read")) {
    tools.read = tool({
      description: "Read a text file from the workspace, optionally by line range.",
      inputSchema: z.object({ file_path: z.string(), offset: z.number().optional(), limit: z.number().optional() }),
      execute: safe(async ({ file_path, offset, limit }: { file_path: string; offset?: number; limit?: number }) => {
        const content = await sandbox.readFile(file_path);
        if (offset === undefined && limit === undefined) return truncateResult(content);
        const lines = content.split("\n");
        const start = Math.max(0, (offset ?? 1) - 1);
        const end = limit === undefined ? lines.length : start + limit;
        return truncateResult(lines.slice(start, end).map((line, i) => `${start + i + 1}\t${line}`).join("\n"));
      }),
    });
  }

  if (enabled.has("write")) {
    tools.write = tool({
      description: "Write complete content to a workspace file.",
      inputSchema: z.object({ file_path: z.string(), content: z.string() }),
      execute: safe(async ({ file_path, content }: { file_path: string; content: string }) => sandbox.writeFile(file_path, content)),
    });
  }

  if (enabled.has("edit")) {
    tools.edit = tool({
      description: "Replace an exact unique string in a workspace file.",
      inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }),
      execute: safe(async ({ file_path, old_string, new_string, replace_all }: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }) => {
        const content = await sandbox.readFile(file_path);
        const count = content.split(old_string).length - 1;
        if (!count) return "Error: old_string not found in file";
        if (count > 1 && !replace_all) return `Error: old_string appears ${count} times in file`;
        return sandbox.writeFile(file_path, replace_all ? content.split(old_string).join(new_string) : content.replace(old_string, new_string));
      }),
    });
  }

  if (enabled.has("glob")) {
    tools.glob = tool({
      description: "Find files matching a glob pattern.",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: safe(async ({ pattern, path }: { pattern: string; path?: string }) => {
        const raw = await sandbox.exec(`cd ${shellQuote(path ?? "/workspace")} && bash -O globstar -O nullglob -c ${shellQuote(`printf '%s\\n' ${pattern}`)}`);
        return truncateResult(raw);
      }),
    });
  }

  if (enabled.has("grep")) {
    tools.grep = tool({
      description: "Search workspace files with a regular expression.",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional(), glob: z.string().optional() }),
      execute: safe(async ({ pattern, path, glob }: { pattern: string; path?: string; glob?: string }) => {
        const include = glob ? `--include=${shellQuote(glob)}` : "";
        return truncateResult(await sandbox.exec(`grep -RIn ${include} ${shellQuote(pattern)} ${shellQuote(path ?? "/workspace")} || true`));
      }),
    });
  }

  for (const item of agentConfig.tools ?? []) {
    if (item.type !== "custom") continue;
    const custom = item as CustomToolConfig;
    tools[custom.name] = tool({
      description: custom.description,
      inputSchema: custom.input_schema ? jsonSchemaToZod(custom.input_schema) : z.object({}),
    });
  }

  if (!env?.allowAlwaysAsk) {
    for (const [name, registered] of Object.entries(tools)) {
      if (getToolPermission(agentConfig, name) === "always_ask") {
        tools[name] = tool({ description: registered.description, inputSchema: registered.parameters ?? registered.inputSchema });
      }
    }
  }
  return tools;
}
