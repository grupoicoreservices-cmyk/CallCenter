import { useEffect, useState } from "react";
import { api, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import { Users, Clock, TrendingDown } from "lucide-react";

export default function Queues() {
  const [queues, setQueues] = useState([]);

  useEffect(() => {
    api.get("/queues").then((r) => setQueues(r.data.queues));
  }, []);

  return (
    <Layout title="Filas de Atendimento" subtitle="Monitoramento e configuração de filas do PBX">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {queues.map((q) => (
          <div key={q.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`queue-card-${q.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Fila · {q.extension}</div>
                <h3 className="font-display text-xl font-bold mt-1">{q.name}</h3>
                <div className="text-xs text-muted-foreground mt-1">Estratégia: <span className="font-mono">{q.strategy}</span></div>
              </div>
              <div className="flex items-center gap-1.5 bg-zinc-50 border border-border px-2 py-1 rounded-sm">
                <Users size={12} className="text-muted-foreground" />
                <span className="font-mono text-xs">{q.agent_count}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-border">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Aguardando</div>
                <div className={`font-mono text-2xl font-medium mt-1 ${q.waiting > 5 ? "text-amber-600" : "text-foreground"}`}>{q.waiting}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Atendidas</div>
                <div className="font-mono text-2xl font-medium mt-1">{q.answered_today}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">hoje</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Perdidas</div>
                <div className="font-mono text-2xl font-medium mt-1 text-red-600">{q.missed_today}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">hoje</div>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock size={12} /> espera média <span className="font-mono text-foreground">{fmtDuration(q.avg_wait_sec)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingDown size={12} /> timeout <span className="font-mono text-foreground">{q.max_wait}s</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
