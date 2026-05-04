import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/**
 * Redireciona para o portal de login correto baseado em hint/contexto.
 * Default: /login (agente). Hint pode forçar /master ou /admin.
 */
export default function ProtectedRoute({ children, requireSuperAdmin = false, hint }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="font-mono text-sm text-muted-foreground">carregando…</div>
      </div>
    );
  }
  if (!user) {
    const target = hint === "admin" ? "/admin" : hint === "master" ? "/master" : "/login";
    return <Navigate to={target} replace />;
  }
  if (requireSuperAdmin && user.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }
  return children;
}
