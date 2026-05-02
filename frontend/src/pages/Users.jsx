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
import { Plus, Pencil, Trash2, ShieldCheck, X, Search, RotateCcw } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | userObj
  const [confirmDel, setConfirmDel] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [u, p, a] = await Promise.all([
        api.get("/users"),
        api.get("/permissions"),
        api.get("/agents").catch(() => ({ data: { agents: [] } })),
      ]);
      setUsers(u.data.users);
      setPermsMeta(p.data);
      setAgentEntities(a.data.agents || []);
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

function UserFormDialog({ open, editing, permsMeta, agentEntities, onClose, onSaved }) {
  const isNew = editing === "new";
  const initial = useMemo(() => {
    if (isNew || !editing) return { name: "", email: "", password: "", role: "agent", permissions: null, active: true, agent_id: null };
    return {
      name: editing.name || "", email: editing.email || "", password: "",
      role: editing.role || "agent",
      permissions: editing.is_custom_permissions ? [...editing.permissions] : null,
      active: editing.active !== false,
      agent_id: editing.agent_id || null,
    };
  }, [editing, isNew]);
  const [form, setForm] = useState(initial);
  const [useDefaults, setUseDefaults] = useState(initial.permissions === null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

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
        agent_id: form.role === "agent" ? (form.agent_id || null) : null,
      };
      if (isNew) {
        if (!form.email || !form.password) {
          setErr("Email e senha são obrigatórios."); setSaving(false); return;
        }
        await api.post("/users", { email: form.email, password: form.password, ...payload });
        toast.success("Usuário criado");
      } else {
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success("Usuário atualizado");
      }
      onSaved();
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="user-form">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo Usuário" : `Editar ${editing?.name || ""}`}</DialogTitle>
          <DialogDescription>
            {isNew ? "Defina credenciais, papel e permissões." : "Altere papel, permissões ou redefina a senha."}
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
          <div className="border-t border-border pt-4 mt-2">
            <Label className="text-xs mb-1.5 block">
              Vincular a um agente do callcenter
              <span className="text-muted-foreground ml-1 font-normal normal-case">(define quais gravações o usuário verá)</span>
            </Label>
            <Select value={form.agent_id || "none"} onValueChange={(v) => setForm({ ...form, agent_id: v === "none" ? null : v })}>
              <SelectTrigger data-testid="uf-agent-id"><SelectValue placeholder="Nenhum vínculo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Sem vínculo (não verá gravações) —</SelectItem>
                {agentEntities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · ext. {a.extension}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
