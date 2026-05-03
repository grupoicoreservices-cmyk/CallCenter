import { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { CreditCard, Save, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function BillingSettings() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    asaas_api_key: "", asaas_environment: "production", asaas_webhook_token: "",
    paypal_client_id: "", paypal_client_secret: "", paypal_environment: "live", paypal_webhook_id: "",
    enabled_methods: [],
  });
  const [meta, setMeta] = useState({});
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await api.get("/billing/settings");
    setForm({
      asaas_api_key: data.asaas_api_key || "",
      asaas_environment: data.asaas_environment || "production",
      asaas_webhook_token: data.asaas_webhook_token || "",
      paypal_client_id: data.paypal_client_id || "",
      paypal_client_secret: data.paypal_client_secret || "",
      paypal_environment: data.paypal_environment || "live",
      paypal_webhook_id: data.paypal_webhook_id || "",
      enabled_methods: data.enabled_methods || [],
    });
    setMeta({
      asaas_api_key_set: data.asaas_api_key_set,
      asaas_webhook_token_set: data.asaas_webhook_token_set,
      paypal_client_secret_set: data.paypal_client_secret_set,
    });
  }
  useEffect(() => { if (user?.role === "super_admin") load(); }, [user]);

  if (user?.role !== "super_admin") {
    return <Layout title="Cobrança"><div className="border border-border bg-card rounded-sm p-12 text-center">
      <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
      <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
    </div></Layout>;
  }

  async function save() {
    setSaving(true);
    try { await api.put("/billing/settings", form); toast.success("Configurações salvas"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  function toggleMethod(m) {
    const has = form.enabled_methods.includes(m);
    setForm({ ...form, enabled_methods: has ? form.enabled_methods.filter(x => x !== m) : [...form.enabled_methods, m] });
  }

  return (
    <Layout title="Configurações de Cobrança" subtitle="Credenciais Asaas e PayPal · Métodos de pagamento ativos">
      <div className="border border-amber-200 bg-amber-50 rounded-sm p-4 mb-4 flex items-start gap-3">
        <AlertCircle size={16} className="text-amber-600 mt-0.5" />
        <div className="text-xs text-amber-900">
          <strong>Configuração da plataforma.</strong> Estas credenciais são salvas com segurança e usadas para processar pagamentos dos tenants.
          Os campos sensíveis (API keys/secrets) ficam mascarados depois de salvos.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ASAAS */}
        <div className="border border-border bg-card rounded-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-emerald-600" />
            <h3 className="font-display text-lg font-semibold">Asaas</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Gateway brasileiro · PIX, Boleto, Cartão</p>
          <div className="space-y-3">
            <div><Label>Ambiente</Label>
              <Select value={form.asaas_environment} onValueChange={(v) => setForm({ ...form, asaas_environment: v })}>
                <SelectTrigger data-testid="bs-asaas-env"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>API Key {meta.asaas_api_key_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurada</span>}</Label>
              <Input value={form.asaas_api_key} onChange={(e) => setForm({ ...form, asaas_api_key: e.target.value })} placeholder="$aact_prod_..." data-testid="bs-asaas-key" />
            </div>
            <div><Label>Webhook Token {meta.asaas_webhook_token_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurado</span>}</Label>
              <Input value={form.asaas_webhook_token} onChange={(e) => setForm({ ...form, asaas_webhook_token: e.target.value })} placeholder="Token recebido no header asaas-access-token" />
            </div>
            <div className="text-[10px] text-muted-foreground">URL do webhook: <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded">/api/webhooks/asaas</code></div>
          </div>
        </div>

        {/* PAYPAL */}
        <div className="border border-border bg-card rounded-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-blue-600" />
            <h3 className="font-display text-lg font-semibold">PayPal</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Gateway global · Subscriptions e One-time</p>
          <div className="space-y-3">
            <div><Label>Ambiente</Label>
              <Select value={form.paypal_environment} onValueChange={(v) => setForm({ ...form, paypal_environment: v })}>
                <SelectTrigger data-testid="bs-paypal-env"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Live (produção)</SelectItem>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Client ID</Label>
              <Input value={form.paypal_client_id} onChange={(e) => setForm({ ...form, paypal_client_id: e.target.value })} placeholder="A21AAxxxx..." data-testid="bs-paypal-id" />
            </div>
            <div><Label>Client Secret {meta.paypal_client_secret_set && <span className="text-[10px] text-emerald-600 ml-1">✓ configurado</span>}</Label>
              <Input value={form.paypal_client_secret} onChange={(e) => setForm({ ...form, paypal_client_secret: e.target.value })} placeholder="EBxxxx..." data-testid="bs-paypal-secret" />
            </div>
            <div><Label>Webhook ID</Label>
              <Input value={form.paypal_webhook_id} onChange={(e) => setForm({ ...form, paypal_webhook_id: e.target.value })} placeholder="WH-xxxxx..." />
            </div>
            <div className="text-[10px] text-muted-foreground">URL do webhook: <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded">/api/webhooks/paypal</code></div>
          </div>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm p-5 mt-4">
        <h3 className="font-display text-lg font-semibold mb-3">Métodos de Pagamento Ativos</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { key: "pix", label: "PIX" },
            { key: "boleto", label: "Boleto" },
            { key: "credit_card", label: "Cartão de Crédito" },
            { key: "paypal", label: "PayPal" },
          ].map(m => (
            <label key={m.key} className="flex items-center gap-2 border border-border rounded-sm px-3 py-2 cursor-pointer hover:bg-zinc-50">
              <Switch checked={form.enabled_methods.includes(m.key)} onCheckedChange={() => toggleMethod(m.key)} data-testid={`bs-method-${m.key}`} />
              <span className="text-sm">{m.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={saving} data-testid="bs-save"><Save size={14} className="mr-1.5" />{saving ? "Salvando…" : "Salvar Configurações"}</Button>
      </div>
    </Layout>
  );
}
