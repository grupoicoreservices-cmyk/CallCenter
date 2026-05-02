import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Plus, Pencil, Trash2, LogIn, Shield, Search, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function Tenants() {
  const { user, setTenantContext } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/tenants");
      setTenants(data.tenants);
    } catch { toast.error("Falha ao carregar tenants"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (user?.role !== "super_admin") {
    return (
      <Layout title="Tenants">
        <div className="border border-border bg-card rounded-sm p-12 text-center">
          <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="text-sm text-muted-foreground mt-1">Apenas super-administradores podem gerenciar tenants.</p>
        </div>
      </Layout>
    );
  }

  const filtered = tenants.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.domain.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete() {
    if (!confirmDel) return;
    try {
      await api.delete(`/tenants/${confirmDel.id}`);
      toast.success(`Tenant ${confirmDel.name} excluído`);
      setConfirmDel(null); load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao excluir");
    }
  }

  function impersonate(t) {
    setTenantContext(t.id);
    toast.success(`Acessando ${t.name}`);
    navigate("/");
  }

  return (
    <Layout
      title="Tenants"
      subtitle="Empresas hospedadas na plataforma — multi-tenancy estilo FusionPBX"
      actions={
        <Button onClick={() => setEditing("new")} data-testid="btn-new-tenant">
          <Plus size={14} className="mr-1.5" /> Novo Tenant
        </Button>
      }
    >
      <div className="mb-4 relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou domínio…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center text-muted-foreground py-8 font-mono text-sm">carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">Nenhum tenant cadastrado.</div>
        ) : filtered.map((t) => (
          <div key={t.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`tenant-card-${t.id}`}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded flex items-center justify-center text-white font-bold" style={{ backgroundColor: t.accent_color }}>
                {t.logo_url ? <img src={t.logo_url} alt="" className="w-10 h-10 rounded object-cover" /> : <Building2 size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold truncate">{t.name}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{t.domain}</div>
              </div>
              {!t.active && <span className="text-[10px] text-red-600 font-medium uppercase tracking-widest">SUSPENSO</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Usuários</div>
                <div className="font-mono text-lg mt-1">{t.user_count}<span className="text-muted-foreground text-xs">/{t.max_users}</span></div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Agentes</div>
                <div className="font-mono text-lg mt-1">{t.agent_count}<span className="text-muted-foreground text-xs">/{t.max_agents}</span></div>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground mt-3 font-mono">criado em {fmtDateTime(t.created_at)}</div>

            <div className="flex items-center gap-1 mt-4 pt-4 border-t border-border">
              <Button size="sm" variant="default" onClick={() => impersonate(t)} disabled={!t.active} data-testid={`tenant-enter-${t.id}`}>
                <LogIn size={12} className="mr-1.5" /> Acessar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(t)} data-testid={`tenant-edit-${t.id}`}>
                <Pencil size={12} />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDel(t)} data-testid={`tenant-delete-${t.id}`} className="text-red-600 hover:bg-red-50">
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <TenantFormDialog open={editing !== null} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmDel?.name}</strong> ({confirmDel?.domain}) e <strong>todos os seus dados</strong> (usuários, agentes, filas, chamadas, gravações) serão removidos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Excluir tudo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function TenantFormDialog({ open, editing, onClose, onSaved }) {
  const isNew = editing === "new";
  const initial = useMemo(() => {
    if (isNew || !editing) return { domain: "", name: "", accent_color: "#0EA5E9", logo_url: "", timezone: "America/Sao_Paulo", max_users: 50, max_agents: 50, active: true };
    return { ...editing, logo_url: editing.logo_url || "" };
  }, [editing, isNew]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setForm(initial); setErr(""); }, [initial]);

  async function save() {
    setErr(""); setSaving(true);
    try {
      const payload = { ...form, logo_url: form.logo_url || null };
      if (isNew) {
        await api.post("/tenants", payload);
        toast.success("Tenant criado");
      } else {
        // omit domain (immutable)
        const { domain, ...rest } = payload;
        await api.patch(`/tenants/${editing.id}`, rest);
        toast.success("Tenant atualizado");
      }
      onSaved();
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="tenant-form">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo Tenant" : `Editar ${editing?.name || ""}`}</DialogTitle>
          <DialogDescription>Configure domínio, marca, limites e status do tenant.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Domínio (FusionPBX)</Label>
            <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} disabled={!isNew} placeholder="empresa.com.br" data-testid="tf-domain" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Nome da empresa</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="tf-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Cor de destaque</Label>
            <div className="flex gap-2">
              <input type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                     className="h-9 w-14 rounded border border-border cursor-pointer" data-testid="tf-color" />
              <Input value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} className="font-mono" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL (opcional)</Label>
            <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…" data-testid="tf-logo" />
          </div>
          <div className="space-y-1.5">
            <Label>Limite de usuários</Label>
            <Input type="number" min={1} value={form.max_users} onChange={(e) => setForm({ ...form, max_users: parseInt(e.target.value) || 1 })} data-testid="tf-max-users" />
          </div>
          <div className="space-y-1.5">
            <Label>Limite de agentes</Label>
            <Input type="number" min={1} value={form.max_agents} onChange={(e) => setForm({ ...form, max_agents: parseInt(e.target.value) || 1 })} data-testid="tf-max-agents" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Fuso horário</Label>
            <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/Sao_Paulo" />
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer pt-2 border-t border-border">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="tf-active" />
              Tenant ativo
            </label>
          </div>
        </div>

        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">{err}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="tf-save">{saving ? "Salvando…" : (isNew ? "Criar" : "Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
