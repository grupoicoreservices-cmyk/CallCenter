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
  { key: "calls", label: "Histórico (CDR)" },
  { key: "abandoned", label: "Abandonos" },
  { key: "recordings", label: "Gravações" },
  { key: "hourly", label: "Produtividade" },
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
  if (key === "duration_sec" || key === "wait_sec" || key === "avg_handle_sec" || key === "avg_wait_sec") {
    return fmtDuration(value);
  }
  if (key === "sla_pct" || key === "adherence_pct") return `${value}%`;
  if (key === "csat") {
    return <span className="inline-flex items-center gap-1">★ {value}</span>;
  }
  return String(value);
}
