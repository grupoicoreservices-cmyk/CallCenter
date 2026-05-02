import { createContext, useContext, useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenantContext, setTenantContextState] = useState(localStorage.getItem("tenant_context") || null);

  // Inject tenant context header on every request (super admin impersonation)
  useEffect(() => {
    const id = api.interceptors.request.use((cfg) => {
      const ctx = localStorage.getItem("tenant_context");
      if (ctx) cfg.headers["X-Tenant-Context"] = ctx;
      return cfg;
    });
    return () => api.interceptors.request.eject(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
      } catch {
        setUser(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(domain, email, password) {
    try {
      const { data } = await api.post("/auth/login", { domain, email, password });
      if (data.token) localStorage.setItem("token", data.token);
      // refresh /me to include tenant info
      try {
        const me = await api.get("/auth/me");
        setUser(me.data);
      } catch { setUser(data); }
      return { ok: true, role: data.role };
    } catch (e) {
      return { ok: false, error: formatApiError(e.response?.data?.detail) || e.message };
    }
  }

  async function logout() {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("token");
    localStorage.removeItem("tenant_context");
    setTenantContextState(null);
    setUser(false);
  }

  function setTenantContext(tenantId) {
    if (tenantId) localStorage.setItem("tenant_context", tenantId);
    else localStorage.removeItem("tenant_context");
    setTenantContextState(tenantId);
    // refetch /me
    api.get("/auth/me").then(({ data }) => setUser(data)).catch(() => {});
  }

  function hasPermission(perm) {
    if (!user || typeof user !== "object") return false;
    if (user.role === "super_admin" || user.role === "admin") return true;
    return Array.isArray(user.permissions) && user.permissions.includes(perm);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, tenantContext, setTenantContext }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
