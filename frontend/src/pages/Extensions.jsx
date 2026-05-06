import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Phone, RefreshCw, Search, UserCircle2, Wifi, WifiOff } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function Extensions() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  async function load() {
    try {
      const { data } = await api.get("/extensions");
      setRows(data.extensions || []);
      if (data.warning) toast.warning(data.warning);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); setReloading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.extension || "").toLowerCase().includes(s)
      || (r.caller_id_name || "").toLowerCase().includes(s)
      || (r.agent_name || "").toLowerCase().includes(s);
  });

  const totalRegistered = rows.filter((r) => r.registered).length;

  return (
    <Layout title="Ramais" subtitle="Lista de ramais SIP do FusionPBX e status de registro">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3" data-testid="extensions-toolbar">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar ramal, nome ou agente..." className="pl-9"
              data-testid="extensions-search" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            <span className="font-mono font-bold text-emerald-700">{totalRegistered}</span> de <span className="font-mono">{rows.length}</span> registrados
          </span>
          <Button variant="outline" size="sm"
            onClick={() => { setReloading(true); load(); }}
            disabled={reloading} data-testid="extensions-refresh">
            <RefreshCw size={12} className={`mr-1.5 ${reloading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">Ramal</th>
              <th className="px-4 py-3">Nome (Caller-ID)</th>
              <th className="px-4 py-3">Agente vinculado</th>
              <th className="px-4 py-3">Registro SIP</th>
              <th className="px-4 py-3">Habilitado</th>
              <th className="px-4 py-3">Descrição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                {rows.length === 0 ? "Nenhum ramal cadastrado no FusionPBX." : "Nenhum ramal encontrado para este filtro."}
              </td></tr>
            ) : filtered.map((r) => (
              <tr key={r.uuid || r.extension} className="hover:bg-zinc-50" data-testid={`extension-row-${r.extension}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-muted-foreground" />
                    <span className="font-mono font-bold">{r.extension}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{r.caller_id_name || "—"}</td>
                <td className="px-4 py-3">
                  {r.agent_name ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <UserCircle2 size={13} className="text-foreground" />
                      {r.agent_name}
                    </span>
                  ) : <span className="text-[11px] text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3">
                  {r.registered ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                      <Wifi size={12} /> Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                      <WifiOff size={12} /> Offline
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.enabled
                    ? <span className="text-emerald-700">Sim</span>
                    : <span className="text-zinc-500">Não</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground truncate max-w-xs">
                  {r.description || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
