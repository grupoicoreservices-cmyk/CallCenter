import { useEffect, useState } from "react";
import { api, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Users, PhoneIncoming, PhoneMissed, Clock, Activity, TrendingUp, UserX, PhoneOff } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

function KpiCard({ label, value, sub, icon: Icon, accent = "text-foreground" }) {
  return (
    <div className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`kpi-${label}`}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
        <Icon size={15} className="text-muted-foreground" />
      </div>
      <div className={`font-mono text-4xl font-medium mt-3 tracking-tight ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function AbandonedSummary({ totals, periodLabel }) {
  const total = totals.agent_loss + totals.queue_abandon;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      <div className="border border-border rounded-sm p-4 bg-zinc-50/50">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
          <UserX size={12} className="text-red-500" /> Abandono do Agente
        </div>
        <div className="font-mono text-3xl font-medium mt-2 text-red-600" data-testid="abandoned-agent-loss">{totals.agent_loss}</div>
        <div className="text-[10px] text-muted-foreground mt-1">agente não atendeu · {periodLabel}</div>
      </div>
      <div className="border border-border rounded-sm p-4 bg-zinc-50/50">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
          <PhoneOff size={12} className="text-amber-500" /> Cliente na Fila
        </div>
        <div className="font-mono text-3xl font-medium mt-2 text-amber-600" data-testid="abandoned-queue">{totals.queue_abandon}</div>
        <div className="text-[10px] text-muted-foreground mt-1">cliente desistiu · {periodLabel}</div>
      </div>
      <div className="border border-border rounded-sm p-4 bg-zinc-50/50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Total Abandonos</div>
        <div className="font-mono text-3xl font-medium mt-2" data-testid="abandoned-total">{total}</div>
        <div className="text-[10px] text-muted-foreground mt-1">{periodLabel}</div>
      </div>
    </div>
  );
}

function AbandonedChart({ data, xKey }) {
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
          <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={11} />
          <YAxis stroke="#a1a1aa" fontSize={11} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4 }} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="agent_loss" name="Abandono do Agente" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
          <Bar dataKey="queue_abandon" name="Cliente na Fila" stackId="a" fill="#f59e0b" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [agents, setAgents] = useState([]);
  const [abandoned, setAbandoned] = useState(null);

  async function load() {
    const [s, a, ab] = await Promise.all([
      api.get("/dashboard/stats"),
      api.get("/agents"),
      api.get("/dashboard/abandoned"),
    ]);
    setStats(s.data);
    setAgents(a.data.agents);
    setAbandoned(ab.data);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const onlineAgents = agents.filter((a) => a.status !== "offline").slice(0, 8);

  return (
    <Layout title="Dashboard" subtitle="Visão geral das operações em tempo real">
      {!stats ? (
        <div className="text-sm text-muted-foreground font-mono">carregando…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Agentes Online" value={stats.online_agents} sub={`de ${stats.total_agents} no total`} icon={Users} />
            <KpiCard label="Em Chamada" value={stats.incall_agents} sub="agentes agora" icon={Activity} accent="text-blue-600" />
            <KpiCard label="Atendidas Hoje" value={stats.answered_today} sub={<span className="text-emerald-600">+ performance</span>} icon={PhoneIncoming} />
            <KpiCard label="Perdidas Hoje" value={stats.missed_today} sub="chamadas não atendidas" icon={PhoneMissed} accent="text-red-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
            <div className="lg:col-span-2 border border-border bg-card rounded-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Chamadas nas últimas 24h</div>
                  <h3 className="font-display text-lg font-semibold">Volume por hora</h3>
                </div>
                <TrendingUp size={16} className="text-muted-foreground" />
              </div>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={stats.hourly} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="hour" stroke="#a1a1aa" fontSize={11} />
                    <YAxis stroke="#a1a1aa" fontSize={11} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="answered" name="Atendidas" fill="#09090b" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="missed" name="Perdidas" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-border bg-card rounded-sm p-5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Tempo de espera</div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="font-mono text-4xl font-medium">{fmtDuration(stats.avg_wait_sec)}</span>
                <span className="text-xs text-muted-foreground">média</span>
              </div>
              <div className="mt-6 pt-4 border-t border-border">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Na fila agora</div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="font-mono text-4xl font-medium text-amber-600">{stats.waiting_in_queue}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={12} /> aguardando</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-border bg-card rounded-sm mt-4">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Análise de abandonos</div>
                <h3 className="font-display text-lg font-semibold">Chamadas Abandonadas</h3>
              </div>
              {abandoned && (
                <div className="flex gap-5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                    <span className="text-muted-foreground">Abandono do Agente</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                    <span className="text-muted-foreground">Cliente na Fila</span>
                  </div>
                </div>
              )}
            </div>

            {!abandoned ? (
              <div className="p-8 text-center text-sm text-muted-foreground font-mono">carregando…</div>
            ) : (
              <div className="p-5">
                <Tabs defaultValue="hour" className="w-full" data-testid="abandoned-tabs">
                  <TabsList>
                    <TabsTrigger value="hour" data-testid="tab-abandoned-hour">Por Hora (24h)</TabsTrigger>
                    <TabsTrigger value="day" data-testid="tab-abandoned-day">Por Dia (7d)</TabsTrigger>
                    <TabsTrigger value="week" data-testid="tab-abandoned-week">Por Semana (4 sem)</TabsTrigger>
                  </TabsList>

                  <TabsContent value="hour" className="mt-4">
                    <AbandonedSummary totals={abandoned.totals.last_24h} periodLabel="últimas 24h" />
                    <AbandonedChart data={abandoned.by_hour} xKey="label" />
                  </TabsContent>
                  <TabsContent value="day" className="mt-4">
                    <AbandonedSummary totals={abandoned.totals.last_7d} periodLabel="últimos 7 dias" />
                    <AbandonedChart data={abandoned.by_day} xKey="label" />
                  </TabsContent>
                  <TabsContent value="week" className="mt-4">
                    <AbandonedSummary totals={abandoned.totals.last_4w} periodLabel="últimas 4 semanas" />
                    <AbandonedChart data={abandoned.by_week} xKey="label" />
                  </TabsContent>
                </Tabs>

                {abandoned.by_queue.length > 0 && (
                  <div className="mt-6 pt-5 border-t border-border">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-3">Por Fila (últimos 7 dias)</div>
                    <div className="space-y-2">
                      {abandoned.by_queue.map((q) => {
                        const total = q.agent_loss + q.queue_abandon;
                        const agentPct = total > 0 ? (q.agent_loss / total) * 100 : 0;
                        return (
                          <div key={q.queue} className="flex items-center gap-3" data-testid={`queue-abandoned-${q.queue}`}>
                            <div className="w-32 text-sm font-medium truncate">{q.queue}</div>
                            <div className="flex-1 flex h-5 rounded-sm overflow-hidden bg-zinc-100 border border-border">
                              {q.agent_loss > 0 && (
                                <div className="bg-red-500 flex items-center justify-center text-[10px] font-mono text-white px-1"
                                  style={{ width: `${agentPct}%` }} title={`Abandono do agente: ${q.agent_loss}`}>
                                  {q.agent_loss}
                                </div>
                              )}
                              {q.queue_abandon > 0 && (
                                <div className="bg-amber-500 flex items-center justify-center text-[10px] font-mono text-white px-1"
                                  style={{ width: `${100 - agentPct}%` }} title={`Cliente na fila: ${q.queue_abandon}`}>
                                  {q.queue_abandon}
                                </div>
                              )}
                            </div>
                            <div className="font-mono text-sm w-10 text-right">{total}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border border-border bg-card rounded-sm mt-4">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Equipe</div>
                <h3 className="font-display text-lg font-semibold">Agentes ativos</h3>
              </div>
            </div>
            <div className="divide-y divide-border">
              {onlineAgents.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center gap-4 table-row-hover" data-testid={`agent-row-${a.id}`}>
                  <img src={a.avatar} alt={a.name} className="w-9 h-9 rounded-full object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">ext. {a.extension}</div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Chamadas</div>
                    <div className="font-mono text-sm">{a.calls_handled}</div>
                  </div>
                  <div className="text-right hidden md:block">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">CSAT</div>
                    <div className="font-mono text-sm">{a.csat}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
              {onlineAgents.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhum agente disponível</div>
              )}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
