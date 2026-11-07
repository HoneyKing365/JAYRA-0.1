import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  Play,
  Pause,
  Square,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { api, TERMINAL_TASK_STATES, type TaskView } from "../lib/appApi";

export interface FloatingTaskHudProps {
  tasks: Record<string, TaskView>;
}

export const FloatingTaskHud: React.FC<FloatingTaskHudProps> = ({ tasks }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Pick the most relevant task: active (non-terminal) first, or recently finished
  const allTasks: TaskView[] = Object.values(tasks || {}) as TaskView[];
  const activeTask: TaskView | undefined =
    allTasks.find((t) => !TERMINAL_TASK_STATES.has(t.state)) ||
    allTasks
      .filter(
        (t) =>
          TERMINAL_TASK_STATES.has(t.state) &&
          Date.now() - Date.parse(t.completedAt || t.updatedAt || "") < 4000
      )
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")
      )[0];

  // Auto reset dismissal when new task appears
  useEffect(() => {
    if (activeTask && dismissedId && activeTask.id !== dismissedId) {
      setDismissedId(null);
    }
  }, [activeTask?.id, dismissedId]);

  if (!activeTask || activeTask.id === dismissedId) {
    return null;
  }

  const isTerminal = TERMINAL_TASK_STATES.has(activeTask.state);
  const isPaused = activeTask.state === "paused";
  const isWaiting =
    activeTask.state.startsWith("waiting") ||
    Boolean(activeTask.pendingQuestion || activeTask.pendingConfirmation);

  const getStatusColor = () => {
    if (activeTask.state === "completed") return "text-emerald-400 border-emerald-400/40 bg-emerald-500/10";
    if (activeTask.state === "failed" || activeTask.state === "cancelled") return "text-rose-400 border-rose-400/40 bg-rose-500/10";
    if (isPaused || isWaiting) return "text-amber-400 border-amber-400/40 bg-amber-500/10";
    return "text-cyan-400 border-cyan-400/40 bg-cyan-500/10";
  };

  const getDotColor = () => {
    if (activeTask.state === "completed") return "bg-emerald-400 shadow-[0_0_8px_#10b981]";
    if (activeTask.state === "failed" || activeTask.state === "cancelled") return "bg-rose-400 shadow-[0_0_8px_#ef4444]";
    if (isPaused || isWaiting) return "bg-amber-400 shadow-[0_0_8px_#f59e0b]";
    return "bg-cyan-400 shadow-[0_0_8px_#00f3ff]";
  };

  const handleAction = async (action: "pause" | "resume" | "stop") => {
    if (actionBusy || !activeTask) return;
    setActionBusy(true);
    try {
      await api.taskAction(activeTask.id, action);
    } catch (err) {
      console.error("[FloatingTaskHud] Action error:", err);
    } finally {
      setActionBusy(false);
    }
  };

  const lastAction =
    activeTask.actions && activeTask.actions.length > 0
      ? activeTask.actions[activeTask.actions.length - 1]
      : null;

  return (
    <AnimatePresence>
      <motion.div
        key={activeTask.id}
        drag
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-6 right-6 z-[9998] w-96 max-w-[calc(100vw-32px)] rounded-2xl border border-cyan-400/30 bg-[#0b0e16]/95 p-4 text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,0.8),0_0_24px_rgba(0,243,255,0.12)] backdrop-blur-xl pointer-events-auto select-none font-sans"
        style={{ cursor: "grab" }}
        whileDrag={{ cursor: "grabbing" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2.5 w-2.5 rounded-full animate-pulse shrink-0 ${getDotColor()}`} />
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-cyan-300 shrink-0">
              JAYRA TASK HUD
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider font-semibold truncate ${getStatusColor()}`}
            >
              {activeTask.state}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={() => setDismissedId(activeTask.id)}
              className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        {!collapsed && (
          <div className="mt-3 space-y-3">
            {/* Task Goal */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Goal</div>
              <div className="text-xs font-medium text-slate-100 line-clamp-2 mt-0.5">
                {activeTask.goal || "Autonomous Task Execution"}
              </div>
            </div>

            {/* Current Status */}
            {activeTask.currentStatus && (
              <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                <div className="text-[9px] font-mono uppercase tracking-wider text-cyan-400/80">Status</div>
                <div className="text-xs text-slate-300 mt-0.5 line-clamp-2">
                  {activeTask.currentStatus}
                </div>
              </div>
            )}

            {/* Plan Steps */}
            {activeTask.plan && activeTask.plan.steps && activeTask.plan.steps.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-slate-400">
                  <span>Plan</span>
                  <span>
                    {activeTask.plan.steps.filter((s) => s.status === "done").length} /{" "}
                    {activeTask.plan.steps.length} done
                  </span>
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {activeTask.plan.steps.slice(0, 4).map((step, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 rounded px-2 py-1 text-[11px] ${
                        step.status === "active"
                          ? "bg-cyan-500/10 text-cyan-200 border border-cyan-500/30 font-medium"
                          : step.status === "done"
                          ? "text-slate-400 line-through opacity-70"
                          : "text-slate-400"
                      }`}
                    >
                      {step.status === "done" ? (
                        <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                      ) : step.status === "active" ? (
                        <ArrowRight size={12} className="text-cyan-400 shrink-0 mt-0.5 animate-pulse" />
                      ) : (
                        <Clock size={12} className="text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <span className="truncate">{step.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last Action Log */}
            {lastAction && (
              <div className="rounded border border-white/5 bg-black/40 px-2.5 py-1.5 text-[10px] font-mono text-slate-400">
                <span className="text-cyan-300">[{lastAction.tool}]</span>{" "}
                <span className="text-slate-300">{lastAction.summary || lastAction.status}</span>
              </div>
            )}

            {/* Footer Controls */}
            {!isTerminal && (
              <div
                className="flex items-center justify-between border-t border-white/10 pt-2.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="text-[10px] font-mono text-slate-500">
                  Step {activeTask.actions?.length || 0}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAction(isPaused ? "resume" : "pause")}
                    disabled={actionBusy}
                    className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 transition-colors"
                  >
                    {isPaused ? <Play size={12} className="text-emerald-400" /> : <Pause size={12} className="text-amber-400" />}
                    <span>{isPaused ? "Resume" : "Pause"}</span>
                  </button>
                  <button
                    onClick={() => handleAction("stop")}
                    disabled={actionBusy}
                    className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                  >
                    <Square size={11} className="text-rose-400 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

