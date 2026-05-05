import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Palette, Save, Image as ImageIcon, Upload, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

const FIELDS = [
  { key: "brand_name",     label: "Nome da marca",         hint: "Aparece no header da sidebar e no painel de login.", placeholder: "Voxyra CCA" },
  { key: "brand_subtitle", label: "Subtítulo",             hint: "Linha pequena abaixo do nome.",                       placeholder: "Callcenter Analytical" },
  { key: "login_title",    label: "Título do login",       hint: "Frase principal exibida no painel esquerdo do login.", placeholder: "Atenda. Resolva. Brilhe." },
  { key: "login_subtitle", label: "Descrição do login",    hint: "Texto descritivo abaixo do título.",                  placeholder: "Plataforma de gestão de operação de callcenter." },
  { key: "footer_text",    label: "Texto do rodapé",       hint: "Aparece no rodapé das páginas de login.",             placeholder: "© 2026 Voxyra CCA" },
  { key: "release_version",label: "Release / versão",     hint: "Mostrado no rodapé como tag de versão.",              placeholder: "v1.0.0" },
  { key: "accent_color",   label: "Cor de destaque (hex)", hint: "Botões e detalhes (ex: #0EA5E9).",                    placeholder: "#09090b" },
];

const ASSETS = [
  { key: "logo_url",      label: "Logo",      hint: "PNG/SVG transparente. Aparece no header.",            kind: "logo",      ratio: "1:1" },
  { key: "wallpaper_url", label: "Wallpaper", hint: "Imagem de fundo do painel esquerdo do login.",        kind: "wallpaper", ratio: "16:9" },
  { key: "favicon_url",   label: "Favicon",   hint: "Ícone exibido na aba do navegador (32x32 / .ico).",    kind: "favicon",   ratio: "1:1" },
];

function fullUrl(u) {
  if (!u) return "";
  if (u.startsWith("http") || u.startsWith("blob:") || u.startsWith("data:")) return u;
  return BACKEND_URL + u;
}

export default function SiteBranding() {
  const { user } = useAuth();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);
  const fileRefs = { logo: useRef(), wallpaper: useRef(), favicon: useRef() };

  async function load() {
    try {
      const { data } = await api.get("/branding/site");
      setForm(data);
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

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function onUpload(kind, file) {
    if (!file) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/uploads/asset?kind=${kind}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setField(`${kind}_url`, data.url);
      toast.success(`${kind} enviado`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put("/branding/site", form);
      setForm(data);
      toast.success("Personalização salva");
      // Re-apply favicon/title immediately
      window.dispatchEvent(new CustomEvent("voxyra:branding-updated", { detail: data }));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Personalização" subtitle="Customize a página de login, ícones e rodapé">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl">
        {/* Texts */}
        <section className="border border-border bg-card rounded-sm p-6" data-testid="branding-texts">
          <div className="flex items-center gap-2 mb-5">
            <Palette size={16} />
            <h2 className="font-display font-semibold text-lg">Textos & Cores</h2>
          </div>
          <div className="space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                {f.key === "login_subtitle" || f.key === "footer_text" ? (
                  <Textarea id={f.key} rows={2} placeholder={f.placeholder}
                    value={form[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}
                    data-testid={`branding-field-${f.key}`} />
                ) : (
                  <Input id={f.key} placeholder={f.placeholder}
                    value={form[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}
                    data-testid={`branding-field-${f.key}`} />
                )}
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Assets */}
        <section className="border border-border bg-card rounded-sm p-6" data-testid="branding-assets">
          <div className="flex items-center gap-2 mb-5">
            <ImageIcon size={16} />
            <h2 className="font-display font-semibold text-lg">Imagens</h2>
          </div>
          <div className="space-y-5">
            {ASSETS.map((a) => {
              const url = form[a.key];
              const isFav = a.kind === "favicon";
              const isWall = a.kind === "wallpaper";
              return (
                <div key={a.key} className="border border-border rounded-sm p-3" data-testid={`branding-asset-${a.kind}`}>
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
                      <input ref={fileRefs[a.kind]} type="file"
                        accept={a.kind === "favicon" ? ".png,.ico,.svg" : ".png,.jpg,.jpeg,.webp,.svg"}
                        className="hidden"
                        onChange={(e) => onUpload(a.kind, e.target.files?.[0])} />
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => fileRefs[a.kind].current?.click()}
                        disabled={uploading === a.kind}
                        data-testid={`branding-upload-${a.kind}`}>
                        <Upload size={12} className="mr-1.5" />
                        {uploading === a.kind ? "Enviando..." : (url ? "Trocar" : "Enviar")}
                      </Button>
                      {url && (
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setField(a.key, "")}
                          data-testid={`branding-remove-${a.kind}`}>
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end max-w-6xl">
        <Button onClick={save} disabled={saving} data-testid="branding-save">
          <Save size={14} className="mr-1.5" />
          {saving ? "Salvando..." : "Salvar personalização"}
        </Button>
      </div>
    </Layout>
  );
}
