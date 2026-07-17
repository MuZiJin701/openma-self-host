import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import yaml from "js-yaml";

import { useApi } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Combobox } from "../../components/Combobox";
import { AGENT_TEMPLATES, type AgentTemplate } from "../../data/templates";
import type { ModelCard } from "@open-managed-agents/api-types";
import type { AgentRecord as Agent } from "../../types/agent";

interface SkillEntry {
  type: "anthropic" | "custom";
  skill_id: string;
  version?: string;
}
interface CallableEntry {
  type: "agent";
  id: string;
  version: number;
}

const ANTHROPIC_SKILLS = [
  { id: "xlsx", label: "Excel (xlsx)" },
  { id: "pdf", label: "PDF" },
  { id: "pptx", label: "PowerPoint (pptx)" },
  { id: "docx", label: "Word (docx)" },
];

// Core built-in tools exposed by the trusted local runtime.
const BUILTIN_TOOLS: Array<{ name: string; label: string; description: string }> = [
  { name: "bash", label: "bash", description: "Run shell commands in the sandbox" },
  { name: "edit", label: "edit", description: "In-place file edits" },
  { name: "read", label: "read", description: "Read files from the sandbox FS" },
  { name: "write", label: "write", description: "Create or overwrite files" },
  { name: "glob", label: "glob", description: "Pattern-match file paths" },
  { name: "grep", label: "grep", description: "Search file contents" },
];

type ToolOverride = "default" | "always_allow" | "always_ask" | "disabled";

const INITIAL_FORM = {
  name: "",
  model: "",
  system: "",
  description: "",
  modelCardId: "",
  skills: [] as SkillEntry[],
  callableAgents: [] as CallableEntry[],
  // Built-in tool policy. `agent_toolset_20260401` toolset's
  // `default_config` controls fallback enabled/permission for any
  // tool without a specific override. `toolOverrides` is a per-tool
  // 4-state: "default" (no entry emitted in configs[]), "always_allow",
  // "always_ask", or "disabled" (enabled=false).
  toolDefaultEnabled: true,
  toolDefaultPermission: "always_allow" as "always_allow" | "always_ask",
  toolOverrides: {} as Record<string, ToolOverride>,
  // Opt-in to the built-in `general_subagent` tool.
  enableGeneralSubagent: false,
};

interface AgentFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the agent is created successfully. Parent uses this
   *  to refresh the list. The dialog handles its own navigation to the
   *  new agent's detail page. */
  onCreated?: () => void;
  /** Data sets the form's pickers pull from. The parent fetches these
   *  on mount (loadAux) and passes them down so the dialog doesn't have
   *  to re-fetch on every open. */
  allAgents: Agent[];
  customSkills: Array<{ id: string; name: string; description: string }>;
  modelCards: ModelCard[];
}

/**
 * Create-agent dialog. Multi-step (template → form) with three editor
 * modes (form / yaml / json). Owns all of its own state — `form`,
 * `createStep`, `createMode`, etc. — so the parent `AgentsList` just
 * mounts it and forwards data lists + an `onCreated` hook for the
 * post-save refresh.
 *
 * Stays hand-rolled rather than wrapping `Modal` because the
 * template→form/yaml/json multi-step header doesn't fit the standard
 * Modal layout. Focus trap, scroll lock, focus restore, and Escape
 * handling are reimplemented inline (mirroring `components/Modal.tsx`
 * behavior) so keyboard + screen-reader users get the same affordances.
 */
export function AgentFormDialog({
  open,
  onClose,
  onCreated,
  allAgents,
  customSkills,
  modelCards,
}: AgentFormDialogProps) {
  const { api } = useApi();
  const nav = useNavigate();

  const [createError, setCreateError] = useState("");
  const [createStep, setCreateStep] = useState<"template" | "form">("template");
  const [templateSearch, setTemplateSearch] = useState("");
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [tab, setTab] = useState<"basic" | "tools" | "skills" | "agents">("basic");
  const [createMode, setCreateMode] = useState<"form" | "yaml" | "json">("form");
  const [codeValue, setCodeValue] = useState("");

  const createDialogRef = useRef<HTMLDivElement>(null);
  const createPreviousFocus = useRef<HTMLElement | null>(null);

  // Pre-select default model card when entering the form step. (tenant_id,
  // model_id) is UNIQUE in DB, so picking a card uniquely determines the
  // model. Skip if user/paste already set model. Re-runs when modelCards
  // arrives if the dialog opened before the aux fetch.
  useEffect(() => {
    if (createStep !== "form") return;
    if (form.modelCardId || form.model) return;
    if (modelCards.length === 0) return;
    const def = modelCards.find((mc) => mc.is_default) ?? modelCards[0];
    setForm((f) => ({ ...f, modelCardId: def.id, model: def.model_id }));
    // Intentionally not depending on form.* — guards above prevent the
    // re-trigger loop and we only want to hydrate on step entry / cards arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createStep, modelCards.length]);

  const closeCreate = () => {
    setCreateStep("template");
    setTemplateSearch("");
    setForm({ ...INITIAL_FORM });
    setTab("basic");
    setCreateError("");
    setCreateMode("form");
    setCodeValue("");
    onClose();
  };

  // Dialog a11y — focus trap + Escape, scroll lock, focus restore on close.
  // Mirrors components/Modal.tsx behavior so this hand-rolled multi-step
  // dialog is keyboard-equivalent.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeCreate();
        return;
      }
      if (e.key !== "Tab") return;
      const el = createDialogRef.current;
      if (!el) return;
      const f = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // closeCreate is stable enough — deps kept tight to avoid re-binding
    // on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    createPreviousFocus.current = document.activeElement as HTMLElement;
    const el = createDialogRef.current;
    el?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      createPreviousFocus.current?.focus();
    };
  }, [open]);

  // Serialize the form's tool-policy state into the AMA-shape
  // `tools` array. Always emits exactly one toolset entry of type
  // `agent_toolset_20260401`; per-tool overrides only land in
  // `configs[]` when they differ from the default.
  const buildToolsField = () => {
    const overrides = Object.entries(form.toolOverrides)
      .filter(([, v]) => v !== "default")
      .map(([name, v]) => {
        if (v === "disabled") return { name, enabled: false };
        return {
          name,
          enabled: true,
          permission_policy: { type: v as "always_allow" | "always_ask" },
        };
      });
    return [
      {
        type: "agent_toolset_20260401",
        default_config: {
          enabled: form.toolDefaultEnabled,
          permission_policy: { type: form.toolDefaultPermission },
        },
        ...(overrides.length > 0 ? { configs: overrides } : {}),
      },
    ];
  };

  const create = async () => {
    setCreateError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        model: form.model,
        system: form.system || undefined,
        description: form.description || undefined,
        tools: buildToolsField(),
      };
      if (form.skills.length) payload.skills = form.skills;
      if (form.callableAgents.length) {
        payload.multiagent = { type: "coordinator", agents: form.callableAgents };
      }
      if (form.enableGeneralSubagent) {
        payload.enable_general_subagent = true;
      }
      const agent = await api<Agent>("/v1/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeCreate();
      onCreated?.();
      nav(`/agents/${agent.id}`);
    } catch (e: any) {
      setCreateError(e?.message || "Failed to create agent");
    }
  };

  const toggleAnthropicSkill = (skillId: string) => {
    const exists = form.skills.find((s) => s.type === "anthropic" && s.skill_id === skillId);
    if (exists) {
      setForm({
        ...form,
        skills: form.skills.filter((s) => !(s.type === "anthropic" && s.skill_id === skillId)),
      });
    } else {
      setForm({
        ...form,
        skills: [...form.skills, { type: "anthropic", skill_id: skillId }],
      });
    }
  };

  const addCallable = (agentId: string) => {
    if (form.callableAgents.find((c) => c.id === agentId)) return;
    setForm({
      ...form,
      callableAgents: [...form.callableAgents, { type: "agent", id: agentId, version: 1 }],
    });
  };
  const removeCallable = (i: number) =>
    setForm({ ...form, callableAgents: form.callableAgents.filter((_, j) => j !== i) });

  const selectTemplate = (tmpl: AgentTemplate) => {
    if (tmpl.id === "blank") {
      setForm({ ...INITIAL_FORM });
    } else {
      setForm({
        ...INITIAL_FORM,
        name: tmpl.name,
        model: tmpl.model,
        system: tmpl.system,
        description: tmpl.description,
        skills: tmpl.skills.map((s) => ({ ...s } as SkillEntry)),
      });
    }
    setCreateStep("form");
    setTab("basic");
  };

  // Convert current form state to a config object
  const formToConfig = () => {
    const config: Record<string, unknown> = {
      name: form.name,
      model: form.model,
    };
    if (form.system) config.system = form.system;
    if (form.description) config.description = form.description;
    config.tools = buildToolsField();
    if (form.skills.length) config.skills = form.skills;
    if (form.callableAgents.length) {
      config.multiagent = { type: "coordinator", agents: form.callableAgents };
    }
    if (form.enableGeneralSubagent) {
      config.enable_general_subagent = true;
    }
    return config;
  };

  // Switch between form/yaml/json modes
  const switchMode = (mode: "form" | "yaml" | "json") => {
    if (mode === createMode) return;
    if (createMode === "form") {
      // form → code: serialize current form
      const config = formToConfig();
      setCodeValue(
        mode === "yaml" ? yaml.dump(config, { lineWidth: -1 }) : JSON.stringify(config, null, 2),
      );
    } else if (mode === "form") {
      // code → form: try to parse back (best-effort, may lose data)
      try {
        const parsed =
          createMode === "yaml"
            ? (yaml.load(codeValue) as Record<string, unknown>)
            : JSON.parse(codeValue);
        // Tool policy round-trip: extract default + per-tool overrides.
        const toolset = Array.isArray(parsed.tools)
          ? (parsed.tools as Array<Record<string, unknown>>).find(
              (t) => t?.type === "agent_toolset_20260401",
            )
          : undefined;
        const dc = (toolset?.default_config ?? {}) as {
          enabled?: boolean;
          permission_policy?: { type?: string };
        };
        const cfgs = (toolset?.configs ?? []) as Array<{
          name?: string;
          enabled?: boolean;
          permission_policy?: { type?: string };
        }>;
        const overrides: Record<string, ToolOverride> = {};
        for (const c of cfgs) {
          if (!c?.name) continue;
          if (c.enabled === false) overrides[c.name] = "disabled";
          else if (c.permission_policy?.type === "always_ask") overrides[c.name] = "always_ask";
          else if (c.permission_policy?.type === "always_allow") overrides[c.name] = "always_allow";
        }
        setForm({
          ...INITIAL_FORM,
          name: String(parsed.name || ""),
          // Paste-mode fallback: if the pasted config has no model field,
          // claude-sonnet-4-6 is a real, current Anthropic model id (not
          // a placeholder), so it's a reasonable default. The form
          // dropdown does its own dynamic option set from modelCards.
          model: String(parsed.model || "claude-sonnet-4-6"),
          system: String(parsed.system || ""),
          description: String(parsed.description || ""),
          skills: Array.isArray(parsed.skills) ? (parsed.skills as SkillEntry[]) : [],
          callableAgents: Array.isArray(parsed.multiagent?.agents)
            ? (parsed.multiagent.agents as CallableEntry[])
            : [],
          toolDefaultEnabled: dc.enabled ?? true,
          toolDefaultPermission:
            dc.permission_policy?.type === "always_ask" ? "always_ask" : "always_allow",
          toolOverrides: overrides,
          enableGeneralSubagent: parsed.enable_general_subagent === true,
        });
      } catch {
        /* keep current form if parse fails */
      }
    } else {
      // yaml ↔ json: convert between formats
      try {
        const parsed = createMode === "yaml" ? yaml.load(codeValue) : JSON.parse(codeValue);
        setCodeValue(
          mode === "yaml"
            ? yaml.dump(parsed, { lineWidth: -1 })
            : JSON.stringify(parsed, null, 2),
        );
      } catch {
        /* keep current value if parse fails */
      }
    }
    setCreateMode(mode);
  };

  // Create agent from code editor
  const createFromCode = async () => {
    setCreateError("");
    try {
      const parsed =
        createMode === "yaml"
          ? (yaml.load(codeValue) as Record<string, unknown>)
          : JSON.parse(codeValue);
      if (!parsed.name) {
        setCreateError("name is required");
        return;
      }
      if (!parsed.tools) parsed.tools = [{ type: "agent_toolset_20260401" }];
      const agent = await api<Agent>("/v1/agents", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      closeCreate();
      onCreated?.();
      nav(`/agents/${agent.id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid config";
      setCreateError(msg);
    }
  };

  const filteredTemplates = templateSearch
    ? AGENT_TEMPLATES.filter(
        (t) =>
          t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
          t.description.toLowerCase().includes(templateSearch.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(templateSearch.toLowerCase())),
      )
    : AGENT_TEMPLATES;

  const inputCls =
    "w-full border border-border rounded-md px-3 py-2 min-h-11 sm:min-h-0 text-sm bg-bg text-fg outline-none focus:border-brand transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] placeholder:text-fg-subtle";
  const tabCls = (t: string) =>
    `inline-flex items-center justify-center px-3 py-1.5 min-h-11 sm:min-h-0 text-sm rounded-md transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
      tab === t ? "bg-brand text-brand-fg" : "text-fg-muted hover:bg-bg-surface"
    }`;

  // Resolve which card the Model dropdown should highlight: explicit pick
  // wins, otherwise derive from model_id (paste path / pre-select effect).
  // Empty string when nothing matches (e.g. paste mode with an unknown model).
  const selectedCardId =
    form.modelCardId || modelCards.find((mc) => mc.model_id === form.model)?.id || "";

  if (!open) {
    // Render the MCP picker anyway? No — it only makes sense while the
    // form dialog is mounted.
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50"
        onClick={closeCreate}
      >
        <div
          ref={createDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="New Agent"
          className="bg-bg rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Template selection step */}
          {createStep === "template" && (
            <>
              <div className="px-6 pt-6 pb-4 border-b border-border">
                <h2 className="font-display text-lg font-semibold text-fg">New Agent</h2>
                <p className="text-sm text-fg-muted mt-1">
                  Start from a template or build from scratch.
                </p>
                <input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className={`${inputCls} mt-3`}
                  placeholder="Search templates..."
                  aria-label="Search templates"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="grid grid-cols-2 gap-3">
                  {filteredTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => selectTemplate(tmpl)}
                      className="text-left border border-border rounded-lg p-4 hover:border-brand hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
                    >
                      <div className="font-medium text-sm text-fg">{tmpl.name}</div>
                      <div className="text-xs text-fg-muted mt-1 line-clamp-2">
                        {tmpl.description}
                      </div>
                      {tmpl.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tmpl.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 bg-bg-surface text-fg-muted rounded text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                {filteredTemplates.length === 0 && (
                  <div className="text-center py-8 text-fg-subtle text-sm">
                    No templates match your search.
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <button
                  onClick={closeCreate}
                  className="inline-flex items-center min-h-11 sm:min-h-0 px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* Form step */}
          {createStep === "form" && (
            <>
              <div className="px-6 pt-6 pb-4 border-b border-border">
                <div className="flex items-center justify-between mb-1">
                  <button
                    onClick={() => {
                      setCreateStep("template");
                      setTemplateSearch("");
                      setCreateMode("form");
                    }}
                    className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-fg-subtle hover:text-fg transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
                  >
                    &larr; Templates
                  </button>
                  <div className="flex items-center gap-0.5 bg-bg-surface rounded-md p-0.5">
                    {(["form", "yaml", "json"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => switchMode(m)}
                        className={`inline-flex items-center justify-center px-2 py-1 min-h-11 sm:min-h-0 text-xs rounded transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
                          createMode === m
                            ? "bg-bg text-fg font-medium shadow-sm"
                            : "text-fg-muted hover:text-fg"
                        }`}
                      >
                        {m === "form" ? "Form" : m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <h2 className="font-display text-lg font-semibold text-fg">New Agent</h2>
                {createMode === "form" && (
                  <div
                    role="tablist"
                    aria-label="Agent configuration sections"
                    className="flex gap-1 mt-3"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === "basic"}
                      tabIndex={tab === "basic" ? 0 : -1}
                      onClick={() => setTab("basic")}
                      className={tabCls("basic")}
                    >
                      Basic
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "tools"}
                      tabIndex={tab === "tools" ? 0 : -1}
                      onClick={() => setTab("tools")}
                      className={tabCls("tools")}
                    >
                      Tools{" "}
                      {Object.keys(form.toolOverrides).length > 0 && (
                        <span className="ml-1 text-xs opacity-60">
                          ({Object.keys(form.toolOverrides).length})
                        </span>
                      )}
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "skills"}
                      tabIndex={tab === "skills" ? 0 : -1}
                      onClick={() => setTab("skills")}
                      className={tabCls("skills")}
                    >
                      Skills{" "}
                      {form.skills.length > 0 && (
                        <span className="ml-1 text-xs opacity-60">({form.skills.length})</span>
                      )}
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "agents"}
                      tabIndex={tab === "agents" ? 0 : -1}
                      onClick={() => setTab("agents")}
                      className={tabCls("agents")}
                    >
                      Multi-Agent{" "}
                      {form.callableAgents.length > 0 && (
                        <span className="ml-1 text-xs opacity-60">
                          ({form.callableAgents.length})
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {/* Code editor mode (YAML/JSON) */}
                {createMode !== "form" && (
                  <div className="space-y-3 h-full flex flex-col">
                    {createError && (
                      <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
                        {createError}
                      </div>
                    )}
                    <textarea
                      value={codeValue}
                      onChange={(e) => setCodeValue(e.target.value)}
                      className={`${inputCls} flex-1 resize-none font-mono text-xs leading-relaxed min-h-[300px]`}
                      spellCheck={false}
                    />
                  </div>
                )}
                {/* Form mode */}
                {createMode === "form" && tab === "basic" && (
                  <BasicTab
                    form={form}
                    setForm={setForm}
                    createError={createError}
                    inputCls={inputCls}
                    modelCards={modelCards}
                    selectedCardId={selectedCardId}
                  />
                )}

                {createMode === "form" && tab === "tools" && (
                  <ToolsTab form={form} setForm={setForm} createError={createError} />
                )}

                {createMode === "form" && tab === "skills" && (
                  <SkillsTab
                    form={form}
                    setForm={setForm}
                    customSkills={customSkills}
                    toggleAnthropicSkill={toggleAnthropicSkill}
                  />
                )}

                {createMode === "form" && tab === "agents" && (
                  <AgentsTab
                    form={form}
                    setForm={setForm}
                    allAgents={allAgents}
                    addCallable={addCallable}
                    removeCallable={removeCallable}
                  />
                )}
              </div>

              <div className="px-6 py-4 border-t border-border flex justify-between items-center">
                <div className="text-xs text-fg-subtle">
                  {createMode === "form" && (
                    <>
                      {form.skills.length > 0 && (
                        <span className="mr-3">{form.skills.length} skills</span>
                      )}
                      {form.callableAgents.length > 0 && (
                        <span>{form.callableAgents.length} agents</span>
                      )}
                    </>
                  )}
                  {createMode !== "form" && <span>{createMode.toUpperCase()} editor</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={closeCreate}>
                    Cancel
                  </Button>
                  {createMode === "form" ? (
                    <Button onClick={create} disabled={!form.name}>
                      Create Agent
                    </Button>
                  ) : (
                    <Button onClick={createFromCode} disabled={!codeValue.trim()}>
                      Create Agent
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

    </>
  );
}

type FormState = typeof INITIAL_FORM;
type FormSetter = React.Dispatch<React.SetStateAction<FormState>>;

interface BasicTabProps {
  form: FormState;
  setForm: FormSetter;
  createError: string;
  inputCls: string;
  modelCards: ModelCard[];
  selectedCardId: string;
}

function BasicTab({
  form,
  setForm,
  createError,
  inputCls,
  modelCards,
  selectedCardId,
}: BasicTabProps) {
  return (
    <div className="space-y-3">
      {createError && (
        <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
          {createError}
        </div>
      )}
      <div>
        <label htmlFor="agent-name" className="text-sm text-fg-muted block mb-1">
          Name *
        </label>
        <input
          id="agent-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputCls}
          placeholder="Coding Assistant"
        />
      </div>
      {/* Model picker — see comments at the original call site. */}
      {modelCards.length === 0 ? (
          <p className="text-xs text-fg-subtle bg-bg-surface px-3 py-2 rounded-lg">
            No model cards configured. Cloud agents need at least one card to provide LLM
            credentials.{" "}
            <a href="/model-cards" className="underline hover:text-fg-muted">
              Add one
            </a>
            .
          </p>
        ) : (
          <div>
            <label className="text-sm text-fg-muted block mb-1">Model</label>
            <Combobox<ModelCard>
              value={selectedCardId}
              onValueChange={(v, item) => {
                setForm({ ...form, modelCardId: v, model: item?.model_id ?? v });
              }}
              endpoint="/v1/model_cards"
              getValue={(mc) => mc.id}
              getLabel={(mc) => (
                <span>
                  {mc.is_default ? "★ " : ""}
                  {mc.model_id}
                  {mc.model !== mc.model_id && (
                    <span className="text-fg-subtle text-[12px]"> ({mc.model})</span>
                  )}
                </span>
              )}
              getTextLabel={(mc) =>
                `${mc.is_default ? "★ " : ""}${mc.model_id}${
                  mc.model !== mc.model_id ? ` (${mc.model})` : ""
                }`
              }
              placeholder={
                !selectedCardId && form.model
                  ? `⚠ ${form.model} — no matching card, pick one`
                  : "Select a model card..."
              }
            />
          </div>
        )}
      <div>
        <label htmlFor="agent-description" className="text-sm text-fg-muted block mb-1">
          Description
        </label>
        <input
          id="agent-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className={inputCls}
          placeholder="A coding assistant that writes clean code..."
        />
      </div>
      <div>
        <label htmlFor="agent-system" className="text-sm text-fg-muted block mb-1">
          System Prompt
        </label>
        <textarea
          id="agent-system"
          value={form.system}
          onChange={(e) => setForm({ ...form, system: e.target.value })}
          rows={5}
          className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
          placeholder="You are a helpful assistant..."
        />
      </div>
    </div>
  );
}

function ToolsTab({
  form,
  setForm,
  createError,
}: {
  form: FormState;
  setForm: FormSetter;
  createError: string;
}) {
  return (
    <div className="space-y-5">
      {createError && (
        <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
          {createError}
        </div>
      )}

      <p className="text-xs text-fg-subtle leading-relaxed">
        Built-in toolset (AMA <span className="font-mono">agent_toolset_20260401</span>).
        Multi-agent delegation lives in its own tab and is a separate field{" "}
        <span className="font-mono">multiagent</span>.
      </p>

      <div className="rounded-md border border-border bg-bg-surface px-3 py-3">
        <div className="text-sm font-medium text-fg mb-1">Default policy</div>
        <p className="text-xs text-fg-subtle mb-3">
          Applies to every tool below that's set to{" "}
          <span className="font-mono">default</span>.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.toolDefaultEnabled}
              onChange={(e) => setForm({ ...form, toolDefaultEnabled: e.target.checked })}
              className="accent-brand"
            />
            Enable tools
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Permission:</span>
            <select
              value={form.toolDefaultPermission}
              disabled={!form.toolDefaultEnabled}
              onChange={(e) =>
                setForm({
                  ...form,
                  toolDefaultPermission: e.target.value as "always_allow" | "always_ask",
                })
              }
              className="border border-border rounded-md px-2 py-1 text-sm bg-bg text-fg outline-none focus:border-brand disabled:opacity-40"
            >
              <option value="always_allow">always_allow</option>
              <option value="always_ask">always_ask</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-fg block mb-2">Per-tool overrides</label>
        <p className="text-xs text-fg-subtle mb-3">
          Each row's effective state is shown in the dropdown. Pick{" "}
          <span className="font-mono">default</span> to inherit the policy above; pick a
          specific value to override. <span className="font-mono">always_ask</span> emits a{" "}
          <span className="font-mono">user.tool_confirmation</span> event the client must
          approve before each call.
        </p>
        <div className="border border-border rounded-md divide-y divide-border">
          {BUILTIN_TOOLS.map((bt) => {
            const current = form.toolOverrides[bt.name] ?? "default";
            const effectiveLabel = !form.toolDefaultEnabled
              ? "disabled"
              : form.toolDefaultPermission;
            const isOff =
              current === "disabled" || (current === "default" && !form.toolDefaultEnabled);
            return (
              <div
                key={bt.name}
                className={`flex items-center justify-between px-3 py-2 gap-3 ${
                  isOff ? "opacity-50" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-mono text-fg">{bt.label}</div>
                  <div className="text-xs text-fg-subtle truncate">{bt.description}</div>
                </div>
                <select
                  value={current}
                  onChange={(e) => {
                    const v = e.target.value as ToolOverride;
                    const next = { ...form.toolOverrides };
                    if (v === "default") delete next[bt.name];
                    else next[bt.name] = v;
                    setForm({ ...form, toolOverrides: next });
                  }}
                  className="border border-border rounded-md px-2 py-1 min-h-11 sm:min-h-0 text-xs bg-bg text-fg outline-none focus:border-brand shrink-0"
                >
                  <option value="default">default ({effectiveLabel})</option>
                  <option value="always_allow">always_allow</option>
                  <option value="always_ask">always_ask</option>
                  <option value="disabled">disabled</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SkillsTab({
  form,
  setForm,
  customSkills,
  toggleAnthropicSkill,
}: {
  form: FormState;
  setForm: FormSetter;
  customSkills: AgentFormDialogProps["customSkills"];
  toggleAnthropicSkill: (id: string) => void;
}) {
  // Hide skills that are already surfaced under Anthropic Skills above
  // (xlsx/pdf/pptx/docx — their backend rows show up in the same list as
  // user-registered skills, otherwise we duplicate).
  const anthropicIds = new Set(ANTHROPIC_SKILLS.map((s) => s.id));
  const filtered = customSkills.filter((cs) => !anthropicIds.has(cs.id));

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-fg block mb-2">Anthropic Skills</label>
        <div className="grid grid-cols-2 gap-2">
          {ANTHROPIC_SKILLS.map((s) => {
            const active = form.skills.some(
              (sk) => sk.type === "anthropic" && sk.skill_id === s.id,
            );
            return (
              <button
                key={s.id}
                onClick={() => toggleAnthropicSkill(s.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm text-left transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
                  active
                    ? "border-brand bg-brand text-brand-fg"
                    : "border-border hover:border-border-strong"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                    active
                      ? "bg-brand-fg text-brand border-brand-fg"
                      : "border-border-strong"
                  }`}
                >
                  {active && "✓"}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-fg block mb-2">Custom Skills</label>
        {filtered.length > 0 ? (
          <div className="space-y-2">
            {filtered.map((cs) => {
              const active = form.skills.some(
                (sk) => sk.type === "custom" && sk.skill_id === cs.id,
              );
              return (
                <button
                  key={cs.id}
                  onClick={() => {
                    if (active) {
                      setForm({
                        ...form,
                        skills: form.skills.filter(
                          (sk) => !(sk.type === "custom" && sk.skill_id === cs.id),
                        ),
                      });
                    } else {
                      setForm({
                        ...form,
                        skills: [
                          ...form.skills,
                          { type: "custom", skill_id: cs.id, version: "latest" },
                        ],
                      });
                    }
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-md border text-sm text-left transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
                    active
                      ? "border-brand bg-brand text-brand-fg"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center text-xs shrink-0 ${
                      active
                        ? "bg-brand-fg text-brand border-brand-fg"
                        : "border-border-strong"
                    }`}
                  >
                    {active && "✓"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{cs.name}</div>
                    <div
                      className={`text-xs truncate ${
                        active ? "text-brand-fg/70" : "text-fg-subtle"
                      }`}
                    >
                      {cs.description}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-mono shrink-0 ${
                      active ? "text-brand-fg/60" : "text-fg-subtle"
                    }`}
                  >
                    {cs.id}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">
            No custom skills registered.{" "}
            <a href="/skills" className="underline hover:text-fg-muted">
              Create one
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}

function AgentsTab({
  form,
  setForm,
  allAgents,
  addCallable,
  removeCallable,
}: {
  form: FormState;
  setForm: FormSetter;
  allAgents: Agent[];
  addCallable: (agentId: string) => void;
  removeCallable: (i: number) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Built-in general sub-agent — opt-in. */}
      <div className="rounded-md border border-border bg-bg-surface px-3 py-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.enableGeneralSubagent}
            onChange={(e) => setForm({ ...form, enableGeneralSubagent: e.target.checked })}
            className="accent-brand mt-0.5"
          />
          <div>
            <div className="font-medium text-fg">Enable general sub-agent</div>
            <p className="text-xs text-fg-subtle mt-0.5">
              Exposes a built-in{" "}
              <span className="font-mono">general_subagent(task)</span> tool. Spawns a
              generic sub-agent thread (reserved id{" "}
              <span className="font-mono">general</span>) inheriting this agent's model +
              sandbox, with a safe built-in tool subset
              (bash/read/write/edit/grep/glob). No roster setup needed.
            </p>
          </div>
        </label>
      </div>

      <div>
        <label className="text-sm font-medium text-fg block">Callable Agents</label>
        <p className="text-xs text-fg-subtle mb-2">
          Specific agents this agent can delegate to via{" "}
          <span className="font-mono">call_agent_&lt;id&gt;</span> tools.
        </p>
      </div>

      {form.callableAgents.map((ca, i) => {
        const agentInfo = allAgents.find((a) => a.id === ca.id);
        return (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg"
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-fg">{agentInfo?.name || ca.id}</div>
              <div className="text-xs text-fg-subtle font-mono">{ca.id}</div>
            </div>
            <button
              onClick={() => removeCallable(i)}
              className="inline-flex items-center justify-center min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 px-2 text-fg-subtle hover:text-danger transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
            >
              ×
            </button>
          </div>
        );
      })}

      <div>
        <label className="text-xs text-fg-muted block mb-1">Add agent</label>
        <Combobox<Agent>
          value=""
          onValueChange={(v) => {
            if (v) addCallable(v);
          }}
          endpoint="/v1/agents"
          getValue={(a) => a.id}
          getLabel={(a) => (
            <span>
              {a.name} <span className="text-fg-subtle text-[12px]">({a.id})</span>
            </span>
          )}
          getTextLabel={(a) => `${a.name} (${a.id})`}
          placeholder="Select an agent..."
          excludeIds={form.callableAgents.map((c) => c.id)}
        />
      </div>

      {form.callableAgents.length === 0 && allAgents.length === 0 && (
        <p className="text-xs text-fg-subtle">
          Create other agents first to enable multi-agent delegation.
        </p>
      )}
    </div>
  );
}
