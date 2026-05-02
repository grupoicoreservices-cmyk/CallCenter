import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Headphones, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@callcenter.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    const r = await login(email, password);
    setLoading(false);
    if (r.ok) navigate("/");
    else setErr(r.error);
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      {/* Left brand panel */}
      <div className="hidden md:flex bg-[hsl(var(--sidebar))] text-zinc-100 p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white text-black rounded-sm flex items-center justify-center">
            <Headphones size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-display font-bold text-xl">Voxyra CCA</div>
            <div className="text-[11px] text-zinc-400 uppercase tracking-widest">Callcenter Analytical</div>
          </div>
        </div>
        <div>
          <h2 className="font-display text-4xl font-bold tracking-tight leading-tight">
            Controle total do seu callcenter.
          </h2>
          <p className="text-zinc-400 mt-4 text-sm max-w-sm">
            Analytics avançado do seu callcenter Fusion PBX. Monitore chamadas em tempo real, analise gravações e acompanhe a performance dos agentes — tudo em um painel moderno.
          </p>
          <div className="grid grid-cols-3 gap-4 mt-10 pt-8 border-t border-white/10">
            <div>
              <div className="font-mono text-2xl font-medium">24/7</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Monitor</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-medium">100%</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Gravado</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-medium">PBX</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Integrado</div>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-zinc-500">© {new Date().getFullYear()} Voxyra CCA</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Acessar painel</div>
            <h1 className="font-display text-3xl font-bold mt-1">Entrar</h1>
            <p className="text-sm text-muted-foreground mt-1">Use suas credenciais para continuar.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
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
            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded" data-testid="login-error">
                {err}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit">
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Entrar"}
            </Button>
          </form>

          <div className="mt-8 text-xs text-muted-foreground border-t border-border pt-5 space-y-1">
            <div className="uppercase tracking-widest text-[10px] font-medium mb-2">Credenciais demo</div>
            <div className="font-mono">admin@callcenter.com / admin123</div>
            <div className="font-mono">supervisor@callcenter.com / super123</div>
            <div className="font-mono">agent@callcenter.com / agent123</div>
          </div>
        </div>
      </div>
    </div>
  );
}
