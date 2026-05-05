import { useEffect, useState } from "react";
import { Headphones, Pause, LogOut as LogOutIcon, Loader2, Phone, Award, Clock, TrendingUp } from "lucide-react";
import { api, fmtDuration, formatApiError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import Layout from "../components/Layout";

const STATUS_OPTIONS = [
  { key: "online",  label: "Disponível",  color: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: Headphones },
  { key: "paused",  label: "Em Pausa",    color: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50 border-amber-200",   icon: Pause },
  { key: "offline", label: "Deslogado",   color: "bg-zinc-400",    text: "text-zinc-700",    bg: "bg-zinc-50 border-zinc-200",     icon: LogOutIcon },
];

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const [agent, setAgent] = useState(null);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  async function load() {
    try {
      const r = await api.get("/agents/me/info");
      setAgent(r.data.agent);
      const rec = await api.get(`/agents/${r.data.agent.id}`).catch(() => ({ data: { recent_calls: [] } }));
      setCalls(rec.data.recent_calls || []);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Falha ao carregar perfil");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); /* eslint-disable-next-line */ }, []);

  async function changeStatus(newStatus) {
    if (!agent) return;
    setUpdating(true);
    try {
      const { data } = await api.put(`/agents/${agent.id}/status`, { status: newStatus });
      const opt = STATUS_OPTIONS.find(o => o.key === newStatus);
      toast.success(`Status alterado para "${opt.label}"${data.pbx_synced ? " · sincronizado no PBX ✓" : ""}`);
      if (data.pbx_error) toast.warning("PBX: " + data.pbx_error);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro");
    } finally { setUpdating(false); }
  }

  if (loading) return <Layout title="Carregando…"><div className="p-8 text-center text-muted-foreground"><Loader2 className="animate-spin mx-auto" /></div></Layout>;
  if (!agent) return <Layout title="Sem vínculo">
    <div className="border border-amber-200 bg-amber-50 rounded-sm p-6 text-center">
      <p className="text-sm">Seu usuário não está vinculado a um agente do callcenter.</p>
      <p className="text-xs text-muted-foreground mt-2">Peça ao administrador para fazer o vínculo em <strong>Usuários → seu cadastro → "Vincular a um agente"</strong>.</p>
      <Button variant="outline" onClick={logout} className="mt-4">Sair</Button>
    </div>
  </Layout>;

  const currentStatus = STATUS_OPTIONS.find(o => o.key === agent.status) || STATUS_OPTIONS[2];

  return (
    <Layout title={`Olá, ${agent.name?.split(" ")[0] || "Agente"}`} subtitle={`Ramal ${agent.extension} · ${agent.username || "—"}`}>
      <div className={`border-2 rounded-sm p-6 mb-5 ${currentStatus.bg}`} data-testid="agent-status-card">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${currentStatus.color} animate-pulse`} />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Estado atual</div>
            <div className={`font-display text-3xl font-bold ${currentStatus.text}`}>{currentStatus.label}</div>
            {agent.status_changed_at && (
              <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                desde {new Date(agent.status_changed_at).toLocaleString("pt-BR")}
              </div>
            )}
          </div>
          <img src={agent.avatar} alt={agent.name} className="w-16 h-16 rounded-full border-2 border-white shadow-sm" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {STATUS_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = agent.status === opt.key;
          return (
            <button key={opt.key}
                    onClick={() => !isActive && changeStatus(opt.key)}
                    disabled={updating || isActive}
                    data-testid={`agent-status-btn-${opt.key}`}
                    className={`border-2 rounded-sm p-5 text-left transition-all ${
                      isActive
                        ? `${opt.bg} cursor-default`
                        : "border-border bg-card hover:border-foreground hover:shadow-sm"
                    } disabled:opacity-90`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${opt.color} text-white`}>
                  <Icon size={18} />
                </div>
                <div>
                  <div className={`font-display text-lg font-bold ${isActive ? opt.text : ""}`}>{opt.label}</div>
                  {isActive && <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-medium">● Ativo</div>}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {opt.key === "online" && "Pronto para receber chamadas"}
                {opt.key === "paused" && "Pausado · não recebe chamadas"}
                {opt.key === "offline" && "Deslogado da fila"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={Phone} label="Chamadas (24h)" value={agent.calls_handled || 0} />
        <KpiCard icon={Clock} label="TMA" value={fmtDuration(agent.avg_handle_sec || 0)} />
        <KpiCard icon={Award} label="CSAT" value={`★ ${agent.csat || 0}`} />
        <KpiCard icon={TrendingUp} label="Aderência" value={`${agent.adherence_pct || 0}%`} />
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Histórico</div>
          <h3 className="font-display text-lg font-semibold">Últimas chamadas</h3>
        </div>
        <div className="overflow-x-auto">
          {calls.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem chamadas ainda.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Número</th>
                  <th className="px-4 py-2">Direção</th>
                  <th className="px-4 py-2">Duração</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono text-xs">{new Date(c.started_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 font-mono">{c.caller_number}</td>
                    <td className="px-4 py-2">{c.direction === "inbound" ? "📥 Entrada" : "📤 Saída"}</td>
                    <td className="px-4 py-2 font-mono">{fmtDuration(c.duration_sec || 0)}</td>
                    <td className="px-4 py-2"><span className={c.disposition === "answered" ? "text-emerald-700" : "text-red-600"}>{c.disposition}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({ icon: Icon, label, value }) {
  return (
    <div className="border border-border bg-card rounded-sm p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon size={12} />
        <span className="text-[10px] uppercase tracking-widest font-medium">{label}</span>
      </div>
      <div className="font-mono text-2xl font-bold">{value}</div>
    </div>
  );
}
