import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtDuration, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Play, Pause, Download, Search, X } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

export default function Recordings() {
  const [rows, setRows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [agentId, setAgentId] = useState("all");
  const [queueId, setQueueId] = useState("all");
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState(null);
  const [progress, setProgress] = useState({});
  const audioRef = useRef(null);

  async function load() {
    const params = {};
    if (agentId !== "all") params.agent_id = agentId;
    if (queueId !== "all") params.queue_id = queueId;
    if (search) params.search = search;
    const { data } = await api.get("/recordings", { params });
    setRows(data.recordings);
  }

  useEffect(() => {
    (async () => {
      const [a, q] = await Promise.all([api.get("/agents"), api.get("/queues")]);
      setAgents(a.data.agents);
      setQueues(q.data.queues);
    })();
  }, []);

  useEffect(() => { load(); }, [agentId, queueId]);

  const playing = useMemo(() => rows.find((r) => r.id === playingId), [rows, playingId]);

  function togglePlay(rec) {
    if (playingId === rec.id) {
      if (audioRef.current?.paused) audioRef.current.play();
      else audioRef.current?.pause();
    } else {
      setPlayingId(rec.id);
      setTimeout(() => { audioRef.current?.play(); }, 50);
    }
  }

  function onTime() {
    const a = audioRef.current;
    if (!a || !playingId) return;
    setProgress({ current: a.currentTime, duration: a.duration });
  }

  function seek(e) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    a.currentTime = pct * a.duration;
  }

  return (
    <Layout title="Gravações" subtitle="Revise, ouça e baixe chamadas gravadas">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número ou agente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9"
            data-testid="rec-search"
          />
        </div>
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="w-[200px]" data-testid="rec-filter-agent"><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os agentes</SelectItem>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={queueId} onValueChange={setQueueId}>
          <SelectTrigger className="w-[180px]" data-testid="rec-filter-queue"><SelectValue placeholder="Fila" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as filas</SelectItem>
            {queues.map((q) => <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(agentId !== "all" || queueId !== "all" || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setAgentId("all"); setQueueId("all"); setSearch(""); }} data-testid="rec-clear">
            <X size={14} className="mr-1" /> Limpar
          </Button>
        )}
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden mb-28">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left">
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 w-12"></th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Data/Hora</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Agente</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Fila</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Número</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Duração</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Tamanho</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 w-20 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="rec-empty">
                Nenhuma gravação encontrada.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={`table-row-hover ${playingId === r.id ? "bg-zinc-50" : ""}`} data-testid={`rec-row-${r.id}`}>
                <td className="px-3 py-3">
                  <button
                    onClick={() => togglePlay(r)}
                    data-testid={`rec-play-${r.id}`}
                    className="w-8 h-8 rounded-full border border-border hover:bg-zinc-100 flex items-center justify-center transition-colors"
                  >
                    {playingId === r.id ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                  </button>
                </td>
                <td className="px-3 py-3 font-mono text-xs">{fmtDateTime(r.started_at)}</td>
                <td className="px-3 py-3 font-medium">{r.agent_name}</td>
                <td className="px-3 py-3">{r.queue_name}</td>
                <td className="px-3 py-3 font-mono text-xs">{r.caller_number}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtDuration(r.duration_sec)}</td>
                <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">{r.size_mb} MB</td>
                <td className="px-3 py-3 text-right">
                  <a href={r.audio_url} download className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid={`rec-download-${r.id}`}>
                    <Download size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sticky audio player */}
      {playing && (
        <div className="fixed bottom-0 left-60 right-0 border-t border-border bg-card/95 backdrop-blur px-8 py-3 z-40" data-testid="audio-player">
          <div className="flex items-center gap-4">
            <button
              onClick={() => togglePlay(playing)}
              className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90"
              data-testid="player-toggle"
            >
              {audioRef.current?.paused ? <Play size={16} className="ml-0.5" /> : <Pause size={16} />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <div className="truncate">
                  <span className="font-medium">{playing.agent_name}</span>
                  <span className="text-muted-foreground mx-2">·</span>
                  <span className="font-mono">{playing.caller_number}</span>
                </div>
                <div className="font-mono text-muted-foreground whitespace-nowrap">
                  {fmtDuration(progress.current || 0)} / {fmtDuration(playing.duration_sec)}
                </div>
              </div>
              <div onClick={seek} className="h-1.5 bg-zinc-200 rounded-full cursor-pointer overflow-hidden">
                <div
                  className="h-full bg-foreground transition-all"
                  style={{ width: `${((progress.current || 0) / (progress.duration || playing.duration_sec || 1)) * 100}%` }}
                />
              </div>
            </div>
            <button onClick={() => setPlayingId(null)} className="text-muted-foreground hover:text-foreground" data-testid="player-close">
              <X size={18} />
            </button>
          </div>
          <audio
            ref={audioRef}
            src={playing.audio_url}
            onTimeUpdate={onTime}
            onLoadedMetadata={onTime}
            onEnded={() => setPlayingId(null)}
          />
        </div>
      )}
    </Layout>
  );
}
