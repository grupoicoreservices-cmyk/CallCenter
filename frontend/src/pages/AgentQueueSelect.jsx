import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Loader2, CheckCircle2, ArrowRight, Headphones } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "sonner";

export default function AgentQueueSelect() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [queues, setQueues] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && user.role !== "agent") {
      navigate("/", { replace: true });
      return;
    }
    (async () => {
      try {
        const { data } = await api.get("/agents/me/queues");
        setQueues(data.queues || []);
        // pre-select previous selection or all if first time
        const saved = (data.active_queues && data.active_queues.length > 0)
          ? new Set(data.active_queues)
          : new Set((data.queues || []).map((q) => q.id));
        setSelected(saved);
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar filas");
      } finally { setLoading(false); }
    })();
  }, [user, navigate]);

  // Cleanup on tab close
  useEffect(() => {
    function onBeforeUnload() {
      const token = localStorage.getItem("token");
      if (!token) return;
      const url = `${process.env.REACT_APP_BACKEND_URL || ""}/api/agents/me/logout?token=${encodeURIComponent(token)}`;
      try {
        const blob = new Blob([JSON.stringify({})], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } catch (_) { /* best effort */ }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function toggle(qid) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(queues.map((q) => q.id))); }
  function clearAll() { setSelected(new Set()); }

  async function confirm() {
    if (selected.size === 0) {
      toast.error("Selecione ao menos uma fila");
      return;
    }
    setSaving(true);
    try {
      await api.post("/agents/me/queues/select", { queue_ids: Array.from(selected) });
      toast.success(`${selected.size} fila${selected.size > 1 ? "s" : ""} ativada${selected.size > 1 ? "s" : ""}`);
      navigate("/agent", { replace: true });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao ativar filas");
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (queues.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full border border-amber-200 bg-amber-50 rounded-sm p-8 text-center" data-testid="queue-select-empty">
          <Users size={32} className="mx-auto text-amber-600 mb-3" />
          <h1 className="font-display text-xl font-bold mb-2">Sem filas atribuídas</h1>
          <p className="text-sm text-muted-foreground">
            Você ainda não está vinculado a nenhuma fila. Peça a um administrador
            para te adicionar como Tier de uma fila no FusionPBX.
          </p>
          <Button variant="outline" onClick={logout} className="mt-5">Sair</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl border border-border bg-card rounded-sm p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-sm bg-foreground text-background flex items-center justify-center">
            <Headphones size={18} strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Bem-vindo</div>
            <h1 className="font-display text-2xl font-bold leading-tight">{user?.name || "Agente"}</h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Selecione as filas em que você deseja receber chamadas nesta sessão.
        </p>

        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {selected.size} de {queues.length} selecionada{queues.length !== 1 ? "s" : ""}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={selectAll} data-testid="queue-select-all">Todas</Button>
            <Button variant="ghost" size="sm" onClick={clearAll} data-testid="queue-clear-all">Nenhuma</Button>
          </div>
        </div>

        <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto" data-testid="queue-list">
          {queues.map((q) => {
            const isOn = selected.has(q.id);
            return (
              <label key={q.id}
                className={`flex items-center gap-3 border rounded-sm p-3 cursor-pointer transition-colors ${
                  isOn ? "border-foreground bg-zinc-50" : "border-border hover:border-zinc-400"
                }`}
                data-testid={`queue-item-${q.id}`}>
                <Checkbox checked={isOn} onCheckedChange={() => toggle(q.id)}
                  data-testid={`queue-check-${q.id}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    <Users size={13} className="text-muted-foreground" />
                    {q.name}
                    {q.extension && <span className="font-mono text-xs text-muted-foreground">·  {q.extension}</span>}
                  </div>
                  {q.strategy && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Estratégia: <span className="font-mono">{q.strategy}</span>
                      {q.waiting > 0 && (
                        <span className="ml-2 text-amber-700">· {q.waiting} aguardando</span>
                      )}
                    </div>
                  )}
                </div>
                {isOn && <CheckCircle2 size={16} className="text-emerald-600" />}
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
          <Button variant="outline" onClick={logout} disabled={saving} data-testid="queue-logout">Sair</Button>
          <Button onClick={confirm} disabled={saving || selected.size === 0}
            data-testid="queue-confirm" className="min-w-[180px]">
            {saving ? <Loader2 className="animate-spin" size={14} />
                    : <>Entrar nas filas <ArrowRight size={14} className="ml-1.5" /></>}
          </Button>
        </div>
      </div>
    </div>
  );
}
