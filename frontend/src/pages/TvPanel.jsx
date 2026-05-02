import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, fmtDuration } from "../lib/api";
import {
  Maximize2, Minimize2, ArrowLeft, Users, PhoneIncoming, PhoneMissed,
  Clock, Activity, Headphones, Trophy, PhoneCall, AlertTriangle,
  Settings, RotateCw, Volume2, VolumeX, Hourglass, Timer,
} from "lucide-react";
import { loadConfig, saveConfig, resetConfig as resetCfg, playBeep } from "../lib/tvConfig";
import TvSettingsDrawer from "../components/TvSettingsDrawer";

export default function TvPanel() {
  const [config, setConfig] = useState(loadConfig());
  const [stats, setStats] = useState(null);
  const [realtime, setRealtime] = useState([]);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [now, setNow] = useState(new Date());
  const [isFs, setIsFs] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const lastAlertRef = useRef({}); // { kind: timestamp }
  const rootRef = useRef(null);

  // Persist config changes
  useEffect(() => { saveConfig(config); }, [config]);

  const isDark = config.theme === "dark";

  // ---------- Data loading ----------
  const loadAll = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, Math.max(3, config.refreshSec) * 1000);
    return () => clearInterval(t);
  }, [loadAll, config.refreshSec]);

  // Clock
  useEffect(() => {
    const c = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(c);
  }, []);

  // Fullscreen tracking
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Rotation
  const activeSlides = useMemo(() => {
    if (config.layout !== "rotation") return [];
    return Object.keys(config.slides).filter((k) => config.slides[k]);
  }, [config.layout, config.slides]);

  useEffect(() => {
    if (config.layout !== "rotation" || activeSlides.length === 0) return;
    const t = setInterval(() => {
      setSlideIdx((i) => (i + 1) % activeSlides.length);
    }, Math.max(5, config.rotationSec) * 1000);
    return () => clearInterval(t);
  }, [config.layout, config.rotationSec, activeSlides.length]);

  useEffect(() => {
    if (slideIdx >= activeSlides.length) setSlideIdx(0);
  }, [activeSlides.length, slideIdx]);

  // Derived metrics
  const onlineAgents = agents.filter((a) => a.status !== "offline");
  const ringingCalls = realtime.filter((c) => c.status === "ringing");
  const pausedCount = agents.filter((a) => a.status === "paused").length;
  const sla = useMemo(() => {
    const tot = (stats?.answered_today || 0) + (stats?.missed_today || 0);
    if (!tot) return 100;
    return Math.round(((stats.answered_today || 0) / tot) * 100);
  }, [stats]);

  // ---------- Alerts ----------
  useEffect(() => {
    if (!config.alerts.soundEnabled || !stats) return;
    const cooldownMs = (config.alerts.cooldownSec || 30) * 1000;
    const fire = (kind, severity) => {
      const last = lastAlertRef.current[kind] || 0;
      if (Date.now() - last < cooldownMs) return;
      lastAlertRef.current[kind] = Date.now();
      playBeep(severity);
    };
    if (sla < (config.alerts.slaBelow || 0)) fire("sla", "critical");
    const maxQ = queues.reduce((m, q) => Math.max(m, q.waiting || 0), 0);
    if (maxQ > (config.alerts.queueAbove || 0)) fire("queue", "warn");
    if ((stats.missed_today || 0) > (config.alerts.missedAbove || 0)) fire("missed", "warn");
  }, [stats, queues, sla, config.alerts]);

  async function toggleFs() {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  }

  function setCfg(next) { setConfig(next); }
  function onReset() { setConfig(resetCfg()); }

  // ---------- Theme palette ----------
  const t = isDark
    ? {
        bg: "bg-zinc-950", text: "text-zinc-100",
        header: "bg-black/40 border-b border-white/10",
        card: "bg-zinc-900/60 border border-white/5",
        cardInner: "bg-black/40 border border-white/5",
        muted: "text-zinc-400", muted2: "text-zinc-500",
        hoverBtn: "hover:bg-white/10 text-zinc-300",
        accentBtn: "bg-white text-black",
        footer: "bg-black/40 border-t border-white/10 text-zinc-500",
        ringingBg: "bg-blue-500/10 border-blue-500/30 text-blue-300",
      }
    : {
        bg: "bg-zinc-50", text: "text-zinc-900",
        header: "bg-white border-b border-zinc-200",
        card: "bg-white border border-zinc-200 shadow-sm",
        cardInner: "bg-zinc-50 border border-zinc-200",
        muted: "text-zinc-500", muted2: "text-zinc-400",
        hoverBtn: "hover:bg-zinc-100 text-zinc-600",
        accentBtn: "bg-zinc-900 text-white",
        footer: "bg-white border-t border-zinc-200 text-zinc-500",
        ringingBg: "bg-blue-50 border-blue-200 text-blue-700",
      };

  const slaColor = isDark
    ? (sla >= 90 ? "text-emerald-400" : sla >= 75 ? "text-amber-400" : "text-red-400")
    : (sla >= 90 ? "text-emerald-600" : sla >= 75 ? "text-amber-600" : "text-red-600");
  const waitColor = isDark
    ? ((stats?.waiting_in_queue || 0) >= 5 ? "text-red-400" : (stats?.waiting_in_queue || 0) >= 2 ? "text-amber-400" : "text-emerald-400")
    : ((stats?.waiting_in_queue || 0) >= 5 ? "text-red-600" : (stats?.waiting_in_queue || 0) >= 2 ? "text-amber-600" : "text-emerald-600");

  // ---------- KPI list (filtered by config) ----------
  const kpis = [
    config.widgets.kpiOnline   && { key: "online",   icon: Users,         label: "Online",         value: onlineAgents.length, sub: `/${agents.length}` },
    config.widgets.kpiIncall   && { key: "incall",   icon: Activity,      label: "Em Chamada",     value: stats?.incall_agents ?? "—", accent: isDark ? "text-blue-400" : "text-blue-600" },
    config.widgets.kpiPaused   && { key: "paused",   icon: Clock,         label: "Pausados",       value: pausedCount, accent: isDark ? "text-amber-400" : "text-amber-600" },
    config.widgets.kpiAnswered && { key: "answered", icon: PhoneIncoming, label: "Atendidas Hoje", value: stats?.answered_today ?? 0, accent: isDark ? "text-emerald-400" : "text-emerald-600" },
    config.widgets.kpiMissed   && { key: "missed",   icon: PhoneMissed,   label: "Perdidas Hoje",  value: stats?.missed_today ?? 0, accent: isDark ? "text-red-400" : "text-red-600" },
    config.widgets.kpiSla      && { key: "sla",      icon: Trophy,        label: "SLA Hoje",       value: `${sla}%`, accent: slaColor },
    config.widgets.kpiWaiting  && { key: "waiting",  icon: Hourglass,     label: "Aguardando",     value: stats?.waiting_in_queue ?? 0, accent: waitColor },
    config.widgets.kpiAvgWait  && { key: "avgwait",  icon: Timer,         label: "TME Médio",      value: fmtDuration(stats?.avg_wait_sec || 0) },
  ].filter(Boolean);

  // Determine active panels (default vs rotation)
  const inRotation = config.layout === "rotation" && activeSlides.length > 0;
  const currentSlide = inRotation ? activeSlides[slideIdx % activeSlides.length] : null;

  const showPanel = (key) => {
    if (!config.widgets[key === "kpis" ? "kpiOnline" : key === "queues" ? "queues" : key === "liveCalls" ? "liveCalls" : "topAgents"]) return false;
    if (!inRotation) return true;
    return currentSlide === key;
  };

  return (
    <div
      ref={rootRef}
      className={`min-h-screen w-full overflow-hidden flex flex-col ${t.bg} ${t.text}`}
      data-testid="tv-panel"
      data-theme={config.theme}
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      {/* Top bar */}
      <header className={`flex items-center justify-between px-6 py-3 ${t.header}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 ${t.accentBtn} rounded-sm flex items-center justify-center`}>
            <Headphones size={18} strokeWidth={2.4} />
          </div>
          <div>
            <div className="font-bold text-sm leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{config.title}</div>
            <div className={`text-[10px] uppercase tracking-widest mt-1 ${t.muted}`}>
              {inRotation ? `Rotação · ${currentSlide || "—"} (${slideIdx + 1}/${activeSlides.length})` : "Monitor operacional em tempo real"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          {config.widgets.clock && (
            <div className="text-right">
              <div className={`text-[10px] uppercase tracking-widest ${t.muted}`}>Hora atual</div>
              <div className="text-2xl font-medium tabular-nums leading-none mt-1">{now.toLocaleTimeString("pt-BR")}</div>
              <div className={`text-[10px] mt-0.5 ${t.muted2}`}>{now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
            </div>
          )}
          <button
            onClick={() => setConfig({ ...config, alerts: { ...config.alerts, soundEnabled: !config.alerts.soundEnabled } })}
            className={`p-2 rounded transition-colors ${t.hoverBtn}`}
            data-testid="tv-sound-toggle"
            title={config.alerts.soundEnabled ? "Som ligado" : "Som mudo"}
          >
            {config.alerts.soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          {inRotation && (
            <div className="flex items-center gap-1.5 text-xs">
              <RotateCw size={14} className="animate-spin" style={{ animationDuration: `${config.rotationSec}s` }} />
              <span className={t.muted}>{config.rotationSec}s</span>
            </div>
          )}
          <button onClick={() => setSettingsOpen(true)} data-testid="tv-settings-open" className={`p-2 rounded transition-colors ${t.hoverBtn}`} title="Configurações">
            <Settings size={18} />
          </button>
          <button onClick={toggleFs} data-testid="tv-fs" className={`p-2 rounded transition-colors ${t.hoverBtn}`} title="Tela cheia">
            {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {!isFs && (
            <Link to="/" className={`p-2 rounded transition-colors ${t.hoverBtn}`} data-testid="tv-back" title="Voltar ao painel">
              <ArrowLeft size={18} />
            </Link>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 grid grid-cols-12 grid-rows-[auto_1fr] gap-4 p-5 overflow-hidden">
        {/* KPI Row */}
        {kpis.length > 0 && (!inRotation || currentSlide === "kpis") && (
          <div className={`col-span-12 grid gap-3 ${kpiGridClass(kpis.length, inRotation)}`}>
            {kpis.map((k) => <TvKpi key={k.key} {...k} t={t} big={inRotation} />)}
          </div>
        )}

        {/* Filas */}
        {showPanel("queues") && (
          <div className={`${inRotation ? "col-span-12 row-span-2" : "col-span-12 lg:col-span-4"} ${t.card} rounded p-4 overflow-hidden flex flex-col`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-xs uppercase tracking-widest font-bold ${t.muted}`}>Filas de Atendimento</h3>
              <div className={`text-[10px] uppercase tracking-widest ${waitColor}`}>{stats?.waiting_in_queue ?? 0} aguardando</div>
            </div>
            <div className={`grid gap-2 overflow-y-auto ${inRotation ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
              {queues.map((q) => {
                const qDot = q.waiting >= 5 ? "bg-red-500" : q.waiting >= 2 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div key={q.id} className={`${t.cardInner} rounded px-3 py-2.5`} data-testid={`tv-queue-${q.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className={`font-bold ${inRotation ? "text-base" : "text-sm"}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{q.name}</div>
                      <div className={`w-2 h-2 rounded-full ${qDot}`} />
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <KMini label="Fila" value={q.waiting} accent={q.waiting > 0 ? (isDark ? "text-amber-400" : "text-amber-600") : ""} t={t} />
                      <KMini label="Atend." value={q.answered_today} accent={isDark ? "text-emerald-400" : "text-emerald-600"} t={t} />
                      <KMini label="Perd." value={q.missed_today} accent={isDark ? "text-red-400" : "text-red-600"} t={t} />
                      <KMini label="TME" value={fmtDuration(q.avg_wait_sec)} small t={t} />
                    </div>
                  </div>
                );
              })}
              {queues.length === 0 && <div className={`text-center py-6 text-sm col-span-full ${t.muted2}`}>Sem filas</div>}
            </div>
          </div>
        )}

        {/* Live Calls */}
        {showPanel("liveCalls") && (
          <div className={`${inRotation ? "col-span-12 row-span-2" : "col-span-12 lg:col-span-4"} ${t.card} rounded p-4 overflow-hidden flex flex-col`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-xs uppercase tracking-widest font-bold flex items-center gap-2 ${t.muted}`}>
                <PhoneCall size={12} /> Chamadas ao Vivo
              </h3>
              <div className={`text-[10px] ${t.muted2}`}>{realtime.length} ativa{realtime.length !== 1 ? "s" : ""}</div>
            </div>
            {ringingCalls.length > 0 && (
              <div className={`${t.ringingBg} border rounded px-3 py-2 mb-2 flex items-center gap-2`}>
                <AlertTriangle size={14} className="animate-pulse" />
                <span className="text-xs font-bold">{ringingCalls.length} chamada{ringingCalls.length !== 1 ? "s" : ""} tocando</span>
              </div>
            )}
            <div className={`space-y-1.5 overflow-y-auto ${inRotation ? "grid grid-cols-1 md:grid-cols-2 gap-2 space-y-0" : ""}`}>
              {realtime.slice(0, inRotation ? 14 : 8).map((c) => (
                <div key={c.id} className={`${t.cardInner} rounded px-3 py-2 flex items-center gap-3`} data-testid={`tv-call-${c.id}`}>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === "ringing" ? "bg-blue-400 animate-pulse" : "bg-purple-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{c.agent_name}</div>
                    <div className={`text-[10px] truncate ${t.muted2}`}>{c.caller_number} · {c.queue_name}</div>
                  </div>
                  <div className="text-sm tabular-nums font-bold">{fmtDuration(c.elapsed_sec)}</div>
                </div>
              ))}
              {realtime.length === 0 && <div className={`text-center py-6 text-sm ${t.muted2}`}>Nenhuma chamada ativa</div>}
            </div>
          </div>
        )}

        {/* Top Agents */}
        {showPanel("topAgents") && (
          <div className={`${inRotation ? "col-span-12 row-span-2" : "col-span-12 lg:col-span-4"} ${t.card} rounded p-4 overflow-hidden flex flex-col`}>
            <h3 className={`text-xs uppercase tracking-widest font-bold mb-3 flex items-center gap-2 ${t.muted}`}>
              <Trophy size={12} className="text-amber-400" /> Top Agentes · 7 dias
            </h3>
            <div className={`space-y-1.5 overflow-y-auto ${inRotation ? "grid grid-cols-1 md:grid-cols-2 gap-2 space-y-0" : ""}`}>
              {ranking.slice(0, inRotation ? 12 : 8).map((r, i) => {
                const medal = i === 0 ? "bg-amber-400 text-black" : i === 1 ? "bg-zinc-300 text-black" : i === 2 ? "bg-orange-500 text-white" : (isDark ? "bg-white/10 text-zinc-300" : "bg-zinc-200 text-zinc-700");
                return (
                  <div key={r.agent_id} className={`${t.cardInner} rounded px-3 py-2 flex items-center gap-3`} data-testid={`tv-rank-${r.agent_id}`}>
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${medal}`}>{i + 1}</div>
                    <img src={r.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{r.agent_name}</div>
                      <div className={`text-[10px] ${t.muted2}`}>
                        <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>{r.answered_7d}</span>
                        <span className="mx-1">·</span>
                        <span className={isDark ? "text-red-400" : "text-red-600"}>{r.missed_7d}</span>
                        <span className="mx-1">·</span>
                        ★ {r.csat}
                      </div>
                    </div>
                    <StatusDot status={r.status} isDark={isDark} />
                  </div>
                );
              })}
              {ranking.length === 0 && <div className={`text-center py-6 text-sm ${t.muted2}`}>Sem dados</div>}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {config.widgets.footer && (
        <footer className={`px-6 py-2 flex items-center justify-between text-[10px] uppercase tracking-widest ${t.footer}`}>
          <div>Auto-atualização: <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>{config.refreshSec}s</span></div>
          <div>{config.title}</div>
          <div>Última sync: <span className="tabular-nums">{now.toLocaleTimeString("pt-BR")}</span></div>
        </footer>
      )}

      <TvSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        setConfig={setCfg}
        onReset={onReset}
      />
    </div>
  );
}

function kpiGridClass(n, big) {
  if (big) return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
  return n <= 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-6";
}

function TvKpi({ icon: Icon, label, value, sub, accent, t, big }) {
  return (
    <div className={`${t.card} rounded p-4`}>
      <div className="flex items-center justify-between">
        <div className={`text-[10px] uppercase tracking-widest font-bold ${t.muted2}`}>{label}</div>
        <Icon size={14} className={t.muted2} />
      </div>
      <div className={`${big ? "text-7xl" : "text-5xl"} font-medium mt-2 tracking-tight leading-none tabular-nums ${accent || t.text}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {value}{sub && <span className={`${big ? "text-2xl" : "text-lg"} ml-1 ${t.muted2}`}>{sub}</span>}
      </div>
    </div>
  );
}

function KMini({ label, value, accent, small = false, t }) {
  return (
    <div>
      <div className={`text-[9px] uppercase tracking-wider ${t.muted2}`}>{label}</div>
      <div className={`${small ? "text-xs" : "text-base"} font-bold tabular-nums ${accent || t.text}`}>{value}</div>
    </div>
  );
}

function StatusDot({ status, isDark }) {
  const c = status === "online" ? (isDark ? "bg-emerald-400" : "bg-emerald-500")
          : status === "incall" ? (isDark ? "bg-blue-400" : "bg-blue-500")
          : status === "paused" ? (isDark ? "bg-amber-400" : "bg-amber-500")
          : (isDark ? "bg-zinc-600" : "bg-zinc-300");
  return <div className={`w-2 h-2 rounded-full shrink-0 ${c}`} />;
}
