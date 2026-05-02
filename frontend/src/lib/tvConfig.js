// Default TV panel configuration
export const DEFAULT_CONFIG = {
  theme: "dark", // "dark" | "light"
  refreshSec: 5,
  // Layout mode
  layout: "default", // "default" | "rotation"
  rotationSec: 30,
  // Visible widgets
  widgets: {
    kpiOnline: true,
    kpiIncall: true,
    kpiPaused: true,
    kpiAnswered: true,
    kpiMissed: true,
    kpiSla: true,
    kpiWaiting: false,
    kpiAvgWait: false,
    queues: true,
    liveCalls: true,
    topAgents: true,
    clock: true,
    footer: true,
  },
  // Rotation slides (only used when layout=rotation)
  slides: {
    queues: true,
    liveCalls: true,
    topAgents: true,
    kpis: true,
  },
  // Alerts
  alerts: {
    soundEnabled: true,
    slaBelow: 80,         // percent
    queueAbove: 5,        // waiting count
    missedAbove: 10,      // missed today
    cooldownSec: 30,      // don't repeat alerts within this window
  },
  // Branding
  title: "Voxyra CCA · TV Panel",
};

const KEY = "voxyra_tv_config_v1";

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return deepMerge({ ...DEFAULT_CONFIG }, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}

export function resetConfig() {
  try { localStorage.removeItem(KEY); } catch {}
  return { ...DEFAULT_CONFIG };
}

function deepMerge(a, b) {
  if (!b || typeof b !== "object") return a;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) {
      out[k] = deepMerge(a[k] || {}, b[k]);
    } else {
      out[k] = b[k];
    }
  }
  return out;
}

// --- Web Audio beep ---
let audioCtx = null;
function getCtx() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { audioCtx = null; }
  return audioCtx;
}

export function playBeep(kind = "alert") {
  const ctx = getCtx();
  if (!ctx) return;
  // Resume suspended context (browser autoplay policy)
  if (ctx.state === "suspended") { try { ctx.resume(); } catch {} }
  const now = ctx.currentTime;
  const beeps = kind === "critical"
    ? [{ f: 880, d: 0.18 }, { f: 660, d: 0.18 }, { f: 880, d: 0.22 }]
    : kind === "warn"
    ? [{ f: 660, d: 0.15 }, { f: 880, d: 0.18 }]
    : [{ f: 760, d: 0.18 }];
  let t = now;
  for (const b of beeps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = b.f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + b.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + b.d + 0.02);
    t += b.d + 0.06;
  }
}
