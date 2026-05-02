import { useEffect, useState } from "react";
import { api, fmtDuration } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Star } from "lucide-react";

export default function Reports() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get("/reports/agents").then((r) => setRows(r.data.rows));
  }, []);

  const chartData = rows.slice(0, 8).map((r) => ({
    name: r.agent_name.split(" ")[0],
    Atendidas: r.answered_7d,
    Perdidas: r.missed_7d,
  }));

  return (
    <Layout title="Relatórios" subtitle="Performance e produtividade dos agentes nos últimos 7 dias">
      <div className="border border-border bg-card rounded-sm p-5 mb-4">
        <div className="mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Últimos 7 dias</div>
          <h3 className="font-display text-lg font-semibold">Chamadas por agente</h3>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
              <YAxis stroke="#a1a1aa" fontSize={11} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4 }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Atendidas" fill="#09090b" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Perdidas" fill="#ef4444" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display text-lg font-semibold">Ranking de Performance</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left">
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-5 py-3 w-10">#</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Agente</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Status</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Atendidas 7d</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Perdidas 7d</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">TMA</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">CSAT</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Aderência</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.agent_id} className="table-row-hover" data-testid={`report-row-${r.agent_id}`}>
                <td className="px-5 py-3 font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <img src={r.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                    <span className="font-medium">{r.agent_name}</span>
                  </div>
                </td>
                <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-3 text-right font-mono">{r.answered_7d}</td>
                <td className="px-3 py-3 text-right font-mono text-red-600">{r.missed_7d}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtDuration(r.avg_handle_sec)}</td>
                <td className="px-3 py-3 text-right">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Star size={12} className="text-amber-500 fill-amber-500" />{r.csat}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono">{r.adherence_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
