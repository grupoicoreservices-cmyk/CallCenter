const MAP = {
  online:   { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", label: "Online" },
  incall:   { bg: "bg-blue-100",    text: "text-blue-700",    dot: "bg-blue-500",    label: "Em Chamada" },
  paused:   { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-500",   label: "Pausado" },
  offline:  { bg: "bg-zinc-100",    text: "text-zinc-600",    dot: "bg-zinc-400",    label: "Offline" },
  ringing:  { bg: "bg-blue-100",    text: "text-blue-700",    dot: "bg-blue-500",    label: "Tocando" },
  queued:   { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-500",   label: "Na Fila" },
  answered: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", label: "Atendida" },
  missed:   { bg: "bg-red-100",     text: "text-red-700",     dot: "bg-red-500",     label: "Perdida" },
  abandoned:{ bg: "bg-red-100",     text: "text-red-700",     dot: "bg-red-500",     label: "Abandonada" },
  voicemail:{ bg: "bg-purple-100",  text: "text-purple-700",  dot: "bg-purple-500",  label: "Correio" },
};

export default function StatusBadge({ status, pulse = false }) {
  const s = MAP[status] || MAP.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${pulse ? "pulse-ring" : ""}`} />
      {s.label}
    </span>
  );
}
