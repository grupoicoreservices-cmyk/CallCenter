import { useEffect, useState, useMemo } from "react";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Plus, Pencil, Trash2, ShieldCheck, X, Search, RotateCcw, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const ROLE_LABEL = { admin: "Administrador", supervisor: "Supervisor", agent: "Agente" };
const ROLE_BADGE = {
  admin: "bg-zinc-900 text-white",
  supervisor: "bg-blue-100 text-blue-700",
  agent: "bg-emerald-100 text-emerald-700",
};

export default function Users() {
  const { user: me, hasPermission } = useAuth();
  const [users, setUsers] = useState([]);
  const [permsMeta, setPermsMeta] = useState({ permissions: [], defaults: {}, roles: [] });
  const [agentEntities, setAgentEntities] = useState([]);
  const [queues, setQueues] = useState([]);
  const [extensions, setExtensions] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | userObj
  const [confirmDel, setConfirmDel] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [u, p, a, q, x] = await Promise.all([
        api.get("/users"),
        api.get("/permissions"),
        api.get("/agents?include_extensions=true").catch(() => ({ data: { agents: [] } })),
        api.get("/queues").catch(() => ({ data: { queues: [] } })),
        api.get("/extensions").catch(() => ({ data: { extensions: [] } })),
      ]);
      setUsers(u.data.users);
      setPermsMeta(p.data);
      setAgentEntities(a.data.agents || []);
      setQueues(q.data.queues || []);
      setExtensions(x.data.extensions || []);
    } catch (e) {
      toast.error("Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (hasPermission("users.manage")) load(); }, [hasPermission]);

  if (!hasPermission("users.manage")) {
    return (
      <Layout title="Usuários">
        <div className="border border-border bg-card rounded-sm p-12 text-center" data-testid="users-forbidden">
          <ShieldCheck size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="text-sm text-muted-foreground mt-1">Apenas administradores podem gerenciar usuários.</p>
        </div>
      </Layout>
    );
  }

  const filtered = users.filter((u) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete() {
    if (!confirmDel) return;
    try {
      await api.delete(`/users/${confirmDel.id}`);
      toast.success(`Usuário ${confirmDel.name} excluído`);
      setConfirmDel(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao excluir");
    }
  }

  return (
    <Layout
      title="Usuários e Permissões"
      subtitle="Crie usuários e defina o que Supervisores e Agentes podem acessar"
      actions={
        <Button onClick={() => setEditing("new")} data-testid="btn-new-user">
          <Plus size={14} className="mr-1.5" /> Novo Usuário
        </Button>
      }
    >
      <div className="mb-4 relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="users-search" />
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left">
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-5 py-3">Nome</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Email</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Papel</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Permissões</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Status</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3">Criado em</th>
              <th className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-3 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground font-mono">carregando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground" data-testid="users-empty">Nenhum usuário encontrado.</td></tr>
            ) : filtered.map((u) => (
              <tr key={u.id} className="table-row-hover" data-testid={`user-row-${u.id}`}>
                <td className="px-5 py-3 font-medium">{u.name}{u.id === me?.id && <span className="ml-2 text-[10px] text-muted-foreground uppercase tracking-widest">(você)</span>}</td>
                <td className="px-3 py-3 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm">{u.permissions.length}</span>
                  <span className="text-xs text-muted-foreground ml-1">{u.is_custom_permissions ? "custom" : "padrão"}</span>
                </td>
                <td className="px-3 py-3">
                  {u.active === false
                    ? <span className="text-xs text-red-600">Desativado</span>
                    : <span className="text-xs text-emerald-600">Ativo</span>}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{fmtDateTime(u.created_at)}</td>
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditing(u)}
                      data-testid={`user-edit-${u.id}`}
                      className="p-1.5 rounded hover:bg-zinc-100 text-muted-foreground hover:text-foreground"
                      title="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDel(u)}
                      data-testid={`user-delete-${u.id}`}
                      disabled={u.id === me?.id}
                      className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={u.id === me?.id ? "Você não pode excluir a si mesmo" : "Excluir"}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserFormDialog
        open={editing !== null}
        editing={editing}
        permsMeta={permsMeta}
        agentEntities={agentEntities}
        queues={queues}
        extensions={extensions}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. <span className="font-medium text-foreground">{confirmDel?.name}</span> ({confirmDel?.email}) perderá acesso ao sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="del-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} data-testid="del-confirm" className="bg-red-600 hover:bg-red-700">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function UserFormDialog({ open, editing, permsMeta, agentEntities, queues, extensions, onClose, onSaved }) {
  const isNew = editing === "new";
  const initial = useMemo(() => {
    if (isNew || !editing) return {
      name: "", email: "", password: "", role: "agent",
      permissions: null, active: true, agent_id: null,
      allowed_extensions: [],
      // Provisioning fields
      provision_extension: false, extension_number: "", extension_sip_password: "",
      provision_pbx_user: false, pbx_password: "",
      provision_call_center_agent: false, cc_agent_id: "",
      queue_uuids: [],
    };
    return {
      name: editing.name || "", email: editing.email || "", password: "",
      role: editing.role || "agent",
      permissions: editing.is_custom_permissions ? [...editing.permissions] : null,
      active: editing.active !== false,
      agent_id: editing.agent_id || null,
      allowed_extensions: editing.allowed_extensions ? [...editing.allowed_extensions] : [],
      provision_extension: false, extension_number: "", extension_sip_password: "",
      provision_pbx_user: false, pbx_password: "",
      provision_call_center_agent: false, cc_agent_id: "",
      queue_uuids: [],
    };
  }, [editing, isNew]);
  const [form, setForm] = useState(initial);
  const [useDefaults, setUseDefaults] = useState(initial.permissions === null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [credentials, setCredentials] = useState(null);

  useEffect(() => {
    setForm(initial);
    setUseDefaults(initial.permissions === null);
    setErr("");
  }, [initial]);

  const grouped = useMemo(() => {
    const out = {};
    for (const p of permsMeta.permissions || []) {
      out[p.group] = out[p.group] || [];
      out[p.group].push(p);
    }
    return out;
  }, [permsMeta.permissions]);

  const effectivePerms = useMemo(() => {
    if (form.role === "admin") return (permsMeta.permissions || []).map((p) => p.key);
    if (useDefaults) return permsMeta.defaults?.[form.role] || [];
    return form.permissions || [];
  }, [form.role, form.permissions, useDefaults, permsMeta]);

  function togglePerm(key) {
    setUseDefaults(false);
    setForm((f) => {
      const cur = new Set(f.permissions ?? permsMeta.defaults?.[f.role] ?? []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      return { ...f, permissions: Array.from(cur) };
    });
  }

  function resetToDefaults() {
    setUseDefaults(true);
    setForm((f) => ({ ...f, permissions: null }));
  }

  async function handleSave() {
    setErr(""); setSaving(true);
    try {
      const payload = {
        name: form.name,
        role: form.role,
        active: form.active,
        permissions: form.role === "admin" ? null : (useDefaults ? null : (form.permissions || [])),
        allowed_extensions: form.role === "admin" ? [] : (form.allowed_extensions || []),
        agent_id: form.role === "agent" ? (form.agent_id || null) : null,
      };
      if (isNew) {
        if (!form.email || !form.password) {
          setErr("Email e senha são obrigatórios."); setSaving(false); return;
        }
        // Provisionamento (apenas em criação + role agent)
        if (form.role === "agent") {
          payload.provision_extension = !!form.provision_extension;
          payload.provision_pbx_user = !!form.provision_pbx_user;
          payload.provision_call_center_agent = !!form.provision_call_center_agent;
          if (form.provision_extension || form.provision_call_center_agent) {
            if (!form.extension_number) {
              setErr("Número do ramal é obrigatório quando provisionando."); setSaving(false); return;
            }
            payload.extension_number = String(form.extension_number);
          }
          if (form.extension_sip_password) payload.extension_sip_password = form.extension_sip_password;
          if (form.pbx_password) payload.pbx_password = form.pbx_password;
          if (form.cc_agent_id) payload.cc_agent_id = form.cc_agent_id;
          if (form.queue_uuids?.length) payload.queue_uuids = form.queue_uuids;
        }
        const { data } = await api.post("/users", { email: form.email, password: form.password, ...payload });
        if (data.provisioned) {
          setCredentials(data.provisioned);
          toast.success("Usuário criado e provisionado no FusionPBX");
        } else {
          toast.success("Usuário criado");
          onSaved();
        }
      } else {
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success("Usuário atualizado");
        onSaved();
      }
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function copyText(t) {
    navigator.clipboard.writeText(t);
    toast.success("Copiado!");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setCredentials(null); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="user-form">
        {credentials ? (
          <div className="space-y-3">
            <DialogHeader>
              <DialogTitle>✅ Usuário criado com provisionamento</DialogTitle>
              <DialogDescription>
                <strong className="text-amber-700">Anote ou copie agora — as senhas só aparecem uma vez.</strong>
              </DialogDescription>
            </DialogHeader>
            {credentials.extension && (
              <>
                <CredRow label="Ramal SIP" value={credentials.extension.extension} onCopy={copyText} />
                <CredRow label="Senha SIP (config no softphone)" value={credentials.extension.sip_password} onCopy={copyText} secret />
              </>
            )}
            {credentials.pbx_user && (
              <>
                <CredRow label="Login PBX (web)" value={credentials.pbx_user.username} onCopy={copyText} />
                <CredRow label="Senha PBX (web)" value={credentials.pbx_user.password} onCopy={copyText} secret />
              </>
            )}
            {credentials.call_center_agent && (
              <>
                <CredRow label="Agente Call Center · Nome" value={credentials.call_center_agent.agent_name} onCopy={copyText} />
                <CredRow label="Agente Call Center · Login" value={credentials.call_center_agent.agent_id} onCopy={copyText} />
              </>
            )}
            {credentials.pbx_user_error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 p-2 rounded">
                ⚠️ Falha ao criar usuário web no PBX: {credentials.pbx_user_error}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => { setCredentials(null); onSaved(); }}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo Usuário" : `Editar ${editing?.name || ""}`}</DialogTitle>
          <DialogDescription>
            {isNew ? "Defina credenciais, papel e (opcional) provisione no FusionPBX." : "Altere papel, permissões ou redefina a senha."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="uname">Nome</Label>
            <Input id="uname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="uf-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uemail">Email</Label>
            <Input id="uemail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!isNew} data-testid="uf-email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upw">{isNew ? "Senha" : "Nova senha (deixe em branco para manter)"}</Label>
            <Input id="upw" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="uf-password" />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <Select value={form.role} onValueChange={(v) => { setForm({ ...form, role: v }); setUseDefaults(true); }}>
              <SelectTrigger data-testid="uf-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(permsMeta.roles || []).map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {form.role === "agent" && (
          <div className="border border-blue-200 bg-blue-50/40 rounded-sm p-4 mt-3">
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1">
                <div className="text-xs font-medium text-blue-900">
                  Vincular a um agente sincronizado do FusionPBX
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Define quais gravações e métricas o usuário verá. Os agentes abaixo foram puxados da Central PBX.
                </div>
              </div>
              {agentEntities.filter(a => a.external_id).length > 0 && (
                <span className="text-[10px] uppercase tracking-widest font-medium text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full whitespace-nowrap">
                  {agentEntities.filter(a => a.external_id).length} sincronizados
                </span>
              )}
            </div>
            <AgentLinkPicker
              agents={agentEntities}
              value={form.agent_id}
              onChange={(v) => setForm({ ...form, agent_id: v })}
            />
          </div>
        )}

        {isNew && form.role === "agent" && (
          <details className="border border-dashed border-zinc-300 bg-zinc-50 rounded-sm p-3 mt-3">
            <summary className="text-xs font-medium text-zinc-700 cursor-pointer select-none">
              ⚙️ Provisionamento avançado no FusionPBX <span className="text-muted-foreground font-normal">(opcional · expanda para criar ramal/agente direto no PBX)</span>
            </summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.provision_extension}
                        onCheckedChange={(v) => setForm({ ...form, provision_extension: v })}
                        data-testid="uf-prov-ext" />
                Cadastrar ramal SIP no FusionPBX
              </label>
              {form.provision_extension && (
                <div className="grid grid-cols-2 gap-2 ml-7">
                  <div>
                    <Label className="text-[11px]">Número do ramal *</Label>
                    <Input value={form.extension_number}
                           onChange={(e) => setForm({ ...form, extension_number: e.target.value })}
                           placeholder="1001" type="number" data-testid="uf-ext-number" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Senha SIP <span className="text-muted-foreground">(auto)</span></Label>
                    <Input value={form.extension_sip_password}
                           onChange={(e) => setForm({ ...form, extension_sip_password: e.target.value })}
                           type="password" placeholder="gerada automaticamente" />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.provision_call_center_agent}
                        onCheckedChange={(v) => setForm({ ...form, provision_call_center_agent: v })}
                        data-testid="uf-prov-cca" />
                Cadastrar como agente do Call Center (com número/login real)
              </label>
              {form.provision_call_center_agent && (
                <div className="ml-7 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">Número/Login do agente <span className="text-muted-foreground">(default = ramal)</span></Label>
                      <Input value={form.cc_agent_id}
                             onChange={(e) => setForm({ ...form, cc_agent_id: e.target.value })}
                             placeholder="ex: 1001 ou joao_silva" data-testid="uf-cc-agent-id" />
                    </div>
                    <div>
                      {!form.provision_extension && (
                        <>
                          <Label className="text-[11px]">Ramal *</Label>
                          <Input value={form.extension_number}
                                 onChange={(e) => setForm({ ...form, extension_number: e.target.value })}
                                 placeholder="1001" type="number" />
                        </>
                      )}
                    </div>
                  </div>
                  {queues.length > 0 && (
                    <div>
                      <Label className="text-[11px]">Vincular a filas <span className="text-muted-foreground">({form.queue_uuids.length})</span></Label>
                      <div className="border border-border rounded p-2 max-h-32 overflow-y-auto bg-white">
                        {queues.map((q) => (
                          <label key={q.id} className="flex items-center gap-2 text-xs hover:bg-zinc-50 px-2 py-1 rounded cursor-pointer">
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
                            <span className="text-muted-foreground font-mono">ext {q.extension}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.provision_pbx_user}
                        onCheckedChange={(v) => setForm({ ...form, provision_pbx_user: v })}
                        data-testid="uf-prov-pbx-user" />
                Criar login web no FusionPBX
              </label>
              {form.provision_pbx_user && (
                <div className="ml-7">
                  <Label className="text-[11px]">Senha PBX web <span className="text-muted-foreground">(auto)</span></Label>
                  <Input value={form.pbx_password}
                         onChange={(e) => setForm({ ...form, pbx_password: e.target.value })}
                         type="password" placeholder="gerada automaticamente" />
                </div>
              )}
            </div>
          </details>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4 mt-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="uf-active" />
            Usuário ativo
          </label>
          {form.role !== "admin" && (
            <Button variant="ghost" size="sm" onClick={resetToDefaults} data-testid="uf-reset-perms">
              <RotateCcw size={12} className="mr-1.5" /> Permissões padrão do papel
            </Button>
          )}
        </div>

        {form.role !== "admin" && (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Ramais visíveis</div>
                <h4 className="font-display font-semibold">
                  {form.allowed_extensions.length === 0 ? "Vê todos os ramais" : `${form.allowed_extensions.length} ramal(is) permitido(s)`}
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Restringe quais ramais este usuário enxerga em Ramais/Agentes, Tempo Real, Gravações e Relatórios.
                  Deixe em branco para ver tudo. Administradores sempre veem todos.
                </p>
              </div>
              {form.allowed_extensions.length > 0 && (
                <Button variant="ghost" size="sm" type="button"
                  onClick={() => setForm((f) => ({ ...f, allowed_extensions: [] }))}
                  data-testid="uf-allowed-ext-clear">
                  <RotateCcw size={12} className="mr-1.5" /> Permitir todos
                </Button>
              )}
            </div>
            <AllowedExtensionsPicker
              extensions={extensions || []}
              value={form.allowed_extensions}
              onChange={(v) => setForm({ ...form, allowed_extensions: v })}
            />
          </div>
        )}

        {/* Permissions */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Permissões</div>
              <h4 className="font-display font-semibold">{form.role === "admin" ? "Administrador tem acesso total" : useDefaults ? "Usando padrões do papel" : "Personalizadas"}</h4>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{effectivePerms.length} ativas</span>
          </div>

          {form.role === "admin" ? (
            <div className="text-sm text-muted-foreground bg-zinc-50 border border-border rounded-sm p-4 text-center">
              <ShieldCheck className="inline mr-1.5 mb-0.5" size={14} /> Administradores possuem todas as permissões automaticamente.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(grouped).map(([group, perms]) => (
                <div key={group} className="border border-border rounded-sm">
                  <div className="px-3 py-2 bg-zinc-50 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{group}</div>
                  <div className="divide-y divide-border">
                    {perms.map((p) => {
                      const checked = effectivePerms.includes(p.key);
                      return (
                        <label key={p.key} className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-50/50">
                          <div>
                            <div className="text-sm">{p.label}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{p.key}</div>
                          </div>
                          <Switch checked={checked} onCheckedChange={() => togglePerm(p.key)} data-testid={`uf-perm-${p.key}`} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded" data-testid="uf-error">{err}</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="uf-cancel"><X size={14} className="mr-1.5" /> Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="uf-save">
            {saving ? "Salvando…" : (isNew ? "Criar Usuário" : "Salvar Alterações")}
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AllowedExtensionsPicker({ extensions, value, onChange }) {
  const [search, setSearch] = useState("");
  const selected = new Set((value || []).map(String));
  const filtered = extensions.filter((e) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (e.extension || "").toLowerCase().includes(s)
      || (e.caller_id_name || "").toLowerCase().includes(s)
      || (e.agent_name || "").toLowerCase().includes(s);
  });

  function toggle(ext) {
    const next = new Set(selected);
    if (next.has(String(ext))) next.delete(String(ext));
    else next.add(String(ext));
    onChange(Array.from(next));
  }
  function selectAll() { onChange(filtered.map((e) => String(e.extension))); }
  function clearAll() { onChange([]); }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por ramal, nome ou agente…"
            className="pl-8 h-8 text-xs" data-testid="uf-allowed-ext-search" />
        </div>
        <Button variant="ghost" size="sm" type="button" onClick={selectAll}
          data-testid="uf-allowed-ext-all" className="text-xs">
          Marcar visíveis
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={clearAll}
          data-testid="uf-allowed-ext-none" className="text-xs">
          Limpar
        </Button>
      </div>

      <div className="border border-border rounded bg-white max-h-56 overflow-y-auto" data-testid="uf-allowed-ext-list">
        {extensions.length === 0 ? (
          <div className="text-xs text-muted-foreground p-4 text-center">
            Nenhum ramal encontrado. Verifique a integração FusionPBX em Central PBX.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">
            Nenhum ramal corresponde ao filtro.
          </div>
        ) : filtered.map((e) => {
          const ext = String(e.extension);
          const checked = selected.has(ext);
          return (
            <label key={e.uuid || ext}
              className={`flex items-center gap-2 px-3 py-2 border-b border-border last:border-0 hover:bg-zinc-50 cursor-pointer text-xs ${checked ? "bg-emerald-50" : ""}`}
              data-testid={`uf-allowed-ext-${ext}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(ext)} />
              <span className="font-mono font-bold w-14 text-foreground">{ext}</span>
              <span className="flex-1 truncate">{e.agent_name || e.caller_id_name || "—"}</span>
              {e.is_agent ? (
                <span className="text-[10px] uppercase tracking-widest text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">Agente</span>
              ) : (
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">Ramal</span>
              )}
            </label>
          );
        })}
      </div>
      {selected.size > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Selecionados: <span className="font-mono text-foreground">{Array.from(selected).join(", ")}</span>
        </div>
      )}
    </div>
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
        <button onClick={() => setShow(!show)} className="text-xs text-muted-foreground underline" type="button">
          {show ? "ocultar" : "ver"}
        </button>
      )}
      <button onClick={() => onCopy(value)} className="p-1.5 hover:bg-zinc-100 rounded" title="Copiar" type="button">
        <Copy size={14} />
      </button>
    </div>
  );
}

function AgentLinkPicker({ agents, value, onChange }) {
  const [search, setSearch] = useState("");
  const [showDemo, setShowDemo] = useState(false);
  const synced = agents.filter(a => a.external_id);
  const demo = agents.filter(a => !a.external_id);
  const list = (showDemo ? agents : synced).filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (a.name || "").toLowerCase().includes(s)
        || (a.extension || "").includes(s)
        || (a.username || "").toLowerCase().includes(s);
  });
  const selected = agents.find(a => a.id === value);

  return (
    <div className="space-y-2">
      {selected && (
        <div className="flex items-center gap-2 text-xs bg-emerald-100 border border-emerald-300 rounded px-2 py-1.5">
          <span className="font-medium text-emerald-900">Vinculado:</span>
          <span className="font-mono">{selected.extension}</span>
          <span>·</span>
          <span>{selected.name}</span>
          {selected.username && <span className="text-muted-foreground">@{selected.username}</span>}
          {selected.external_id ? (
            <span className="ml-auto text-[10px] uppercase tracking-widest text-emerald-700">FusionPBX ✓</span>
          ) : (
            <span className="ml-auto text-[10px] uppercase tracking-widest text-amber-700">demo</span>
          )}
          <button type="button" onClick={() => onChange(null)} className="text-red-600 hover:text-red-800" title="Desvincular">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Filtrar por nome, ramal ou login…"
               className="pl-8 h-8 text-xs" data-testid="uf-agent-search" />
      </div>

      <div className="border border-border rounded bg-white max-h-48 overflow-y-auto" data-testid="uf-agent-list">
        {list.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">
            {synced.length === 0
              ? "Nenhum agente sincronizado do FusionPBX. Vá em Central PBX → Sincronizar Agora."
              : "Nenhum agente encontrado."}
          </div>
        ) : list.map((a) => {
          const active = a.id === value;
          return (
            <button type="button" key={a.id}
              onClick={() => onChange(active ? null : a.id)}
              className={`w-full text-left px-3 py-2 border-b border-border last:border-0 hover:bg-zinc-50 transition flex items-center gap-2 ${active ? "bg-emerald-50" : ""}`}
              data-testid={`uf-agent-opt-${a.id}`}>
              <div className="font-mono text-sm w-12 shrink-0 text-foreground">{a.extension || "—"}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{a.name}</div>
                {a.username && <div className="text-[10px] text-muted-foreground font-mono">@{a.username}</div>}
              </div>
              {a.external_id ? (
                <span className="text-[10px] uppercase tracking-widest text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">PBX</span>
              ) : (
                <span className="text-[10px] uppercase tracking-widest text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">demo</span>
              )}
              {active && <span className="text-emerald-600 text-xs">✓</span>}
            </button>
          );
        })}
      </div>

      {demo.length > 0 && !showDemo && (
        <button type="button" onClick={() => setShowDemo(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground underline">
          Mostrar também {demo.length} agentes simulados (demo)
        </button>
      )}
      {!value && synced.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Nenhum vínculo selecionado — o usuário não verá gravações até vincular um agente.
        </div>
      )}
    </div>
  );
}
