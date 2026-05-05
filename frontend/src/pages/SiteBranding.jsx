import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Palette, Save, Image as ImageIcon, Upload, Shield, Trash2, Globe, User, Crown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

const GLOBAL_FIELDS = [
  { key: "brand_name",      label: "Nome da marca",          hint: "Aparece no header da sidebar.",                placeholder: "Voxyra CCA" },
  { key: "brand_subtitle",  label: "Subtítulo",              hint: "Linha pequena abaixo do nome.",                placeholder: "Callcenter Analytical" },
  { key: "footer_text",     label: "Texto do rodapé",        hint: "Mostrado no rodapé das páginas de login.",     placeholder: "© 2026 Voxyra CCA",   long: true },
  { key: "release_version", label: "Release / versão",      hint: "Tag exibida ao lado do rodapé.",               placeholder: "v1.0.0" },
  { key: "accent_color",    label: "Cor de destaque global", hint: "Fallback quando o modo não tem cor própria.", placeholder: "#09090b" },
];

const GLOBAL_ASSETS = [
  { key: "logo_url",      label: "Logo padrão",      hint: "Usada quando o modo não tem logo própria.",  kind: "logo",      ratio: "1:1" },
  { key: "favicon_url",   label: "Favicon",          hint: "Ícone na aba do navegador (32x32 / .ico).",   kind: "favicon",   ratio: "1:1" },
  { key: "wallpaper_url", label: "Wallpaper padrão", hint: "Fundo do painel quando o modo não definir.",  kind: "wallpaper", ratio: "16:9" },
];

const MODE_FIELDS = [
  { key: "hero_title",     label: "Título da página",   hint: "Frase principal do painel esquerdo.",  placeholder: "Atenda. Resolva. Brilhe.", long: false },
  { key: "hero_subtitle",  label: "Descrição",          hint: "Texto descritivo abaixo do título.",   placeholder: "Acesse suas chamadas em tempo real, gravações e métricas.", long: true },
  { key: "accent_color",   label: "Cor de destaque",    hint: "Cor do botão de login (hex).",          placeholder: "#0EA5E9" },
];

const MODE_ASSETS = [
  { key: "logo_url",      label: "Logo do modo",   hint: "PNG/SVG. Sobrepõe a logo global.",       kind: "logo",      ratio: "1:1" },
  { key: "wallpaper_url", label: "Wallpaper",      hint: "Imagem de fundo do painel esquerdo.",    kind: "wallpaper", ratio: "16:9" },
];

const MODES = [
  { key: "agent",  label: "Agente",      icon: User,        accent: "#0EA5E9" },
  { key: "master", label: "Master",      icon: ShieldCheck, accent: "#10B981" },
  { key: "admin",  label: "Super Admin", icon: Crown,       accent: "#F59E0B" },
];

function fullUrl(u) {
  if (!u) return "";
  if (u.startsWith("http") || u.startsWith("blob:") || u.startsWith("data:")) return u;
  return BACKEND_URL + u;
}

function emptyMode() {
  return { hero_title: "", hero_subtitle: "", accent_color: "", wallpaper_url: "", logo_url: "" };
}

export default function SiteBranding() {
  const { user } = useAuth();
  const [form, setForm] = useState({ modes: { agent: emptyMode(), master: emptyMode(), admin: emptyMode() } });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);  // "global:logo" | "agent:wallpaper"...
  const [tab, setTab] = useState("global");
  const fileRef = useRef();
  const [pendingUpload, setPendingUpload] = useState(null);  // {scope, key, kind}

  async function load() {
    try {
      const { data } = await api.get("/branding/site");
      setForm({
        ...data,
        modes: {
          agent:  { ...emptyMode(), ...(data.modes?.agent  || {}) },
          master: { ...emptyMode(), ...(data.modes?.master || {}) },
          admin:  { ...emptyMode(), ...(data.modes?.admin  || {}) },
        },
      });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }
  useEffect(() => { if (user?.role === "super_admin") load(); }, [user]);

  if (user?.role !== "super_admin") {
    return (
      <Layout title="Personalização" subtitle="Customize a aparência da plataforma">
        <div className="border border-border bg-card rounded-sm p-12 text-center" data-testid="branding-restricted">
          <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="text-sm text-muted-foreground mt-2">Apenas Super Administradores podem personalizar a plataforma.</p>
        </div>
      </Layout>
    );
  }

  function setGlobal(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setMode(modeKey, k, v) {
    setForm((f) => ({ ...f, modes: { ...f.modes, [modeKey]: { ...f.modes[modeKey], [k]: v } } }));
  }

  function triggerUpload(scope, key, kind) {
    setPendingUpload({ scope, key, kind });
    fileRef.current?.click();
  }

  async function onFilePicked(file) {
    if (!file || !pendingUpload) return;
    const { scope, key, kind } = pendingUpload;
    setUploading(`${scope}:${kind}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/uploads/asset?kind=${kind}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (scope === "global") setGlobal(key, data.url);
      else setMode(scope, key, data.url);
      toast.success(`${kind} enviado`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setUploading(null);
      setPendingUpload(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put("/branding/site", form);
      setForm({
        ...data,
        modes: {
          agent:  { ...emptyMode(), ...(data.modes?.agent  || {}) },
          master: { ...emptyMode(), ...(data.modes?.master || {}) },
          admin:  { ...emptyMode(), ...(data.modes?.admin  || {}) },
        },
      });
      toast.success("Personalização salva");
      window.dispatchEvent(new CustomEvent("voxyra:branding-updated", { detail: data }));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Personalização" subtitle="Customize logos, wallpapers e textos das páginas de login">
      <input ref={fileRef} type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,.ico"
        className="hidden"
        onChange={(e) => onFilePicked(e.target.files?.[0])} />

      <Tabs value={tab} onValueChange={setTab} className="max-w-6xl">
        <TabsList className="mb-6" data-testid="branding-tabs">
          <TabsTrigger value="global" data-testid="branding-tab-global"><Globe size={14} className="mr-1.5" />Geral</TabsTrigger>
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <TabsTrigger key={m.key} value={m.key} data-testid={`branding-tab-${m.key}`}>
                <Icon size={14} className="mr-1.5" /> {m.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Global tab */}
        <TabsContent value="global" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="border border-border bg-card rounded-sm p-6" data-testid="branding-global-texts">
              <div className="flex items-center gap-2 mb-5"><Palette size={16} /><h2 className="font-display font-semibold text-lg">Textos & Cores</h2></div>
              <div className="space-y-4">
                {GLOBAL_FIELDS.map((f) => (
                  <FieldRow key={f.key} f={f} value={form[f.key] ?? ""} onChange={(v) => setGlobal(f.key, v)} testid={`branding-global-${f.key}`} />
                ))}
              </div>
            </section>
            <section className="border border-border bg-card rounded-sm p-6" data-testid="branding-global-assets">
              <div className="flex items-center gap-2 mb-5"><ImageIcon size={16} /><h2 className="font-display font-semibold text-lg">Imagens globais</h2></div>
              <div className="space-y-4">
                {GLOBAL_ASSETS.map((a) => (
                  <AssetRow key={a.key} a={a} url={form[a.key]}
                    uploading={uploading === `global:${a.kind}`}
                    onUpload={() => triggerUpload("global", a.key, a.kind)}
                    onClear={() => setGlobal(a.key, "")} />
                ))}
              </div>
            </section>
          </div>
        </TabsContent>

        {/* Per-mode tabs */}
        {MODES.map((m) => (
          <TabsContent key={m.key} value={m.key} className="space-y-6">
            <div className="border border-border bg-card rounded-sm p-4 flex items-start gap-3" data-testid={`branding-${m.key}-info`}>
              <m.icon size={18} className="mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-display font-semibold">Página de login do {m.label}</div>
                <div className="text-xs text-muted-foreground">Personaliza apenas a tela <span className="font-mono">/{m.key === "agent" ? "login" : m.key}</span>. Deixe vazio para usar os valores globais.</div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="border border-border bg-card rounded-sm p-6" data-testid={`branding-${m.key}-texts`}>
                <div className="flex items-center gap-2 mb-5"><Palette size={16} /><h2 className="font-display font-semibold text-lg">Textos & Cor</h2></div>
                <div className="space-y-4">
                  {MODE_FIELDS.map((f) => (
                    <FieldRow key={f.key} f={f}
                      value={form.modes[m.key]?.[f.key] ?? ""}
                      onChange={(v) => setMode(m.key, f.key, v)}
                      testid={`branding-${m.key}-${f.key}`} />
                  ))}
                </div>
              </section>
              <section className="border border-border bg-card rounded-sm p-6" data-testid={`branding-${m.key}-assets`}>
                <div className="flex items-center gap-2 mb-5"><ImageIcon size={16} /><h2 className="font-display font-semibold text-lg">Imagens</h2></div>
                <div className="space-y-4">
                  {MODE_ASSETS.map((a) => (
                    <AssetRow key={a.key} a={a} url={form.modes[m.key]?.[a.key]}
                      uploading={uploading === `${m.key}:${a.kind}`}
                      onUpload={() => triggerUpload(m.key, a.key, a.kind)}
                      onClear={() => setMode(m.key, a.key, "")} />
                  ))}
                </div>
              </section>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <div className="mt-6 flex justify-end max-w-6xl">
        <Button onClick={save} disabled={saving} data-testid="branding-save">
          <Save size={14} className="mr-1.5" />
          {saving ? "Salvando..." : "Salvar personalização"}
        </Button>
      </div>
    </Layout>
  );
}

function FieldRow({ f, value, onChange, testid }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testid}>{f.label}</Label>
      {f.long ? (
        <Textarea id={testid} rows={2} placeholder={f.placeholder}
          value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      ) : (
        <Input id={testid} placeholder={f.placeholder}
          value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      )}
      <p className="text-[11px] text-muted-foreground">{f.hint}</p>
    </div>
  );
}

function AssetRow({ a, url, uploading, onUpload, onClear }) {
  const isFav = a.kind === "favicon";
  const isWall = a.kind === "wallpaper";
  return (
    <div className="border border-border rounded-sm p-3" data-testid={`branding-asset-row-${a.key}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-medium">{a.label}</div>
          <div className="text-[11px] text-muted-foreground">{a.hint}</div>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{a.ratio}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className={`shrink-0 border border-border rounded-sm bg-zinc-50 overflow-hidden flex items-center justify-center ${isWall ? "w-32 h-20" : isFav ? "w-12 h-12" : "w-16 h-16"}`}>
          {url ? (
            <img src={fullUrl(url)} alt={a.label} className={isWall ? "w-full h-full object-cover" : "w-full h-full object-contain"} />
          ) : (
            <ImageIcon size={isFav ? 16 : 20} className="text-zinc-300" />
          )}
        </div>
        <div className="flex-1 flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onUpload}
            disabled={uploading} data-testid={`branding-upload-${a.key}`}>
            <Upload size={12} className="mr-1.5" />
            {uploading ? "Enviando..." : (url ? "Trocar" : "Enviar")}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm"
              onClick={onClear}
              data-testid={`branding-remove-${a.key}`}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
