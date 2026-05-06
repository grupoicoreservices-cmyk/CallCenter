import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, PhoneCall, Phone, Disc3, BarChart3, Users, UserCog, LogOut, Headphones,
  Tv2, ShieldCheck, History, Building2, X, Sparkles, CreditCard, Receipt, Server, Download, Palette, Crown,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

const ITEMS = [
  { to: "/agent", label: "Meu Painel", icon: Headphones, testid: "nav-agent", roleOnly: ["agent"] },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", perm: "dashboard.view" },
  { to: "/realtime", label: "Tempo Real", icon: PhoneCall, testid: "nav-realtime", perm: "realtime.view" },
  { to: "/recordings", label: "Gravações", icon: Disc3, testid: "nav-recordings", perm: "recordings.view_own" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, testid: "nav-reports", perm: "reports.view" },
  { to: "/queues", label: "Filas", icon: Users, testid: "nav-queues", perm: "queues.view" },
  { to: "/agents", label: "Agentes", icon: UserCog, testid: "nav-agents", perm: "agents.view" },
  { to: "/extensions", label: "Ramais", icon: Phone, testid: "nav-extensions", perm: "agents.view" },
  { to: "/tv", label: "Painel TV", icon: Tv2, testid: "nav-tv", perm: "tv.view" },
  { to: "/users", label: "Usuários", icon: ShieldCheck, testid: "nav-users", perm: "users.manage" },
  { to: "/audit", label: "Auditoria", icon: History, testid: "nav-audit", perm: "users.manage" },
];

export default function Sidebar() {
  const { user, logout, hasPermission, tenantContext, setTenantContext } = useAuth();
  const navigate = useNavigate();
  const isSuper = user?.role === "super_admin";
  const [appVersion, setAppVersion] = useState(null);

  useEffect(() => {
    api.get("/system/version").then(r => setAppVersion(r.data.version)).catch(() => {});
  }, []);

  const visibleItems = ITEMS.filter((it) => {
    if (it.roleOnly) return it.roleOnly.includes(user?.role);
    return !it.perm || hasPermission(it.perm);
  });
  const tenantName = user?.tenant?.name;
  const tenantAccent = user?.tenant?.accent_color || "#09090b";

  const doLogout = async () => { await logout(); navigate("/login"); };
  const exitTenant = () => { setTenantContext(null); navigate("/tenants"); };

  return (
    <aside className="w-60 shrink-0 bg-[hsl(var(--sidebar))] text-zinc-100 flex flex-col min-h-screen" data-testid="sidebar">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-sm flex items-center justify-center" style={{ background: tenantName ? tenantAccent : "white", color: tenantName ? "white" : "black" }}>
            {user?.tenant?.logo_url
              ? <img src={user.tenant.logo_url} alt="" className="w-8 h-8 rounded-sm object-cover" />
              : <Headphones size={16} strokeWidth={2.4} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-[15px] leading-none truncate">{tenantName || "Voxyra CCA"}</div>
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest mt-1 truncate">
              {isSuper && !tenantContext ? "Super Admin" : (user?.tenant?.domain || "Callcenter Analytical")}
            </div>
          </div>
        </div>
      </div>

      {/* Super admin: show "viewing as" tenant indicator */}
      {isSuper && tenantContext && tenantName && (
        <div className="mx-2 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-sm flex items-center gap-2">
          <Building2 size={12} className="text-amber-400 shrink-0" />
          <div className="text-[10px] text-amber-200 flex-1 min-w-0">
            <div className="uppercase tracking-widest">Visualizando como</div>
            <div className="text-xs font-medium truncate">{tenantName}</div>
          </div>
          <button onClick={exitTenant} data-testid="exit-tenant" className="text-amber-300 hover:text-white" title="Sair do tenant">
            <X size={12} />
          </button>
        </div>
      )}

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {/* Super admin: Tenants nav */}
        {isSuper && (
          <>
            <NavLink to="/tenants" end data-testid="nav-tenants"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Building2 size={16} strokeWidth={1.8} /><span>Tenants</span>
            </NavLink>
            <NavLink to="/plans" end data-testid="nav-plans"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Sparkles size={16} strokeWidth={1.8} /><span>Planos</span>
            </NavLink>
            <NavLink to="/billing" end data-testid="nav-billing"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <CreditCard size={16} strokeWidth={1.8} /><span>Cobrança</span>
            </NavLink>
            <NavLink to="/charges" end data-testid="nav-charges"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Receipt size={16} strokeWidth={1.8} /><span>Faturas</span>
            </NavLink>
            <NavLink to="/system" end data-testid="nav-system"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Download size={16} strokeWidth={1.8} /><span>Atualizações</span>
            </NavLink>
            <NavLink to="/branding" end data-testid="nav-branding"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Palette size={16} strokeWidth={1.8} /><span>Personalização</span>
            </NavLink>
            <NavLink to="/super-admins" end data-testid="nav-super-admins"
              className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
              <Crown size={16} strokeWidth={1.8} /><span>Super Admins</span>
            </NavLink>
          </>
        )}
        {/* PBX integration: super admin (when in tenant context) and admins */}
        {(isSuper && tenantContext) || user?.role === "admin" ? (
          <NavLink to="/fusionpbx" end data-testid="nav-fusionpbx"
            className={({ isActive }) => `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
            <Server size={16} strokeWidth={1.8} /><span>Central PBX</span>
          </NavLink>
        ) : null}
        {/* Regular nav (only when in tenant context or for tenant users) */}
        {(tenantContext || !isSuper) && visibleItems.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.to === "/"} data-testid={it.testid}
            className={({ isActive }) =>
              `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${isActive ? "active" : ""}`}>
            <it.icon size={16} strokeWidth={1.8} />
            <span>{it.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium">
            {user?.name?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user?.name}</div>
            <div className="text-[10px] text-zinc-400 uppercase tracking-wider">{user?.role}</div>
          </div>
          <button onClick={doLogout} data-testid="btn-logout" className="text-zinc-400 hover:text-white p-1.5 rounded transition-colors" title="Sair">
            <LogOut size={15} />
          </button>
        </div>
        {appVersion && (
          <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono flex items-center justify-between" data-testid="app-version">
            <span>Voxyra CCA</span>
            <span className="text-zinc-400">{appVersion}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
