import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useApi } from "../lib/api";
import { useApiQuery } from "../lib/useApiQuery";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Page } from "../components/Page";

interface EnvironmentRecord {
  id: string;
  name: string;
  description?: string;
  config: { type: "local" };
  metadata?: Record<string, unknown>;
}

interface MetadataRow {
  key: string;
  value: string;
}

export function EnvironmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const navigate = useNavigate();
  const [environment, setEnvironment] = useState<EnvironmentRecord | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([]);
  const [saving, setSaving] = useState(false);

  const { data, error } = useApiQuery<EnvironmentRecord>(
    id ? `/v1/environments/${id}` : null,
  );

  useEffect(() => {
    if (!data) return;
    setEnvironment(data);
    setName(data.name);
    setDescription(data.description ?? "");
    setMetadataRows(metadataToRows(data.metadata));
  }, [data]);

  async function save() {
    if (!id || !environment) return;
    setSaving(true);
    try {
      const updated = await api<EnvironmentRecord>(`/v1/environments/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          config: { type: "local" },
          metadata: rowsToMetadata(metadataRows),
        }),
      });
      setEnvironment(updated);
      setName(updated.name);
      setDescription(updated.description ?? "");
      setMetadataRows(metadataToRows(updated.metadata));
      toast.success("Environment saved");
    } catch {
      // useApi displays the request error.
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <div className="flex-1 p-8 text-danger text-sm">Unable to load environment.</div>;
  }
  if (!environment) {
    return <div className="flex-1 p-8 text-fg-muted">Loading...</div>;
  }

  return (
    <Page>
      <div className="max-w-3xl space-y-6">
        <section className="space-y-3">
          <h1 className="sr-only">{environment.name || "Environment"}</h1>
          <div>
            <label className="block text-[13px] font-medium text-fg mb-1.5" htmlFor="env-name">
              Name
            </label>
            <input
              id="env-name"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 50))}
              className="w-full sm:w-72 border border-border rounded-md px-3 py-2 min-h-11 sm:min-h-0 text-sm bg-bg text-fg outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-fg mb-1.5" htmlFor="env-description">
              Description
            </label>
            <textarea
              id="env-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="w-full border border-border rounded-md px-3 py-2 text-[13px] bg-bg text-fg outline-none focus:border-brand resize-y"
            />
          </div>
        </section>

        <section className="border border-border rounded-lg bg-bg-surface/30">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display text-base font-semibold text-fg">Runtime</h2>
            <p className="text-[12px] text-fg-muted mt-0.5">
              Self-host environments always use the trusted local subprocess runtime.
            </p>
          </header>
          <div className="px-4 py-4 text-sm text-fg-muted">config.type = local</div>
        </section>

        <section className="border border-border rounded-lg bg-bg-surface/30">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-fg">Metadata</h2>
              <p className="text-[12px] text-fg-muted mt-0.5">Optional key-value labels.</p>
            </div>
            <button
              type="button"
              className="text-sm text-brand hover:underline"
              onClick={() => setMetadataRows((rows) => [...rows, { key: "", value: "" }])}
            >
              Add
            </button>
          </header>
          <div className="px-4 py-4 space-y-2">
            {metadataRows.length === 0 && (
              <p className="text-[13px] text-fg-subtle italic">No metadata.</p>
            )}
            {metadataRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(event) => updateMetadataRow(index, "key", event.target.value)}
                  placeholder="key"
                  className="flex-1 min-w-0 border border-border rounded-md px-3 py-2 text-[13px] bg-bg text-fg"
                />
                <input
                  value={row.value}
                  onChange={(event) => updateMetadataRow(index, "value", event.target.value)}
                  placeholder="value"
                  className="flex-1 min-w-0 border border-border rounded-md px-3 py-2 text-[13px] bg-bg text-fg"
                />
                <button
                  type="button"
                  className="text-sm text-fg-subtle hover:text-danger"
                  onClick={() => setMetadataRows((rows) => rows.filter((_, i) => i !== index))}
                  aria-label="Remove metadata row"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} loading={saving} disabled={!name.trim()}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={() => navigate("/environments")} disabled={saving}>
            Cancel
          </Button>
          <span className="text-xs text-fg-subtle ml-auto font-mono">{environment.id}</span>
        </div>
      </div>
    </Page>
  );

  function updateMetadataRow(index: number, field: keyof MetadataRow, value: string) {
    setMetadataRows((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
  }
}

function metadataToRows(metadata: Record<string, unknown> | undefined): MetadataRow[] {
  return Object.entries(metadata ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function rowsToMetadata(rows: MetadataRow[]): Record<string, unknown> {
  return Object.fromEntries(
    rows
      .map(({ key, value }) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0),
  );
}
