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
  const [tab, setTab] = useState("config"); // config | diag
  const [diag, setDiag] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [form, setForm] = useState({
    enabled: false, connection_type: "rest",
    base_url: "", api_key: "", username: "", password: "",
    domain_uuid: "", domain_name: "", verify_ssl: true, sync_interval_minutes: 1,
    path_extensions: "", path_queues: "", path_agents: "", path_cdr: "",
    db_host: "", db_port: 5432, db_name: "fusionpbx",
    db_username: "", db_password: "", db_ssl: false,
    esl_host: "", esl_port: 8021, esl_password: "", esl_timeout: 5.0,
    sftp_host: "", sftp_port: 22, sftp_username: "", sftp_password: "",
    sftp_private_key: "", sftp_recordings_path: "",
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
        enabled: !!data.enabled,
        connection_type: data.connection_type || "rest",
        base_url: data.base_url || "",
        api_key: "", username: data.username || "", password: "",
        domain_uuid: data.domain_uuid || "", domain_name: data.domain_name || "",
        verify_ssl: data.verify_ssl !== false,
        sync_interval_minutes: data.sync_interval_minutes || 1,
        path_extensions: data.path_extensions || "",
        path_queues: data.path_queues || "",
        path_agents: data.path_agents || "",
        path_cdr: data.path_cdr || "",
        db_host: data.db_host || "",
        db_port: data.db_port || 5432,
        db_name: data.db_name || "fusionpbx",
        db_username: data.db_username || "",
        db_password: "",
        db_ssl: !!data.db_ssl,
        esl_host: data.esl_host || "",
        esl_port: data.esl_port || 8021,
        esl_password: "",
        esl_timeout: data.esl_timeout || 5.0,
        sftp_host: data.sftp_host || "",
        sftp_port: data.sftp_port || 22,
        sftp_username: data.sftp_username || "",
        sftp_password: "",
        sftp_private_key: "",
        sftp_recordings_path: data.sftp_recordings_path || "",
      });
      setMeta({
        configured: data.configured, api_key_set: data.api_key_set, password_set: data.password_set,
        esl_password_set: data.esl_password_set, esl_configured: data.esl_configured,
        sftp_password_set: data.sftp_password_set, sftp_key_set: data.sftp_key_set,
        sftp_configured: data.sftp_configured,
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
      if (!payload.db_password) delete payload.db_password;
      if (!payload.esl_password) delete payload.esl_password;
      if (!payload.sftp_password) delete payload.sftp_password;
      if (!payload.sftp_private_key) delete payload.sftp_private_key;
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

  async function resyncAgents() {
    if (!window.confirm(
      "Esta ação vai REMOVER todos os agentes já sincronizados e buscar novamente do FusionPBX.\n\n" +
      "Use isto se você criou agentes (Apps → Call Center → Agents) e quer que eles substituam os ramais sincronizados anteriormente.\n\n" +
      "Continuar?"
    )) return;
    try {
      const { data } = await api.post(`/fusionpbx/resync-agents${qs}`);
      const src = data.summary?.agent_source === "call_center_agent" ? "agentes do Call Center" : "ramais (sem agentes cadastrados)";
      toast.success(`${data.deleted} antigos removidos · ${data.summary?.agents_synced || 0} novos importados (fonte: ${src})`);
      if (tab === "diag") loadDiag();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  async function fixCallDates() {
    try {
      const { data } = await api.post(`/fusionpbx/fix-call-dates${qs}`);
      if (data.fixed > 0) {
        toast.success(`${data.fixed} chamadas tiveram suas datas corrigidas. Recarregue o Dashboard.`);
      } else {
        toast.info("Nenhuma data precisava de correção.");
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  async function testESL() {
    setTesting(true);
    try {
      const { data } = await api.post(`/fusionpbx/esl/test${qs}`);
      const ch = data.active_channels;
      const status = data.status?.[0] || "ok";
      toast.success(`ESL conectado · ${ch != null ? ch + ' canais ativos' : 'OK'} · ${status.slice(0,80)}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ESL"); }
    finally { setTesting(false); }
  }

  async function testSFTP() {
    setTesting(true);
    try {
      const { data } = await api.post(`/fusionpbx/sftp/test${qs}`);
      toast.success(`SFTP conectado · ${data.found} gravação(ões) encontrada(s) na pasta`);
      if (data.samples?.length) {
        console.log("Sample recordings:", data.samples);
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro SFTP"); }
    finally { setTesting(false); }
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

          {/* Connection mode selector */}
          <div className="border-y border-border py-3">
            <Label className="text-xs uppercase tracking-widest font-medium">Modo de conexão</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" onClick={() => setForm({ ...form, connection_type: "rest" })}
                className={`border rounded p-3 text-left transition ${form.connection_type === "rest" ? "border-emerald-600 bg-emerald-50" : "border-border hover:bg-zinc-50"}`}
                data-testid="fpbx-mode-rest">
                <div className="font-medium text-sm">REST API</div>
                <div className="text-[10px] text-muted-foreground mt-1">Endpoints HTTP. Requer FusionPBX-API instalado.</div>
              </button>
              <button type="button" onClick={() => setForm({ ...form, connection_type: "db" })}
                className={`border rounded p-3 text-left transition ${form.connection_type === "db" ? "border-emerald-600 bg-emerald-50" : "border-border hover:bg-zinc-50"}`}
                data-testid="fpbx-mode-db">
                <div className="font-medium text-sm">PostgreSQL Direto ⭐</div>
                <div className="text-[10px] text-muted-foreground mt-1">Conecta direto no banco. Sem instalar nada no PBX.</div>
              </button>
            </div>
          </div>

          {form.connection_type === "db" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><Label>Host PostgreSQL <span className="text-red-600">*</span></Label>
                  <Input value={form.db_host} onChange={(e) => setForm({ ...form, db_host: e.target.value })}
                         placeholder="51.222.195.17 ou pbx.empresa.com.br" data-testid="fpbx-db-host" />
                </div>
                <div><Label>Porta</Label>
                  <Input type="number" value={form.db_port}
                         onChange={(e) => setForm({ ...form, db_port: parseInt(e.target.value) || 5432 })}
                         data-testid="fpbx-db-port" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Database</Label>
                  <Input value={form.db_name} onChange={(e) => setForm({ ...form, db_name: e.target.value })}
                         placeholder="fusionpbx" data-testid="fpbx-db-name" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={form.db_ssl} onCheckedChange={(v) => setForm({ ...form, db_ssl: v })} />
                    SSL/TLS
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Usuário (read-only) <span className="text-red-600">*</span></Label>
                  <Input value={form.db_username} onChange={(e) => setForm({ ...form, db_username: e.target.value })}
                         placeholder="voxyra_ro" data-testid="fpbx-db-user" />
                </div>
                <div><Label>Senha {meta.db_password_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurada</span>}</Label>
                  <Input type="password" value={form.db_password} onChange={(e) => setForm({ ...form, db_password: e.target.value })}
                         data-testid="fpbx-db-pass" />
                </div>
              </div>
              <div className="border border-blue-200 bg-blue-50 rounded p-3 text-xs text-blue-900">
                <strong>💡 Como criar usuário read-only no FusionPBX:</strong>
                <pre className="bg-white p-2 rounded mt-1 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">{`# No servidor FusionPBX (1 vez):
sudo -u postgres psql -d fusionpbx <<'SQL'
CREATE USER voxyra_ro WITH PASSWORD 'TROCAR_SENHA_FORTE';
GRANT CONNECT ON DATABASE fusionpbx TO voxyra_ro;
GRANT USAGE ON SCHEMA public TO voxyra_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO voxyra_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO voxyra_ro;
SQL

# Liberar conexão remota (descobre versão):
PG_VER=$(ls /etc/postgresql/ | head -1)
echo "host fusionpbx voxyra_ro IP_DO_VOXYRA/32 md5" | \
  sudo tee -a /etc/postgresql/$PG_VER/main/pg_hba.conf

# Listen all:
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" \\
  /etc/postgresql/$PG_VER/main/postgresql.conf

sudo systemctl restart postgresql`}</pre>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Domain UUID {form.connection_type === "db" && <span className="text-red-600">*</span>}</Label>
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

          <div className="border border-blue-200 bg-blue-50/40 rounded-sm p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-900">
                <PhoneCall size={12} />
                ESL · Chamadas em tempo real <span className="font-normal text-[10px] text-muted-foreground">(Event Socket do FreeSWITCH · porta 8021)</span>
              </div>
              {meta.esl_configured && (
                <span className="text-[10px] uppercase tracking-widest text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">ativo</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-[11px]">Host ESL</Label>
                <Input value={form.esl_host}
                       onChange={(e) => setForm({ ...form, esl_host: e.target.value })}
                       placeholder="51.222.195.17 (geralmente o mesmo do FusionPBX)" data-testid="fpbx-esl-host" />
              </div>
              <div>
                <Label className="text-[11px]">Porta</Label>
                <Input type="number" value={form.esl_port}
                       onChange={(e) => setForm({ ...form, esl_port: parseInt(e.target.value) || 8021 })}
                       data-testid="fpbx-esl-port" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-[11px]">Senha ESL {meta.esl_password_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurada</span>}</Label>
                <Input type="password" value={form.esl_password}
                       onChange={(e) => setForm({ ...form, esl_password: e.target.value })}
                       placeholder={meta.esl_password_set ? "(deixe vazio para manter)" : "ClueCon (default)"} data-testid="fpbx-esl-password" />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" onClick={testESL}
                        disabled={testing || !form.esl_host} className="w-full" data-testid="fpbx-esl-test">
                  {testing ? "Testando…" : "Testar ESL"}
                </Button>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-blue-100 pt-2">
              💡 No FusionPBX edite <code className="bg-zinc-100 px-1 py-0.5 rounded">/etc/freeswitch/autoload_configs/event_socket.conf.xml</code>:
              defina <code className="bg-zinc-100 px-1 py-0.5 rounded">listen-ip = 0.0.0.0</code>, anote o <code className="bg-zinc-100 px-1 py-0.5 rounded">password</code>, e libere a porta 8021 só para o IP {window.location.hostname}.
            </div>
          </div>

          <div className="border border-purple-200 bg-purple-50/40 rounded-sm p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-purple-900">
                <Disc3 size={12} />
                SFTP · Gravações de chamadas <span className="font-normal text-[10px] text-muted-foreground">(SSH/SFTP para baixar áudios do PBX sob demanda)</span>
              </div>
              {meta.sftp_configured && (
                <span className="text-[10px] uppercase tracking-widest text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">ativo</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-[11px]">Host SFTP</Label>
                <Input value={form.sftp_host}
                       onChange={(e) => setForm({ ...form, sftp_host: e.target.value })}
                       placeholder="51.222.195.17 (geralmente o mesmo do FusionPBX)" data-testid="fpbx-sftp-host" />
              </div>
              <div>
                <Label className="text-[11px]">Porta SSH</Label>
                <Input type="number" value={form.sftp_port}
                       onChange={(e) => setForm({ ...form, sftp_port: parseInt(e.target.value) || 22 })}
                       data-testid="fpbx-sftp-port" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Usuário SSH</Label>
                <Input value={form.sftp_username}
                       onChange={(e) => setForm({ ...form, sftp_username: e.target.value })}
                       placeholder="voxyra_recordings" data-testid="fpbx-sftp-user" />
              </div>
              <div>
                <Label className="text-[11px]">Senha SSH {meta.sftp_password_set && <span className="text-[10px] text-emerald-600 ml-1">✓</span>}</Label>
                <Input type="password" value={form.sftp_password}
                       onChange={(e) => setForm({ ...form, sftp_password: e.target.value })}
                       placeholder={meta.sftp_password_set ? "(deixe vazio para manter)" : "senha da conta SSH"}
                       data-testid="fpbx-sftp-password" />
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Path das gravações <span className="text-muted-foreground">(opcional · auto-detecta se vazio)</span></Label>
              <Input value={form.sftp_recordings_path}
                     onChange={(e) => setForm({ ...form, sftp_recordings_path: e.target.value })}
                     placeholder="/var/lib/freeswitch/recordings" data-testid="fpbx-sftp-path" />
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={testSFTP}
                      disabled={testing || !form.sftp_host || !form.sftp_username}
                      data-testid="fpbx-sftp-test">
                {testing ? "Testando…" : "Testar SFTP"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Lista até 5 gravações encontradas para validar acesso e path
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-purple-100 pt-2">
              💡 Crie um usuário read-only no PBX:
              <code className="bg-zinc-100 px-1 py-0.5 rounded ml-1">
                useradd -m -s /sbin/nologin voxyra_recordings && chmod o+rx /var/lib/freeswitch/recordings
              </code>.
              Depois libere acesso somente leitura nessa pasta.
            </div>
          </div>

          {form.connection_type === "rest" && (
            <div className="border border-amber-200 bg-amber-50 rounded-sm p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
              <Settings2 size={12} />
              Endpoints REST customizados <span className="font-normal text-[10px] text-muted-foreground">(opcional · se seu FusionPBX não usar os paths padrão)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Path Extensions/Ramais</Label>
                <Input value={form.path_extensions}
                  onChange={(e) => setForm({ ...form, path_extensions: e.target.value })}
                  placeholder="/app/extensions/api.php" className="font-mono text-xs" data-testid="fpbx-path-ext" />
              </div>
              <div>
                <Label className="text-[10px]">Path Queues/Filas</Label>
                <Input value={form.path_queues}
                  onChange={(e) => setForm({ ...form, path_queues: e.target.value })}
                  placeholder="/app/call_center/api.php" className="font-mono text-xs" data-testid="fpbx-path-queues" />
              </div>
              <div>
                <Label className="text-[10px]">Path Agents</Label>
                <Input value={form.path_agents}
                  onChange={(e) => setForm({ ...form, path_agents: e.target.value })}
                  placeholder="(opcional, usa Extensions se vazio)" className="font-mono text-xs" data-testid="fpbx-path-agents" />
              </div>
              <div>
                <Label className="text-[10px]">Path CDR/Chamadas</Label>
                <Input value={form.path_cdr}
                  onChange={(e) => setForm({ ...form, path_cdr: e.target.value })}
                  placeholder="/app/xml_cdr/api.php" className="font-mono text-xs" data-testid="fpbx-path-cdr" />
              </div>
            </div>
            <div className="text-[10px] text-amber-800 mt-1">
              Dica: aponte para seus scripts PHP que retornam JSON. Exemplo de script: <code className="font-mono bg-white px-1">SELECT * FROM v_extensions WHERE domain_uuid='UUID'</code> encoded como JSON.
            </div>
          </div>
          )}

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
            <Button variant="outline" onClick={resyncAgents} disabled={!form.enabled || !meta.configured}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50" data-testid="fpbx-resync-agents">
              <Users size={14} className="mr-1.5" /> Re-sincronizar agentes
            </Button>
            <Button variant="outline" onClick={fixCallDates}
                    className="text-amber-700 border-amber-200 hover:bg-amber-50" data-testid="fpbx-fix-dates">
              <RefreshCw size={14} className="mr-1.5" /> Corrigir datas das chamadas
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
