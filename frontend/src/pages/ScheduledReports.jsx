import { useEffect, useState } from "react";
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
  Mail, Plus, Edit3, Trash2, PlayCircle, RefreshCw, CheckCircle2,
  AlertCircle, Send, Save, Server, Calendar, Clock, X, Loader2,
} from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";

const FREQUENCIES = [
  { v: "daily", l: "Diário" },
  { v: "weekly", l: "Semanal" },
  { v: "monthly", l: "Mensal" },
];

const PERIODS = [
  { v: "today", l: "Hoje" },
  { v: "7d", l: "Últimos 7 dias" },
  { v: "30d", l: "Últimos 30 dias" },
  { v: "90d", l: "Últimos 90 dias" },
];

const WEEKDAYS = [
  { v: 0, l: "Segunda" }, { v: 1, l: "Terça" }, { v: 2, l: "Quarta" },
  { v: 3, l: "Quinta" }, { v: 4, l: "Sexta" }, { v: 5, l: "Sábado" }, { v: 6, l: "Domingo" },
];

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

function freqLabel(rep) {
  const base = FREQUENCIES.find(f => f.v === rep.frequency)?.l || rep.frequency;
  if (rep.frequency === "weekly" && rep.schedule_day != null) {
    return `${base} · ${WEEKDAYS[rep.schedule_day]?.l || ""}`;
  }
  if (rep.frequency === "monthly" && rep.schedule_day != null) {
    return `${base} · dia ${rep.schedule_day}`;
  }
  return base;
}

export default function ScheduledReports() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [reportTypes, setReportTypes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [runningId, setRunningId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/scheduled-reports");
      setReports(res.data.reports || []);
      setReportTypes(res.data.report_types || []);
    } catch (e) {
      toast.error("Erro ao carregar agendamentos");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function runNow(rid) {
    setRunningId(rid);
    try {
      await api.post(`/scheduled-reports/${rid}/run-now`);
      toast.success("Email enviado com sucesso");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Falha ao enviar");
      load();
    } finally { setRunningId(null); }
  }

  async function doDelete() {
    if (!confirmDel) return;
    try {
      await api.delete(`/scheduled-reports/${confirmDel.id}`);
      toast.success("Agendamento removido");
      setConfirmDel(null); load();
    } catch (e) {
      toast.error("Erro ao remover");
    }
  }

  return (
    <Layout title="Relatórios Agendados"
      subtitle="Envio automático por email · diário, semanal ou mensal">
      <div className="flex items-center justify-between mb-4 gap-2">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}
          data-testid="sched-refresh">
          <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSmtpOpen(true)}
            data-testid="sched-smtp-open">
            <Server size={13} className="mr-1.5" /> Configurar SMTP
          </Button>
          <Button onClick={() => setEditing({})} data-testid="sched-new">
            <Plus size={14} className="mr-1.5" /> Novo agendamento
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : reports.length === 0 ? (
        <div className="border border-border bg-card rounded-sm p-12 text-center">
          <Mail size={32} className="mx-auto mb-3 text-muted-foreground" />
          <div className="font-display text-base font-medium mb-1">
            Nenhum agendamento criado
          </div>
          <div className="text-sm text-muted-foreground mb-4">
            Configure o SMTP primeiro, depois crie agendamentos para receber relatórios por email.
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => setSmtpOpen(true)}>
              <Server size={13} className="mr-1.5" /> Configurar SMTP
            </Button>
            <Button onClick={() => setEditing({})}>
              <Plus size={13} className="mr-1.5" /> Criar agendamento
            </Button>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card rounded-sm overflow-hidden"
          data-testid="sched-list">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Relatório</th>
                <th className="px-3 py-2 text-left">Frequência</th>
                <th className="px-3 py-2 text-left">Horário</th>
                <th className="px-3 py-2 text-left">Próxima execução</th>
                <th className="px-3 py-2 text-left">Última</th>
                <th className="px-3 py-2 text-center w-16">Ativo</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reports.map(r => {
                const typeLabel = reportTypes.find(t => t.key === r.report_type)?.label
                                    || r.report_type;
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      <div>{typeLabel}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.formats?.map(f => f.toUpperCase()).join(" + ")} · {r.report_period}
                      </div>
                    </td>
                    <td className="px-3 py-2">{freqLabel(r)}</td>
                    <td className="px-3 py-2 font-mono">{r.schedule_time}</td>
                    <td className="px-3 py-2 text-muted-foreground text-[11px]">
                      {fmtDateTime(r.next_run_at)}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {r.last_run_status === "ok" ? (
                        <span className="text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 size={11} />
                          {fmtDateTime(r.last_run_at)}
                        </span>
                      ) : r.last_run_status === "error" ? (
                        <span className="text-red-700 flex items-center gap-1" title={r.last_run_error || ""}>
                          <AlertCircle size={11} />
                          erro · {fmtDateTime(r.last_run_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.enabled ? (
                        <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full" />
                      ) : (
                        <span className="inline-block w-2 h-2 bg-zinc-300 rounded-full" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => runNow(r.id)}
                          disabled={runningId === r.id}
                          data-testid={`sched-run-${r.id}`}
                          title="Enviar agora">
                          {runningId === r.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Send size={13} />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}
                          data-testid={`sched-edit-${r.id}`} title="Editar">
                          <Edit3 size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDel(r)}
                          data-testid={`sched-del-${r.id}`} title="Remover">
                          <Trash2 size={13} className="text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ScheduleDialog open={editing !== null} editing={editing} types={reportTypes}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }} />

      <SmtpDialog open={smtpOpen} onClose={() => setSmtpOpen(false)} />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover agendamento?</DialogTitle>
            <DialogDescription>
              "{confirmDel?.name}" deixará de enviar emails. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={doDelete}
              data-testid="sched-del-confirm">
              <Trash2 size={13} className="mr-1.5" /> Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

/* ───────────────── Schedule Dialog ───────────────── */
function ScheduleDialog({ open, editing, types, onClose, onSaved }) {
  const isNew = editing && !editing.id;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recipientsText, setRecipientsText] = useState("");

  useEffect(() => {
    if (!editing) { setForm(null); return; }
    if (editing.id) {
      setForm({ ...editing });
      setRecipientsText((editing.recipients || []).join(", "));
    } else {
      setForm({
        name: "", report_type: "cdr", report_period: "7d", frequency: "daily",
        schedule_time: "08:00", schedule_day: null,
        recipients: [], formats: ["pdf"], enabled: true,
      });
      setRecipientsText("");
    }
  }, [editing]);

  if (!form) return null;
  const set = (patch) => setForm({ ...form, ...patch });

  function toggleFormat(f) {
    const has = form.formats.includes(f);
    set({ formats: has ? form.formats.filter(x => x !== f) : [...form.formats, f] });
  }

  async function save() {
    const recipients = recipientsText.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!form.name.trim()) { toast.error("Informe um nome"); return; }
    if (!recipients.length) { toast.error("Informe ao menos um destinatário"); return; }
    if (!form.formats?.length) { toast.error("Selecione ao menos um formato"); return; }
    const payload = { ...form, recipients };
    setSaving(true);
    try {
      if (isNew) await api.post("/scheduled-reports", payload);
      else await api.put(`/scheduled-reports/${form.id}`, payload);
      toast.success(isNew ? "Agendamento criado" : "Agendamento atualizado");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="sched-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo agendamento" : "Editar agendamento"}</DialogTitle>
          <DialogDescription>
            Envia automaticamente o relatório por email na frequência configurada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Nome do agendamento</Label>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex: Relatório diário operacional"
              data-testid="sched-name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo de relatório</Label>
              <Select value={form.report_type} onValueChange={(v) => set({ report_type: v })}>
                <SelectTrigger data-testid="sched-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Período dos dados</Label>
              <Select value={form.report_period} onValueChange={(v) => set({ report_period: v })}>
                <SelectTrigger data-testid="sched-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map(p => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Frequência</Label>
              <Select value={form.frequency} onValueChange={(v) => set({ frequency: v, schedule_day: v === "daily" ? null : (form.schedule_day ?? (v === "weekly" ? 0 : 1)) })}>
                <SelectTrigger data-testid="sched-freq"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map(f => <SelectItem key={f.v} value={f.v}>{f.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.frequency === "weekly" && (
              <div>
                <Label>Dia da semana</Label>
                <Select value={String(form.schedule_day ?? 0)}
                  onValueChange={(v) => set({ schedule_day: parseInt(v) })}>
                  <SelectTrigger data-testid="sched-weekday"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map(d => <SelectItem key={d.v} value={String(d.v)}>{d.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.frequency === "monthly" && (
              <div>
                <Label>Dia do mês (1-28)</Label>
                <Input type="number" min={1} max={28} value={form.schedule_day ?? 1}
                  onChange={(e) => set({ schedule_day: parseInt(e.target.value) || 1 })}
                  data-testid="sched-monthday" />
              </div>
            )}
            <div className={form.frequency === "daily" ? "col-span-2" : ""}>
              <Label>Horário (24h)</Label>
              <Input type="time" value={form.schedule_time}
                onChange={(e) => set({ schedule_time: e.target.value })}
                data-testid="sched-time" />
            </div>
          </div>

          <div>
            <Label>Destinatários (separe por vírgula)</Label>
            <Input value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)}
              placeholder="diretor@empresa.com, supervisor@empresa.com"
              data-testid="sched-recipients" />
            <div className="text-[10px] text-muted-foreground mt-1">
              Você pode adicionar quantos emails quiser.
            </div>
          </div>

          <div>
            <Label>Formato do anexo</Label>
            <div className="flex gap-3 mt-1">
              {["pdf", "xlsx"].map(f => (
                <label key={f} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.formats.includes(f)}
                    onChange={() => toggleFormat(f)}
                    data-testid={`sched-format-${f}`} />
                  <span className="text-sm uppercase font-mono">{f}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })}
              data-testid="sched-enabled" />
            <Label className="cursor-pointer">
              {form.enabled ? "Ativo · envia automaticamente" : "Pausado · não envia"}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="sched-save">
            {saving ? <Loader2 size={13} className="mr-1.5 animate-spin" />
                    : <Save size={13} className="mr-1.5" />}
            {isNew ? "Criar agendamento" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────── SMTP Dialog ───────────────── */
function SmtpDialog({ open, onClose }) {
  const [smtp, setSmtp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/smtp/settings").then(r => {
      const s = r.data || {};
      setSmtp({
        host: s.host || "", port: s.port || 587,
        username: s.username || "", password: "",
        from_email: s.from_email || "",
        from_name: s.from_name || "Voxyra CCA",
        use_tls: s.use_tls != null ? s.use_tls : true,
        use_ssl: s.use_ssl || false,
        has_password: s.has_password || false,
      });
    }).finally(() => setLoading(false));
  }, [open]);

  if (!smtp) return null;
  const set = (p) => setSmtp({ ...smtp, ...p });

  async function save() {
    if (!smtp.host || !smtp.from_email) {
      toast.error("Host e Email remetente são obrigatórios"); return;
    }
    setSaving(true);
    try {
      const payload = { ...smtp };
      delete payload.has_password;
      await api.put("/smtp/settings", payload);
      toast.success("SMTP configurado");
      const r = await api.get("/smtp/settings");
      const s = r.data || {};
      setSmtp({ ...smtp, password: "", has_password: s.has_password });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally { setSaving(false); }
  }

  async function testSend() {
    if (!testTo) { toast.error("Informe um email para testar"); return; }
    setTesting(true);
    try {
      const r = await api.post("/smtp/test", { to_email: testTo });
      toast.success(r.data?.message || "Email de teste enviado");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Falha no teste");
    } finally { setTesting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !testing && !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="smtp-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server size={16} /> Configurar SMTP
          </DialogTitle>
          <DialogDescription>
            Credenciais usadas para enviar os relatórios agendados.
            {smtp.has_password && (
              <span className="block mt-1 text-emerald-700 text-[11px]">
                ✓ Senha já configurada · deixe vazio para manter
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Servidor SMTP</Label>
                <Input value={smtp.host} onChange={(e) => set({ host: e.target.value })}
                  placeholder="smtp.gmail.com" data-testid="smtp-host" />
              </div>
              <div>
                <Label>Porta</Label>
                <Input type="number" value={smtp.port}
                  onChange={(e) => set({ port: parseInt(e.target.value) || 587 })}
                  data-testid="smtp-port" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Usuário</Label>
                <Input value={smtp.username} onChange={(e) => set({ username: e.target.value })}
                  placeholder="usuario@dominio.com" data-testid="smtp-user" />
              </div>
              <div>
                <Label>Senha {smtp.has_password ? "(opcional)" : ""}</Label>
                <Input type="password" value={smtp.password}
                  onChange={(e) => set({ password: e.target.value })}
                  placeholder={smtp.has_password ? "Deixe vazio para manter" : ""}
                  data-testid="smtp-pass" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email remetente</Label>
                <Input type="email" value={smtp.from_email}
                  onChange={(e) => set({ from_email: e.target.value })}
                  placeholder="noreply@empresa.com" data-testid="smtp-from-email" />
              </div>
              <div>
                <Label>Nome do remetente</Label>
                <Input value={smtp.from_name}
                  onChange={(e) => set({ from_name: e.target.value })}
                  placeholder="Voxyra CCA" data-testid="smtp-from-name" />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={smtp.use_tls}
                  onChange={(e) => set({ use_tls: e.target.checked, use_ssl: e.target.checked ? false : smtp.use_ssl })} />
                <span className="text-sm">STARTTLS (porta 587)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={smtp.use_ssl}
                  onChange={(e) => set({ use_ssl: e.target.checked, use_tls: e.target.checked ? false : smtp.use_tls })} />
                <span className="text-sm">SSL/TLS (porta 465)</span>
              </label>
            </div>

            <div className="border-t border-border pt-3 mt-3">
              <Label className="text-[11px] text-muted-foreground uppercase tracking-widest">
                Teste de envio
              </Label>
              <div className="flex gap-2 mt-1">
                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)}
                  placeholder="seu@email.com para receber o teste"
                  data-testid="smtp-test-to" />
                <Button variant="outline" size="sm" onClick={testSend}
                  disabled={!smtp.host || testing}
                  data-testid="smtp-test-btn">
                  {testing ? <Loader2 size={13} className="animate-spin" />
                          : <Send size={13} />}
                  <span className="ml-1.5">Enviar teste</span>
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Salve as credenciais antes de testar.
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Fechar</Button>
          <Button onClick={save} disabled={saving} data-testid="smtp-save">
            {saving ? <Loader2 size={13} className="mr-1.5 animate-spin" />
                    : <Save size={13} className="mr-1.5" />}
            Salvar credenciais
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
