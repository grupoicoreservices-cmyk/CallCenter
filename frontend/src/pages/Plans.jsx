import { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import { Plus, Pencil, Trash2, Check, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function Plans() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const { data } = await api.get("/plans"); setPlans(data.plans); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (user?.role !== "super_admin") {
    return (
      <Layout title="Planos"><div className="border border-border bg-card rounded-sm p-12 text-center">
        <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
        <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
        <p className="text-sm text-muted-foreground mt-1">Apenas super-administradores gerenciam planos.</p>
      </div></Layout>
    );
  }

  async function del(p) {
    if (!confirm(`Excluir plano "${p.name}"?`)) return;
    try { await api.delete(`/plans/${p.id}`); toast.success("Plano excluído"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  return (
    <Layout title="Planos & Contratos" subtitle="Estrutura de planos da plataforma — Basic / Pro / Enterprise"
      actions={<Button onClick={() => setEditing("new")} data-testid="btn-new-plan"><Plus size={14} className="mr-1.5" />Novo Plano</Button>}>
      {loading ? <div className="text-center text-muted-foreground py-8 font-mono text-sm">carregando…</div>
        : <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm flex flex-col" data-testid={`plan-card-${p.id}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
                    <Sparkles size={10} /> Plano
                  </div>
                  <h3 className="font-display text-2xl font-bold mt-1">{p.name}</h3>
                </div>
                {!p.active && <span className="text-[10px] text-red-600 font-medium uppercase tracking-widest">INATIVO</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-2 min-h-[40px]">{p.description || "—"}</p>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-mono text-4xl font-medium tracking-tight">
                  R$ {p.monthly_price.toFixed(2)}<span className="text-sm text-muted-foreground ml-1">/mês</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border text-xs">
                <div><span className="text-muted-foreground">Usuários:</span> <span className="font-mono">{p.max_users >= 999 ? "∞" : p.max_users}</span></div>
                <div><span className="text-muted-foreground">Agentes:</span> <span className="font-mono">{p.max_agents >= 999 ? "∞" : p.max_agents}</span></div>
              </div>
              <ul className="text-xs space-y-1.5 mt-4 pt-4 border-t border-border flex-1">
                {(p.features || []).map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5"><Check size={11} className="text-emerald-600 mt-0.5 shrink-0" /> {f}</li>
                ))}
              </ul>
              <div className="flex gap-1 mt-4 pt-4 border-t border-border">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(p)} data-testid={`plan-edit-${p.id}`}><Pencil size={12} className="mr-1.5" />Editar</Button>
                <Button size="sm" variant="outline" onClick={() => del(p)} className="text-red-600" data-testid={`plan-del-${p.id}`}><Trash2 size={12} /></Button>
              </div>
            </div>
          ))}
        </div>}
      <PlanDialog open={editing !== null} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </Layout>
  );
}

function PlanDialog({ open, editing, onClose, onSaved }) {
  const isNew = editing === "new";
  const [form, setForm] = useState({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !editing) setForm({ name: "", description: "", monthly_price: 99, max_users: 10, max_agents: 10, features: [], active: true });
    else setForm({ ...editing, features: editing.features || [] });
    setErr("");
  }, [editing, isNew]);

  async function save() {
    setErr(""); setSaving(true);
    try {
      const payload = { ...form, monthly_price: parseFloat(form.monthly_price), max_users: parseInt(form.max_users), max_agents: parseInt(form.max_agents) };
      if (isNew) await api.post("/plans", payload);
      else await api.patch(`/plans/${editing.id}`, payload);
      toast.success(isNew ? "Plano criado" : "Plano atualizado");
      onSaved();
    } catch (e) { setErr(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="plan-form">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo Plano" : `Editar ${editing?.name}`}</DialogTitle>
          <DialogDescription>Configure preço, limites e recursos do plano.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2"><Label>Nome</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="pf-name" /></div>
          <div className="space-y-1.5 col-span-2"><Label>Descrição</Label><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Preço mensal (R$)</Label><Input type="number" step="0.01" value={form.monthly_price ?? ""} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} data-testid="pf-price" /></div>
          <div className="space-y-1.5"><Label>Usuários (máx)</Label><Input type="number" min="1" value={form.max_users ?? ""} onChange={(e) => setForm({ ...form, max_users: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2"><Label>Agentes (máx)</Label><Input type="number" min="1" value={form.max_agents ?? ""} onChange={(e) => setForm({ ...form, max_agents: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2">
            <Label>Recursos (um por linha)</Label>
            <Textarea rows={5} value={(form.features || []).join("\n")} onChange={(e) => setForm({ ...form, features: e.target.value.split("\n").filter(Boolean) })} data-testid="pf-features" />
          </div>
          <div className="col-span-2 pt-2 border-t border-border">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              Plano ativo (disponível para novos tenants)
            </label>
          </div>
        </div>
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="pf-save">{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
