import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Trash2, X } from "lucide-react";
import { motion } from "motion/react";
import { DIAGNOSTIC_EVENT, type DiagnosticEntry, type DiagnosticSeverity } from "../lib/diagnostics";

const MAX_ENTRIES = 40;

export function ErrorDiagnosticConsole({ enabled }: { enabled: boolean }) {
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const add = (entry: DiagnosticEntry) => {
      setEntries((current) => [...current.slice(-(MAX_ENTRIES - 1)), entry]);
      setOpen(true);
    };
    const onDiagnostic = (event: Event) => {
      const entry = (event as CustomEvent<DiagnosticEntry>).detail;
      if (entry && typeof entry.message === "string") add(entry);
    };
    const onError = (event: ErrorEvent) => {
      add({
        id: `${Date.now()}-window-error`,
        title: "Runtime error",
        message: event.message || "An uncaught browser error occurred.",
        severity: "error",
        at: Date.now(),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      add({
        id: `${Date.now()}-promise-rejection`,
        title: "Unhandled async error",
        message: reason instanceof Error ? reason.message : String(reason ?? "An unhandled promise rejection occurred."),
        severity: "error",
        at: Date.now(),
      });
    };

    window.addEventListener(DIAGNOSTIC_EVENT, onDiagnostic);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener(DIAGNOSTIC_EVENT, onDiagnostic);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled]);

  const errorCount = entries.filter((entry) => entry.severity === "error").length;
  const severityColor: Record<DiagnosticSeverity, string> = {
    error: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    info: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100",
  };

  if (!enabled || entries.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[120] w-[min(420px,calc(100vw-32px))] text-slate-100">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-slate-950/90 px-3 py-2 text-xs shadow-xl backdrop-blur-xl"
          aria-label={`Open diagnostic console, ${entries.length} entries`}
        >
          <Activity size={14} className={errorCount ? "text-rose-300" : "text-cyan-300"} />
          Diagnostics <span className="font-mono text-white/60">{entries.length}</span>
        </button>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          aria-label="Error and diagnostic console"
          className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950/95 shadow-[0_16px_60px_rgba(0,0,0,.65)] backdrop-blur-2xl"
        >
          <header className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-wider">
              <AlertTriangle size={14} className={errorCount ? "text-rose-300" : "text-cyan-300"} />
              Error &amp; Diagnostic Console
              <span className="text-white/45">{entries.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setEntries([])} aria-label="Clear diagnostics" title="Clear"
                className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
                <Trash2 size={13} />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Minimize diagnostic console" title="Minimize"
                className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="max-h-64 space-y-2 overflow-y-auto p-2.5" aria-live="polite">
            {entries.slice().reverse().map((entry) => (
              <article key={entry.id} className={`rounded-lg border px-2.5 py-2 ${severityColor[entry.severity]}`}>
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="font-semibold">{entry.title}</span>
                  <time className="shrink-0 text-white/45">{new Date(entry.at).toLocaleTimeString()}</time>
                </div>
                <p className="mt-1 break-words text-[11px] leading-relaxed text-white/75">{entry.message}</p>
              </article>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}
