import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtDuration, fmtDateTime, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Play, Pause, Star, Search, Filter, MessageSquare, Save, Trash2, Loader2, Headphones } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

function streamUrl(u) {
  if (!u) return "";
  if (u.startsWith("http") || u.startsWith("blob:")) return u;
  let url = BACKEND_URL + u;
  if (u.includes("/stream")) {
    const t = localStorage.getItem("token");
    if (t) url += (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
  }
  return url;
}

const PERIODS = [
  { v: "24h", l: "Últimas 24h" },
  { v: "7d", l: "Últimos 7 dias" },
  { v: "30d", l: "Últimos 30 dias" },
  { v: "90d", l: "Últimos 90 dias" },
  { v: "all", l: "Todo período" },
];

const STATUS_FILTERS = [
  { v: "all", l: "Todas" },
  { v: "pending", l: "Pendentes" },
  { v: "evaluated", l: "Avaliadas" },
];

function StarRow({ value, onChange, size = 18, readOnly = false }) {
  return (
    <div className="flex gap-0.5" data-testid="star-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button"
          onClick={() => !readOnly && onChange?.(n)}
          disabled={readOnly}
          className={`transition-colors ${readOnly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
          data-testid={`star-${n}`}>
          <Star size={size}
            className={n <= value ? "fill-amber-400 text-amber-400" : "text-zinc-300"} />
        </button>
      ))}
    </div>
  );
}

export default function Auditoria() {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [agentId, setAgentId] = useState("all");
  const [queueId, setQueueId] = useState("all");
  const [period, setPeriod] = useState("30d");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState(null);
  const [evaluating, setEvaluating] = useState(null);  // recording obj
  const audioRef = useRef(null);

  async function loadAll() {
    setLoading(true);
    try {
      const params = { period, evaluation_status: statusFilter };
      if (agentId !== "all") params.agent_id = agentId;
      if (queueId !== "all") params.queue_id = queueId;
      const [r, s] = await Promise.all([
        api.get("/audit/recordings", { params }),
        api.get("/audit/stats", { params: { period } }),
      ]);
      setRows(r.data.recordings || []);
      setStats(s.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    (async () => {
      try {
        const [a, q] = await Promise.all([
          api.get("/agents?include_extensions=true"),
          api.get("/queues"),
        ]);
        setAgents(a.data.agents || []);
        setQueues(q.data.queues || []);
      } catch {}
    })();
  }, []);

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [agentId, queueId, period, statusFilter]);

  const filteredRows = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.caller_number || "").toLowerCase().includes(s)
      || (r.agent_name || "").toLowerCase().includes(s)
      || (r.queue_name || "").toLowerCase().includes(s);
  });

  function togglePlay(id, url) {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = streamUrl(url);
        audioRef.current.play().catch(() => toast.error("Não foi possível reproduzir"));
      }
      setPlayingId(id);
    }
  }

  return (
    <Layout title="Auditoria & QA" subtitle="Avaliação de gravações e análise de comportamento dos agentes">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Avaliações" value={stats?.total ?? 0} testid="audit-kpi-total" />
        <KpiCard label="Nota média" value={stats ? stats.avg_score.toFixed(2) : "—"}
          icon={<Star size={14} className="text-amber-400 fill-amber-400" />} testid="audit-kpi-avg" />
        <KpiCard label="Pendentes" value={(rows || []).filter((r) => !r.evaluation).length} testid="audit-kpi-pending" />
        <KpiCard label="Gravações no período" value={rows.length} testid="audit-kpi-total-recs" />
      </div>

      {/* Filtros */}
      <div className="border border-border bg-card rounded-sm p-4 mb-4 flex flex-wrap items-end gap-3" data-testid="audit-filters">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-[10px] uppercase tracking-widest">Buscar</Label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm" placeholder="Número, agente ou fila"
              data-testid="audit-search" />
          </div>
        </div>
        <FilterSelect label="Período" value={period} onChange={setPeriod} options={PERIODS} testid="audit-period" />
        <FilterSelect label="Agente" value={agentId} onChange={setAgentId}
          options={[{ v: "all", l: "Todos" }, ...agents.map((a) => ({ v: a.id, l: a.name + (a.extension ? ` (${a.extension})` : "") }))]}
          testid="audit-agent" />
        <FilterSelect label="Fila" value={queueId} onChange={setQueueId}
          options={[{ v: "all", l: "Todas" }, ...queues.map((q) => ({ v: q.id, l: q.name }))]}
          testid="audit-queue" />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}
          options={STATUS_FILTERS} testid="audit-status" />
      </div>

      {/* Lista */}
      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3 w-12"></th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Agente</th>
              <th className="px-4 py-3">Fila</th>
              <th className="px-4 py-3">Número</th>
              <th className="px-4 py-3">Duração</th>
              <th className="px-4 py-3">Avaliação</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Carregando...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                <Headphones size={32} className="mx-auto mb-2 opacity-30" />
                Nenhuma gravação encontrada com os filtros aplicados.
              </td></tr>
            ) : filteredRows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50" data-testid={`audit-row-${r.id}`}>
                <td className="px-4 py-2.5">
                  {r.audio_url ? (
                    <button onClick={() => togglePlay(r.id, r.audio_url)}
                      className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90"
                      data-testid={`play-${r.id}`}>
                      {playingId === r.id ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">sem áudio</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs font-mono whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                <td className="px-4 py-2.5 font-medium">{r.agent_name || "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.queue_name || "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.caller_number || "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{fmtDuration(r.duration_sec || 0)}</td>
                <td className="px-4 py-2.5">
                  {r.evaluation ? (
                    <div className="flex items-center gap-2">
                      <StarRow value={r.evaluation.score} readOnly size={14} />
                      <span className="text-[10px] text-muted-foreground" title={r.evaluation.evaluator_name}>
                        {r.evaluation.evaluator_name?.split(" ")[0]}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] uppercase tracking-widest text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Pendente</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="outline" size="sm" onClick={() => setEvaluating(r)}
                    data-testid={`evaluate-${r.id}`}>
                    {r.evaluation ? <><MessageSquare size={12} className="mr-1.5" /> Ver/Editar</> : <><Star size={12} className="mr-1.5" /> Avaliar</>}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EvaluateDialog
        recording={evaluating}
        onClose={() => setEvaluating(null)}
        onSaved={() => { setEvaluating(null); loadAll(); }}
      />
    </Layout>
  );
}

function KpiCard({ label, value, icon, testid }) {
  return (
    <div className="border border-border bg-card rounded-sm p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</div>
      <div className="font-display text-3xl font-bold mt-1 flex items-center gap-2">
        {value} {icon}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testid }) {
  return (
    <div className="min-w-[140px]">
      <Label className="text-[10px] uppercase tracking-widest">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm" data-testid={testid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function EvaluateDialog({ recording, onClose, onSaved }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    if (recording) {
      setScore(recording.evaluation?.score || 0);
      setComment(recording.evaluation?.comment || "");
    }
  }, [recording]);

  async function save() {
    if (!score) { toast.error("Defina a nota (1 a 5 estrelas)"); return; }
    setSaving(true);
    try {
      await api.post(`/audit/recordings/${recording.id}/evaluation`, {
        score, comment,
      });
      toast.success("Avaliação salva");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm("Remover esta avaliação?")) return;
    setDeleting(true);
    try {
      await api.delete(`/audit/recordings/${recording.id}/evaluation`);
      toast.success("Avaliação removida");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setDeleting(false); }
  }

  if (!recording) return null;
  return (
    <Dialog open={!!recording} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="evaluate-dialog">
        <DialogHeader>
          <DialogTitle>Avaliação de chamada</DialogTitle>
          <DialogDescription>
            {recording.agent_name || "—"} · {fmtDateTime(recording.started_at)} · {fmtDuration(recording.duration_sec || 0)} · {recording.caller_number || "—"}
          </DialogDescription>
        </DialogHeader>

        {recording.audio_url && (
          <div className="my-2 p-3 bg-zinc-50 rounded-sm">
            <audio ref={audioRef} controls className="w-full" src={streamUrl(recording.audio_url)}>
              Seu navegador não suporta áudio.
            </audio>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-widest">Nota</Label>
            <div className="flex items-center gap-3 mt-1">
              <StarRow value={score} onChange={setScore} size={28} />
              <span className="font-mono text-lg font-bold">{score || "—"}/5</span>
            </div>
          </div>
          <div>
            <Label htmlFor="ev-comment" className="text-[10px] uppercase tracking-widest">Comentário do supervisor</Label>
            <textarea id="ev-comment" rows={4}
              className="w-full mt-1 px-3 py-2 border border-border rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              placeholder="Pontos fortes, oportunidades de melhoria, observações…"
              value={comment} onChange={(e) => setComment(e.target.value)}
              data-testid="ev-comment" />
          </div>
          {recording.evaluation && (
            <div className="text-[11px] text-muted-foreground">
              Avaliado por <strong>{recording.evaluation.evaluator_name}</strong> em {fmtDateTime(recording.evaluation.updated_at)}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <div>
            {recording.evaluation && (
              <Button variant="ghost" size="sm" onClick={remove} disabled={deleting || saving}
                className="text-zinc-500 hover:text-red-600" data-testid="ev-delete">
                {deleting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Trash2 size={14} className="mr-1.5" />}
                Remover
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !score} data-testid="ev-save">
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
              Salvar avaliação
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
