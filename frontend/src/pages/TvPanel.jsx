import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api, fmtDuration } from "../lib/api";
import {
  Maximize2, Minimize2, ArrowLeft, Users, PhoneIncoming, PhoneMissed,
  Clock, Activity, Headphones, Trophy, PhoneCall, AlertTriangle,
} from "lucide-react";

export default function TvPanel() {
  const [stats, setStats] = useState(null);
  const [realtime, setRealtime] = useState([]);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [now, setNow] = useState(new Date());
  const [isFs, setIsFs] = useState(false);
  const rootRef = useRef(null);

  async function loadAll() {
    try {
      const [s, r, a, q, rk] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/realtime/calls"),
        api.get("/agents"),
        api.get("/queues"),
        api.get("/reports/agents"),
      ]);
      setStats(s.data); setRealtime(r.data.calls);
      setAgents(a.data.agents); setQueues(q.data.queues);
      setRanking(rk.data.rows);
    } catch {}
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 5000);
    const c = setInterval(() => setNow(new Date()), 1000);
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => { clearInterval(t); clearInterval(c); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  async function toggleFs() {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  }

  const onlineAgents = agents.filter((a) => a.status !== "offline");
  const ringingCalls = realtime.filter((c) => c.status === "ringing");
  const pausedCount = agents.filter((a) => a.status === "paused").length;

  const sla = (() => {
    const tot = (stats?.answered_today || 0) + (stats?.missed_today || 0);
    if (!tot) return 100;
    return Math.round(((stats.answered_today || 0) / tot) * 100);
  })();

  const slaColor = sla >= 90 ? "text-emerald-400" : sla >= 75 ? "text-amber-400" : "text-red-400";
  const waitColor = (stats?.waiting_in_queue || 0) >= 5 ? "text-red-400" : (stats?.waiting_in_queue || 0) >= 2 ? "text-amber-400" : "text-emerald-400";

  return (
    <div
      ref={rootRef}
      className="min-h-screen w-full bg-zinc-950 text-zinc-100 font-mono overflow-hidden flex flex-col"
      data-testid="tv-panel"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white text-black rounded-sm flex items-center justify-center">
            <Headphones size={18} strokeWidth={2.4} />
          </div>
          <div>
            <div className="font-bold text-sm leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Voxyra CCA · TV Panel</div>
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest mt-1">Monitor operacional em tempo real</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest">Hora atual</div>
            <div className="text-2xl font-medium tabular-nums leading-none mt-1">
              {now.toLocaleTimeString("pt-BR")}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
          </div>
          <button onClick={toggleFs} data-testid="tv-fs" className="p-2 hover:bg-white/10 rounded transition-colors text-zinc-300" title="Tela cheia">
            {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {!isFs && (
            <Link to="/" className="p-2 hover:bg-white/10 rounded transition-colors text-zinc-300" data-testid="tv-back" title="Voltar ao painel">
              <ArrowLeft size={18} />
            </Link>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 grid grid-cols-12 grid-rows-[auto_1fr] gap-4 p-5 overflow-hidden">
        {/* KPI Row */}
        <div className="col-span-12 grid grid-cols-2 md:grid-cols-6 gap-3">
          <TvKpi icon={Users} label="Online" value={onlineAgents.length} sub={`/${agents.length}`} />
          <TvKpi icon={Activity} label="Em Chamada" value={stats?.incall_agents ?? "—"} accent="text-blue-400" />
          <TvKpi icon={Clock} label="Pausados" value={pausedCount} accent="text-amber-400" />
          <TvKpi icon={PhoneIncoming} label="Atendidas Hoje" value={stats?.answered_today ?? 0} accent="text-emerald-400" />
          <TvKpi icon={PhoneMissed} label="Perdidas Hoje" value={stats?.missed_today ?? 0} accent="text-red-400" />
          <TvKpi icon={Trophy} label="SLA Hoje" value={`${sla}%`} accent={slaColor} />
        </div>

        {/* Queues column */}
        <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-white/5 rounded p-4 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold">Filas de Atendimento</h3>
            <div className={`text-[10px] uppercase tracking-widest ${waitColor}`}>
              {stats?.waiting_in_queue ?? 0} aguardando
            </div>
          </div>
          <div className="space-y-2 overflow-y-auto">
            {queues.map((q) => {
              const waitColorQ = q.waiting >= 5 ? "bg-red-500" : q.waiting >= 2 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={q.id} className="bg-black/40 border border-white/5 rounded px-3 py-2.5" data-testid={`tv-queue-${q.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{q.name}</div>
                    <div className={`w-2 h-2 rounded-full ${waitColorQ}`} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <KMini label="Fila" value={q.waiting} accent={q.waiting > 0 ? "text-amber-400" : "text-zinc-300"} />
                    <KMini label="Atend." value={q.answered_today} accent="text-emerald-400" />
                    <KMini label="Perd." value={q.missed_today} accent="text-red-400" />
                    <KMini label="TME" value={fmtDuration(q.avg_wait_sec)} small />
                  </div>
                </div>
              );
            })}
            {queues.length === 0 && <div className="text-center text-zinc-500 text-sm py-6">Sem filas</div>}
          </div>
        </div>

        {/* Live calls column */}
        <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-white/5 rounded p-4 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold flex items-center gap-2">
              <PhoneCall size={12} /> Chamadas ao Vivo
            </h3>
            <div className="text-[10px] text-zinc-500">{realtime.length} ativa{realtime.length !== 1 ? "s" : ""}</div>
          </div>
          {ringingCalls.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2 mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="text-blue-400 animate-pulse" />
              <span className="text-xs font-bold text-blue-300">{ringingCalls.length} chamada{ringingCalls.length !== 1 ? "s" : ""} tocando</span>
            </div>
          )}
          <div className="space-y-1.5 overflow-y-auto">
            {realtime.slice(0, 8).map((c) => (
              <div key={c.id} className="bg-black/40 border border-white/5 rounded px-3 py-2 flex items-center gap-3" data-testid={`tv-call-${c.id}`}>
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === "ringing" ? "bg-blue-400 animate-pulse" : "bg-purple-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{c.agent_name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{c.caller_number} · {c.queue_name}</div>
                </div>
                <div className="text-sm tabular-nums font-bold">{fmtDuration(c.elapsed_sec)}</div>
              </div>
            ))}
            {realtime.length === 0 && <div className="text-center text-zinc-500 text-sm py-6">Nenhuma chamada ativa</div>}
          </div>
        </div>

        {/* Top agents column */}
        <div className="col-span-12 lg:col-span-4 bg-zinc-900/60 border border-white/5 rounded p-4 overflow-hidden flex flex-col">
          <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3 flex items-center gap-2">
            <Trophy size={12} className="text-amber-400" /> Top Agentes · 7 dias
          </h3>
          <div className="space-y-1.5 overflow-y-auto">
            {ranking.slice(0, 8).map((r, i) => {
              const medal = i === 0 ? "bg-amber-400 text-black" : i === 1 ? "bg-zinc-300 text-black" : i === 2 ? "bg-orange-500 text-black" : "bg-white/10 text-zinc-300";
              return (
                <div key={r.agent_id} className="bg-black/40 border border-white/5 rounded px-3 py-2 flex items-center gap-3" data-testid={`tv-rank-${r.agent_id}`}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${medal}`}>
                    {i + 1}
                  </div>
                  <img src={r.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{r.agent_name}</div>
                    <div className="text-[10px] text-zinc-500">
                      <span className="text-emerald-400">{r.answered_7d}</span>
                      <span className="mx-1 text-zinc-600">·</span>
                      <span className="text-red-400">{r.missed_7d}</span>
                      <span className="mx-1 text-zinc-600">·</span>
                      ★ {r.csat}
                    </div>
                  </div>
                  <StatusDot status={r.status} />
                </div>
              );
            })}
            {ranking.length === 0 && <div className="text-center text-zinc-500 text-sm py-6">Sem dados</div>}
          </div>
        </div>
      </div>

      {/* Footer ticker */}
      <footer className="border-t border-white/10 bg-black/40 px-6 py-2 flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-widest">
        <div>Auto-atualização: <span className="text-emerald-400">5s</span></div>
        <div>Voxyra CCA · Callcenter Analytical</div>
        <div>Última sync: <span className="text-zinc-300 tabular-nums">{now.toLocaleTimeString("pt-BR")}</span></div>
      </footer>
    </div>
  );
}

function TvKpi({ icon: Icon, label, value, sub, accent = "text-zinc-100" }) {
  return (
    <div className="bg-zinc-900/60 border border-white/5 rounded p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{label}</div>
        <Icon size={14} className="text-zinc-500" />
      </div>
      <div className={`text-5xl font-medium mt-2 tracking-tight leading-none tabular-nums ${accent}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {value}{sub && <span className="text-lg text-zinc-600 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function KMini({ label, value, accent = "text-zinc-100", small = false }) {
  return (
    <div>
      <div className="text-[9px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`${small ? "text-xs" : "text-base"} font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function StatusDot({ status }) {
  const c = status === "online" ? "bg-emerald-400" :
            status === "incall" ? "bg-blue-400" :
            status === "paused" ? "bg-amber-400" : "bg-zinc-600";
  return <div className={`w-2 h-2 rounded-full shrink-0 ${c}`} />;
}
