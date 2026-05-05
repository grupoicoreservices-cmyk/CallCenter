import { useEffect, useState, useMemo } from "react";
import { api, API_BASE, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { FileSpreadsheet, FileText, Loader2, Download } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
];

const TYPES = [
  { key: "agents", label: "Performance" },
  { key: "queues", label: "Filas" },
  { key: "sla", label: "SLA" },
  { key: "calls", label: "Histórico (CDR)" },
  { key: "abandoned", label: "Abandonos" },
  { key: "recordings", label: "Gravações" },
  { key: "hourly", label: "Produtividade" },
  { key: "agent_states", label: "Estados Agente" },
  { key: "heatmap", label: "Heatmap" },
  { key: "compare", label: "Comparativo" },
];

export default function Reports() {
  const [type, setType] = useState("agents");
  const [period, setPeriod] = useState("7d");
  const [agentId, setAgentId] = useState("all");
  const [queueId, setQueueId] = useState("all");
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(null); // 'xlsx' | 'pdf' | null

  useEffect(() => {
    Promise.all([api.get("/agents"), api.get("/queues")]).then(([a, q]) => {
      setAgents(a.data.agents);
      setQueues(q.data.queues);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { type, period };
    if (agentId !== "all") params.agent_id = agentId;
    if (queueId !== "all") params.queue_id = queueId;
    api.get("/reports/data", { params })
      .then((r) => setReport(r.data))
      .finally(() => setLoading(false));
  }, [type, period, agentId, queueId]);

  async function doExport(fmt) {
    setExporting(fmt);
    try {
      const params = new URLSearchParams({ type, format: fmt, period });
      if (agentId !== "all") params.append("agent_id", agentId);
      if (queueId !== "all") params.append("queue_id", queueId);
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/reports/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao exportar");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="?([^";]+)"?/);
      const filename = match ? match[1] : `relatorio.${fmt}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erro ao exportar: " + e.message);
    } finally {
      setExporting(null);
    }
  }

  const chartData = useMemo(() => {
    if (!report) return null;
    if (type === "agents") return report.rows.slice(0, 8).map((r) => ({ name: r.agent_name.split(" ")[0], Atendidas: r.answered, Perdidas: r.missed }));
    if (type === "queues") return report.rows.map((r) => ({ name: r.queue_name, Atendidas: r.answered, Perdidas: r.missed }));
    if (type === "hourly") return report.rows.map((r) => ({ name: r.hour, Atendidas: r.answered, Perdidas: r.missed }));
    return null;
  }, [report, type]);

  return (
    <Layout title="Relatórios" subtitle="Exporte relatórios detalhados em Excel ou PDF">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]" data-testid="rep-period"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="w-[200px]" data-testid="rep-agent"><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os agentes</SelectItem>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={queueId} onValueChange={setQueueId}>
          <SelectTrigger className="w-[200px]" data-testid="rep-queue"><SelectValue placeholder="Fila" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as filas</SelectItem>
            {queues.map((q) => <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => doExport("xlsx")} disabled={!!exporting || loading} data-testid="btn-export-xlsx">
            {exporting === "xlsx" ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <FileSpreadsheet size={14} className="mr-1.5 text-emerald-600" />}
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("pdf")} disabled={!!exporting || loading} data-testid="btn-export-pdf">
            {exporting === "pdf" ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <FileText size={14} className="mr-1.5 text-red-600" />}
            PDF
          </Button>
        </div>
      </div>

      {/* Type tabs */}
      <Tabs value={type} onValueChange={setType} className="w-full">
        <TabsList className="flex-wrap h-auto">
          {TYPES.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`rep-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TYPES.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            {loading || !report ? (
              <div className="border border-border bg-card rounded-sm p-12 text-center text-sm text-muted-foreground font-mono">
                <Loader2 size={16} className="inline animate-spin mr-2" /> carregando relatório…
              </div>
            ) : (
              <>
                {chartData && chartData.length > 0 && (
                  <div className="border border-border bg-card rounded-sm p-5 mb-4">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-3">{report.title} · visualização</div>
                    <div className="h-64">
                      <ResponsiveContainer>
                        <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
                          <YAxis stroke="#a1a1aa" fontSize={11} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4 }} />
                          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="Atendidas" fill="#09090b" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="Perdidas" fill="#ef4444" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Visualização especial por tipo */}
                {report.title === "Heatmap (Dia × Hora)" && (
                  <div className="border border-border bg-card rounded-sm p-4 mb-4">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-2">Heatmap · {report.rows.reduce((a, r) => a + Object.keys(r).filter(k => k !== "day").reduce((s, k) => s + r[k], 0), 0)} chamadas</div>
                    <div className="overflow-x-auto">
                      <table className="text-[10px] font-mono">
                        <thead><tr><th className="p-1 sticky left-0 bg-card"></th>
                          {Array.from({ length: 24 }, (_, h) => <th key={h} className="p-1 text-muted-foreground">{h}h</th>)}
                        </tr></thead>
                        <tbody>{report.rows.map((row, i) => (
                          <tr key={i}>
                            <td className="p-1 font-medium sticky left-0 bg-card">{row.day}</td>
                            {Array.from({ length: 24 }, (_, h) => {
                              const v = row[`h${String(h).padStart(2, "0")}`] || 0;
                              const intensity = report.max_value ? v / report.max_value : 0;
                              const bg = v === 0 ? "transparent" : `rgba(16, 185, 129, ${0.15 + intensity * 0.85})`;
                              return <td key={h} className="p-0">
                                <div className="w-7 h-7 flex items-center justify-center rounded-sm" style={{ background: bg }}
                                     title={`${row.day} ${h}h → ${v} chamadas`}>{v || ""}</div>
                              </td>;
                            })}
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-2">Verde mais escuro = mais chamadas. Use para dimensionar equipe.</div>
                  </div>
                )}

                {report.title === "Comparativo de Períodos" && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    {report.rows.map((r, i) => (
                      <div key={i} className="border border-border bg-card rounded-sm p-3">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{r.metric}</div>
                        <div className="font-mono text-2xl font-bold mt-1">{r.current}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">vs {r.previous} anterior</div>
                        <div className={`text-xs font-mono mt-1 ${r.trend === "up" ? "text-emerald-700" : "text-red-600"}`}>
                          {r.trend === "up" ? "↑" : "↓"} {Math.abs(r.delta_pct)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {report.title === "SLA por Fila" && report.rows.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {report.rows.slice(0, 6).map((r, i) => {
                      const colorMap = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" };
                      const bgMap = { green: "bg-emerald-50 border-emerald-200", amber: "bg-amber-50 border-amber-200", red: "bg-red-50 border-red-200" };
                      return (
                        <div key={i} className={`border rounded-sm p-3 ${bgMap[r.color] || "border-border bg-card"}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${colorMap[r.color]}`} />
                            <div className="text-xs font-medium truncate">{r.queue_name}</div>
                            <span className="ml-auto text-[10px] text-muted-foreground font-mono">ext {r.extension}</span>
                          </div>
                          <div className="mt-2 flex items-baseline gap-2">
                            <div className="font-mono text-3xl font-bold">{r.sla_pct}%</div>
                            <div className="text-[10px] text-muted-foreground">meta {r.target_sec}s</div>
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono mt-1">
                            {r.answered_within} dentro · {r.answered} atendidas · {r.missed} perdidas
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border border-border bg-card rounded-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Resultado</div>
                      <h3 className="font-display text-lg font-semibold" data-testid="rep-title">{report.title}</h3>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{report.rows.length}</span> registro{report.rows.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 border-b border-border">
                        <tr className="text-left">
                          {report.columns.map((c) => (
                            <th key={c.key} className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border" data-testid="rep-tbody">
                        {report.rows.length === 0 ? (
                          <tr><td colSpan={report.columns.length} className="px-5 py-10 text-center text-muted-foreground" data-testid="rep-empty">
                            Sem dados para os filtros selecionados.
                          </td></tr>
                        ) : report.rows.slice(0, 200).map((row, i) => (
                          <tr key={i} className="table-row-hover" data-testid={`rep-row-${i}`}>
                            {report.columns.map((c) => (
                              <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${isNumeric(row[c.key]) ? "font-mono" : ""}`}>
                                {renderCell(c.key, row[c.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {report.rows.length > 200 && (
                      <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border bg-zinc-50 flex items-center gap-2">
                        <Download size={12} />
                        Exibindo 200 de {report.rows.length} registros — <button onClick={() => doExport("xlsx")} className="underline hover:text-foreground">exporte em Excel</button> para ver todos.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Layout>
  );
}

function isNumeric(v) {
  return typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));
}

function renderCell(key, value) {
  if (value == null || value === "") return "—";
  if (key === "status") return <StatusBadge status={value} />;
  if (key === "trend") {
    return value === "up"
      ? <span className="text-emerald-700">↑ melhor</span>
      : <span className="text-red-600">↓ pior</span>;
  }
  if (key === "color") {
    const map = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" };
    return <span className={`inline-block w-2.5 h-2.5 rounded-full ${map[value] || "bg-zinc-300"}`} />;
  }
  if (["duration_sec", "wait_sec", "avg_handle_sec", "avg_wait_sec",
       "median_handle_sec", "p95_handle_sec", "max_handle_sec",
       "asa_sec", "logged_in_sec", "available_sec", "on_break_sec", "logged_out_sec"].includes(key)) {
    return fmtDuration(value);
  }
  if (["sla_pct", "adherence_pct", "available_pct", "delta_pct"].includes(key)) return `${value}%`;
  if (key === "csat") {
    return <span className="inline-flex items-center gap-1">★ {value}</span>;
  }
  return String(value);
}
