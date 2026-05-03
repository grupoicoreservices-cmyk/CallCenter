import { useEffect, useState } from "react";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Phone, Save, RefreshCw, CheckCircle2, AlertCircle, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function FusionPBXSettings() {
  const { user, tenantContext } = useAuth();
  // Super admin precisa estar em contexto de tenant. Tenant admin usa o seu próprio.
  const activeTenantId = user?.role === "super_admin" ? tenantContext : user?.tenant_id;
  const qs = activeTenantId ? `?tenant_id=${activeTenantId}` : "";
  const [form, setForm] = useState({
    enabled: false, base_url: "", api_key: "", username: "", password: "",
    domain_uuid: "", domain_name: "", verify_ssl: true, sync_interval_minutes: 5,
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
        sync_interval_minutes: data.sync_interval_minutes || 5,
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
      const { data } = await api.post("/fusionpbx/sync");
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
                     onChange={(e) => setForm({ ...form, sync_interval_minutes: parseInt(e.target.value) || 5 })} />
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
    </Layout>
  );
}
