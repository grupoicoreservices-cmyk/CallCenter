import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, PhoneCall, Disc3, BarChart3, Users, UserCog, LogOut, Headphones,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/realtime", label: "Tempo Real", icon: PhoneCall, testid: "nav-realtime" },
  { to: "/recordings", label: "Gravações", icon: Disc3, testid: "nav-recordings" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, testid: "nav-reports" },
  { to: "/queues", label: "Filas", icon: Users, testid: "nav-queues" },
  { to: "/agents", label: "Agentes", icon: UserCog, testid: "nav-agents" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const doLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <aside className="w-60 shrink-0 bg-[hsl(var(--sidebar))] text-zinc-100 flex flex-col min-h-screen" data-testid="sidebar">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white text-black rounded-sm flex items-center justify-center">
            <Headphones size={16} strokeWidth={2.4} />
          </div>
          <div>
            <div className="font-display font-bold text-[15px] leading-none">Voxyra CCA</div>
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest mt-1">Callcenter Analytical</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            data-testid={it.testid}
            className={({ isActive }) =>
              `sidebar-item flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 border-l-2 border-transparent rounded-r-sm ${
                isActive ? "active" : ""
              }`
            }
          >
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
          <button
            onClick={doLogout}
            data-testid="btn-logout"
            className="text-zinc-400 hover:text-white p-1.5 rounded transition-colors"
            title="Sair"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
