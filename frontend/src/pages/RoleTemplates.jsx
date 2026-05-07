import { useEffect, useState, useMemo } from "react";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import { Plus, Save, Trash2, RotateCcw, Users as UsersIcon, ShieldCheck, Loader2 } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function RoleTemplates() {
  const [permsMeta, setPermsMeta] = useState({ permissions: [], defaults: {} });
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | role | "new"
  const [confirmDel, setConfirmDel] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        api.get("/permissions"),
        api.get("/role-templates"),
      ]);
      setPermsMeta(p.data);
      setRoles(r.data.roles || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function deleteRole(role) {
    setConfirmDel(null);
    try {
      const { data } = await api.delete(`/role-templates/${role.key}`);
      toast.success(data.reset ? `Grupo "${role.label}" resetado para padrão` : `Grupo "${role.label}" removido`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  return (
    <Layout title="Permissões por Grupo" subtitle="Configure as permissões padrão de cada grupo de usuário do seu tenant">
      <div className="flex items-center justify-between mb-5">
        <div className="text-xs text-muted-foreground max-w-2xl">
          Quando um usuário é criado em um grupo, ele herda automaticamente as permissões definidas aqui.
          Alterações são aplicadas imediatamente para todos os usuários do grupo (exceto os que tenham permissões customizadas individuais).
        </div>
        <Button onClick={() => setEditing("new")} data-testid="btn-new-role">
          <Plus size={14} className="mr-1.5" /> Novo grupo personalizado
        </Button>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((r) => (
            <RoleCard key={r.key} role={r} totalPerms={permsMeta.permissions?.length || 0}
              onEdit={() => setEditing(r)}
              onDelete={() => setConfirmDel(r)} />
          ))}
        </div>
      )}

      <RoleFormDialog
        open={editing !== null}
        editing={editing}
        permsMeta={permsMeta}
        existingKeys={roles.map((r) => r.key)}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDel?.is_builtin ? "Resetar grupo" : "Remover grupo"}</DialogTitle>
            <DialogDescription>
              {confirmDel?.is_builtin ? (
                <>O grupo padrão <strong>{confirmDel?.label}</strong> voltará às permissões originais. Os usuários deste grupo passarão a usar os defaults.</>
              ) : (
                <>O grupo <strong>{confirmDel?.label}</strong> será removido. {confirmDel?.user_count > 0 && (<span className="text-red-600 font-semibold">{confirmDel?.user_count} usuário(s) ainda usam este grupo.</span>)}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteRole(confirmDel)}
              disabled={!confirmDel?.is_builtin && confirmDel?.user_count > 0}
              data-testid="confirm-delete-role">
              {confirmDel?.is_builtin ? "Resetar" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function RoleCard({ role, totalPerms, onEdit, onDelete }) {
  const count = role.permissions?.length || 0;
  const groupCounts = useMemo(() => {
    return count;
  }, [count]);
  return (
    <div className="border border-border bg-card rounded-sm p-5 flex flex-col gap-3 hover:border-foreground/20 transition" data-testid={`role-card-${role.key}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            {role.is_builtin ? "Grupo padrão" : "Grupo personalizado"}
          </div>
          <h3 className="font-display text-xl font-semibold flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-700" />
            {role.label}
          </h3>
          <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{role.key}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Usuários</div>
          <div className="font-mono text-2xl font-bold flex items-center gap-1 justify-end">
            <UsersIcon size={14} className="text-muted-foreground" /> {role.user_count}
          </div>
        </div>
      </div>
      <div className="text-xs">
        <span className="font-mono font-bold">{groupCounts}</span>
        <span className="text-muted-foreground"> / {totalPerms} permissões</span>
        {role.is_builtin && role.has_override && (
          <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800 uppercase tracking-widest">customizado</span>
        )}
      </div>
      <div className="flex gap-2 mt-auto pt-2 border-t border-border">
        <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}
          data-testid={`role-edit-${role.key}`}>Editar</Button>
        <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-red-600"
          onClick={onDelete} title={role.is_builtin ? "Resetar para padrão" : "Remover grupo"}
          data-testid={`role-delete-${role.key}`}>
          {role.is_builtin ? <RotateCcw size={14} /> : <Trash2 size={14} />}
        </Button>
      </div>
    </div>
  );
}

function RoleFormDialog({ open, editing, permsMeta, existingKeys, onClose, onSaved }) {
  const isNew = editing === "new";
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [perms, setPerms] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setKey("");
      setLabel("");
      setPerms(new Set());
    } else if (editing) {
      setKey(editing.key);
      setLabel(editing.label || editing.key);
      setPerms(new Set(editing.permissions || []));
    }
  }, [open, editing, isNew]);

  const groupedPerms = useMemo(() => {
    const g = {};
    (permsMeta.permissions || []).forEach((p) => {
      if (!g[p.group]) g[p.group] = [];
      g[p.group].push(p);
    });
    return g;
  }, [permsMeta]);

  function toggle(k) {
    const s = new Set(perms);
    if (s.has(k)) s.delete(k); else s.add(k);
    setPerms(s);
  }

  async function save() {
    const finalKey = (key || "").trim().toLowerCase();
    if (!finalKey) { toast.error("Chave obrigatória"); return; }
    if (!/^[a-z0-9_-]+$/.test(finalKey)) { toast.error("Chave: apenas letras, números, _ e -"); return; }
    if (isNew && existingKeys.includes(finalKey)) { toast.error("Já existe um grupo com essa chave"); return; }
    if (!label.trim()) { toast.error("Nome obrigatório"); return; }
    setSaving(true);
    try {
      await api.put(`/role-templates/${finalKey}`, {
        key: finalKey, label: label.trim(),
        permissions: Array.from(perms),
      });
      toast.success(isNew ? "Grupo criado" : "Grupo atualizado");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar"); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  const isBuiltin = !isNew && editing?.is_builtin;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="role-form-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo grupo personalizado" : `Editar grupo "${editing?.label}"`}</DialogTitle>
          <DialogDescription>
            Defina o nome e as permissões. Todos os usuários deste grupo passarão a ter essas permissões automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="r-label">Nome</Label>
              <Input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: Telemarketing"
                data-testid="role-form-label" />
            </div>
            <div>
              <Label htmlFor="r-key">Chave (id interno)</Label>
              <Input id="r-key" value={key} onChange={(e) => setKey(e.target.value.replace(/[^a-z0-9_-]/gi, ""))}
                placeholder="Ex: telemarketing"
                disabled={!isNew} className="font-mono" data-testid="role-form-key" />
              {!isNew && <p className="text-[11px] text-muted-foreground mt-1">A chave não pode ser alterada após a criação.</p>}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-display font-semibold text-sm">Permissões ({perms.size} selecionada(s))</h4>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPerms(new Set((permsMeta.permissions || []).map((p) => p.key)))}
                  data-testid="role-perms-all" className="text-xs">Marcar todas</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPerms(new Set())}
                  data-testid="role-perms-none" className="text-xs">Limpar</Button>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(groupedPerms).map(([group, items]) => (
                <div key={group} className="border border-border rounded-sm">
                  <div className="px-3 py-2 bg-zinc-50 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                    {group}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    {items.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 cursor-pointer"
                        data-testid={`role-perm-${p.key}`}>
                        <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} />
                        <span className="flex-1">{p.label}</span>
                        <code className="text-[10px] text-muted-foreground">{p.key}</code>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="role-form-save">
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            {isNew ? "Criar grupo" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
