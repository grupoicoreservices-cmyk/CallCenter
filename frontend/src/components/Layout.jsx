import Sidebar from "./Sidebar";
import FloatingDialer from "./FloatingDialer";

export default function Layout({ title, subtitle, actions, children }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <header className="border-b border-border bg-card/50 backdrop-blur">
          <div className="px-8 py-5 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Voxyra · Callcenter Analytical</div>
              <h1 className="font-display text-2xl font-bold text-foreground mt-0.5" data-testid="page-title">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        </header>
        <div className="px-8 py-6">{children}</div>
      </main>
      <FloatingDialer />
    </div>
  );
}
