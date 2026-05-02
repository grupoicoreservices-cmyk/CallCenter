import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { X, RotateCcw, Volume2 } from "lucide-react";
import { DEFAULT_CONFIG, playBeep } from "../lib/tvConfig";

export default function TvSettingsDrawer({ open, onClose, config, setConfig, onReset }) {
  if (!open) return null;
  const isDark = config.theme === "dark";

  function setField(path, value) {
    const parts = path.split(".");
    const next = JSON.parse(JSON.stringify(config));
    let cur = next;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
    setConfig(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="tv-settings">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={`relative w-full sm:w-[420px] h-full overflow-y-auto shadow-2xl ${isDark ? "bg-zinc-900 text-zinc-100 border-l border-white/10" : "bg-white text-zinc-900 border-l border-zinc-200"}`}
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        <div className={`sticky top-0 z-10 px-5 py-4 flex items-center justify-between ${isDark ? "bg-zinc-900 border-b border-white/10" : "bg-white border-b border-zinc-200"}`}>
          <div>
            <div className={`text-[10px] uppercase tracking-widest font-medium ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>Personalização</div>
            <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Painel TV</h2>
          </div>
          <button onClick={onClose} data-testid="tv-settings-close" className={`p-2 rounded ${isDark ? "hover:bg-white/10" : "hover:bg-zinc-100"}`}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Theme */}
          <Section title="Aparência" isDark={isDark}>
            <Row label="Tema">
              <div className="flex gap-2">
                <ThemeBtn active={config.theme === "light"} onClick={() => setField("theme", "light")} testid="tv-theme-light" isDark={isDark}>Claro</ThemeBtn>
                <ThemeBtn active={config.theme === "dark"} onClick={() => setField("theme", "dark")} testid="tv-theme-dark" isDark={isDark}>Escuro</ThemeBtn>
              </div>
            </Row>
            <Row label="Título do painel">
              <Input value={config.title} onChange={(e) => setField("title", e.target.value)} className="h-8" data-testid="tv-title-input" />
            </Row>
          </Section>

          {/* Layout & Rotation */}
          <Section title="Layout e Rotação" isDark={isDark}>
            <Row label="Modo">
              <div className="flex gap-2">
                <ThemeBtn active={config.layout === "default"} onClick={() => setField("layout", "default")} testid="tv-layout-default" isDark={isDark}>Padrão</ThemeBtn>
                <ThemeBtn active={config.layout === "rotation"} onClick={() => setField("layout", "rotation")} testid="tv-layout-rotation" isDark={isDark}>Rotação</ThemeBtn>
              </div>
            </Row>
            {config.layout === "rotation" && (
              <>
                <Row label={`Intervalo: ${config.rotationSec}s`}>
                  <Slider min={10} max={120} step={5} value={[config.rotationSec]} onValueChange={(v) => setField("rotationSec", v[0])} data-testid="tv-rot-interval" />
                </Row>
                <Row label="Slides ativos">
                  <div className="space-y-1.5 w-full">
                    <Toggle label="KPIs" checked={config.slides.kpis} onChange={(v) => setField("slides.kpis", v)} testid="tv-slide-kpis" />
                    <Toggle label="Filas" checked={config.slides.queues} onChange={(v) => setField("slides.queues", v)} testid="tv-slide-queues" />
                    <Toggle label="Chamadas Ao Vivo" checked={config.slides.liveCalls} onChange={(v) => setField("slides.liveCalls", v)} testid="tv-slide-calls" />
                    <Toggle label="Top Agentes" checked={config.slides.topAgents} onChange={(v) => setField("slides.topAgents", v)} testid="tv-slide-agents" />
                  </div>
                </Row>
              </>
            )}
            <Row label={`Atualização: ${config.refreshSec}s`}>
              <Slider min={3} max={60} step={1} value={[config.refreshSec]} onValueChange={(v) => setField("refreshSec", v[0])} />
            </Row>
          </Section>

          {/* Widgets */}
          <Section title="Widgets visíveis" isDark={isDark}>
            <div className={`text-[10px] uppercase tracking-widest font-medium mb-2 ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>KPIs</div>
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              <Toggle label="Online" checked={config.widgets.kpiOnline} onChange={(v) => setField("widgets.kpiOnline", v)} />
              <Toggle label="Em Chamada" checked={config.widgets.kpiIncall} onChange={(v) => setField("widgets.kpiIncall", v)} />
              <Toggle label="Pausados" checked={config.widgets.kpiPaused} onChange={(v) => setField("widgets.kpiPaused", v)} />
              <Toggle label="Atendidas" checked={config.widgets.kpiAnswered} onChange={(v) => setField("widgets.kpiAnswered", v)} />
              <Toggle label="Perdidas" checked={config.widgets.kpiMissed} onChange={(v) => setField("widgets.kpiMissed", v)} />
              <Toggle label="SLA" checked={config.widgets.kpiSla} onChange={(v) => setField("widgets.kpiSla", v)} />
              <Toggle label="Aguardando" checked={config.widgets.kpiWaiting} onChange={(v) => setField("widgets.kpiWaiting", v)} />
              <Toggle label="TME médio" checked={config.widgets.kpiAvgWait} onChange={(v) => setField("widgets.kpiAvgWait", v)} />
            </div>
            <div className={`text-[10px] uppercase tracking-widest font-medium mb-2 ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>Painéis</div>
            <div className="space-y-1.5">
              <Toggle label="Filas de Atendimento" checked={config.widgets.queues} onChange={(v) => setField("widgets.queues", v)} />
              <Toggle label="Chamadas Ao Vivo" checked={config.widgets.liveCalls} onChange={(v) => setField("widgets.liveCalls", v)} />
              <Toggle label="Top Agentes" checked={config.widgets.topAgents} onChange={(v) => setField("widgets.topAgents", v)} />
              <Toggle label="Relógio no cabeçalho" checked={config.widgets.clock} onChange={(v) => setField("widgets.clock", v)} />
              <Toggle label="Rodapé" checked={config.widgets.footer} onChange={(v) => setField("widgets.footer", v)} />
            </div>
          </Section>

          {/* Alerts */}
          <Section title="Alertas Sonoros" isDark={isDark}>
            <Row label="Som ativado">
              <Switch checked={config.alerts.soundEnabled} onCheckedChange={(v) => setField("alerts.soundEnabled", v)} data-testid="tv-sound-enabled" />
            </Row>
            <Row label={`SLA crítico abaixo de ${config.alerts.slaBelow}%`}>
              <Slider min={50} max={99} step={1} value={[config.alerts.slaBelow]} onValueChange={(v) => setField("alerts.slaBelow", v[0])} data-testid="tv-alert-sla" />
            </Row>
            <Row label={`Fila com mais de ${config.alerts.queueAbove} aguardando`}>
              <Slider min={1} max={20} step={1} value={[config.alerts.queueAbove]} onValueChange={(v) => setField("alerts.queueAbove", v[0])} data-testid="tv-alert-queue" />
            </Row>
            <Row label={`Mais de ${config.alerts.missedAbove} perdidas hoje`}>
              <Slider min={1} max={50} step={1} value={[config.alerts.missedAbove]} onValueChange={(v) => setField("alerts.missedAbove", v[0])} data-testid="tv-alert-missed" />
            </Row>
            <Row label={`Cooldown: ${config.alerts.cooldownSec}s`}>
              <Slider min={10} max={300} step={10} value={[config.alerts.cooldownSec]} onValueChange={(v) => setField("alerts.cooldownSec", v[0])} />
            </Row>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => playBeep("warn")} data-testid="tv-test-warn"><Volume2 size={14} className="mr-1.5" /> Testar Aviso</Button>
              <Button variant="outline" size="sm" onClick={() => playBeep("critical")} data-testid="tv-test-critical"><Volume2 size={14} className="mr-1.5" /> Testar Crítico</Button>
            </div>
          </Section>

          <div className="pt-4 border-t border-zinc-200/30">
            <Button variant="outline" size="sm" onClick={onReset} className="w-full" data-testid="tv-reset">
              <RotateCcw size={14} className="mr-2" /> Restaurar padrões
            </Button>
            <p className={`text-[10px] mt-3 text-center ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
              As configurações são salvas localmente neste navegador.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, isDark, children }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest font-bold mb-3 pb-2 border-b ${isDark ? "text-zinc-300 border-white/10" : "text-zinc-700 border-zinc-200"}`}>
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <Label className="text-xs mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, testid }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm cursor-pointer py-1">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testid} />
    </label>
  );
}

function ThemeBtn({ active, onClick, children, testid, isDark }) {
  const activeCls = isDark ? "bg-white text-black" : "bg-zinc-900 text-white";
  const idleCls = isDark ? "bg-white/5 text-zinc-300 hover:bg-white/10" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200";
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${active ? activeCls : idleCls}`}
    >
      {children}
    </button>
  );
}
