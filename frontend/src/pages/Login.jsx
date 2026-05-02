import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Headphones, Loader2, Shield } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [domain, setDomain] = useState("empresa-a.local");
  const [email, setEmail] = useState("admin@empresa-a.local");
  const [password, setPassword] = useState("admin123");
  const [superMode, setSuperMode] = useState(false);
  const [branding, setBranding] = useState(null); // {name, accent_color, logo_url} | null
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch branding when domain changes (debounced)
  useEffect(() => {
    if (superMode || !domain) { setBranding(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/auth/branding?domain=${encodeURIComponent(domain.trim())}`);
        setBranding(data.found ? data : null);
      } catch { setBranding(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [domain, superMode]);

  if (user) return <Navigate to={user.role === "super_admin" ? "/tenants" : "/"} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    const r = await login(superMode ? "" : domain, email, password);
    setLoading(false);
    if (r.ok) navigate(r.role === "super_admin" ? "/tenants" : "/");
    else setErr(r.error);
  }

  function toggleSuper() {
    const next = !superMode;
    setSuperMode(next);
    if (next) { setDomain(""); setEmail("root@voxyra.io"); setPassword("root123"); }
    else { setDomain("empresa-a.local"); setEmail("admin@empresa-a.local"); setPassword("admin123"); }
    setErr("");
  }

  const accent = branding?.accent_color || "#0EA5E9";

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      <div className="hidden md:flex bg-[hsl(var(--sidebar))] text-zinc-100 p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white text-black rounded-sm flex items-center justify-center" style={{ background: branding?.logo_url ? "transparent" : "white" }}>
            {branding?.logo_url
              ? <img src={branding.logo_url} alt="" className="w-10 h-10 object-contain" />
              : <Headphones size={20} strokeWidth={2.2} />}
          </div>
          <div>
            <div className="font-display font-bold text-xl">{branding?.name || "Voxyra CCA"}</div>
            <div className="text-[11px] text-zinc-400 uppercase tracking-widest">{superMode ? "Super Admin" : "Callcenter Analytical"}</div>
          </div>
        </div>
        <div>
          <h2 className="font-display text-4xl font-bold tracking-tight leading-tight">
            {superMode ? "Gerencie todos os tenants." : "Controle total do seu callcenter."}
          </h2>
          <p className="text-zinc-400 mt-4 text-sm max-w-sm">
            {superMode
              ? "Acesso master para criar, suspender e gerenciar todas as empresas hospedadas na plataforma."
              : "Analytics avançado do seu callcenter. Monitore chamadas em tempo real, analise gravações e acompanhe a performance dos agentes — tudo em um painel moderno."}
          </p>
          <div className="grid grid-cols-3 gap-4 mt-10 pt-8 border-t border-white/10">
            <div><div className="font-mono text-2xl font-medium">24/7</div><div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Monitor</div></div>
            <div><div className="font-mono text-2xl font-medium">100%</div><div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Gravado</div></div>
            <div><div className="font-mono text-2xl font-medium">PBX</div><div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Integrado</div></div>
          </div>
        </div>
        <div className="text-[11px] text-zinc-500">© {new Date().getFullYear()} Voxyra CCA</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{superMode ? "Acesso master" : "Acessar painel"}</div>
              <h1 className="font-display text-3xl font-bold mt-1">Entrar</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {superMode ? "Login como Super Administrador." : (branding ? `Acessar ${branding.name}.` : "Informe o domínio do seu tenant.")}
              </p>
            </div>
            {branding && !superMode && (
              <div className="w-3 h-3 rounded-full mt-2" style={{ backgroundColor: accent }} title={`Cor: ${accent}`} />
            )}
          </div>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
            {!superMode && (
              <div className="space-y-1.5">
                <Label htmlFor="domain">Domínio</Label>
                <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="empresa-a.local"
                       required data-testid="login-domain" autoComplete="organization" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required data-testid="login-email" autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Senha</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required data-testid="login-password" autoComplete="current-password" />
            </div>
            {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded" data-testid="login-error">{err}</div>}
            <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit"
                    style={{ background: superMode ? "#09090b" : accent, borderColor: accent }}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Entrar"}
            </Button>
          </form>

          <button onClick={toggleSuper} type="button" data-testid="toggle-super"
                  className="mt-6 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Shield size={12} /> {superMode ? "Voltar ao login normal" : "Acesso Super Admin"}
          </button>

          <div className="mt-6 text-xs text-muted-foreground border-t border-border pt-5 space-y-1">
            <div className="uppercase tracking-widest text-[10px] font-medium mb-2">Credenciais demo</div>
            {superMode ? (
              <div className="font-mono">root@voxyra.io / root123</div>
            ) : (
              <>
                <div className="font-mono"><b>empresa-a.local</b> · admin@empresa-a.local / admin123</div>
                <div className="font-mono"><b>empresa-b.local</b> · admin@empresa-b.local / admin123</div>
                <div className="font-mono">supervisor@... / super123</div>
                <div className="font-mono">agent@... / agent123</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
