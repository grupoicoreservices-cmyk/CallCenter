import { useEffect, useState } from "react";
import { api, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { PhoneIncoming, PhoneOutgoing, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";

export default function Realtime() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await api.get("/realtime/calls");
    setCalls(data.calls);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout
      title="Chamadas em Tempo Real"
      subtitle="Monitor ao vivo das conversas ativas"
      actions={
        <Button size="sm" variant="outline" onClick={load} data-testid="btn-refresh-realtime">
          <RefreshCw size={14} className="mr-1.5" /> Atualizar
        </Button>
      }
    >
      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left">
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-5 py-3">Status</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Agente</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Fila</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Número</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Direção</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Duração</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">carregando…</td></tr>
            ) : calls.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="realtime-empty">
                Nenhuma chamada ativa no momento.
              </td></tr>
            ) : (
              calls.map((c) => (
                <tr key={c.id} className="table-row-hover" data-testid={`call-row-${c.id}`}>
                  <td className="px-5 py-3"><StatusBadge status={c.status} pulse={c.status === "ringing" || c.status === "queued"} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {c.agent_avatar
                        ? <img src={c.agent_avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                        : <div className="w-7 h-7 rounded-full bg-zinc-200" />}
                      <div>
                        <div className="font-medium">{c.agent_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">ext. {c.agent_extension}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{c.queue_name}</td>
                  <td className="px-3 py-3 font-mono">{c.caller_number}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {c.direction === "inbound"
                        ? <><PhoneIncoming size={12} className="text-emerald-600" /> Entrada</>
                        : <><PhoneOutgoing size={12} className="text-blue-600" /> Saída</>}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{fmtDuration(c.elapsed_sec)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
