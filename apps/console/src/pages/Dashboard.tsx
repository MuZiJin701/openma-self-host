import { useNavigate } from "react-router";
import { useApiQuery } from "../lib/useApiQuery";
import { Button } from "@/components/ui/button";

interface Agent { id: string; name: string; description?: string; }
interface Session { id: string; title?: string | null; status?: string; created_at: string; }

export function Dashboard() {
  const nav = useNavigate();
  const { data: agentsResponse } = useApiQuery<{ data: Agent[] }>("/v1/agents", { limit: "5" });
  const { data: sessionsResponse } = useApiQuery<{ data: Session[] }>("/v1/sessions", { limit: "5" });
  const agents = agentsResponse?.data ?? [];
  const sessions = sessionsResponse?.data ?? [];

  return (
    <div className="p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-fg">Workspace</h1>
        <p className="mt-1 text-sm text-fg-muted">Manage agents, sessions, files, models, skills, and local environments.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => nav("/agents")}>Agents</Button>
        <Button variant="outline" onClick={() => nav("/sessions")}>Sessions</Button>
        <Button variant="outline" onClick={() => nav("/environments")}>Environments</Button>
      </div>
      <section className="grid md:grid-cols-2 gap-5">
        <div className="rounded-lg border border-border">
          <div className="p-4 flex justify-between"><h2 className="font-medium">Agents</h2><span className="text-sm text-fg-subtle">{agents.length}</span></div>
          <div className="divide-y divide-border">
            {agents.length === 0 && <p className="p-4 text-sm text-fg-subtle">No agents yet.</p>}
            {agents.map((agent) => <button key={agent.id} className="w-full text-left p-4 hover:bg-bg-surface" onClick={() => nav(`/agents/${agent.id}`)}><div className="font-medium">{agent.name}</div><div className="text-xs text-fg-subtle mt-1">{agent.description || agent.id}</div></button>)}
          </div>
        </div>
        <div className="rounded-lg border border-border">
          <div className="p-4 flex justify-between"><h2 className="font-medium">Recent sessions</h2><span className="text-sm text-fg-subtle">{sessions.length}</span></div>
          <div className="divide-y divide-border">
            {sessions.length === 0 && <p className="p-4 text-sm text-fg-subtle">No sessions yet.</p>}
            {sessions.map((session) => <button key={session.id} className="w-full text-left p-4 hover:bg-bg-surface" onClick={() => nav(`/sessions/${session.id}`)}><div className="font-medium">{session.title || "Untitled session"}</div><div className="text-xs text-fg-subtle mt-1">{session.status || "idle"} · {new Date(session.created_at).toLocaleString()}</div></button>)}
          </div>
        </div>
      </section>
    </div>
  );
}
