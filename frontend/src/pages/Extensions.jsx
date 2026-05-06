import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Phone, RefreshCw, Search, UserCircle2, Wifi, WifiOff, Settings2 } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";

const TYPE_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "agent", label: "Agentes" },
  { key: "extension", label: "Ramais" },
];

function TypeBadge({ isAgent }) {
  if (isAgent) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <UserCircle2 size={11} /> Agente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
      <Phone size={11} /> Ramal
    </span>
  );
}

function AgentStatusPill({ status }) {
  if (!status) return <span className="text-[11px] text-muted-foreground">—</span>;
  const map = {
    online: { label: "Online", cls: "bg-emerald-500/10 text-emerald-700" },
    paused: { label: "Pausa", cls: "bg-amber-500/10 text-amber-700" },
    incall: { label: "Em ligação", cls: "bg-blue-500/10 text-blue-700" },
    offline: { label: "Offline", cls: "bg-zinc-500/10 text-zinc-600" },
  };
  const c = map[status] || { label: status, cls: "bg-zinc-100 text-zinc-600" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

export default function Extensions() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const { data } = await api.get("/extensions");
      setRows(data.extensions || []);
      if (data.warning) toast.warning(data.warning);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); setReloading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = rows.filter((r) => {
    if (typeFilter === "agent" && !r.is_agent) return false;
    if (typeFilter === "extension" && r.is_agent) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.extension || "").toLowerCase().includes(s)
      || (r.caller_id_name || "").toLowerCase().includes(s)
      || (r.agent_name || "").toLowerCase().includes(s);
  });

  const totalRegistered = rows.filter((r) => r.registered).length;
  const totalAgents = rows.filter((r) => r.is_agent).length;

  return (
    <Layout title="Ramais / Agentes" subtitle="Todos os ramais SIP do FusionPBX, com destaque para os que são agentes do call center">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3" data-testid="extensions-toolbar">
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar ramal, nome ou agente..." className="pl-9"
              data-testid="extensions-search" />
          </div>
          <div className="inline-flex rounded-sm border border-border overflow-hidden" data-testid="extensions-type-filter">
            {TYPE_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)}
                data-testid={`extensions-filter-${f.key}`}
                className={`px-3 py-1.5 text-xs uppercase tracking-widest font-medium transition-colors ${
                  typeFilter === f.key
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:bg-zinc-50"
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            <span className="font-mono font-bold text-emerald-700">{totalAgents}</span> agentes ·
            <span className="font-mono font-bold text-emerald-700 ml-1">{totalRegistered}</span> de <span className="font-mono">{rows.length}</span> registrados
          </span>
          <Button variant="outline" size="sm"
            onClick={() => { setReloading(true); load(); }}
            disabled={reloading} data-testid="extensions-refresh">
            <RefreshCw size={12} className={`mr-1.5 ${reloading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">Ramal</th>
              <th className="px-4 py-3">Nome (Caller-ID)</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Status Agente</th>
              <th className="px-4 py-3">Filas</th>
              <th className="px-4 py-3">Registro SIP</th>
              <th className="px-4 py-3">Habilitado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                {rows.length === 0 ? "Nenhum ramal cadastrado no FusionPBX." : "Nenhum item encontrado para este filtro."}
              </td></tr>
            ) : filtered.map((r) => (
              <tr key={r.uuid || r.extension} className="hover:bg-zinc-50" data-testid={`extension-row-${r.extension}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-muted-foreground" />
                    <span className="font-mono font-bold">{r.extension}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.agent_name || r.caller_id_name || "—"}
                </td>
                <td className="px-4 py-3">
                  <TypeBadge isAgent={r.is_agent} />
                </td>
                <td className="px-4 py-3">
                  <AgentStatusPill status={r.agent_status} />
                </td>
                <td className="px-4 py-3 text-xs font-mono">
                  {r.is_agent ? (r.queues_count || 0) : "—"}
                </td>
                <td className="px-4 py-3">
                  {r.registered ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700" data-testid={`ext-reg-${r.extension}`}>
                      <Wifi size={12} /> Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500" data-testid={`ext-reg-${r.extension}`}>
                      <WifiOff size={12} /> Offline
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.enabled
                    ? <span className="text-emerald-700">Sim</span>
                    : <span className="text-zinc-500">Não</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.is_agent && r.agent_id ? (
                    <Button variant="outline" size="sm"
                      data-testid={`manage-agent-${r.extension}`}
                      onClick={() => navigate(`/agents?focus=${r.agent_id}`)}>
                      <Settings2 size={12} className="mr-1.5" />
                      Gerenciar agente
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
