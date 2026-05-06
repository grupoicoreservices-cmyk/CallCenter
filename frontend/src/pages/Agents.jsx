import { useEffect, useState } from "react";
import { api, fmtDuration, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Search, Plus, Trash2, Loader2, Copy, KeyRound, Pencil, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function Agents() {
  const { user, tenantContext } = useAuth();
  const activeTenantId = user?.role === "super_admin" ? tenantContext : user?.tenant_id;
  const qs = activeTenantId ? `?tenant_id=${activeTenantId}` : "";
  const canEdit = ["super_admin", "admin"].includes(user?.role);

  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // agent being edited
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState(null); // último resultado da criação
  const [form, setForm] = useState({
    name: "", extension: "", agent_id: "",
    voxyra_email: "", voxyra_password: "",
    sip_password: "", pbx_password: "",
    queue_uuids: [],
    create_pbx_user: true,
    create_voxyra_user: true,
  });

  async function load() {
    try {
      const [a, q] = await Promise.all([api.get("/agents"), api.get("/queues")]);
      setAgents(a.data.agents); setQueues(q.data.queues);
    } catch (e) { /* ignore */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function handleResync(a) {
    try {
      const { data } = await api.post(`/agents/${a.id}/pbx-resync`);
      const ct = data.contact ? `contact=${data.contact.split("@")[0].replace("user/", "")}` : "sem contato";
      toast.success(`Sincronizado: ${a.name} (${ct}, status=${data.status || "?"})`);
      if (data.errors?.length) data.errors.forEach(e => toast.warning(e));
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro na sincronização"); }
  }

  function openNew() {
    setEditing(null);
    setForm({
      name: "", extension: "", agent_id: "", voxyra_email: "", voxyra_password: "",
      sip_password: "", pbx_password: "", queue_uuids: [],
      create_pbx_user: true, create_voxyra_user: true,
    });
    setCredentials(null);
    setOpen(true);
  }

  async function openEdit(agent) {
    setEditing(agent);
    setCredentials(null);
    let voxyraEmail = "";
    try {
      const { data } = await api.get(`/agents/${agent.id}/linked-user`);
      voxyraEmail = data?.email || "";
    } catch (_) { /* ignore */ }
    const queue_uuids = (agent.queues || [])
      .map((qid) => queues.find((q) => q.id === qid)?.external_id)
      .filter(Boolean);
    setForm({
      name: agent.name || "",
      extension: agent.extension || "",
      agent_id: agent.username || agent.agent_login || "",
      voxyra_email: voxyraEmail,
      voxyra_password: "",
      sip_password: "",
      pbx_password: "",
      queue_uuids,
      create_pbx_user: false,
      create_voxyra_user: false,
    });
    setOpen(true);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!form.name) { toast.error("Nome é obrigatório"); return; }
    if (!editing && !form.agent_id) { toast.error("ID de login do agente é obrigatório"); return; }
    setSaving(true);
    try {
      if (editing) {
        // Edit mode
        const payload = {
          name: form.name,
          queue_uuids: form.queue_uuids,
        };
        if (form.voxyra_email) payload.voxyra_email = form.voxyra_email;
        if (form.voxyra_password) payload.voxyra_password = form.voxyra_password;
        if (form.sip_password) payload.sip_password = form.sip_password;
        const { data } = await api.put(`/agents/${editing.id}${qs}`, payload);
        toast.success(`Agente "${form.name}" atualizado`);
        if (data.warnings && data.warnings.length > 0) {
          data.warnings.forEach((w) => toast.warning(w));
        }
        setOpen(false);
        load();
      } else {
        // Create mode (legacy provision endpoint expects extension; if not given,
        // use agent_id as extension placeholder so backend creation works.)
        const payload = { ...form };
        if (!payload.extension) payload.extension = payload.agent_id;
        ["voxyra_email", "voxyra_password", "sip_password", "pbx_password"].forEach(k => {
          if (!payload[k]) delete payload[k];
        });
        const { data } = await api.post(`/fusionpbx/provision/agent${qs}`, payload);
        toast.success(`Agente "${form.name}" criado com sucesso`);
        setCredentials(data);
        load();
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar"); }
    finally { setSaving(false); }
  }

  async function handleDelete(a) {
    if (!window.confirm(`Excluir agente "${a.name}" do Voxyra E do FusionPBX (extension + cc_agent + login)?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await api.delete(`/fusionpbx/provision/agent/${a.id}${qs}`);
      toast.success("Agente removido");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  function copyText(t) {
    navigator.clipboard.writeText(t);
    toast.success("Copiado!");
  }

  const filtered = agents.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || (a.extension || "").includes(search)
  );

  return (
    <Layout title="Agentes" subtitle="Equipe e métricas individuais">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar agente…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="agents-search" />
        </div>
        {canEdit && (
          <Button onClick={openNew} data-testid="agent-create-btn">
            <Plus size={14} className="mr-1.5" /> Novo agente
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((a) => (
          <div key={a.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`agent-card-${a.id}`}>
            <div className="flex items-center gap-3">
              <img src={a.avatar} alt={a.name} className="w-12 h-12 rounded-full object-cover" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground font-mono">ext. {a.extension} · @{a.username}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={a.status} />
                {canEdit && a.external_id && (
                  <button onClick={() => handleResync(a)} className="text-zinc-500 hover:text-blue-600 p-1" title="Re-sincronizar com PBX" data-testid={`agent-resync-${a.id}`}>
                    <RefreshCw size={14} />
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => openEdit(a)} className="text-zinc-500 hover:text-foreground p-1" title="Editar" data-testid={`agent-edit-${a.id}`}>
                    <Pencil size={14} />
                  </button>
                )}
                {canEdit && a.external_id && (
                  <button onClick={() => handleDelete(a)} className="text-red-500 hover:text-red-700 p-1" title="Excluir" data-testid={`agent-delete-${a.id}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
              <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Chamadas</div>
                <div className="font-mono text-lg font-medium mt-1">{a.calls_handled}</div></div>
              <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">TMA</div>
                <div className="font-mono text-lg font-medium mt-1">{fmtDuration(a.avg_handle_sec)}</div></div>
              <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">CSAT</div>
                <div className="font-mono text-lg font-medium mt-1">{a.csat}</div></div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-10">Nenhum agente encontrado.</div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{credentials ? "✅ Agente criado" : (editing ? `Editar: ${editing.name}` : "Novo agente")}</DialogTitle>
          </DialogHeader>

          {credentials ? (
            <div className="space-y-3">
              <div className="border border-emerald-200 bg-emerald-50 rounded p-3 text-sm">
                <strong>Anote ou copie agora — as senhas só aparecem uma vez.</strong>
              </div>
              <CredRow label="Ramal SIP" value={credentials.extension?.extension} onCopy={copyText} />
              <CredRow label="Senha SIP (config no softphone)" value={credentials.sip_password} onCopy={copyText} secret />
              {credentials.pbx_user && (
                <>
                  <CredRow label="Login PBX (web)" value={credentials.pbx_user.username} onCopy={copyText} />
                  <CredRow label="Senha PBX (web)" value={credentials.pbx_user.password} onCopy={copyText} secret />
                </>
              )}
              {credentials.voxyra_user && (
                <>
                  <CredRow label="Login Voxyra" value={credentials.voxyra_user.email} onCopy={copyText} />
                  <CredRow label="Senha Voxyra" value={credentials.voxyra_user.password} onCopy={copyText} secret />
                  {credentials.voxyra_user.warning && (
                    <div className="text-amber-700 text-xs">⚠️ {credentials.voxyra_user.warning}</div>
                  )}
                </>
              )}
              <DialogFooter>
                <Button onClick={() => { setCredentials(null); setOpen(false); }}>Fechar</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nome completo *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                         placeholder="João Silva" data-testid="agent-form-name" required /></div>
                <div><Label>ID de login do agente {!editing && "*"}
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    (usado em /login)
                  </span></Label>
                  <Input value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
                         placeholder="ex: 100, 1001 ou joao"
                         disabled={!!editing}
                         data-testid="agent-form-agentid"
                         required={!editing} />
                  {editing && <p className="text-[11px] text-muted-foreground mt-0.5">ID de login não pode ser alterado.</p>}
                </div>
              </div>
              {!editing && (
                <div><Label>Email Voxyra <span className="text-[10px] text-muted-foreground">(opcional — auto-gerado)</span></Label>
                  <Input value={form.voxyra_email} onChange={(e) => setForm({ ...form, voxyra_email: e.target.value })}
                         placeholder="auto-gerado" data-testid="agent-form-email" /></div>
              )}
              {editing && (
                <div><Label>Email Voxyra</Label>
                  <Input value={form.voxyra_email} onChange={(e) => setForm({ ...form, voxyra_email: e.target.value })}
                         placeholder="email@dominio" type="email" data-testid="agent-form-email" /></div>
              )}
              <div className="border border-border bg-zinc-50 rounded p-3 space-y-2">
                <div className="text-xs font-medium flex items-center gap-1.5"><KeyRound size={12} />
                  {editing ? "Trocar senhas (deixe vazio para manter)" : "Senhas (deixe vazio para gerar)"}
                </div>
                <div className={`grid ${editing ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                  <div><Label className="text-[11px]">SIP</Label>
                    <Input value={form.sip_password} onChange={(e) => setForm({ ...form, sip_password: e.target.value })}
                           type="password" placeholder={editing ? "manter" : "auto"} /></div>
                  {!editing && (
                    <div><Label className="text-[11px]">PBX web</Label>
                      <Input value={form.pbx_password} onChange={(e) => setForm({ ...form, pbx_password: e.target.value })}
                             type="password" placeholder="auto" /></div>
                  )}
                  <div><Label className="text-[11px]">Voxyra</Label>
                    <Input value={form.voxyra_password} onChange={(e) => setForm({ ...form, voxyra_password: e.target.value })}
                           type="password" placeholder={editing ? "manter" : "auto"} /></div>
                </div>
              </div>
              <div>
                <Label>Filas para vincular <span className="text-[10px] text-muted-foreground">({form.queue_uuids.length} selecionadas)</span></Label>
                <div className="border border-border rounded p-2 max-h-40 overflow-y-auto space-y-1">
                  {queues.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2">Nenhuma fila ainda. Crie em /filas primeiro.</div>
                  ) : queues.map((q) => (
                    <label key={q.id} className="flex items-center gap-2 text-sm hover:bg-zinc-50 px-2 py-1 rounded cursor-pointer">
                      <input type="checkbox"
                             checked={form.queue_uuids.includes(q.external_id)}
                             onChange={(e) => {
                               const next = e.target.checked
                                 ? [...form.queue_uuids, q.external_id]
                                 : form.queue_uuids.filter(x => x !== q.external_id);
                               setForm({ ...form, queue_uuids: next });
                             }}
                             disabled={!q.external_id} />
                      <span className="font-medium">{q.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">ext {q.extension}</span>
                      {!q.external_id && <span className="text-[10px] text-amber-600 ml-auto">(sem UUID — não sincronizada)</span>}
                    </label>
                  ))}
                </div>
              </div>
              {!editing && (
                <div className="flex items-center gap-6 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch checked={form.create_pbx_user}
                            onCheckedChange={(v) => setForm({ ...form, create_pbx_user: v })} />
                    Criar usuário PBX (login web do FusionPBX)
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch checked={form.create_voxyra_user}
                            onCheckedChange={(v) => setForm({ ...form, create_voxyra_user: v })} />
                    Criar usuário Voxyra
                  </label>
                </div>
              )}
              <div className="text-[11px] text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2">
                💡 O <b>ramal</b> não é cadastrado aqui. O agente escolhe qual ramal usar a cada login na tela de acesso, e o sistema vincula automaticamente ao FusionPBX.
              </div>
              <DialogFooter className="pt-3">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving} data-testid="agent-form-submit">
                  {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                  {editing ? "Salvar alterações" : "Criar e sincronizar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function CredRow({ label, value, onCopy, secret }) {
  const [show, setShow] = useState(!secret);
  if (!value) return null;
  return (
    <div className="border border-border rounded p-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</div>
        <div className="font-mono text-sm truncate">{show ? value : "••••••••••"}</div>
      </div>
      {secret && (
        <button onClick={() => setShow(!show)} className="text-xs text-muted-foreground underline">
          {show ? "ocultar" : "ver"}
        </button>
      )}
      <button onClick={() => onCopy(value)} className="p-1.5 hover:bg-zinc-100 rounded" title="Copiar">
        <Copy size={14} />
      </button>
    </div>
  );
}
