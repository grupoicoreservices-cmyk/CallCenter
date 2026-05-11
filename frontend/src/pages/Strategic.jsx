import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  TrendingUp, Phone, PhoneIncoming, PhoneOutgoing, Users, Award,
  Flame, Timer, Target, RefreshCw, ChevronUp, ChevronDown,
} from "lucide-react";
import { api, formatApiError, fmtDuration } from "../lib/api";
import { toast } from "sonner";

const PERIODS = [
  { v: "today", l: "Hoje" },
  { v: "7d", l: "Últimos 7 dias" },
  { v: "30d", l: "Últimos 30 dias" },
  { v: "90d", l: "Últimos 90 dias" },
];

const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function KpiCard({ label, value, sub, icon: Icon, accent = "text-foreground", testid }) {
  return (
    <div className="border border-border bg-card rounded-sm p-4 hover:shadow-sm transition-shadow"
      data-testid={testid}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
          {label}
        </div>
        <Icon size={14} className="text-muted-foreground" />
      </div>
      <div className={`font-mono text-3xl font-medium mt-2 tracking-tight ${accent}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function Strategic() {
  const [period, setPeriod] = useState("7d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/strategic/overview?period=${period}`);
      setData(res.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [period]);

  const s = data?.summary || {};
  const conv = data?.conversion || {};

  return (
    <Layout title="Página Estratégica"
      subtitle="Visão executiva consolidada · top números, ranking, KPIs e SLA">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44" data-testid="strategic-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map(p => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}
            data-testid="strategic-refresh">
            <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : (
        <>
          {/* Top KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <KpiCard label="Chamadas" value={s.total_calls || 0}
              sub={`${s.inbound || 0} in · ${s.outbound || 0} out`}
              icon={Phone} testid="kpi-total" />
            <KpiCard label="Atendidas" value={s.answered || 0}
              sub={`${s.answer_rate || 0}% de atend.`}
              icon={PhoneIncoming} accent="text-emerald-700" testid="kpi-answered" />
            <KpiCard label="Perdidas" value={s.missed || 0}
              icon={PhoneOutgoing} accent="text-red-700" testid="kpi-missed" />
            <KpiCard label="TMA" value={fmtDuration(s.avg_handle_sec || 0)}
              sub="Tempo médio atend."
              icon={Timer} testid="kpi-aht" />
            <KpiCard label="TME" value={fmtDuration(s.avg_wait_sec || 0)}
              sub="Tempo médio espera"
              icon={Timer} testid="kpi-asa" />
            <KpiCard label="Conversão" value={`${conv.conversion_rate || 0}%`}
              sub={`${conv.conversions || 0}/${conv.evaluated_calls || 0} avaliadas`}
              icon={Target} accent="text-blue-700" testid="kpi-conversion" />
          </div>

          <Tabs defaultValue="numbers" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="numbers" data-testid="tab-numbers">
                <Phone size={13} className="mr-1.5" />Top Números
              </TabsTrigger>
              <TabsTrigger value="agents" data-testid="tab-agents">
                <Award size={13} className="mr-1.5" />Ranking Agentes
              </TabsTrigger>
              <TabsTrigger value="heatmap" data-testid="tab-heatmap">
                <Flame size={13} className="mr-1.5" />Mapa de Calor
              </TabsTrigger>
              <TabsTrigger value="queues" data-testid="tab-queues">
                <Users size={13} className="mr-1.5" />SLA por Fila
              </TabsTrigger>
              <TabsTrigger value="conversion" data-testid="tab-conversion">
                <Target size={13} className="mr-1.5" />Conversão
              </TabsTrigger>
            </TabsList>

            <TabsContent value="numbers">
              <TopNumbersPanel data={data} />
            </TabsContent>
            <TabsContent value="agents">
              <AgentRankingPanel rows={data?.agent_ranking || []} />
            </TabsContent>
            <TabsContent value="heatmap">
              <HeatmapPanel grid={data?.heatmap || []} />
            </TabsContent>
            <TabsContent value="queues">
              <QueueSlaPanel rows={data?.queue_sla || []} />
            </TabsContent>
            <TabsContent value="conversion">
              <ConversionPanel data={conv} agents={data?.agent_ranking || []} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </Layout>
  );
}

/* ─── Top Numbers ──────────────────────────────────────────── */
function TopNumbersPanel({ data }) {
  const inbound = data?.top_inbound || [];
  const outbound = data?.top_outbound || [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <NumberList title="Top 10 — Entrantes" subtitle="Quem mais te liga"
        rows={inbound} icon={PhoneIncoming} accent="emerald" testid="top-inbound" />
      <NumberList title="Top 10 — Saída" subtitle="Para quem você mais liga"
        rows={outbound} icon={PhoneOutgoing} accent="blue" testid="top-outbound" />
    </div>
  );
}

function NumberList({ title, subtitle, rows, icon: Icon, accent, testid }) {
  const max = Math.max(...rows.map(r => r.calls), 1);
  const accentBg = accent === "emerald" ? "bg-emerald-500" : "bg-blue-500";
  return (
    <div className="border border-border bg-card rounded-sm" data-testid={testid}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="font-display font-semibold text-sm flex items-center gap-2">
            <Icon size={14} /> {title}
          </div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <span className="text-[10px] uppercase text-muted-foreground tracking-widest">
          {rows.length} resultados
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          Sem dados no período selecionado
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => {
            const w = (r.calls / max) * 100;
            return (
              <li key={r.number + i} className="px-4 py-2.5 hover:bg-zinc-50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground w-5">
                      {i + 1}.
                    </span>
                    <span className="font-mono text-sm font-semibold">{r.number}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="font-mono font-medium">{r.calls}</span>
                    <span className="text-emerald-700">{r.answered}✓</span>
                    {r.missed > 0 && <span className="text-red-600">{r.missed}✗</span>}
                    <span className="text-muted-foreground font-mono">
                      {fmtDuration(r.total_duration_sec || 0)}
                    </span>
                  </div>
                </div>
                <div className="h-1 bg-zinc-100 rounded-sm overflow-hidden">
                  <div className={`h-full ${accentBg} transition-all`}
                    style={{ width: `${w}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─── Agent Ranking ───────────────────────────────────────── */
function AgentRankingPanel({ rows }) {
  const [sortKey, setSortKey] = useState("answered");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function toggle(k) {
    if (k === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(k); setSortDir("desc"); }
  }

  const Th = ({ k, children, align = "left" }) => (
    <th className={`px-3 py-2 cursor-pointer hover:bg-zinc-100 select-none text-${align}`}
      onClick={() => toggle(k)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k && (sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
      </span>
    </th>
  );

  return (
    <div className="border border-border bg-card rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="font-display font-semibold text-sm flex items-center gap-2">
          <Award size={14} /> Ranking de Agentes
        </div>
        <div className="text-[11px] text-muted-foreground">
          Clique nas colunas para ordenar · QA via Auditoria
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          Sem dados no período selecionado
        </div>
      ) : (
        <table className="w-full text-xs" data-testid="agent-ranking-table">
          <thead className="bg-zinc-50 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            <tr>
              <th className="px-3 py-2 text-left w-8">#</th>
              <Th k="agent_name">Agente</Th>
              <Th k="calls" align="right">Chamadas</Th>
              <Th k="answered" align="right">Atendidas</Th>
              <Th k="answer_rate" align="right">% Atend.</Th>
              <Th k="avg_handle_sec" align="right">TMA</Th>
              <Th k="avg_wait_sec" align="right">TME</Th>
              <Th k="qa_avg" align="right">QA Média</Th>
              <Th k="conversion_rate" align="right">% Conv.</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r, i) => (
              <tr key={r.agent_id} className="hover:bg-zinc-50">
                <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{r.agent_name}</td>
                <td className="px-3 py-2 text-right font-mono">{r.calls}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{r.answered}</td>
                <td className="px-3 py-2 text-right font-mono">{r.answer_rate}%</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avg_handle_sec)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avg_wait_sec)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.qa_avg !== null ? (
                    <span className={r.qa_avg >= 4 ? "text-emerald-700"
                      : r.qa_avg >= 3 ? "text-amber-700" : "text-red-700"}>
                      {r.qa_avg} <span className="text-muted-foreground">({r.qa_count})</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono font-medium">
                  {r.qa_count > 0 ? (
                    <span className={r.conversion_rate >= 70 ? "text-emerald-700"
                      : r.conversion_rate >= 40 ? "text-amber-700" : "text-red-700"}>
                      {r.conversion_rate}%
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── Heatmap ─────────────────────────────────────────────── */
function HeatmapPanel({ grid }) {
  const allVals = grid.flat();
  const max = Math.max(...allVals, 1);
  function color(v) {
    if (v === 0) return "bg-zinc-50";
    const intensity = v / max;
    if (intensity > 0.8) return "bg-blue-700 text-white";
    if (intensity > 0.6) return "bg-blue-500 text-white";
    if (intensity > 0.4) return "bg-blue-400 text-white";
    if (intensity > 0.2) return "bg-blue-200";
    return "bg-blue-100";
  }
  return (
    <div className="border border-border bg-card rounded-sm" data-testid="heatmap">
      <div className="px-4 py-3 border-b border-border">
        <div className="font-display font-semibold text-sm flex items-center gap-2">
          <Flame size={14} /> Distribuição de chamadas — Dia × Hora
        </div>
        <div className="text-[11px] text-muted-foreground">
          Concentração de volume por hora e dia da semana · pico: {max} chamadas
        </div>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="text-[10px] font-mono mx-auto">
          <thead>
            <tr>
              <th className="px-1 py-1"></th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="px-1 py-1 text-muted-foreground font-normal w-6">
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, day) => (
              <tr key={day}>
                <td className="px-2 py-0.5 text-muted-foreground font-medium">
                  {DAY_LABELS[day]}
                </td>
                {row.map((v, h) => (
                  <td key={h} className="p-0.5">
                    <div className={`w-6 h-6 rounded-sm flex items-center justify-center
                      text-[9px] ${color(v)} transition-colors hover:ring-2 hover:ring-blue-500/50`}
                      title={`${DAY_LABELS[day]} ${h}h: ${v} chamada(s)`}>
                      {v > 0 ? v : ""}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Queue SLA ──────────────────────────────────────────── */
function QueueSlaPanel({ rows }) {
  return (
    <div className="border border-border bg-card rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="font-display font-semibold text-sm flex items-center gap-2">
          <Users size={14} /> SLA por Fila
        </div>
        <div className="text-[11px] text-muted-foreground">
          Service Level Agreement: % chamadas atendidas em até 20s
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          Sem dados de filas no período
        </div>
      ) : (
        <table className="w-full text-xs" data-testid="queue-sla-table">
          <thead className="bg-zinc-50 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            <tr>
              <th className="px-3 py-2 text-left">Fila</th>
              <th className="px-3 py-2 text-right">Chamadas</th>
              <th className="px-3 py-2 text-right">Atendidas</th>
              <th className="px-3 py-2 text-right">Abandonadas</th>
              <th className="px-3 py-2 text-right">% Abandono</th>
              <th className="px-3 py-2 text-right">TME</th>
              <th className="px-3 py-2 text-right">Tempo Abandono</th>
              <th className="px-3 py-2 text-right">SLA 20s</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.queue_id} className="hover:bg-zinc-50">
                <td className="px-3 py-2 font-medium">{r.queue_name}</td>
                <td className="px-3 py-2 text-right font-mono">{r.calls}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{r.answered}</td>
                <td className="px-3 py-2 text-right font-mono text-red-700">{r.abandoned}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <span className={r.abandon_rate < 10 ? "text-emerald-700"
                    : r.abandon_rate < 25 ? "text-amber-700" : "text-red-700"}>
                    {r.abandon_rate}%
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avg_wait_sec)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avg_abandon_sec)}</td>
                <td className="px-3 py-2 text-right">
                  <SlaBar pct={r.sla_20s_rate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SlaBar({ pct }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="inline-flex items-center gap-2 w-32 justify-end">
      <span className="font-mono text-xs font-medium w-10 text-right">{pct}%</span>
      <div className="flex-1 h-2 bg-zinc-100 rounded-sm overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

/* ─── Conversion ─────────────────────────────────────────── */
function ConversionPanel({ data, agents }) {
  const evaluatedAgents = agents.filter(a => a.qa_count > 0);
  return (
    <div className="space-y-4">
      <div className="border border-blue-200 bg-blue-50 rounded-sm p-4">
        <div className="flex items-start gap-3">
          <Target size={18} className="text-blue-700 mt-0.5" />
          <div className="text-xs text-blue-900 leading-relaxed">
            <div className="font-semibold text-sm mb-1">Como a conversão é calculada</div>
            {data.explainer || "Conversão baseada na nota de Auditoria QA (≥4 = sucesso)."}
            {" "}
            <a href="/auditoria" className="underline font-medium">Ir para Auditoria QA →</a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard label="Avaliadas" value={data.evaluated_calls || 0}
          sub="chamadas pontuadas"
          icon={Phone} testid="conv-evaluated" />
        <KpiCard label="Conversões" value={data.conversions || 0}
          sub="nota ≥ 4"
          icon={TrendingUp} accent="text-emerald-700" testid="conv-good" />
        <KpiCard label="Taxa" value={`${data.conversion_rate || 0}%`}
          sub="das avaliadas"
          icon={Target} accent="text-blue-700" testid="conv-rate" />
        <KpiCard label="Nota Média"
          value={data.avg_qa_score || "—"}
          sub="QA geral (1-5)"
          icon={Award} testid="conv-avg-score" />
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="font-display font-semibold text-sm">
            Top conversores · agentes com QA ≥ 1 avaliação
          </div>
        </div>
        {evaluatedAgents.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            Nenhum agente com chamadas avaliadas ainda.{" "}
            <a href="/auditoria" className="underline">Comece a avaliar gravações →</a>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {evaluatedAgents
              .sort((a, b) => b.conversion_rate - a.conversion_rate)
              .slice(0, 10)
              .map((a, i) => (
                <li key={a.agent_id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground w-5">
                    {i + 1}.
                  </span>
                  <span className="flex-1 font-medium text-sm">{a.agent_name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {a.qa_count} aval. · nota {a.qa_avg}
                  </span>
                  <div className="w-32">
                    <SlaBar pct={a.conversion_rate} />
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
