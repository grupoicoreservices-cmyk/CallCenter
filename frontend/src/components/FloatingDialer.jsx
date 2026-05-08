import { useEffect, useRef, useState, useCallback } from "react";
import { Phone, X, Delete, PhoneCall, PhoneIncoming, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

const DIAL_KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

export default function FloatingDialer() {
  const { user, hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [inbound, setInbound] = useState(null);
  const lastInboundUuid = useRef(null);
  const audioRef = useRef(null);
  const canDial = hasPermission && hasPermission("dialer.use");
  // Hook deve ser declarado SEMPRE, antes de qualquer return condicional
  const checkInbound = useCallback(async () => {
    if (!user || user.role !== "agent") return;
    try {
      const { data } = await api.get("/realtime/calls");
      const myExt = String(localStorage.getItem("agent_extension") || "");
      if (!myExt) return;
      const ringing = (data.calls || []).find((c) =>
        String(c.agent_extension || c.callee || "") === myExt
        && (c.state === "RINGING" || c.callstate === "RINGING")
      );
      if (ringing && ringing.uuid !== lastInboundUuid.current) {
        lastInboundUuid.current = ringing.uuid;
        setInbound({
          uuid: ringing.uuid,
          caller_number: ringing.caller_number || ringing.cid_num || "—",
          caller_name: ringing.caller_name || ringing.cid_name || "Chamada",
          queue: ringing.queue_name || ringing.queue,
        });
        try { audioRef.current?.play().catch(() => {}); } catch {}
        toast.info(`📞 Ligação entrante: ${ringing.caller_number || "—"}`,
                    { duration: 8000 });
      } else if (!ringing && inbound) {
        // Chamada saiu da lista (atendida ou desligada)
        setInbound(null);
        lastInboundUuid.current = null;
      }
    } catch {/* sem perm ou tenant sem ESL */}
  }, [user, inbound]);
  useEffect(() => {
    if (!user || user.role !== "agent") return;
    const interval = setInterval(checkInbound, 4000);
    checkInbound();
    return () => clearInterval(interval);
  }, [user, checkInbound]);
  if (!canDial || !user) return null;

  function press(d) { setNumber((n) => (n + d).slice(0, 20)); }
  function backspace() { setNumber((n) => n.slice(0, -1)); }
  function clear() { setNumber(""); }

  async function dial() {
    const dest = number.trim();
    if (!dest) { toast.error("Digite o número"); return; }
    setCalling(true);
    try {
      const { data } = await api.post("/dialer/click2call", { destination: dest });
      if (data.ok) {
        toast.success(`Discando para ${dest}. Atenda no ramal ${data.extension}.`);
        clear();
        setOpen(false);
      } else {
        toast.error(`Falha: ${(data.result || "").slice(0, 120)}`);
      }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao discar");
    } finally { setCalling(false); }
  }

  return (
    <>
      {/* Beep para chamada entrante */}
      <audio ref={audioRef} preload="auto">
        <source src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==" type="audio/wav" />
      </audio>

      {/* Modal de chamada entrante */}
      {inbound && (
        <div className="fixed top-4 right-4 z-50 bg-white border-2 border-emerald-500 rounded-sm shadow-2xl w-80 animate-pulse"
          data-testid="inbound-call-toast">
          <div className="px-4 py-3 bg-emerald-500 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneIncoming size={16} className="animate-bounce" />
              <span className="font-semibold text-sm">Chamada entrante</span>
            </div>
            <button onClick={() => setInbound(null)} className="hover:bg-white/20 p-1 rounded">
              <X size={14} />
            </button>
          </div>
          <div className="p-4">
            <div className="font-display text-2xl font-bold">{inbound.caller_name}</div>
            <div className="font-mono text-sm text-muted-foreground">{inbound.caller_number}</div>
            {inbound.queue && (
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1">
                fila: {inbound.queue}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground mt-3">
              Atenda no seu telefone ramal <span className="font-mono font-bold">{localStorage.getItem("agent_extension")}</span>
            </div>
          </div>
        </div>
      )}

      {/* Botão flutuante */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-foreground text-background shadow-lg hover:scale-105 transition flex items-center justify-center"
        title={open ? "Fechar discador" : "Abrir discador"}
        data-testid="dialer-fab">
        {open ? <X size={20} /> : <Phone size={20} />}
      </button>

      {/* Discador */}
      {open && (
        <div className="fixed bottom-24 right-6 z-40 bg-card border border-border rounded-sm shadow-2xl w-72 overflow-hidden"
          data-testid="dialer-panel">
          <div className="px-4 py-3 border-b border-border bg-zinc-50">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Discar (Click2Call)</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Sentado no ramal: <span className="font-mono font-bold text-foreground">{localStorage.getItem("agent_extension") || "—"}</span>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="relative">
              <Input value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^0-9*#+]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") dial(); }}
                placeholder="Número de destino"
                className="pr-10 font-mono text-lg text-center h-12"
                data-testid="dialer-input" />
              {number && (
                <button onClick={backspace} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  data-testid="dialer-backspace">
                  <Delete size={16} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {DIAL_KEYS.map(([d, l]) => (
                <button key={d} onClick={() => press(d)}
                  className="flex flex-col items-center justify-center py-2 border border-border rounded-sm bg-white hover:bg-zinc-50 active:scale-95 transition"
                  data-testid={`dialer-key-${d}`}>
                  <span className="text-xl font-display font-semibold">{d}</span>
                  <span className="text-[9px] text-muted-foreground">{l}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={clear} disabled={!number || calling}
                className="flex-1" data-testid="dialer-clear">Limpar</Button>
              <Button onClick={dial} disabled={!number || calling}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                data-testid="dialer-call">
                {calling ? <Loader2 size={14} className="mr-1.5 animate-spin" />
                          : <PhoneCall size={14} className="mr-1.5" />}
                Discar
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center leading-tight">
              Seu telefone vai tocar primeiro. Quando atender, a ligação para o destino é feita automaticamente.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
