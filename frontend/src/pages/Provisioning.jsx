import { useEffect, useState, useMemo } from "react";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  Plus, Save, Trash2, Copy, Smartphone, Download, RefreshCw, Loader2, Search, ExternalLink, Eye, EyeOff,
} from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";

const TRANSPORTS = [
  { v: "udp", l: "UDP" },
  { v: "tcp", l: "TCP" },
  { v: "tls", l: "TLS" },
];

function formatMac(mac) {
  if (!mac) return "";
  const c = mac.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  return c.match(/.{1,2}/g)?.join(":") || c;
}

export default function Provisioning() {
  const [vendors, setVendors] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | device
  const [confirmDel, setConfirmDel] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [v, d] = await Promise.all([
        api.get("/provisioning/vendors"),
        api.get("/provisioning/devices"),
      ]);
      setVendors(v.data.vendors || []);
      setDevices(d.data.devices || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function regenerate(d) {
    try {
      await api.post(`/provisioning/devices/${d.id}/regenerate`);
      toast.success("Arquivo regerado");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  async function remove(d) {
    setConfirmDel(null);
    try {
      await api.delete(`/provisioning/devices/${d.id}`);
      toast.success("Aparelho removido");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  async function downloadCfg(d) {
    try {
      const res = await api.get(`/provisioning/devices/${d.id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.download = d.filename || "config";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error("Erro ao baixar"); }
  }

  function copyUrl(d) {
    if (!d.url) return;
    navigator.clipboard.writeText(d.url);
    toast.success("URL copiada para a área de transferência");
  }

  const filtered = devices.filter((d) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (d.mac || "").includes(s.replace(/\W/g, ""))
      || (d.extension || "").toLowerCase().includes(s)
      || (d.display_name || "").toLowerCase().includes(s)
      || (d.vendor || "").toLowerCase().includes(s);
  });

  return (
    <Layout title="Provisionamento de Aparelhos" subtitle="Gere automaticamente os arquivos de configuração para Yealink, Cisco, Polycom, Siemens, Flyvoice e Grandstream">
      <div className="bg-amber-50 border border-amber-300 rounded-sm p-4 mb-4 text-xs">
        <div className="font-semibold text-amber-900 mb-1">⚙️ Configuração necessária</div>
        <ol className="list-decimal list-inside text-amber-900/80 space-y-0.5">
          <li>No <code className="bg-amber-100 px-1">backend/.env</code> da VPS, defina <code className="bg-amber-100 px-1">PROVISIONING_PUBLIC_URL=https://seudominio.voxyra.net.br</code> (URL pública do Voxyra) e reinicie o backend.</li>
          <li>No telefone, aponte o "Provisioning Server URL" / "Alternate TFTP" para a URL exibida na coluna URL desta tabela.</li>
          <li>Para 0-touch via DHCP, configure a <strong>option 66</strong> ou <strong>150</strong> no servidor DHCP com o mesmo URL base.</li>
        </ol>
      </div>

      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm" placeholder="MAC, ramal, fabricante..."
            data-testid="prov-search" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}
            data-testid="prov-refresh">
            <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={() => setEditing("new")} data-testid="prov-new">
            <Plus size={14} className="mr-1.5" /> Adicionar aparelho
          </Button>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">MAC</th>
              <th className="px-4 py-3">Fabricante / Modelo</th>
              <th className="px-4 py-3">Ramal</th>
              <th className="px-4 py-3">Display</th>
              <th className="px-4 py-3">URL de provisionamento</th>
              <th className="px-4 py-3">Último fetch</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                <Smartphone size={32} className="mx-auto mb-2 opacity-30" />
                Nenhum aparelho cadastrado.
              </td></tr>
            ) : filtered.map((d) => (
              <tr key={d.id} className="hover:bg-zinc-50" data-testid={`prov-row-${d.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{formatMac(d.mac)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium uppercase text-xs">{d.vendor}</div>
                  {d.model && <div className="text-[11px] text-muted-foreground">{d.model}</div>}
                </td>
                <td className="px-4 py-3 font-mono font-bold">{d.extension}</td>
                <td className="px-4 py-3 text-xs">{d.display_name || "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => copyUrl(d)}
                    className="text-[11px] font-mono text-blue-600 hover:underline truncate max-w-xs block text-left"
                    title={d.url} data-testid={`prov-url-${d.id}`}>
                    {d.url}
                  </button>
                </td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground">
                  {d.last_fetched_at ? (
                    <>
                      <div>{new Date(d.last_fetched_at).toLocaleString("pt-BR")}</div>
                      {d.last_fetched_ip && <div className="font-mono text-zinc-400">{d.last_fetched_ip}</div>}
                    </>
                  ) : (
                    <span className="text-amber-700">Nunca baixado</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => copyUrl(d)} className="p-1 text-zinc-500 hover:text-blue-600"
                      title="Copiar URL" data-testid={`prov-copy-${d.id}`}><Copy size={14} /></button>
                    <button onClick={() => downloadCfg(d)} className="p-1 text-zinc-500 hover:text-emerald-600"
                      title="Baixar arquivo" data-testid={`prov-download-${d.id}`}><Download size={14} /></button>
                    <button onClick={() => regenerate(d)} className="p-1 text-zinc-500 hover:text-blue-600"
                      title="Regerar" data-testid={`prov-regen-${d.id}`}><RefreshCw size={14} /></button>
                    <button onClick={() => setEditing(d)} className="p-1 text-zinc-500 hover:text-foreground"
                      title="Editar" data-testid={`prov-edit-${d.id}`}><Smartphone size={14} /></button>
                    <button onClick={() => setConfirmDel(d)} className="p-1 text-zinc-500 hover:text-red-600"
                      title="Remover" data-testid={`prov-delete-${d.id}`}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeviceFormDialog open={editing !== null} editing={editing} vendors={vendors}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }} />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover aparelho</DialogTitle>
            <DialogDescription>
              {confirmDel && <>O aparelho <strong>{formatMac(confirmDel.mac)}</strong> ({confirmDel.vendor}, ramal {confirmDel.extension}) será removido. O arquivo de configuração também será deletado.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => remove(confirmDel)}
              data-testid="prov-confirm-delete">Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function DeviceFormDialog({ open, editing, vendors, onClose, onSaved }) {
  const isNew = editing === "new";
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setForm({
        mac: "", vendor: "yealink", model: "", extension: "",
        auth_user: "", auth_password: "", display_name: "", label: "",
        domain: "", sip_server: "", sip_port: 5060, transport: "udp",
        codecs: ["PCMA", "PCMU", "G722"], notes: "",
      });
    } else if (editing) {
      setForm({ ...editing, auth_password: "" });
    }
    setShowPwd(false);
  }, [open, editing, isNew]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.mac || form.mac.replace(/\W/g, "").length !== 12) {
      toast.error("MAC deve ter 12 caracteres hexadecimais"); return;
    }
    if (!form.extension || !/^\d{2,8}$/.test(form.extension)) {
      toast.error("Ramal inválido"); return;
    }
    if (isNew && !form.auth_password) {
      toast.error("Senha SIP obrigatória"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        mac: form.mac.replace(/\W/g, "").toLowerCase(),
        sip_port: Number(form.sip_port) || 5060,
      };
      if (!payload.auth_user) payload.auth_user = payload.extension;
      // Ao editar sem trocar senha, mantém a antiga
      if (!isNew && !payload.auth_password) payload.auth_password = editing.auth_password;
      let res;
      if (isNew) {
        res = await api.post("/provisioning/devices", payload);
      } else {
        res = await api.patch(`/provisioning/devices/${editing.id}`, payload);
      }
      toast.success(isNew ? `Aparelho criado · ${res.data.device.filename}` : "Aparelho atualizado");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="prov-form-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "Adicionar aparelho" : `Editar ${formatMac(editing?.mac)}`}</DialogTitle>
          <DialogDescription>
            Defina o MAC, fabricante, modelo e dados SIP. O Voxyra gera o arquivo de configuração e disponibiliza via HTTP para o telefone consumir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>MAC Address *</Label>
              <Input value={form.mac || ""}
                onChange={(e) => set("mac", e.target.value.replace(/[^a-fA-F0-9:.\- ]/g, ""))}
                placeholder="001122AABBCC ou 00:11:22:AA:BB:CC"
                className="font-mono uppercase"
                disabled={!isNew}
                data-testid="prov-mac" />
            </div>
            <div>
              <Label>Fabricante *</Label>
              <Select value={form.vendor} onValueChange={(v) => set("vendor", v)}>
                <SelectTrigger data-testid="prov-vendor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modelo (opcional)</Label>
              <Input value={form.model || ""} onChange={(e) => set("model", e.target.value)}
                placeholder="Ex: T46U, 6921, VVX 411..." data-testid="prov-model" />
            </div>
            <div>
              <Label>Ramal SIP *</Label>
              <Input value={form.extension || ""}
                onChange={(e) => set("extension", e.target.value.replace(/\D/g, ""))}
                placeholder="9165" maxLength={8} data-testid="prov-extension" />
            </div>
            <div>
              <Label>Usuário Auth (opcional, default = ramal)</Label>
              <Input value={form.auth_user || ""}
                onChange={(e) => set("auth_user", e.target.value)} data-testid="prov-auth-user" />
            </div>
            <div>
              <Label>Senha SIP {isNew ? "*" : "(deixe vazio para manter)"}</Label>
              <div className="relative">
                <Input type={showPwd ? "text" : "password"}
                  value={form.auth_password || ""}
                  onChange={(e) => set("auth_password", e.target.value)}
                  data-testid="prov-auth-password" />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <Label>Nome de exibição</Label>
              <Input value={form.display_name || ""}
                onChange={(e) => set("display_name", e.target.value)}
                placeholder="Paulo Barbosa" data-testid="prov-display-name" />
            </div>
            <div>
              <Label>Label da linha</Label>
              <Input value={form.label || ""} onChange={(e) => set("label", e.target.value)}
                placeholder="9165" data-testid="prov-label" />
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <h4 className="font-display font-semibold text-sm mb-2">Servidor SIP</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label>Endereço (deixe vazio para usar o domínio do tenant)</Label>
                <Input value={form.sip_server || ""}
                  onChange={(e) => set("sip_server", e.target.value)}
                  placeholder="grupoicore.cliente.voxyra.net.br" data-testid="prov-sip-server" />
              </div>
              <div>
                <Label>Porta</Label>
                <Input type="number" value={form.sip_port || 5060}
                  onChange={(e) => set("sip_port", e.target.value)}
                  data-testid="prov-sip-port" />
              </div>
              <div>
                <Label>Transporte</Label>
                <Select value={form.transport} onValueChange={(v) => set("transport", v)}>
                  <SelectTrigger data-testid="prov-transport"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSPORTS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <Input value={form.notes || ""} onChange={(e) => set("notes", e.target.value)}
              placeholder="Localização, sala, observações..." data-testid="prov-notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="prov-save">
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            {isNew ? "Criar e gerar config" : "Salvar e regerar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
