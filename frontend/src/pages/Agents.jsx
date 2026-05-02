import { useEffect, useState } from "react";
import { api, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { Input } from "../components/ui/input";
import { Search } from "lucide-react";

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/agents").then((r) => setAgents(r.data.agents));
  }, []);

  const filtered = agents.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.extension.includes(search)
  );

  return (
    <Layout title="Agentes" subtitle="Equipe e métricas individuais">
      <div className="mb-4 relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar agente…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="agents-search" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((a) => (
          <div key={a.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`agent-card-${a.id}`}>
            <div className="flex items-center gap-3">
              <img src={a.avatar} alt={a.name} className="w-12 h-12 rounded-full object-cover" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground font-mono">ext. {a.extension} · @{a.username}</div>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Chamadas</div>
                <div className="font-mono text-lg font-medium mt-1">{a.calls_handled}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">TMA</div>
                <div className="font-mono text-lg font-medium mt-1">{fmtDuration(a.avg_handle_sec)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">CSAT</div>
                <div className="font-mono text-lg font-medium mt-1">{a.csat}</div>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-10">Nenhum agente encontrado.</div>
        )}
      </div>
    </Layout>
  );
}
