import { useMemo, useState } from "react";
import { ArchiveIcon } from "lucide-react";
import { useApi } from "../lib/api";
import { useApiQuery } from "../lib/useApiQuery";
import { Modal } from "../components/Modal";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { FacetedFilter } from "../components/FacetedFilter";
import { FilterChip } from "../components/FilterChip";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { archiveSkill, createSkillWithVersion } from "./skills-api";

/* ---------- types ---------- */

interface Skill {
  id: string;
  display_title?: string;
  name: string;
  description: string | null;
  source?: "anthropic" | "custom";
  latest_version: number | string | null;
  archived_at?: string | null;
  created_at: string;
}
interface SkillFile {
  filename: string;
  content: string;
  encoding?: "utf8" | "base64";
}

interface VersionSummary {
  version: number;
  created_at: string;
}

interface VersionDetail {
  version: number;
  created_at: string;
  files: SkillFile[];
}

type SourceValue = "any" | "anthropic" | "custom";

const SOURCE_OPTIONS: { value: SourceValue; label: string }[] = [
  { value: "any", label: "All" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom" },
];

/* ---------- component ---------- */

export function SkillsList() {
  const { api } = useApi();

  /* Server-driven filter state. `source` flows into skillsParams below
   * → useApiQuery reruns when params change → list reflects exactly
   * what the server returned (no client-side split on s.source). */
  const [source, setSource] = useState<SourceValue>("any");
  const skillsParams = useMemo(
    () => (source !== "any" ? { source } : {}),
    [source],
  );

  /* list state — TQ owns the fetch lifecycle. `load()` becomes
   * `refetch`, which kicks off a background refetch that leaves
   * the prior items on screen until the new payload lands. */
  const {
    data: skillsRes,
    isLoading: loading,
    refetch: refetchSkills,
  } = useApiQuery<{ data: Skill[] }>("/v1/skills", skillsParams);
  const skills = skillsRes?.data ?? [];
  const load = () => {
    void refetchSkills();
  };

  /* create dialog */
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createUploading, setCreateUploading] = useState(false);
  const [createError, setCreateError] = useState("");

  /* detail dialog */
  const [detail, setDetail] = useState<Skill | null>(null);
  const [detailFiles, setDetailFiles] = useState<SkillFile[]>([]);
  const [detailVersions, setDetailVersions] = useState<VersionSummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  /* new version sub-form inside detail */
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [nvContent, setNvContent] = useState("");
  const [nvUploading, setNvUploading] = useState(false);
  const [nvError, setNvError] = useState("");

  /* ---- loaders ---- */

  /* ---- create ---- */

  const resetCreate = () => {
    setCreateTitle("");
    setCreateDescription("");
    setCreateContent("");
    setCreateError("");
  };

  const doCreate = async () => {
    if (!createTitle.trim() || !createContent.trim()) {
      setCreateError("Skill name and SKILL.md content are required.");
      return;
    }
    setCreateError("");
    setCreateUploading(true);
    try {
      await createSkillWithVersion(api, {
        name: createTitle.trim(),
        description: createDescription.trim(),
        content: createContent,
      });
      setShowCreate(false);
      resetCreate();
      void load();
    } catch (e: any) {
      setCreateError(e?.message || "Skill creation failed");
    } finally {
      setCreateUploading(false);
    }
  };

  /* ---- detail ---- */

  const openDetail = async (skill: Skill) => {
    setDetail(skill);
    setDetailLoading(true);
    setShowNewVersion(false);
    setNvError("");
    setNvContent("");
    try {
      const [versionDetail, versionsRes] = await Promise.all([
        api<VersionDetail>(
          `/v1/skills/${skill.id}/versions/${skill.latest_version}`
        ),
        api<{ data: VersionSummary[] }>(`/v1/skills/${skill.id}/versions`),
      ]);
      setDetailFiles(versionDetail.files || []);
      setDetailVersions(versionsRes.data || []);
    } catch {
      setDetailFiles([]);
      setDetailVersions([]);
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailFiles([]);
    setDetailVersions([]);
    setShowNewVersion(false);
    setNvContent("");
    setNvError("");
  };

  /* ---- new version ---- */

  const startNewVersion = () => {
    setNvError("");
    setNvContent("");
    setShowNewVersion(true);
  };

  const doNewVersion = async () => {
    if (!detail || !nvContent.trim()) {
      setNvError("SKILL.md content is required.");
      return;
    }
    setNvError("");
    setNvUploading(true);
    try {
      await api(`/v1/skills/${detail.id}/versions`, {
        method: "POST",
        body: JSON.stringify({
          files: [{ filename: "SKILL.md", content: nvContent, content_type: "text/markdown" }],
        }),
      });
      setShowNewVersion(false);
      setNvContent("");
      /* refresh both the list and this detail */
      load();
      const refreshed = await api<Skill>(`/v1/skills/${detail.id}`);
      openDetail(refreshed);
    } catch (e: any) {
      setNvError(e?.message || "Version publish failed");
    } finally {
      setNvUploading(false);
    }
  };

  /* ---- archive ---- */

  const archiveSkillById = async (skill: Skill) => {
    const name = skill.display_title || skill.name;
    if (!confirm(`Archive ${name}?`)) return;
    try {
      await archiveSkill(api, skill.id);
      closeDetail();
      void load();
    } catch {}
  };

  const archiveDetail = async () => {
    if (!detail) return;
    await archiveSkillById(detail);
  };

  /* ---- helpers ---- */

  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 min-h-11 sm:min-h-0 text-sm outline-none focus:border-border-strong transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] bg-bg text-fg";

  // TanStack column defs. Single table for both Anthropic built-in + custom
  // skills; the Source column lets the user tell them apart at a glance.
  // No click sort / no per-column filter — Source filter chip drives the
  // server `source` param instead.
  const columns = useMemo<ColumnDef<Skill>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-fg truncate">
              {row.original.display_title || row.original.name}
            </div>
            <div className="text-xs text-fg-subtle font-mono truncate">
              {row.original.source === "anthropic" ? row.original.name : row.original.id}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "description",
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.description}</span>
        ),
      },
      {
        id: "source",
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) =>
          row.original.source === "anthropic" ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-subtle text-warning">
              built-in
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-surface text-fg-muted">
              custom
            </span>
          ),
      },
      {
        id: "version",
        accessorFn: (s) => s.latest_version,
        header: "Version",
        cell: ({ row }) => (
          <span className="text-fg-muted">v{row.original.latest_version}</span>
        ),
      },
      {
        id: "created",
        accessorFn: (s) => s.created_at,
        header: "Created",
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {new Date(row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const s = row.original;
          // Anthropic built-in skills aren't user-editable; render the
          // item as disabled so the menu layout stays uniform across
          // rows but the user can't trigger a 4xx.
          const isBuiltIn = s.source === "anthropic";
          return (
            <RowActionsMenu
              label={`Actions for ${s.display_title || s.name}`}
              actions={[
                {
                  label: "Archive",
                  icon: <ArchiveIcon className="size-4" />,
                  destructive: true,
                  disabled: isBuiltIn,
                  onSelect: () => {
                    void archiveSkillById(s);
                  },
                },
              ]}
            />
          );
        },
        enableHiding: false,
        size: 56,
      },
    ],
    [],
  );

  // Active-filter chip displays — kept undefined when matching the default
  // so the chip reads "Source ▾" rather than "Source: All ▾". The clear-X
  // only renders when the chip is in non-default state.
  const sourceDisplay =
    source === "any" ? undefined : SOURCE_OPTIONS.find((o) => o.value === source)?.label;

  const filters = (
    <FilterChip
      label="Source"
      active={source !== "any"}
      display={sourceDisplay}
      onClear={() => setSource("any")}
    >
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="w-48 p-0"
      >
        <FacetedFilter
          options={SOURCE_OPTIONS}
          value={source}
          onValueChange={(v) => setSource(v as SourceValue)}
          searchPlaceholder="Source..."
        />
      </PopoverContent>
    </FilterChip>
  );

  // Built-in (anthropic) skills aren't user-editable; click on those rows
  // is a no-op so we don't open a half-empty detail dialog that would 404
  // on its version fetches.
  const handleRowClick = (s: Skill) => {
    if (s.source !== "anthropic") openDetail(s);
  };

  /* ---- render ---- */

  return (
    <DataTable<Skill>
      subtitle="Manage pre-built and custom skills for your agents."
      createLabel="+ New skill"
      onCreate={() => setShowCreate(true)}
      filters={filters}
      data={skills}
      loading={loading}
      getRowId={(s) => s.id}
      onRowClick={handleRowClick}
      columns={columns}
      emptyTitle="No skills yet"
      emptyKind="skill"
      emptySubtitle="Create a skill to give your agents domain expertise."
      emptyAction={<Button onClick={() => setShowCreate(true)}>+ New skill</Button>}
    >
      {/* ===== Create Dialog ===== */}
      <Modal
        open={showCreate}
        onClose={() => {
          if (createUploading) return;
          setShowCreate(false);
          resetCreate();
        }}
        title="Create Custom Skill"
        subtitle="Create a skill and publish its initial SKILL.md version."
        maxWidth="max-w-xl"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={createUploading}
              onClick={() => {
                setShowCreate(false);
                resetCreate();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={doCreate}
              disabled={createUploading}
              loading={createUploading}
              loadingLabel="Uploading..."
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError && (
            <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
              {createError}
            </div>
          )}

          <div>
            <label className="text-sm text-fg-muted block mb-1">Skill name</label>
            <input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              className={inputCls}
              placeholder="release-notes"
              disabled={createUploading}
            />
          </div>
          <div>
            <label className="text-sm text-fg-muted block mb-1">Description</label>
            <input
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              className={inputCls}
              placeholder="Release note guidance"
              disabled={createUploading}
            />
          </div>
          <div>
            <label className="text-sm text-fg-muted block mb-1">SKILL.md</label>
            <textarea
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              className={`${inputCls} min-h-40 resize-y font-mono text-xs`}
              placeholder="# Release notes\n\nDescribe how the Agent should use this skill."
              disabled={createUploading}
            />
          </div>
        </div>
      </Modal>

      {/* ===== Detail Dialog ===== */}
      <Modal
        open={!!detail}
        onClose={closeDetail}
        title={detail?.display_title || detail?.name || ""}
        subtitle={detail ? `${detail.id} · v${detail.latest_version}` : ""}
        maxWidth="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={closeDetail}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <div className="text-fg-subtle text-sm py-8 text-center">
            Loading...
          </div>
        ) : detail ? (
          <div className="space-y-5">
            {/* Actions */}
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" onClick={archiveDetail}>
                Archive
              </Button>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-fg-muted block mb-0.5">
                  Display Title
                </label>
                <p className="text-sm font-medium">
                  {detail.display_title || detail.name}
                </p>
              </div>
              <div>
                <label className="text-xs text-fg-muted block mb-0.5">
                  Name
                </label>
                <p className="text-sm font-mono">
                  {detail.name}
                </p>
              </div>
              <div>
                <label className="text-xs text-fg-muted block mb-0.5">
                  Description
                </label>
                <p className="text-sm text-fg-muted">
                  {detail.description}
                </p>
              </div>
              <div>
                <label className="text-xs text-fg-muted block mb-0.5">
                  Created
                </label>
                <p className="text-sm text-fg-muted">
                  {new Date(detail.created_at).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Usage hint */}
            <div>
              <label className="text-xs text-fg-muted block mb-1">
                Usage in Agent Config
              </label>
              <pre className="bg-bg-surface border border-border rounded-lg p-3 text-xs font-mono text-fg-muted">
{`"skills": [{ "type": "custom", "skill_id": "${detail.id}", "version": "latest" }]`}
              </pre>
            </div>

            {/* Files */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-fg-muted">
                  Files (v{detail.latest_version})
                </label>
                <button
                  onClick={startNewVersion}
                  className="inline-flex items-center min-h-11 sm:min-h-0 px-2 text-xs text-fg-muted hover:text-fg transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
                >
                  + New version
                </button>
              </div>
              {detailFiles.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                  No files in this version.
                </p>
              ) : (
                <div className="space-y-2">
                  {detailFiles.map((f, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-lg overflow-hidden"
                    >
                      <div className="bg-bg-surface px-3 py-1.5 border-b border-border text-xs font-mono text-fg-muted flex items-center justify-between">
                        <span className="truncate">{f.filename}</span>
                        {f.encoding === "base64" && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-fg-subtle">
                            binary
                          </span>
                        )}
                      </div>
                      {f.encoding === "base64" ? (
                        <p className="px-3 py-2 text-xs italic text-fg-subtle">
                          Binary file — not previewed.
                        </p>
                      ) : (
                        <pre className="px-3 py-2 text-xs font-mono text-fg-muted whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                          {f.content}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New Version sub-form */}
            {showNewVersion && (
              <div className="border border-border-strong rounded-lg p-4 bg-bg-surface/50 space-y-3">
                <h3 className="text-sm font-medium text-fg">
                  Publish New Version
                </h3>
                {nvError && (
                  <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
                    {nvError}
                  </div>
                )}
                <textarea
                  value={nvContent}
                  onChange={(e) => setNvContent(e.target.value)}
                  className={`${inputCls} min-h-40 resize-y font-mono text-xs`}
                  placeholder="# Updated skill instructions"
                  disabled={nvUploading}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={nvUploading}
                    onClick={() => {
                      setShowNewVersion(false);
                      setNvContent("");
                      setNvError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={doNewVersion}
                    disabled={nvUploading}
                    loading={nvUploading}
                    loadingLabel="Publishing..."
                  >
                    Publish Version
                  </Button>
                </div>
              </div>
            )}

            {/* Versions list */}
            <div>
              <label className="text-xs text-fg-muted block mb-2">
                Version History
              </label>
              {detailVersions.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                  No version history available.
                </p>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-surface/60 text-fg-muted text-xs uppercase tracking-wider">
                        <th className="text-left px-4 py-2">Version</th>
                        <th className="text-left px-4 py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailVersions.map((v) => (
                        <tr
                          key={v.version}
                          className="border-t border-border"
                        >
                          <td className="px-4 py-2 font-mono text-xs">
                            v{v.version}
                            {v.version === detail.latest_version && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-success-subtle text-success">
                                latest
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-fg-muted text-xs">
                            {new Date(v.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </DataTable>
  );
}
