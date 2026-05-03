import { useEffect, useState } from "react";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Phone, Save, RefreshCw, CheckCircle2, AlertCircle, Server, Trash2,
  Activity, Users, PhoneCall, Disc3, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function FusionPBXSettings() {
  const { user, tenantContext } = useAuth();
  // Super admin precisa estar em contexto de tenant. Tenant admin usa o seu próprio.
  const activeTenantId = user?.role === "super_admin" ? tenantContext : user?.tenant_id;
  const qs = activeTenantId ? `?tenant_id=${activeTenantId}` : "";
  const [form, setForm] = useState({
    enabled: false, base_url: "", api_key: "", username: "", password: "",
    domain_uuid: "", domain_name: "", verify_ssl: true, sync_interval_minutes: 1,
  });
  const [meta, setMeta] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  async function load() {
    try {
      const { data } = await api.get(`/fusionpbx/settings${qs}`);
      setForm({
        enabled: !!data.enabled, base_url: data.base_url || "",
        api_key: "", username: data.username || "", password: "",
        domain_uuid: data.domain_uuid || "", domain_name: data.domain_name || "",
        verify_ssl: data.verify_ssl !== false,
        sync_interval_minutes: data.sync_interval_minutes || 1,
      });
      setMeta({
        configured: data.configured, api_key_set: data.api_key_set, password_set: data.password_set,
        last_sync_at: data.last_sync_at, last_sync_status: data.last_sync_status,
      });
    } catch (e) { /* ignore */ }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form };
      // Only send secrets if user typed something
      if (!payload.api_key) delete payload.api_key;
      if (!payload.password) delete payload.password;
      await api.put(`/fusionpbx/settings${qs}`, payload);
      toast.success("Configuração salva");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const { data } = await api.post(`/fusionpbx/test${qs}`);
      toast.success("Conexão OK · " + (data.status_code ? `HTTP ${data.status_code}` : "respondeu"));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Falha"); }
    finally { setTesting(false); }
  }

  async function sync() {
    setSyncing(true);
    setLastSync(null);
    try {
      const { data } = await api.post(`/fusionpbx/sync${qs}`);
      setLastSync(data);
      if (data.status === "ok") {
        toast.success(`Sincronizado: ${data.agents_synced} agentes, ${data.queues_synced} filas, ${data.calls_synced} chamadas`);
      } else {
        toast.warning(`Sync com erros: ${(data.errors || []).join(" · ")}`);
      }
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSyncing(false); }
  }

  async function clearDemo() {
    if (!window.confirm(
      "Deseja REMOVER todos os dados simulados (agentes, filas, chamadas e gravações de demonstração)?\n\n" +
      "Os dados reais sincronizados da sua Central PBX NÃO serão afetados.\n\n" +
      "Esta ação não pode ser desfeita."
    )) return;
    try {
      const { data } = await api.post(`/fusionpbx/clear-demo-data${qs}`);
      const total = Object.values(data.deleted || {}).reduce((a, b) => a + b, 0);
      toast.success(`${total} registros simulados removidos (${data.deleted.agents} agentes · ${data.deleted.queues} filas · ${data.deleted.calls} chamadas · ${data.deleted.recordings} gravações)`);
      if (tab === "diag") loadDiag();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  async function loadDiag() {
    setDiagLoading(true);
    try {
      const { data } = await api.get(`/fusionpbx/diagnostics${qs}`);
      setDiag(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setDiagLoading(false); }
  }

  useEffect(() => {
    if (tab === "diag") {
      loadDiag();
      const id = setInterval(loadDiag, 15000); // refresh a cada 15s
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (user?.role !== "super_admin" && user?.role !== "admin") {
    return <Layout title="Central PBX"><div className="border border-border bg-card rounded-sm p-12 text-center">
      <Server size={32} className="mx-auto text-muted-foreground mb-3" />
      <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
    </div></Layout>;
  }

  if (user?.role === "super_admin" && !tenantContext) {
    return <Layout title="Central PBX"><div className="border border-amber-200 bg-amber-50 rounded-sm p-12 text-center">
      <Server size={32} className="mx-auto text-amber-600 mb-3" />
      <h3 className="font-display text-lg font-semibold">Selecione um tenant</h3>
      <p className="text-sm text-muted-foreground mt-2">Você precisa entrar no contexto de um tenant antes de configurar a Central PBX.</p>
      <a href="/tenants" className="inline-block mt-4 text-sm underline">Ir para Tenants →</a>
    </div></Layout>;
  }

  return (
    <Layout title="Integração com Central PBX" subtitle="Voxyra CCA · Conecte ao seu servidor de telefonia via REST API">
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button onClick={() => setTab("config")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === "config" ? "border-emerald-600 text-emerald-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-config">
          <Settings2 size={14} className="inline mr-1.5" /> Configuração
        </button>
        <button onClick={() => setTab("diag")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === "diag" ? "border-emerald-600 text-emerald-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-diag">
          <Activity size={14} className="inline mr-1.5" /> Diagnóstico & Dados Recebidos
        </button>
      </div>

      {tab === "diag" ? (
        <DiagnosticsPanel diag={diag} loading={diagLoading} onReload={loadDiag} />
      ) : (
      <>
      <div className="border border-blue-200 bg-blue-50 rounded-sm p-4 mb-4 flex items-start gap-3">
        <AlertCircle size={16} className="text-blue-600 mt-0.5" />
        <div className="text-xs text-blue-900">
          <strong>Como funciona:</strong> O Voxyra CCA tenta endpoints REST padrão da comunidade
          (<code className="font-mono bg-white px-1">/api/extensions</code>, <code className="font-mono bg-white px-1">/api/call_center_queues</code>, <code className="font-mono bg-white px-1">/api/xml_cdr</code>).
          Caso seu servidor PBX não exponha REST nativamente, instale um módulo de API REST ou
          adicione scripts customizados. Use a aba <strong>Testar Conexão</strong> antes de sincronizar.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Form */}
        <div className="lg:col-span-2 border border-border bg-card rounded-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Phone size={16} className="text-emerald-600" />
              <h3 className="font-display text-lg font-semibold">Servidor PBX</h3>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="fpbx-enabled" />
              {form.enabled ? "Ativada" : "Desativada"}
            </label>
          </div>

          <div><Label>URL Base do servidor</Label>
            <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                   placeholder="https://pbx.empresa.com.br" data-testid="fpbx-url" />
            <div className="text-[10px] text-muted-foreground mt-1">URL pública (https). Sem barra final.</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>API Key {meta.api_key_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurada</span>}</Label>
              <Input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                     placeholder="Bearer token" type="password" data-testid="fpbx-key" />
            </div>
            <div><Label>Username (Basic auth · alternativo)</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                     placeholder="admin" data-testid="fpbx-user" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Password {meta.password_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurada</span>}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="fpbx-pass" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.verify_ssl} onCheckedChange={(v) => setForm({ ...form, verify_ssl: v })} />
                Verificar SSL
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Domain UUID</Label>
              <Input value={form.domain_uuid} onChange={(e) => setForm({ ...form, domain_uuid: e.target.value })}
                     placeholder="xxxxxxxx-xxxx-..." className="font-mono text-xs" data-testid="fpbx-domain-uuid" />
            </div>
            <div><Label>Domain Name</Label>
              <Input value={form.domain_name} onChange={(e) => setForm({ ...form, domain_name: e.target.value })}
                     placeholder="empresa.com.br" data-testid="fpbx-domain-name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Intervalo Sync (min)</Label>
              <Input type="number" min={1} value={form.sync_interval_minutes}
                     onChange={(e) => setForm({ ...form, sync_interval_minutes: parseInt(e.target.value) || 1 })} />
            </div>
          </div>

          <div className="border-t border-border pt-3 flex gap-2 flex-wrap">
            <Button onClick={save} disabled={saving} data-testid="fpbx-save">
              <Save size={14} className="mr-1.5" />{saving ? "Salvando…" : "Salvar"}
            </Button>
            <Button variant="outline" onClick={test} disabled={testing || !meta.configured} data-testid="fpbx-test">
              {testing ? "Testando…" : "Testar Conexão"}
            </Button>
            <Button variant="default" onClick={sync} disabled={syncing || !form.enabled || !meta.configured} data-testid="fpbx-sync">
              <RefreshCw size={14} className="mr-1.5" />{syncing ? "Sincronizando…" : "Sincronizar Agora"}
            </Button>
            <Button variant="outline" onClick={clearDemo} className="text-red-600 border-red-200 hover:bg-red-50 ml-auto" data-testid="fpbx-clear-demo">
              <Trash2 size={14} className="mr-1.5" /> Limpar dados simulados
            </Button>
          </div>
        </div>

        {/* Status */}
        <div className="border border-border bg-card rounded-sm p-5">
          <h3 className="font-display text-lg font-semibold mb-3">Status</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Estado</div>
              <div className="flex items-center gap-2 mt-1">
                {form.enabled ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-zinc-400" />}
                <span>{form.enabled ? "Integração ativa" : "Desativada"}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Última sincronização</div>
              <div className="font-mono text-xs mt-1">{meta.last_sync_at ? fmtDateTime(meta.last_sync_at) : "—"}</div>
              {meta.last_sync_status && (
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] mt-1 ${meta.last_sync_status === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {meta.last_sync_status}
                </span>
              )}
            </div>
            {lastSync && (
              <div className="border-t border-border pt-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-2">Último resultado</div>
                <div className="space-y-1 text-xs">
                  <div>Agentes: <span className="font-mono">{lastSync.agents_synced}</span></div>
                  <div>Filas: <span className="font-mono">{lastSync.queues_synced}</span></div>
                  <div>Chamadas: <span className="font-mono">{lastSync.calls_synced}</span></div>
                  {lastSync.errors?.length > 0 && (
                    <div className="text-amber-700 mt-2">
                      <div className="font-medium">Erros:</div>
                      {lastSync.errors.map((e, i) => <div key={i} className="break-all">• {e}</div>)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </Layout>
  );
}

function DiagnosticsPanel({ diag, loading, onReload }) {
  if (loading && !diag) {
    return <div className="text-center text-muted-foreground py-12 font-mono text-sm">carregando diagnóstico…</div>;
  }
  if (!diag) return null;

  const { settings: s, counts, recent_calls: calls, recent_agents: agents, recent_queues: queues, sync_history: history } = diag;
  const totalReal = (counts.agents?.real || 0) + (counts.queues?.real || 0) + (counts.calls?.real || 0);
  const receivingData = totalReal > 0;
  const autoInterval = s.last_sync_summary?.sync_interval_minutes || 1;

  return (
    <div className="space-y-4">
      {/* Auto-sync banner */}
      {s.enabled && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-sm p-3 flex items-center gap-3 text-sm">
          <RefreshCw size={14} className="text-emerald-600 animate-spin" style={{ animationDuration: "3s" }} />
          <span className="text-emerald-900">
            <strong>Sincronização automática ativa</strong> — cada alteração no FusionPBX (fila, agente, chamada) é importada a cada {autoInterval} min.
          </span>
        </div>
      )}

      {/* Banner de status geral */}
      <div className={`border rounded-sm p-4 flex items-start gap-3 ${receivingData ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        {receivingData ? <CheckCircle2 size={20} className="text-emerald-600 mt-0.5" /> : <AlertCircle size={20} className="text-amber-600 mt-0.5" />}
        <div className="flex-1">
          <div className="font-medium text-sm">
            {receivingData ? "✅ Recebendo dados da Central PBX" : "⚠️  Nenhum dado real sincronizado ainda"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {receivingData
              ? `${counts.agents.real} agentes · ${counts.queues.real} filas · ${counts.calls.real} chamadas · ${counts.recordings.real} gravações sincronizadas do PBX.`
              : "Configure a integração na aba 'Configuração', clique em 'Testar Conexão' e depois 'Sincronizar Agora'."}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onReload}><RefreshCw size={12} className="mr-1.5" /> Recarregar</Button>
      </div>

      {/* Cards de contagem */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Agentes" counts={counts.agents} color="emerald" />
        <StatCard icon={Phone} label="Filas" counts={counts.queues} color="blue" />
        <StatCard icon={PhoneCall} label="Chamadas" counts={counts.calls} color="purple" />
        <StatCard icon={Disc3} label="Gravações" counts={counts.recordings} color="amber" />
      </div>

      {/* Última sincronização */}
      <div className="border border-border bg-card rounded-sm p-5">
        <h3 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <RefreshCw size={16} /> Última Sincronização
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Quando</div>
            <div className="font-mono text-xs mt-1">{s.last_sync_at ? fmtDateTime(s.last_sync_at) : "nunca"}</div></div>
          <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</div>
            <div className="mt-1">
              {s.last_sync_status === "ok" ? <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px]">ok</span>
               : s.last_sync_status ? <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px]">{s.last_sync_status}</span>
               : "—"}
            </div></div>
          <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">URL</div>
            <div className="font-mono text-xs mt-1 break-all">{s.base_url || "—"}</div></div>
          <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Habilitada</div>
            <div className="mt-1">{s.enabled ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-red-600" />}</div></div>
        </div>
        {s.last_sync_summary?.errors?.length > 0 && (
          <div className="mt-3 border border-red-200 bg-red-50 rounded p-3 text-xs">
            <div className="font-medium text-red-800 mb-1">Erros na última sync:</div>
            {s.last_sync_summary.errors.map((err, i) => <div key={i} className="font-mono text-red-700 break-all">• {err}</div>)}
          </div>
        )}
      </div>

      {/* Filas */}
      {queues.length > 0 && (
        <div className="border border-border bg-card rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-zinc-50 border-b border-border text-xs uppercase tracking-widest font-medium">
            Filas sincronizadas ({queues.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Nome</th><th className="px-4 py-2 text-left">Ramal</th><th className="px-4 py-2 text-left">Estratégia</th><th className="px-4 py-2 text-left font-mono">UUID</th></tr>
            </thead>
            <tbody>
              {queues.map(q => (
                <tr key={q.id} className="border-t border-border">
                  <td className="px-4 py-2">{q.name}</td>
                  <td className="px-4 py-2 font-mono">{q.extension}</td>
                  <td className="px-4 py-2 text-xs">{q.strategy}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground break-all">{q.external_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Últimas 10 chamadas reais */}
      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-zinc-50 border-b border-border text-xs uppercase tracking-widest font-medium flex items-center justify-between">
          <span>Últimas chamadas recebidas do PBX</span>
          <span className="text-muted-foreground normal-case font-normal">atualiza a cada 15s</span>
        </div>
        {calls.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">Nenhuma chamada real sincronizada ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Quando</th>
                <th className="px-4 py-2 text-left">Direção</th>
                <th className="px-4 py-2 text-left">Origem</th>
                <th className="px-4 py-2 text-left">Destino</th>
                <th className="px-4 py-2 text-left">Fila</th>
                <th className="px-4 py-2 text-left">Agente</th>
                <th className="px-4 py-2 text-left">Dur.</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(c => (
                <tr key={c.id} className="border-t border-border hover:bg-zinc-50">
                  <td className="px-4 py-2 font-mono text-xs">{c.started_at ? fmtDateTime(c.started_at) : "—"}</td>
                  <td className="px-4 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded-sm text-[10px] ${c.direction === "inbound" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>{c.direction}</span></td>
                  <td className="px-4 py-2 font-mono text-xs">{c.caller_number || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.callee_number || "—"}</td>
                  <td className="px-4 py-2 text-xs">{c.queue_name || "—"}</td>
                  <td className="px-4 py-2 text-xs">{c.agent_name || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{Math.floor((c.duration_sec || 0) / 60)}:{String((c.duration_sec || 0) % 60).padStart(2, "0")}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded-sm text-[10px] ${c.disposition === "answered" ? "bg-emerald-100 text-emerald-700" : c.disposition === "missed" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{c.disposition}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Agentes recentes */}
      {agents.length > 0 && (
        <div className="border border-border bg-card rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-zinc-50 border-b border-border text-xs uppercase tracking-widest font-medium">
            Agentes (ramais) sincronizados
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Ramal</th><th className="px-4 py-2 text-left">Nome</th><th className="px-4 py-2 text-left">Usuário</th><th className="px-4 py-2 text-left">Email</th><th className="px-4 py-2 text-left">Atualizado</th></tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{a.extension}</td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{a.username || "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{a.email || "—"}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{a.updated_at ? fmtDateTime(a.updated_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Histórico de syncs */}
      {history.length > 0 && (
        <div className="border border-border bg-card rounded-sm p-5">
          <h3 className="font-display text-base font-semibold mb-3">Histórico de sincronizações (últimas 5)</h3>
          <div className="space-y-2 text-xs font-mono">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                <span>{fmtDateTime(h.created_at)}</span>
                <span className="text-muted-foreground">por {h.actor_name || h.actor_email}</span>
                <span>
                  {h.changes?.agents || 0} agentes · {h.changes?.queues || 0} filas · {h.changes?.calls || 0} chamadas
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, counts, color }) {
  const colorMap = {
    emerald: "text-emerald-600", blue: "text-blue-600",
    purple: "text-purple-600", amber: "text-amber-600",
  };
  const real = counts?.real || 0;
  const demo = counts?.demo || 0;
  return (
    <div className="border border-border bg-card rounded-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={colorMap[color]} />
        <span className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold">{real}</div>
      <div className="text-[10px] text-muted-foreground mt-1">reais do PBX</div>
      {demo > 0 && (
        <div className="text-[10px] text-amber-600 mt-0.5">+ {demo} simulados</div>
      )}
    </div>
  );
}
