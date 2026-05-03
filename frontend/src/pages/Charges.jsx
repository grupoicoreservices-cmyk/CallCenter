import { useEffect, useState } from "react";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  CreditCard, Plus, RefreshCw, ExternalLink, Shield, Copy, QrCode, Check,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const STATUS_LABEL = {
  pending: { label: "Pendente", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "Confirmado", cls: "bg-blue-100 text-blue-700" },
  paid: { label: "Pago", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Atrasado", cls: "bg-red-100 text-red-700" },
  refunded: { label: "Reembolsado", cls: "bg-zinc-200 text-zinc-700" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelado", cls: "bg-zinc-200 text-zinc-700" },
  chargeback: { label: "Chargeback", cls: "bg-purple-100 text-purple-700" },
};

function StatusBadge({ s }) {
  const m = STATUS_LABEL[s] || STATUS_LABEL.pending;
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${m.cls}`}>{m.label}</span>;
}

export default function Charges() {
  const { user } = useAuth();
  const [charges, setCharges] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filterTenant !== "all") params.tenant_id = filterTenant;
      if (filterStatus !== "all") params.status = filterStatus;
      const [c, t] = await Promise.all([
        api.get("/billing/charges", { params }),
        tenants.length === 0 ? api.get("/tenants") : Promise.resolve({ data: { tenants } }),
      ]);
      setCharges(c.data.charges);
      if (t.data.tenants) setTenants(t.data.tenants);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar"); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user?.role === "super_admin") load(); /* eslint-disable-next-line */ }, [user, filterTenant, filterStatus]);

  if (user?.role !== "super_admin") {
    return <Layout title="Cobranças"><div className="border border-border bg-card rounded-sm p-12 text-center">
      <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
      <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
    </div></Layout>;
  }

  async function syncCharge(id) {
    try {
      await api.post(`/billing/charges/${id}/sync`);
      toast.success("Status atualizado");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao sincronizar"); }
  }

  return (
    <Layout
      title="Cobranças"
      subtitle="Asaas (PIX/Boleto/Cartão) · PayPal · Webhooks ativos"
      actions={
        <Button onClick={() => setCreating(true)} data-testid="btn-new-charge">
          <Plus size={14} className="mr-1.5" /> Nova cobrança
        </Button>
      }
    >
      <div className="flex gap-3 mb-4">
        <Select value={filterTenant} onValueChange={setFilterTenant}>
          <SelectTrigger className="max-w-[280px]" data-testid="filter-tenant"><SelectValue placeholder="Tenant" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tenants</SelectItem>
            {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.domain}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="max-w-[200px]" data-testid="filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
            <SelectItem value="overdue">Atrasado</SelectItem>
            <SelectItem value="refunded">Reembolsado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Criada</th>
              <th className="px-4 py-2.5 font-medium">Tenant</th>
              <th className="px-4 py-2.5 font-medium">Gateway / Método</th>
              <th className="px-4 py-2.5 font-medium">Valor</th>
              <th className="px-4 py-2.5 font-medium">Vencimento</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-muted-foreground font-mono">carregando…</td></tr>
            ) : charges.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Nenhuma cobrança encontrada.</td></tr>
            ) : charges.map((c) => {
              const tenant = tenants.find(t => t.id === c.tenant_id);
              return (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-zinc-50" data-testid={`charge-row-${c.id}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</td>
                  <td className="px-4 py-2.5">{tenant?.name || c.tenant_id.slice(0,8)}</td>
                  <td className="px-4 py-2.5 capitalize">{c.gateway} · {c.method.replace("_", " ")}</td>
                  <td className="px-4 py-2.5 font-mono">R$ {Number(c.amount).toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.due_date || "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge s={c.status} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setViewing(c)} data-testid={`charge-view-${c.id}`}>
                        <ExternalLink size={12} />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => syncCharge(c.id)} data-testid={`charge-sync-${c.id}`} title="Atualizar status">
                        <RefreshCw size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateChargeDialog open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} tenants={tenants} />
      <ChargeDetailsDialog open={!!viewing} charge={viewing} onClose={() => setViewing(null)} onSync={() => { syncCharge(viewing.id); setViewing(null); }} />
    </Layout>
  );
}

function CreateChargeDialog({ open, onClose, onCreated, tenants }) {
  const [form, setForm] = useState({
    tenant_id: "", gateway: "asaas", method: "pix",
    amount: "", description: "",
    customer_name: "", customer_email: "", customer_cpf_cnpj: "", customer_phone: "",
    due_date: "", currency: "BRL",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function pickTenant(tid) {
    const t = tenants.find(x => x.id === tid);
    if (!t) return setForm({ ...form, tenant_id: tid });
    setForm({
      ...form, tenant_id: tid,
      customer_name: form.customer_name || t.name,
      amount: form.amount || (t.contract_value ? String(t.contract_value) : ""),
    });
  }

  async function save() {
    setErr(""); setSaving(true);
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      if (!payload.due_date) delete payload.due_date;
      if (payload.gateway === "paypal") payload.method = "paypal";
      await api.post("/billing/charges", payload);
      toast.success("Cobrança criada");
      onCreated();
    } catch (e) { setErr(formatApiError(e.response?.data?.detail) || "Erro ao criar"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="charge-form">
        <DialogHeader>
          <DialogTitle>Nova cobrança</DialogTitle>
          <DialogDescription>Cobre um tenant via Asaas (PIX/Boleto/Cartão) ou PayPal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Tenant</Label>
            <Select value={form.tenant_id} onValueChange={pickTenant}>
              <SelectTrigger data-testid="cf-tenant"><SelectValue placeholder="Selecione um tenant" /></SelectTrigger>
              <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.domain}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Gateway</Label>
              <Select value={form.gateway} onValueChange={(v) => setForm({ ...form, gateway: v, method: v === "paypal" ? "paypal" : "pix" })}>
                <SelectTrigger data-testid="cf-gateway"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asaas">Asaas (BR)</SelectItem>
                  <SelectItem value="paypal">PayPal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Método</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })} disabled={form.gateway === "paypal"}>
                <SelectTrigger data-testid="cf-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {form.gateway === "asaas" ? (<>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                  </>) : (
                    <SelectItem value="paypal">PayPal Checkout</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="299.00" data-testid="cf-amount" />
            </div>
            <div><Label>Vencimento (opcional)</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          {form.gateway === "paypal" && (
            <div><Label>Moeda</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mensalidade Voxyra CCA · Fev/2026" />
          </div>
          <div className="border-t border-border pt-3 space-y-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Dados do Cliente</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} /></div>
            </div>
            {form.gateway === "asaas" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>CPF/CNPJ <span className="text-red-600">*</span></Label>
                  <Input value={form.customer_cpf_cnpj} onChange={(e) => setForm({ ...form, customer_cpf_cnpj: e.target.value })} placeholder="00000000000" data-testid="cf-cpf" />
                </div>
                <div><Label>Telefone</Label>
                  <Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="11999999999" />
                </div>
              </div>
            )}
          </div>
        </div>
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.tenant_id || !form.amount} data-testid="cf-save">
            {saving ? "Criando…" : "Criar cobrança"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDetailsDialog({ open, charge, onClose, onSync }) {
  if (!charge) return null;
  const copy = (txt) => { navigator.clipboard.writeText(txt); toast.success("Copiado"); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrança · {charge.gateway}</DialogTitle>
          <DialogDescription>{charge.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Valor</div>
              <div className="text-2xl font-mono font-bold">R$ {Number(charge.amount).toFixed(2)}</div>
            </div>
            <StatusBadge s={charge.status} />
          </div>

          {charge.pix_qrcode && (
            <div className="border border-border rounded p-3 bg-zinc-50">
              <div className="flex items-center gap-1 text-xs font-medium mb-2"><QrCode size={12} /> QR Code PIX</div>
              <img src={`data:image/png;base64,${charge.pix_qrcode}`} alt="QR PIX" className="mx-auto w-48 h-48 rounded bg-white border border-border" />
              {charge.pix_payload && (
                <div className="mt-2">
                  <Label className="text-[10px]">Pix Copia e Cola</Label>
                  <div className="flex gap-1 mt-1">
                    <Input value={charge.pix_payload} readOnly className="font-mono text-xs" />
                    <Button size="sm" variant="outline" onClick={() => copy(charge.pix_payload)}><Copy size={12} /></Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {charge.boleto_url && (
            <div className="border border-border rounded p-3 bg-zinc-50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Boleto Bancário</span>
                <a href={charge.boleto_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink size={12} className="mr-1" /> Abrir</Button>
                </a>
              </div>
              {charge.barcode && (
                <div className="mt-2">
                  <Label className="text-[10px]">Linha digitável</Label>
                  <div className="flex gap-1 mt-1">
                    <Input value={charge.barcode} readOnly className="font-mono text-xs" />
                    <Button size="sm" variant="outline" onClick={() => copy(charge.barcode)}><Copy size={12} /></Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {charge.checkout_url && (
            <a href={charge.checkout_url} target="_blank" rel="noreferrer" className="block">
              <Button className="w-full"><ExternalLink size={14} className="mr-1.5" /> Abrir Checkout PayPal</Button>
            </a>
          )}

          {charge.invoice_url && !charge.pix_qrcode && !charge.boleto_url && (
            <a href={charge.invoice_url} target="_blank" rel="noreferrer" className="block">
              <Button variant="outline" className="w-full"><ExternalLink size={14} className="mr-1.5" /> Ver fatura</Button>
            </a>
          )}

          <div className="text-[10px] text-muted-foreground font-mono space-y-1">
            <div>ID: {charge.id}</div>
            {charge.external_id && <div>Gateway ID: {charge.external_id}</div>}
            <div>Criada: {fmtDateTime(charge.created_at)}</div>
            {charge.paid_at && <div className="text-emerald-700"><Check size={10} className="inline" /> Paga em: {fmtDateTime(charge.paid_at)}</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={onSync}><RefreshCw size={14} className="mr-1.5" /> Atualizar Status</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
