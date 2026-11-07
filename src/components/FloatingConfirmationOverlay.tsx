import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, Loader2, Check, X } from "lucide-react";
import { api, type ConfirmationRequest } from "../lib/appApi";

export interface FloatingConfirmationOverlayProps {
  confirmations: ConfirmationRequest[];
}

export const FloatingConfirmationOverlay: React.FC<FloatingConfirmationOverlayProps> = ({
  confirmations,
}) => {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const request = confirmations[0];

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!request) return null;

  const secondsLeft = Math.max(0, Math.round((Date.parse(request.expiresAt) - now) / 1000));
  const details = Object.entries(request.details || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 6);

  const handleResolve = async (approved: boolean) => {
    setBusy(true);
    try {
      await api.resolveConfirmation(request.id, approved, "once");
    } catch (err) {
      console.error("[FloatingConfirmation] Error resolving:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key={request.id}
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="fixed top-5 right-5 z-[9999] w-[420px] max-w-[calc(100vw-40px)] rounded-2xl border border-amber-400/40 bg-[#0e1018]/95 p-5 shadow-2xl backdrop-blur-xl pointer-events-auto"
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-400/15 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]">
            <ShieldAlert size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider uppercase text-amber-300 border border-amber-400/30">
                {request.capability || "AUTHORIZATION"}
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {secondsLeft > 0 ? `${secondsLeft}s` : "Expired"}
              </span>
            </div>
            <h4 className="mt-1 text-sm font-semibold text-white tracking-tight">
              {request.title}
            </h4>
            <p className="mt-1 text-xs text-slate-300 leading-relaxed">
              {request.description}
            </p>
          </div>
        </div>

        {details.length > 0 && (
          <div className="mt-3 max-h-24 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-2.5 font-mono text-[10px] text-slate-300 space-y-1">
            {details.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="shrink-0 text-slate-500 uppercase">{k}:</span>
                <span className="truncate text-slate-200">
                  {typeof v === "string" ? v : JSON.stringify(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 pt-2 border-t border-white/5">
          <span className="text-[10px] font-mono text-slate-500">
            {confirmations.length > 1 ? `+${confirmations.length - 1} more pending` : "Requires approval"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResolve(false)}
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-rose-500/20 hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-40 cursor-pointer"
            >
              <X size={13} />
              Deny
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResolve(true)}
              className="flex items-center gap-1 rounded-lg border border-amber-400/50 bg-gradient-to-r from-amber-500/30 to-amber-600/40 px-3.5 py-1.5 text-xs font-semibold text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.25)] transition hover:from-amber-500/45 hover:to-amber-600/55 hover:border-amber-300 disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Authorize
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
