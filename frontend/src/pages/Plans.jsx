import { useEffect, useState, useMemo } from "react";
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
  const [catalog, setCatalog] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.get("/plans"), api.get("/plans/features-catalog")]);
      setPlans(p.data.plans);
      setCatalog(c.data.features);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const labelByKey = useMemo(() => Object.fromEntries(catalog.map(f => [f.key, f.label])), [catalog]);

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
                {(p.features || []).slice(0, 8).map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5"><Check size={11} className="text-emerald-600 mt-0.5 shrink-0" /> {labelByKey[f] || f}</li>
                ))}
                {(p.features || []).length > 8 && (
                  <li className="text-muted-foreground text-[10px] mt-1">+ {p.features.length - 8} outros recursos</li>
                )}
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
  const [catalog, setCatalog] = useState([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !editing) setForm({ name: "", description: "", monthly_price: 99, max_users: 10, max_agents: 10, features: [], active: true });
    else setForm({ ...editing, features: editing.features || [] });
    setErr("");
  }, [editing, isNew]);

  useEffect(() => {
    if (open) api.get("/plans/features-catalog").then(r => setCatalog(r.data.features)).catch(() => {});
  }, [open]);

  const grouped = useMemo(() => {
    const out = {};
    for (const f of catalog) {
      out[f.group] = out[f.group] || [];
      out[f.group].push(f);
    }
    return out;
  }, [catalog]);

  function toggleFeature(key) {
    const cur = new Set(form.features || []);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    setForm({ ...form, features: Array.from(cur) });
  }

  function selectAll(group) {
    const keys = grouped[group].map(f => f.key);
    const cur = new Set(form.features || []);
    keys.forEach(k => cur.add(k));
    setForm({ ...form, features: Array.from(cur) });
  }

  function clearAll(group) {
    const keys = new Set(grouped[group].map(f => f.key));
    setForm({ ...form, features: (form.features || []).filter(k => !keys.has(k)) });
  }

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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="plan-form">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo Plano" : `Editar ${editing?.name}`}</DialogTitle>
          <DialogDescription>Configure preço, limites e selecione os recursos incluídos.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2"><Label>Nome do plano</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="pf-name" /></div>
          <div className="space-y-1.5 col-span-2"><Label>Descrição (opcional)</Label><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Para quem este plano é indicado" /></div>
          <div className="space-y-1.5"><Label>Preço mensal (R$)</Label><Input type="number" step="0.01" value={form.monthly_price ?? ""} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} data-testid="pf-price" /></div>
          <div className="space-y-1.5"><Label>Usuários (máx · 999 = ∞)</Label><Input type="number" min="1" value={form.max_users ?? ""} onChange={(e) => setForm({ ...form, max_users: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2"><Label>Agentes (máx · 999 = ∞)</Label><Input type="number" min="1" value={form.max_agents ?? ""} onChange={(e) => setForm({ ...form, max_agents: e.target.value })} /></div>
        </div>

        {/* Features by group */}
        <div className="border-t border-border pt-4 mt-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Recursos do plano</div>
              <h4 className="font-display font-semibold">Selecione o que este plano inclui</h4>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{(form.features || []).length}/{catalog.length} ativos</span>
          </div>

          <div className="space-y-3">
            {Object.entries(grouped).map(([group, items]) => {
              const groupKeys = items.map(f => f.key);
              const groupActive = groupKeys.filter(k => (form.features || []).includes(k)).length;
              return (
                <div key={group} className="border border-border rounded-sm overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 border-b border-border">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                      {group} <span className="font-mono ml-1">({groupActive}/{items.length})</span>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => selectAll(group)} className="text-[10px] uppercase tracking-wider text-emerald-600 hover:text-emerald-700 px-1">tudo</button>
                      <span className="text-zinc-300">·</span>
                      <button type="button" onClick={() => clearAll(group)} className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-700 px-1">nada</button>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((f) => {
                      const checked = (form.features || []).includes(f.key);
                      return (
                        <label key={f.key} className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-50/50">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">{f.label}</div>
                            <div className="text-[10px] text-muted-foreground">{f.description}</div>
                          </div>
                          <Switch checked={checked} onCheckedChange={() => toggleFeature(f.key)} data-testid={`pf-feat-${f.key}`} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-border">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            Plano ativo (disponível para novos tenants)
          </label>
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
