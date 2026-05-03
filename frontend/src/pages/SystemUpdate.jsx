import { useEffect, useState, useRef } from "react";
import { api, formatApiError, fmtDateTime } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import {
  RefreshCw, Download, GitBranch, CheckCircle2, AlertCircle, Terminal, Shield, Clock,
  Wrench, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function SystemUpdate() {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState(null);
  const logRef = useRef(null);
  const pollRef = useRef(null);

  async function loadInfo() {
    setLoading(true);
    try {
      const { data } = await api.get("/system/info");
      setInfo(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao obter info"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user?.role === "super_admin") loadInfo(); }, [user]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log?.length]);

  if (user?.role !== "super_admin") {
    return <Layout title="Atualizações"><div className="border border-border bg-card rounded-sm p-12 text-center">
      <Shield size={32} className="mx-auto text-muted-foreground mb-3" />
      <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
      <p className="text-sm text-muted-foreground mt-1">Apenas super-administradores podem atualizar o sistema.</p>
    </div></Layout>;
  }

  async function check() {
    setChecking(true);
    try {
      const { data } = await api.post("/system/update/check");
      if (data.has_updates) toast.success(`${data.commits_behind} atualizaç${data.commits_behind > 1 ? "ões" : "ão"} disponíveis!`);
      else toast.info("Você está na versão mais recente ✓");
      loadInfo();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setChecking(false); }
  }

  async function runPreflight() {
    setCheckingPreflight(true);
    setPreflight(null);
    try {
      const { data } = await api.get("/system/update/preflight");
      setPreflight(data);
      if (data.all_ok) toast.success("Todas as permissões OK ✓");
      else toast.warning("Algumas permissões precisam ser corrigidas");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro"); }
    finally { setCheckingPreflight(false); }
  }

  async function startUpdate() {
    if (!window.confirm(
      "Iniciar atualização?\n\n" +
      "O sistema vai: puxar o código do Git, atualizar dependências, recompilar o frontend e reiniciar.\n\n" +
      "A aplicação ficará indisponível por ~15-30 segundos no final.\n\n" +
      "Tem certeza?"
    )) return;
    setUpdating(true);
    try {
      await api.post("/system/update/run");
      toast.success("Atualização iniciada");
      setStatus({ running: true, log: [] });
      // Poll status every 2s
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get("/system/update/status");
          setStatus(data);
          if (!data.running) {
            clearInterval(pollRef.current);
            setUpdating(false);
            if (data.success) {
              toast.success("Atualização concluída! Reiniciando…");
              setTimeout(() => window.location.reload(), 10000);
            } else {
              toast.error("Atualização falhou. Veja os logs abaixo.");
              loadInfo();
            }
          }
        } catch (e) {
          // Backend may be restarting — keep trying
        }
      }, 2000);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro");
      setUpdating(false);
    }
  }

  const git = info?.git || {};
  const hasGit = git.installed;
  const hasUpdates = git.has_updates;

  return (
    <Layout title="Atualizações do Sistema" subtitle={info?.app_version ? `Voxyra CCA · ${info.app_version}` : "Voxyra CCA · Atualize a plataforma via interface web"}>
      {loading ? (
        <div className="text-center text-muted-foreground py-8 font-mono text-sm">carregando…</div>
      ) : (
        <>
          {/* Status / Version Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="border border-border bg-card rounded-sm p-5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-2">
                <GitBranch size={12} /> Versão Atual
              </div>
              {hasGit ? (
                <>
                  <div className="font-mono text-lg">{git.commit}</div>
                  <div className="text-xs text-muted-foreground mt-1">branch: <span className="font-mono">{git.branch}</span></div>
                  <div className="text-xs text-muted-foreground mt-2 border-t border-border pt-2 italic line-clamp-2">{git.last_commit_message}</div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-1">{fmtDateTime(git.last_commit_date)}</div>
                </>
              ) : (
                <div className="text-sm text-amber-700">Não é um repo Git · clone via git para habilitar</div>
              )}
            </div>

            <div className="border border-border bg-card rounded-sm p-5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-2">
                <Download size={12} /> Atualizações
              </div>
              {!hasGit ? (
                <div className="text-sm text-muted-foreground">—</div>
              ) : hasUpdates ? (
                <>
                  <div className="text-2xl font-mono text-amber-600">{git.commits_behind}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {git.commits_behind === 1 ? "nova atualização disponível" : "novas atualizações disponíveis"}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 size={18} /> <span className="font-medium">Atualizado</span></div>
                  <div className="text-xs text-muted-foreground mt-1">Você está na versão mais recente</div>
                </>
              )}
            </div>

            <div className="border border-border bg-card rounded-sm p-5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-2">
                <Clock size={12} /> Última atualização
              </div>
              <div className="font-mono text-sm">{info?.update_state?.finished_at ? fmtDateTime(info.update_state.finished_at) : "—"}</div>
              {info?.update_state?.success === true && <div className="text-xs text-emerald-600 mt-1">✓ Sucesso</div>}
              {info?.update_state?.success === false && <div className="text-xs text-red-600 mt-1">✗ Falhou</div>}
            </div>
          </div>

          {/* Actions */}
          <div className="border border-border bg-card rounded-sm p-5 mb-4">
            <h3 className="font-display text-lg font-semibold mb-3">Ações</h3>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={check} disabled={checking || updating || !hasGit} data-testid="btn-check-updates">
                <RefreshCw size={14} className="mr-1.5" />{checking ? "Verificando…" : "Verificar atualizações"}
              </Button>
              <Button variant="outline" onClick={runPreflight} disabled={checkingPreflight || updating} data-testid="btn-preflight">
                <Wrench size={14} className="mr-1.5" />{checkingPreflight ? "Verificando…" : "Diagnosticar Permissões"}
              </Button>
              <Button onClick={startUpdate} disabled={updating || !hasGit} data-testid="btn-run-update"
                      className={hasUpdates ? "bg-amber-600 hover:bg-amber-700" : ""}>
                <Download size={14} className="mr-1.5" />{updating ? "Atualizando…" : (hasUpdates ? "Atualizar Agora" : "Forçar Atualização")}
              </Button>
            </div>
            {preflight && (
              <div className="mt-4 space-y-2">
                <div className={`rounded-sm p-3 border text-sm ${preflight.all_ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="font-medium flex items-center gap-2">
                    {preflight.all_ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-amber-600" />}
                    {preflight.all_ok ? "Todas as permissões OK — atualização pela web pronta!" : "Algumas permissões precisam ser corrigidas"}
                  </div>
                </div>
                {preflight.checks.map((c, i) => (
                  <div key={i} className={`border rounded-sm p-3 text-sm ${c.ok ? "border-border bg-zinc-50" : "border-red-200 bg-red-50"}`}>
                    <div className="flex items-center gap-2 font-medium">
                      {c.ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-red-600" />}
                      {c.name}
                    </div>
                    {!c.ok && c.fix && (
                      <div className="mt-2 flex items-start gap-2">
                        <pre className="flex-1 bg-zinc-950 text-zinc-300 font-mono text-[11px] p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">{c.fix}</pre>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(c.fix); toast.success("Copiado"); }}>
                          <Copy size={12} />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!hasGit && (
              <div className="mt-4 border border-amber-200 bg-amber-50 rounded-sm p-3 text-xs text-amber-900">
                <strong>Instalado manualmente (sem Git):</strong> para habilitar atualização pela web, instale via <code className="font-mono bg-white px-1">git clone</code> em <code className="font-mono bg-white px-1">/opt/CallCenter</code>.
              </div>
            )}
          </div>

          {/* Live Log */}
          {status && (
            <div className="border border-border bg-zinc-950 rounded-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Terminal size={14} />
                  <span className="font-mono text-xs uppercase tracking-widest">Console de atualização</span>
                </div>
                <div className="flex items-center gap-2">
                  {status.running && <span className="inline-flex items-center gap-1 text-xs text-amber-400"><RefreshCw size={10} className="animate-spin" /> em execução</span>}
                  {!status.running && status.success === true && <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={10} /> sucesso</span>}
                  {!status.running && status.success === false && <span className="inline-flex items-center gap-1 text-xs text-red-400"><AlertCircle size={10} /> falhou</span>}
                </div>
              </div>
              <div ref={logRef} className="font-mono text-xs text-zinc-300 bg-black rounded p-3 h-96 overflow-y-auto whitespace-pre-wrap" data-testid="update-log">
                {(status.log || []).map((l, i) => (
                  <div key={i} className={l.line.startsWith("$") ? "text-cyan-400" : l.line.startsWith("❌") ? "text-red-400" : l.line.startsWith("✅") || l.line.startsWith("🚀") || l.line.startsWith("🔄") ? "text-emerald-400" : ""}>
                    {l.line}
                  </div>
                ))}
                {status.running && <div className="text-amber-400 animate-pulse">▊</div>}
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
