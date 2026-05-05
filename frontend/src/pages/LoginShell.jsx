import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Headphones, Loader2, ShieldCheck, Crown, User } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

/**
 * mode: "agent" | "master" | "admin"
 * - agent : só agent. Domínio + email + senha
 * - master: admin + supervisor. Domínio + email + senha
 * - admin : super_admin. Sem domínio
 */
export default function LoginShell({ mode = "agent" }) {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [branding, setBranding] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = mode === "admin";
  const allowedRoles =
    mode === "agent" ? ["agent"]
    : mode === "master" ? ["admin", "supervisor"]
    : ["super_admin"];

  // Branding: extrai domínio do email digitado
  useEffect(() => {
    if (isAdmin) { setBranding(null); return; }
    const at = email.indexOf("@");
    const domain = at > 0 ? email.substring(at + 1).trim() : "";
    if (!domain || !domain.includes(".")) { setBranding(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/auth/branding?domain=${encodeURIComponent(domain)}`);
        setBranding(data.found ? data : null);
      } catch { setBranding(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [email, isAdmin]);

  // Se já logado, redireciona pelo papel correto
  if (user && typeof user === "object") {
    if (allowedRoles.includes(user.role)) {
      const target = user.role === "super_admin" ? "/tenants"
                   : user.role === "agent" ? "/agent" : "/";
      return <Navigate to={target} replace />;
    }
    return <WrongRolePanel currentRole={user.role} mode={mode} onLogout={logout} />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    // Backend extrai domínio automaticamente quando vazio
    const r = await login("", email, password);
    setLoading(false);
    if (!r.ok) { setErr(r.error); return; }
    if (!allowedRoles.includes(r.role)) {
      await logout();
      const where = r.role === "super_admin" ? "/admin"
                  : (r.role === "admin" || r.role === "supervisor") ? "/master"
                  : "/login";
      setErr(`Esta conta tem perfil "${r.role}". Use a página correta: ${where}`);
      return;
    }
    if (r.role === "super_admin") navigate("/tenants");
    else if (r.role === "agent") navigate("/agent");
    else navigate("/");
  }

  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const accent = isAdmin ? "#09090b" : (branding?.accent_color || meta.accent);

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      {/* Painel esquerdo */}
      <div className="hidden md:flex bg-[hsl(var(--sidebar))] text-zinc-100 p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white text-black rounded-sm flex items-center justify-center"
               style={{ background: branding?.logo_url ? "transparent" : "white" }}>
            {branding?.logo_url
              ? <img src={branding.logo_url} alt="" className="w-10 h-10 object-contain" />
              : <Headphones size={20} strokeWidth={2.2} />}
          </div>
          <div>
            <div className="font-display font-bold text-xl">{branding?.name || "Voxyra CCA"}</div>
            <div className="text-[11px] text-zinc-400 uppercase tracking-widest">{meta.subtitle}</div>
          </div>
        </div>
        <div>
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full text-[11px] uppercase tracking-widest"
               style={{ background: meta.accent + "33", color: meta.accent }}>
            <Icon size={12} /> {meta.label}
          </div>
          <h2 className="font-display text-4xl font-bold tracking-tight leading-tight">
            {meta.heroTitle}
          </h2>
          <p className="text-zinc-400 mt-4 text-sm max-w-sm">{meta.heroDesc}</p>
        </div>
        <div className="text-[11px] text-zinc-500 flex items-center justify-between">
          <span>© {new Date().getFullYear()} Voxyra CCA</span>
          <PortalLinks current={mode} />
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-[10px] uppercase tracking-widest font-medium" style={{ color: accent }}>
              {meta.formTag}
            </div>
            <h1 className="font-display text-3xl font-bold mt-1">Entrar</h1>
            <p className="text-sm text-muted-foreground mt-1">{meta.formDesc}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" data-testid={`login-${mode}-form`}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required data-testid={`login-${mode}-email`} autoComplete="email"
                placeholder={meta.emailPlaceholder} />
              {!isAdmin && branding && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: branding.accent_color || "#0EA5E9" }} />
                  {branding.name}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Senha</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required data-testid={`login-${mode}-password`} autoComplete="current-password" />
            </div>
            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded"
                   data-testid={`login-${mode}-error`}>{err}</div>
            )}
            <Button type="submit" className="w-full" disabled={loading}
                    data-testid={`login-${mode}-submit`}
                    style={{ background: accent, borderColor: accent }}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : `Entrar como ${meta.label}`}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2">
              Outros portais
            </div>
            <PortalLinks current={mode} dark />
          </div>
        </div>
      </div>
    </div>
  );
}

const MODE_META = {
  agent: {
    icon: User, accent: "#0EA5E9", label: "Agente",
    subtitle: "Portal do Agente",
    heroTitle: "Atenda. Resolva. Brilhe.",
    heroDesc: "Acesse suas chamadas em tempo real, gravações, métricas pessoais e estado do dia.",
    formTag: "Portal do Agente", formDesc: "Acesso para agentes do callcenter.",
    emailPlaceholder: "agente@empresa.com.br",
  },
  master: {
    icon: ShieldCheck, accent: "#10B981", label: "Gestor",
    subtitle: "Painel Master",
    heroTitle: "Gestão e supervisão.",
    heroDesc: "Monitore filas, supervisione agentes em tempo real, configure operação e analise relatórios.",
    formTag: "Painel Master · Admin/Supervisor", formDesc: "Acesso para supervisores e admins.",
    emailPlaceholder: "gestor@empresa.com.br",
  },
  admin: {
    icon: Crown, accent: "#F59E0B", label: "Super Admin",
    subtitle: "Console Master",
    heroTitle: "Plataforma. Tenants. Tudo.",
    heroDesc: "Gerencie todas as empresas hospedadas na plataforma, planos, cobranças e integrações globais.",
    formTag: "Console Super Admin", formDesc: "Acesso ao console mestre da plataforma.",
    emailPlaceholder: "root@voxyra.io",
  },
};

function PortalLinks({ current, dark = false }) {
  // Admin portal é "secret" — só aparece quando o usuário já está em /admin.
  // Nas páginas /login (agente) e /master, mostramos apenas o link recíproco.
  const items = [
    { mode: "agent",  href: "/login",  label: "Agente",       icon: User },
    { mode: "master", href: "/master", label: "Master",       icon: ShieldCheck },
    { mode: "admin",  href: "/admin",  label: "Super Admin",  icon: Crown },
  ].filter(i => i.mode !== current && (i.mode !== "admin" || current === "admin"));
  const cls = dark
    ? "text-muted-foreground hover:text-foreground"
    : "text-zinc-400 hover:text-zinc-100";
  return (
    <div className="flex items-center gap-3">
      {items.map(i => {
        const Icon = i.icon;
        return (
          <a key={i.mode} href={i.href}
             className={`inline-flex items-center gap-1 text-xs ${cls} transition-colors`}>
            <Icon size={12} /> {i.label}
          </a>
        );
      })}
    </div>
  );
}

function WrongRolePanel({ currentRole, mode, onLogout }) {
  const correct = currentRole === "super_admin" ? "/admin"
                : (currentRole === "admin" || currentRole === "supervisor") ? "/master"
                : "/login";
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center border border-amber-200 bg-amber-50 rounded-sm p-8">
        <Crown className="mx-auto text-amber-600 mb-3" size={28} />
        <h1 className="font-display text-2xl font-bold">Portal incorreto</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Você está logado como <strong>{currentRole}</strong>, mas esta é a página de <strong>{mode}</strong>.
        </p>
        <div className="flex gap-2 mt-4 justify-center">
          <a href={correct}><Button>Ir para o portal correto</Button></a>
          <Button variant="outline" onClick={onLogout}>Sair</Button>
        </div>
      </div>
    </div>
  );
}
