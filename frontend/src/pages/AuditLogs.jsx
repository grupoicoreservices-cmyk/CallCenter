import { useEffect, useState } from "react";
import { api, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import { ShieldCheck, History, RefreshCw, UserPlus, UserCog, UserX, LogIn } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const ACTION_META = {
  create: { label: "Criação", icon: UserPlus, cls: "bg-emerald-100 text-emerald-700" },
  update: { label: "Atualização", icon: UserCog, cls: "bg-blue-100 text-blue-700" },
  delete: { label: "Exclusão", icon: UserX, cls: "bg-red-100 text-red-700" },
  login:  { label: "Login", icon: LogIn, cls: "bg-zinc-100 text-zinc-700" },
};

export default function AuditLogs() {
  const { hasPermission } = useAuth();
  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (actionFilter !== "all") params.action = actionFilter;
      const { data } = await api.get("/audit-logs", { params });
      setLogs(data.logs);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (hasPermission("users.manage")) load(); }, [actionFilter, hasPermission]);

  if (!hasPermission("users.manage")) {
    return (
      <Layout title="Auditoria">
        <div className="border border-border bg-card rounded-sm p-12 text-center">
          <ShieldCheck size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="text-sm text-muted-foreground mt-1">Apenas administradores podem visualizar logs de auditoria.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Logs de Auditoria"
      subtitle="Histórico completo de ações administrativas e logins"
      actions={
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw size={14} className="mr-1.5" /> Atualizar
        </Button>
      }
    >
      <div className="flex items-center gap-2 mb-4">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[200px]" data-testid="audit-filter-action"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as ações</SelectItem>
            <SelectItem value="create">Criação</SelectItem>
            <SelectItem value="update">Atualização</SelectItem>
            <SelectItem value="delete">Exclusão</SelectItem>
            <SelectItem value="login">Login</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          <History size={12} className="inline mr-1" />
          <span className="font-mono">{logs.length}</span> evento{logs.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left">
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-5 py-3">Data/Hora</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Ação</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Alvo</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Por</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Alterações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground font-mono">carregando…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground" data-testid="audit-empty">Nenhum log para os filtros selecionados.</td></tr>
            ) : logs.map((l) => {
              const meta = ACTION_META[l.action] || { label: l.action, icon: History, cls: "bg-zinc-100 text-zinc-700" };
              const Icon = meta.icon;
              return (
                <tr key={l.id} className="table-row-hover" data-testid={`audit-row-${l.id}`}>
                  <td className="px-5 py-3 font-mono text-xs">{fmtDateTime(l.created_at)}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                      <Icon size={11} /> {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm">{l.target_label || "—"}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{l.target_type}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm">{l.actor_name || "—"}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{l.actor_email}</div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {l.changes && Object.keys(l.changes).length > 0 ? (
                      <ul className="space-y-0.5">
                        {Object.entries(l.changes).map(([k, v]) => (
                          <li key={k} className="font-mono">
                            <span className="text-muted-foreground">{k}:</span> {renderChange(v)}
                          </li>
                        ))}
                      </ul>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

function renderChange(v) {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("from" in v && "to" in v) {
      return <><span className="text-red-600">{String(v.from)}</span> → <span className="text-emerald-600">{String(v.to)}</span></>;
    }
    return JSON.stringify(v);
  }
  return String(v);
}
