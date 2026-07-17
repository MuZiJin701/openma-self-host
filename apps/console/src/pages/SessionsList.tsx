import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useApi } from "../lib/api";
import { useInfiniteApiQuery } from "../lib/useApiQuery";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "../lib/useApiQuery";
import type { SessionRecord as Session } from "../types/session";
import { buildSessionCreateBody } from "./session-api";

interface Agent { id: string; name: string; }
interface Environment { id: string; name: string; config?: { type?: string }; archived_at?: string | null; }

export function SessionsList() {
  const { api } = useApi();
  const nav = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const { data: environmentResponse } = useApiQuery<{ data: Environment[] }>("/v1/environments");
  const environments = (environmentResponse?.data ?? []).filter((item) => !item.archived_at);
  const { items: sessions, isLoading, hasMore, loadMore, refresh } =
    useInfiniteApiQuery<Session>("/v1/sessions", { limit: 50, params: {} });

  useEffect(() => {
    void api<{ data: Agent[] }>("/v1/agents?limit=200").then((response) => setAgents(response.data ?? []));
  }, [api]);

  useEffect(() => {
    if (!environmentId && environments.length) setEnvironmentId(environments[0]!.id);
  }, [environmentId, environments]);

  const create = async () => {
    if (!agentId || !environmentId) return;
    setError("");
    try {
      const session = await api<Session>("/v1/sessions", {
        method: "POST",
        body: JSON.stringify(buildSessionCreateBody({
          agent: agentId,
          title,
          environmentId,
          isLocalRuntime: true,
        })),
      });
      setShowCreate(false);
      setTitle("");
      await refresh();
      nav(`/sessions/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create session");
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Sessions</h1>
          <p className="text-sm text-fg-subtle mt-1">Conversation history in the user workspace.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>New session</Button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-border bg-bg-surface p-4 space-y-3 max-w-xl">
          <h2 className="font-medium text-fg">Create session</h2>
          <select className="w-full border border-border rounded-md px-3 py-2 bg-bg text-fg" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Select agent</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <select className="w-full border border-border rounded-md px-3 py-2 bg-bg text-fg" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
            <option value="">Select local environment</option>
            {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
          </select>
          <input className="w-full border border-border rounded-md px-3 py-2 bg-bg text-fg" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button disabled={!agentId || !environmentId} onClick={() => void create()}>Create</Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border divide-y divide-border">
        {isLoading && <p className="p-4 text-sm text-fg-subtle">Loading sessions…</p>}
        {!isLoading && sessions.length === 0 && <p className="p-8 text-center text-sm text-fg-subtle">No sessions yet.</p>}
        {sessions.map((session) => (
          <button key={session.id} className="w-full text-left p-4 hover:bg-bg-surface transition-colors" onClick={() => nav(`/sessions/${session.id}`)}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-fg">{session.title || "Untitled session"}</span>
              <span className="text-xs text-fg-subtle">{session.status ?? "idle"}</span>
            </div>
            <div className="text-xs text-fg-subtle mt-1">Agent {session.agent?.id ?? "—"} · Environment {session.environment_id}</div>
          </button>
        ))}
      </div>
      {hasMore && <Button variant="ghost" onClick={() => void loadMore()}>Load more</Button>}
    </div>
  );
}
