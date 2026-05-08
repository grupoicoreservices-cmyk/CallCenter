import { useEffect, useState } from "react";
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
import { api, formatApiError } from "../lib/api";
import { toast } from "sonner";
import {
  Phone, PhoneIncoming, Server, Award, Plus, Save, Trash2, Edit3,
  Loader2, Search, RefreshCw, Mic, Voicemail, Eye, EyeOff,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const TABS = [
  { k: "ext", label: "Ramais", icon: Phone },
  { k: "did", label: "DIDs (entrada)", icon: PhoneIncoming },
  { k: "trunk", label: "Troncos", icon: Server },
  { k: "lic", label: "Licenças", icon: Award },
];

export default function Manager() {
  const [tab, setTab] = useState("ext");
  return (
    <Layout title="Manager PBX" subtitle="Gerencie ramais, DIDs, troncos e licenças do FusionPBX">
      <div className="border-b border-border mb-5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            data-testid={`mgr-tab-${t.k}`}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors whitespace-nowrap ${
              tab === t.k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "ext" && <ExtensionsTab />}
      {tab === "did" && <DidsTab />}
      {tab === "trunk" && <TrunksTab />}
      {tab === "lic" && <LicensesTab />}
    </Layout>
  );
}

// ============== RAMAIS ==============
function ExtensionsTab() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/extensions");
      setList(data.extensions || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function remove(ext) {
    setConfirmDel(null);
    try {
      await api.delete(`/pbx/extensions/${ext.uuid}`);
      toast.success(`Ramal ${ext.extension} removido`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  const filtered = list.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.extension || "").includes(s) || (r.caller_id_name || "").toLowerCase().includes(s);
  });

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm" placeholder="Buscar ramal ou nome..."
            data-testid="mgr-ext-search" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button onClick={() => setCreating(true)} data-testid="mgr-ext-new">
            <Plus size={14} className="mr-1.5" /> Novo ramal
          </Button>
        </div>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">Ramal</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Reg. SIP</th>
              <th className="px-4 py-3">IP / Porta</th>
              <th className="px-4 py-3">Aparelho</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum ramal.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.uuid} className="hover:bg-zinc-50" data-testid={`mgr-ext-row-${r.extension}`}>
                <td className="px-4 py-3 font-mono font-bold">{r.extension}</td>
                <td className="px-4 py-3">{r.caller_id_name || "—"}</td>
                <td className="px-4 py-3 text-xs">{r.enabled ? <span className="text-emerald-700">Habilitado</span> : <span className="text-zinc-500">Desativado</span>}</td>
                <td className="px-4 py-3 text-xs">{r.registered ? <span className="text-emerald-700">Online</span> : <span className="text-zinc-500">Offline</span>}</td>
                <td className="px-4 py-3 text-[11px] font-mono">
                  {r.registration ? (
                    <div className="leading-tight">
                      {r.registration.public_ip && (
                        <div title="IP público">
                          <span className="text-muted-foreground">pub:</span> {r.registration.public_ip}
                          {r.registration.public_port ? `:${r.registration.public_port}` : ""}
                        </div>
                      )}
                      {r.registration.internal_ip && r.registration.internal_ip !== r.registration.public_ip && (
                        <div title="IP interno">
                          <span className="text-muted-foreground">int:</span> {r.registration.internal_ip}
                          {r.registration.internal_port ? `:${r.registration.internal_port}` : ""}
                        </div>
                      )}
                      {r.registration.transport && (
                        <div className="text-[10px] uppercase tracking-widest">
                          <span className={`px-1 rounded ${r.registration.transport === 'tls' ? 'bg-emerald-100 text-emerald-700' : r.registration.transport === 'tcp' ? 'bg-blue-100 text-blue-700' : 'bg-zinc-100 text-zinc-700'}`}>
                            {r.registration.transport}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : <span className="text-zinc-400">—</span>}
                </td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-[200px] truncate" title={r.registration?.user_agent}>
                  {r.registration?.user_agent || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}
                    data-testid={`mgr-ext-edit-${r.extension}`}>
                    <Edit3 size={12} className="mr-1.5" /> Editar
                  </Button>
                  <button onClick={() => setConfirmDel(r)} className="ml-1 text-zinc-500 hover:text-red-600 p-1">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ExtensionEditDialog open={!!editing} ext={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      <ExtensionCreateDialog open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover ramal {confirmDel?.extension}?</DialogTitle>
            <DialogDescription>Esta ação remove o ramal do FusionPBX. Não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => remove(confirmDel)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExtensionEditDialog({ open, ext, onClose, onSaved }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !ext) return;
    (async () => {
      setLoading(true);
      try {
        const { data: r } = await api.get(`/pbx/extensions/${ext.uuid}/full`);
        const d = r.extension || {};
        const _str = (v) => (v === null || v === undefined ? "" : String(v));
        const _bool = (v) => {
          if (v === true || v === false) return v;
          return _str(v).toLowerCase() === "true";
        };
        setData({
          caller_id_name: _str(d.effective_caller_id_name) || ext?.caller_id_name || "",
          caller_id_internal: _str(d.effective_caller_id_number) || ext?.extension || "",
          caller_id_external_name: _str(d.outbound_caller_id_name),
          caller_id_external: _str(d.outbound_caller_id_number),
          voicemail_enabled: _bool(d.voicemail_enabled),
          voicemail_password: _str(d.voicemail_password),
          voicemail_mail_to: _str(d.voicemail_mail_to),
          user_record: _str(d.user_record) || "none",
          call_group: _str(d.call_group),
          pickup_group: _str(d.pickup_group),
          accountcode: _str(d.accountcode),
          description: _str(d.description) || ext?.description || "",
          enabled: d.enabled === null || d.enabled === undefined ? true : _bool(d.enabled),
        });
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar ramal");
        // Inicializa com defaults usando o que veio da listagem para não bloquear edição
        setData({
          caller_id_name: ext?.caller_id_name || "",
          caller_id_internal: ext?.extension || "",
          caller_id_external_name: "",
          caller_id_external: "",
          voicemail_enabled: false,
          voicemail_password: "",
          voicemail_mail_to: "",
          user_record: "none",
          call_group: "",
          pickup_group: "",
          accountcode: "",
          description: ext?.description || "",
          enabled: ext?.enabled !== false,
        });
      }
      finally { setLoading(false); }
    })();
  }, [open, ext]);

  function set(k, v) { setData((d) => ({ ...d, [k]: v })); }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/pbx/extensions/${ext.uuid}`, data);
      toast.success("Ramal atualizado");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  if (!open || !ext) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="mgr-ext-edit">
        <DialogHeader>
          <DialogTitle>Editar ramal {ext.extension}</DialogTitle>
          <DialogDescription>Atualize informações do ramal SIP no FusionPBX.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Nome (Caller-ID interno)</Label>
                <Input value={data.caller_id_name || ""} onChange={(e) => set("caller_id_name", e.target.value)} data-testid="mgr-ext-name" />
              </div>
              <div>
                <Label>CID interno (número)</Label>
                <Input value={data.caller_id_internal || ""} onChange={(e) => set("caller_id_internal", e.target.value)} className="font-mono" data-testid="mgr-ext-cid-int" />
              </div>
              <div>
                <Label>CID externo (nome)</Label>
                <Input value={data.caller_id_external_name || ""} onChange={(e) => set("caller_id_external_name", e.target.value)} />
              </div>
              <div>
                <Label>CID externo (número)</Label>
                <Input value={data.caller_id_external || ""} onChange={(e) => set("caller_id_external", e.target.value)} className="font-mono" data-testid="mgr-ext-cid-ext" />
              </div>
              <div>
                <Label>Categoria (account code)</Label>
                <Input value={data.accountcode || ""} onChange={(e) => set("accountcode", e.target.value)} placeholder="Ex: vendas, suporte..." data-testid="mgr-ext-cat" />
              </div>
              <div>
                <Label>Grupo de captura (pickup_group)</Label>
                <Input value={data.pickup_group || ""} onChange={(e) => set("pickup_group", e.target.value)} placeholder="Ex: comercial" data-testid="mgr-ext-pickup" />
              </div>
              <div>
                <Label>Grupo de chamada (call_group)</Label>
                <Input value={data.call_group || ""} onChange={(e) => set("call_group", e.target.value)} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={data.description || ""} onChange={(e) => set("description", e.target.value)} />
              </div>
            </div>

            <div className="border-t border-border pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 cursor-pointer p-3 border border-border rounded-sm hover:bg-zinc-50">
                <input type="checkbox" checked={!!data.voicemail_enabled} onChange={(e) => set("voicemail_enabled", e.target.checked)} data-testid="mgr-ext-vm" />
                <Voicemail size={14} /> Correio de voz
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border border-border rounded-sm hover:bg-zinc-50">
                <input type="checkbox" checked={!!data.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="mgr-ext-enabled" />
                Ramal ativo
              </label>
              <div className="md:col-span-1">
                <Label className="flex items-center gap-1.5 text-xs"><Mic size={12} /> Gravação</Label>
                <Select value={data.user_record} onValueChange={(v) => set("user_record", v)}>
                  <SelectTrigger className="h-9 text-sm" data-testid="mgr-ext-record"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Desativada</SelectItem>
                    <SelectItem value="all">Todas as chamadas</SelectItem>
                    <SelectItem value="inbound">Apenas entrantes</SelectItem>
                    <SelectItem value="outbound">Apenas saintes</SelectItem>
                    <SelectItem value="local">Apenas internas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {data.voicemail_enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-border pt-3">
                <div>
                  <Label>Senha do correio</Label>
                  <Input value={data.voicemail_password || ""} onChange={(e) => set("voicemail_password", e.target.value)} className="font-mono" data-testid="mgr-ext-vm-pwd" />
                </div>
                <div>
                  <Label>E-mail para receber gravação</Label>
                  <Input type="email" value={data.voicemail_mail_to || ""} onChange={(e) => set("voicemail_mail_to", e.target.value)} placeholder="ex: paulo@empresa.com.br" data-testid="mgr-ext-vm-email" />
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || loading} data-testid="mgr-ext-save">
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtensionCreateDialog({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    extension: "", sip_password: "", caller_id_name: "", caller_id_number: "", description: "",
  });
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    if (open) setForm({ extension: "", sip_password: Math.random().toString(36).slice(-12), caller_id_name: "", caller_id_number: "", description: "" });
  }, [open]);

  async function save() {
    if (!/^\d{2,8}$/.test(form.extension)) { toast.error("Ramal inválido"); return; }
    if (!form.sip_password || form.sip_password.length < 6) { toast.error("Senha SIP min 6 chars"); return; }
    if (!form.caller_id_name) { toast.error("Nome obrigatório"); return; }
    setSaving(true);
    try {
      await api.post("/pbx/extensions", form);
      toast.success(`Ramal ${form.extension} criado`);
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="mgr-ext-create">
        <DialogHeader>
          <DialogTitle>Novo ramal</DialogTitle>
          <DialogDescription>Crie um ramal SIP no FusionPBX.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Número *</Label>
            <Input value={form.extension} maxLength={8} onChange={(e) => setForm({ ...form, extension: e.target.value.replace(/\D/g, "") })} data-testid="mgr-ext-create-number" /></div>
          <div><Label>Nome *</Label>
            <Input value={form.caller_id_name} onChange={(e) => setForm({ ...form, caller_id_name: e.target.value })} data-testid="mgr-ext-create-name" /></div>
          <div><Label>Caller-ID número (default = ramal)</Label>
            <Input value={form.caller_id_number} onChange={(e) => setForm({ ...form, caller_id_number: e.target.value })} /></div>
          <div><Label>Senha SIP *</Label>
            <div className="relative">
              <Input type={showPwd ? "text" : "password"} value={form.sip_password} onChange={(e) => setForm({ ...form, sip_password: e.target.value })} className="font-mono" data-testid="mgr-ext-create-pwd" />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">{showPwd ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div><Label>Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="mgr-ext-create-save">
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== DIDs ==============
function DidsTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/pbx/dids");
      setList(data.dids || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function remove(d) {
    if (!window.confirm(`Remover DID ${d.dialplan_number}?`)) return;
    try {
      await api.delete(`/pbx/dids/${d.uuid}`);
      toast.success("DID removido");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-muted-foreground">Configure os números DID que recebem chamadas externas e direcione cada um a um ramal/fila.</div>
        <Button onClick={() => setEditing("new")} data-testid="mgr-did-new"><Plus size={14} className="mr-1.5" /> Novo DID</Button>
      </div>

      <div className="border border-border bg-card rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-border">
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              <th className="px-4 py-3">DID</th><th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Destino</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              : list.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum DID cadastrado.</td></tr>
              : list.map((d) => (
                <tr key={d.uuid} className="hover:bg-zinc-50" data-testid={`mgr-did-row-${d.dialplan_number}`}>
                  <td className="px-4 py-3 font-mono font-bold">{d.dialplan_number}</td>
                  <td className="px-4 py-3">{d.dialplan_name || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.target || "—"}</td>
                  <td className="px-4 py-3 text-xs">{(d.dialplan_enabled || "").toLowerCase() === "true" ? <span className="text-emerald-700">Ativo</span> : <span className="text-zinc-500">Inativo</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(d)} data-testid={`mgr-did-edit-${d.dialplan_number}`}><Edit3 size={12} /></Button>
                    <button onClick={() => remove(d)} className="ml-1 text-zinc-500 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <DidEditDialog open={editing !== null} did={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </>
  );
}

function DidEditDialog({ open, did, onClose, onSaved }) {
  const isNew = did === "new";
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isNew) setForm({ did_number: "", target_extension: "", name: "", enabled: true, description: "" });
    else if (did) setForm({
      did_number: did.dialplan_number || "",
      target_extension: did.target || "",
      name: did.dialplan_name || "",
      enabled: (did.dialplan_enabled || "").toLowerCase() === "true",
      description: did.dialplan_description || "",
    });
  }, [open, did, isNew]);

  async function save() {
    if (!/^\d+$/.test(form.did_number)) { toast.error("DID inválido"); return; }
    if (!form.target_extension) { toast.error("Destino obrigatório"); return; }
    setSaving(true);
    try {
      if (isNew) await api.post("/pbx/dids", form);
      else await api.put(`/pbx/dids/${did.uuid}`, form);
      toast.success(isNew ? "DID criado" : "DID atualizado");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="mgr-did-edit">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo DID" : `Editar DID ${did?.dialplan_number}`}</DialogTitle>
          <DialogDescription>Vincule um número externo a um destino interno.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Número DID *</Label>
            <Input value={form.did_number || ""} onChange={(e) => setForm({ ...form, did_number: e.target.value.replace(/\D/g, "") })} className="font-mono" placeholder="552133334444" data-testid="mgr-did-number" /></div>
          <div><Label>Destino (ramal ou fila) *</Label>
            <Input value={form.target_extension || ""} onChange={(e) => setForm({ ...form, target_extension: e.target.value })} className="font-mono" placeholder="Ex: 9165 ou 600" data-testid="mgr-did-target" /></div>
          <div><Label>Nome</Label>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Comercial RJ" /></div>
          <div><Label>Descrição</Label>
            <Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} data-testid="mgr-did-enabled" />
            DID ativo
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="mgr-did-save">
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== TRUNKS ==============
function TrunksTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    setLoading(true);
    try { const { data } = await api.get("/pbx/trunks"); setList(data.trunks || []); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  })(); }, []);

  return (
    <div className="border border-border bg-card rounded-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-border">
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            <th className="px-4 py-3">Tronco</th><th className="px-4 py-3">Usuário</th>
            <th className="px-4 py-3">Proxy</th><th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Descrição</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            : list.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum tronco. Cadastre via FusionPBX → Accounts → Gateways.</td></tr>
            : list.map((t) => (
              <tr key={t.gateway_uuid} className="hover:bg-zinc-50" data-testid={`mgr-trunk-${t.gateway}`}>
                <td className="px-4 py-3 font-bold">{t.gateway}</td>
                <td className="px-4 py-3 text-xs font-mono">{t.username || "—"}</td>
                <td className="px-4 py-3 text-xs font-mono">{t.proxy || "—"}</td>
                <td className="px-4 py-3 text-xs">{(t.enabled || "").toLowerCase() === "true" ? <span className="text-emerald-700">Ativo</span> : <span className="text-zinc-500">Inativo</span>}</td>
                <td className="px-4 py-3 text-xs">{t.description || "—"}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="bg-zinc-50 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Para criar/editar troncos, use o painel do FusionPBX (Accounts → Gateways). Aqui é leitura apenas.
      </div>
    </div>
  );
}

// ============== LICENSES ==============
function LicensesTab() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const isSuper = user?.role === "super_admin";

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/pbx/licenses");
      setData(data);
      setForm({ ...data.limits });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!user?.tenant_id && user?.role !== "super_admin") return;
    const tid = user.tenant_id || JSON.parse(localStorage.getItem("active_tenant") || "null")?.id;
    if (!tid) { toast.error("Tenant não identificado"); return; }
    try {
      await api.put(`/pbx/licenses/${tid}`, form);
      toast.success("Limites atualizados");
      setEditing(false);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
  }

  if (loading || !data) return <div className="text-center py-8 text-muted-foreground">Carregando...</div>;
  const items = [
    { label: "Ramais", k: "max_extensions", used: data.used.extensions },
    { label: "DIDs (entrada)", k: "max_dids", used: data.used.dids },
    { label: "Troncos SIP", k: "max_trunks", used: data.used.trunks },
    { label: "Usuários Voxyra", k: "max_users", used: data.used.users },
  ];

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-muted-foreground">Limites de uso da assinatura. {isSuper ? "Você pode editar como super admin." : "Apenas super admin pode aumentar os limites."}</div>
        {isSuper && !editing && <Button onClick={() => setEditing(true)} variant="outline" size="sm"><Edit3 size={12} className="mr-1.5" /> Editar limites</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((i) => {
          const limit = form[i.k] || 0;
          const pct = limit > 0 ? Math.min(100, (i.used / limit) * 100) : 0;
          return (
            <div key={i.k} className="border border-border bg-card rounded-sm p-5" data-testid={`mgr-lic-${i.k}`}>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{i.label}</div>
              <div className="font-display text-3xl font-bold mt-1">
                <span className={pct > 90 ? "text-red-600" : pct > 75 ? "text-amber-600" : ""}>{i.used}</span>
                <span className="text-muted-foreground text-xl"> / {limit || "∞"}</span>
              </div>
              {limit > 0 && (
                <div className="mt-2 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                  <div className={`h-full ${pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
              {isSuper && editing && (
                <Input type="number" min="0" value={form[i.k] || 0}
                  onChange={(e) => setForm({ ...form, [i.k]: parseInt(e.target.value) || 0 })}
                  className="mt-3 font-mono"
                  placeholder="0 = ilimitado"
                  data-testid={`mgr-lic-input-${i.k}`} />
              )}
            </div>
          );
        })}
      </div>

      {isSuper && editing && (
        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => { setEditing(false); setForm({ ...data.limits }); }}>Cancelar</Button>
          <Button onClick={save} data-testid="mgr-lic-save"><Save size={14} className="mr-1.5" /> Salvar limites</Button>
        </div>
      )}
    </>
  );
}
