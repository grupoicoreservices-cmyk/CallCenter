import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headphones, Pause, LogOut as LogOutIcon, Loader2, Phone, Award, Clock, TrendingUp, Users, PhoneIncoming, ListChecks } from "lucide-react";
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

const DOT = {
  online: "bg-emerald-500",
  paused: "bg-amber-500",
  offline: "bg-zinc-300",
};

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [calls, setCalls] = useState([]);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  async function load() {
    try {
      const r = await api.get("/agents/me/info");
      setAgent(r.data.agent);
      const [rec, qs] = await Promise.all([
        api.get(`/agents/${r.data.agent.id}`).catch(() => ({ data: { recent_calls: [] } })),
        api.get("/agents/me/queue-status").catch(() => ({ data: { queues: [] } })),
      ]);
      setCalls(rec.data.recent_calls || []);
      setQueues(qs.data.queues || []);
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

      {/* Queues panel */}
      {queues.length > 0 && (
        <div className="mb-6 space-y-3" data-testid="agent-queues">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Filas ativas nesta sessão</div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/agent/select-queues")}
              data-testid="agent-change-queues">
              <ListChecks size={13} className="mr-1.5" /> Trocar filas
            </Button>
          </div>
          {queues.map((q) => (
            <div key={q.id} className="border border-border bg-card rounded-sm overflow-hidden" data-testid={`agent-queue-${q.id}`}>
              <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Fila</div>
                  <div className="font-display font-semibold text-base flex items-center gap-2">
                    <Users size={14} className="text-muted-foreground" />
                    <span>{q.name}</span>
                    {q.extension && <span className="font-mono text-xs text-muted-foreground">·  {q.extension}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5" title="Chamadas aguardando atendimento">
                    <PhoneIncoming size={14} className={q.waiting > 0 ? "text-amber-600" : "text-muted-foreground"} />
                    <span className="font-mono text-base font-bold">{q.waiting}</span>
                    <span className="text-muted-foreground">na fila</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Agentes logados (online + pausa)">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="font-mono text-base font-bold">{q.logged_in}</span>
                    <span className="text-muted-foreground">logados</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    <span className="text-emerald-700 font-medium">{q.online}</span> disp · <span className="text-amber-700 font-medium">{q.paused}</span> pausa · <span className="text-zinc-500 font-medium">{q.offline}</span> off
                  </div>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {q.agents.map((p) => (
                  <li key={p.id} className={`px-5 py-2.5 flex items-center gap-3 ${p.is_me ? "bg-zinc-50" : ""}`} data-testid={`agent-peer-${p.id}`}>
                    {p.avatar
                      ? <img src={p.avatar} alt="" className="w-7 h-7 rounded-full" />
                      : <div className="w-7 h-7 rounded-full bg-zinc-200 flex items-center justify-center text-[11px] font-medium">{p.name?.[0] || "?"}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}{p.is_me && <span className="text-[10px] text-muted-foreground ml-2">(você)</span>}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">Ramal {p.extension || "—"}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${DOT[p.status] || DOT.offline}`} />
                      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                        {p.status === "online" ? "Disp." : p.status === "paused" ? "Pausa" : "Off"}
                      </span>
                    </div>
                  </li>
                ))}
                {q.agents.length === 0 && (
                  <li className="px-5 py-3 text-xs text-muted-foreground">Nenhum agente nesta fila.</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

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
