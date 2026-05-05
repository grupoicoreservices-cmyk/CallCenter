import { useEffect, useState } from "react";
import { api, fmtDuration, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Users, Clock, TrendingDown, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function Queues() {
  const { user, tenantContext } = useAuth();
  const activeTenantId = user?.role === "super_admin" ? tenantContext : user?.tenant_id;
  const qs = activeTenantId ? `?tenant_id=${activeTenantId}` : "";
  const canEdit = ["super_admin", "admin"].includes(user?.role);
  const [queues, setQueues] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", extension: "", strategy: "ring-all", max_wait_time: 120 });
  const [saving, setSaving] = useState(false);

  async function load() {
    try { const r = await api.get("/queues"); setQueues(r.data.queues); }
    catch (e) { /* ignore */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function handleCreate(e) {
    e?.preventDefault();
    if (!form.name || !form.extension) { toast.error("Nome e ramal são obrigatórios"); return; }
    setSaving(true);
    try {
      const { data } = await api.post(`/fusionpbx/provision/queue${qs}`, form);
      toast.success(`Fila "${form.name}" criada no FusionPBX`);
      setOpen(false);
      setForm({ name: "", extension: "", strategy: "ring-all", max_wait_time: 120 });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao criar"); }
    finally { setSaving(false); }
  }

  async function handleDelete(q) {
    if (!window.confirm(`Excluir fila "${q.name}" do Voxyra E do FusionPBX?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await api.delete(`/fusionpbx/provision/queue/${q.id}${qs}`);
      toast.success("Fila removida");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao remover"); }
  }

  async function handleSetSla(q) {
    const current = q.sla_target_sec || 20;
    const v = window.prompt(
      `Meta de SLA para "${q.name}" (segundos para atender):\nDefault da indústria: 20s (80% das chamadas).`,
      String(current),
    );
    if (!v) return;
    const n = parseInt(v);
    if (isNaN(n) || n < 1 || n > 600) { toast.error("Informe entre 1 e 600 segundos"); return; }
    try {
      await api.put(`/queues/${q.id}/sla${qs}`, { sla_target_sec: n });
      toast.success(`Meta SLA "${q.name}" definida em ${n}s`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  return (
    <Layout title="Filas de Atendimento" subtitle="Monitoramento e configuração de filas do PBX">
      {canEdit && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setOpen(true)} data-testid="queue-create-btn">
            <Plus size={14} className="mr-1.5" /> Nova fila
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {queues.map((q) => (
          <div key={q.id} className="border border-border bg-card rounded-sm p-5 hover:shadow-sm transition-shadow" data-testid={`queue-card-${q.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Fila · {q.extension}</div>
                <h3 className="font-display text-xl font-bold mt-1">{q.name}</h3>
                <div className="text-xs text-muted-foreground mt-1">Estratégia: <span className="font-mono">{q.strategy}</span></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-zinc-50 border border-border px-2 py-1 rounded-sm" title={`Meta SLA: ${q.sla_target_sec || 20}s`}>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">SLA</span>
                  <span className="font-mono text-xs">{q.sla_target_sec || 20}s</span>
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-50 border border-border px-2 py-1 rounded-sm">
                  <Users size={12} className="text-muted-foreground" />
                  <span className="font-mono text-xs">{q.agent_count || 0}</span>
                </div>
                {canEdit && (
                  <button onClick={() => handleSetSla(q)}
                          className="text-blue-600 hover:text-blue-800 p-1"
                          title="Definir meta de SLA" data-testid={`queue-sla-${q.id}`}>
                    <Clock size={14} />
                  </button>
                )}
                {canEdit && q.external_id && (
                  <button onClick={() => handleDelete(q)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Excluir fila" data-testid={`queue-delete-${q.id}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-border">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Aguardando</div>
                <div className={`font-mono text-2xl font-medium mt-1 ${q.waiting > 5 ? "text-amber-600" : "text-foreground"}`}>{q.waiting}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Atendidas</div>
                <div className="font-mono text-2xl font-medium mt-1">{q.answered_today}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">hoje</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Perdidas</div>
                <div className="font-mono text-2xl font-medium mt-1 text-red-600">{q.missed_today}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">hoje</div>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock size={12} /> espera média <span className="font-mono text-foreground">{fmtDuration(q.avg_wait_sec)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingDown size={12} /> timeout <span className="font-mono text-foreground">{q.max_wait}s</span>
              </div>
            </div>
          </div>
        ))}
        {queues.length === 0 && (
          <div className="col-span-2 text-center text-muted-foreground py-12 border border-dashed border-border rounded-sm">
            Nenhuma fila cadastrada. {canEdit && "Clique em \"Nova fila\" para criar."}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova fila no FusionPBX</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Nome da fila *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                     placeholder="Suporte N1" data-testid="queue-form-name" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ramal *</Label>
                <Input value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })}
                       placeholder="5000" type="number" data-testid="queue-form-ext" required />
              </div>
              <div>
                <Label>Timeout (s)</Label>
                <Input value={form.max_wait_time} onChange={(e) => setForm({ ...form, max_wait_time: parseInt(e.target.value) || 120 })}
                       type="number" data-testid="queue-form-timeout" />
              </div>
            </div>
            <div>
              <Label>Estratégia</Label>
              <Select value={form.strategy} onValueChange={(v) => setForm({ ...form, strategy: v })}>
                <SelectTrigger data-testid="queue-form-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ring-all">ring-all (toca em todos)</SelectItem>
                  <SelectItem value="longest-idle-agent">longest-idle (agente mais ocioso)</SelectItem>
                  <SelectItem value="round-robin">round-robin</SelectItem>
                  <SelectItem value="top-down">top-down</SelectItem>
                  <SelectItem value="agent-with-least-talk-time">menos tempo falando</SelectItem>
                  <SelectItem value="agent-with-fewest-calls">menos chamadas</SelectItem>
                  <SelectItem value="random">random</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} data-testid="queue-form-submit">
                {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Criar e sincronizar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
