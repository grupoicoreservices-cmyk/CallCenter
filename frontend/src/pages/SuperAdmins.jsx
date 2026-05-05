import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import { Crown, Plus, Pencil, Trash2, Shield, KeyRound } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

export default function SuperAdmins() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // {mode:"create"|"edit", target?}

  async function load() {
    try {
      const { data } = await api.get("/super-admins");
      setRows(data.users || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user?.role === "super_admin") load(); }, [user]);

  if (user?.role !== "super_admin") {
    return (
      <Layout title="Super Admins" subtitle="Acesso restrito">
        <div className="border border-border bg-card rounded-sm p-12 text-center">
          <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
        </div>
      </Layout>
    );
  }

  async function onDelete(u) {
    if (!confirm(`Remover super admin ${u.email}?`)) return;
    try {
      await api.delete(`/super-admins/${u.id}`);
      toast.success("Super admin removido");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  return (
    <Layout title="Super Admins" subtitle="Gerencie contas com acesso master à plataforma">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-muted-foreground">
          {rows.length} super admin{rows.length !== 1 ? "s" : ""} cadastrado{rows.length !== 1 ? "s" : ""}
        </div>
        <Button onClick={() => setDialog({ mode: "create" })} data-testid="superadmins-new">
          <Plus size={14} className="mr-1.5" /> Novo Super Admin
        </Button>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criado em</th>
              <th className="px-4 py-3 w-24 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhum super admin cadastrado.</td></tr>
            ) : rows.map((u) => {
              const isMe = u.id === user.id;
              return (
                <tr key={u.id} className={isMe ? "bg-amber-50/30" : ""} data-testid={`superadmin-row-${u.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Crown size={14} className="text-amber-600" />
                      <span className="font-medium">{u.name}</span>
                      {isMe && <span className="text-[10px] uppercase tracking-widest text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Você</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.active
                      ? <span className="text-emerald-700 text-xs inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Ativo</span>
                      : <span className="text-zinc-500 text-xs inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-400" /> Inativo</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ mode: "edit", target: u })}
                      data-testid={`superadmin-edit-${u.id}`}>
                      <Pencil size={13} />
                    </Button>
                    {!isMe && (
                      <Button variant="ghost" size="sm" onClick={() => onDelete(u)}
                        data-testid={`superadmin-delete-${u.id}`}
                        className="text-red-600 hover:text-red-700">
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} onSaved={load} />}
    </Layout>
  );
}

function FormDialog({ dialog, onClose, onSaved }) {
  const isEdit = dialog.mode === "edit";
  const [form, setForm] = useState({
    name: dialog.target?.name || "",
    email: dialog.target?.email || "",
    password: "",
    active: dialog.target?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { name: form.name, active: form.active };
        if (form.password) payload.password = form.password;
        await api.put(`/super-admins/${dialog.target.id}`, payload);
        toast.success("Super admin atualizado");
      } else {
        if (!form.password || form.password.length < 8) {
          toast.error("Senha mínima 8 caracteres");
          setSaving(false); return;
        }
        await api.post("/super-admins", {
          name: form.name, email: form.email, password: form.password, active: form.active,
        });
        toast.success("Super admin criado");
      }
      onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="superadmin-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown size={16} className="text-amber-600" />
            {isEdit ? "Editar Super Admin" : "Novo Super Admin"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sa-name">Nome</Label>
            <Input id="sa-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              required data-testid="superadmin-field-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-email">Email</Label>
            <Input id="sa-email" type="email" value={form.email} disabled={isEdit}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required data-testid="superadmin-field-email" />
            {isEdit && <p className="text-[11px] text-muted-foreground">Email não pode ser alterado.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-pw" className="flex items-center gap-1.5">
              <KeyRound size={12} /> {isEdit ? "Nova senha (deixe em branco para manter)" : "Senha (min. 8)"}
            </Label>
            <Input id="sa-pw" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password" data-testid="superadmin-field-password" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <Label htmlFor="sa-active">Ativo</Label>
              <p className="text-[11px] text-muted-foreground">Inativos não podem fazer login.</p>
            </div>
            <Switch id="sa-active" checked={form.active}
              onCheckedChange={(v) => setForm({ ...form, active: v })}
              data-testid="superadmin-field-active" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="superadmin-save">
            {saving ? "Salvando..." : (isEdit ? "Salvar" : "Criar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
