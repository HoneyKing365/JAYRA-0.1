import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  X,
  RefreshCw,
  Calendar,
  Clock,
  Code2,
  FileText,
  ExternalLink,
  CheckCircle2,
  Circle,
  TrendingUp,
  Brain,
  Layers,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Plus,
  Copy,
  Check,
  Flame,
  Zap,
} from "lucide-react";
import { api, type DailySummaryFlashcard, type ProjectTimeBreakdown } from "../lib/appApi";

export interface DailySummaryCardProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string;
  themeColor?: string;
}

export function DailySummaryCard({
  isOpen,
  onClose,
  initialDate,
  themeColor = "cyan",
}: DailySummaryCardProps) {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return initialDate || new Date().toISOString().split("T")[0];
  });
  const [card, setCard] = useState<DailySummaryFlashcard | null>(null);
  const [vibeState, setVibeState] = useState<string>("DAYTIME_NORMAL");
  const [tasksSummary, setTasksSummary] = useState<{ total: number; completed: number; pending: number }>({
    total: 0,
    completed: 0,
    pending: 0,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Deck State
  const [activeTab, setActiveTab] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [checkedTodos, setCheckedTodos] = useState<Set<string>>(new Set());
  const [customTodos, setCustomTodos] = useState<string[]>([]);
  const [newTodoInput, setNewTodoInput] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [displayLang, setDisplayLang] = useState<"roman_urdu" | "roman_hindi" | "en" | "urdu">("roman_urdu");

  // Load summary for selected date
  const loadSummary = async (date: string, forceRegenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = forceRegenerate
        ? await api.generateKnowledgeGraphSummary(date)
        : await api.getKnowledgeGraphSummary(date);

      if (res.success && res.flashcard) {
        setCard(res.flashcard);
        if (res.vibeState) setVibeState(res.vibeState);
        if (res.tasksSummary) setTasksSummary(res.tasksSummary);
      } else {
        // If not found, attempt generation
        const genRes = await api.generateKnowledgeGraphSummary(date);
        if (genRes.success && genRes.flashcard) {
          setCard(genRes.flashcard);
          if (genRes.vibeState) setVibeState(genRes.vibeState);
          if (genRes.tasksSummary) setTasksSummary(genRes.tasksSummary);
        } else {
          setError("No activity records available for this date yet.");
        }
      }
    } catch (err: unknown) {
      console.error("[DailySummaryCard] Failed to fetch summary:", err);
      setError(err instanceof Error ? err.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadSummary(selectedDate);
      setIsFlipped(false);
    }
  }, [isOpen, selectedDate]);

  // Handle keyboard ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const toggleTodo = (todoText: string) => {
    setCheckedTodos((prev) => {
      const next = new Set(prev);
      if (next.has(todoText)) next.delete(todoText);
      else next.add(todoText);
      return next;
    });
  };

  const addCustomTodo = (e: React.FormEvent) => {
    e.preventDefault();
    const text = newTodoInput.trim();
    if (!text) return;
    setCustomTodos((prev) => [...prev, text]);
    setNewTodoInput("");
  };

  const copyMarkdown = () => {
    if (!card) return;
    void navigator.clipboard.writeText(card.markdownCard);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const navigateDate = (deltaDays: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + deltaDays);
    const nextStr = current.toISOString().split("T")[0];
    const todayStr = new Date().toISOString().split("T")[0];
    if (nextStr <= todayStr) {
      setSelectedDate(nextStr);
      setIsFlipped(false);
    }
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const productivityScore = card?.productivityScore ?? Math.min(100, Math.max(30, ((card?.focusMinutes || 60) / 240) * 70 + 20));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 10, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-summary-title"
            className="relative flex h-[90vh] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-cyan-500/30 bg-slate-950/95 font-sans text-slate-100 shadow-[0_25px_80px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
          >
            {/* Top Glowing Ambient Accents */}
            <div className="pointer-events-none absolute -top-24 left-1/4 h-56 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -top-24 right-1/4 h-56 w-96 rounded-full bg-indigo-500/15 blur-3xl" />

            {/* Header Bar */}
            <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
                  <Sparkles size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id="daily-summary-title" className="text-base font-semibold tracking-wide text-white">
                      JAYRA Daily Pulse & Knowledge Flashcards
                    </h2>
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-cyan-300">
                      Second Brain
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    Autonomous Developer Activity Synthesis & Retrospectives
                  </p>
                </div>
              </div>

              {/* Date Navigation & Controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-xl border border-white/10 bg-white/5 p-1 font-mono text-xs text-slate-300">
                  <button
                    type="button"
                    onClick={() => navigateDate(-1)}
                    aria-label="Previous day"
                    className="rounded-lg p-1.5 transition hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="flex items-center gap-1.5 px-2.5 font-medium text-cyan-200">
                    <Calendar size={13} className="text-cyan-400" />
                    {selectedDate}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigateDate(1)}
                    disabled={isToday}
                    aria-label="Next day"
                    className="rounded-lg p-1.5 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => loadSummary(selectedDate, true)}
                  disabled={loading}
                  aria-label="Re-synthesize summary"
                  title="Force re-synthesize day pulse"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-cyan-300 disabled:opacity-40"
                >
                  <RefreshCw size={15} className={loading ? "animate-spin text-cyan-400" : ""} />
                </button>

                <button
                  type="button"
                  onClick={copyMarkdown}
                  title="Copy full summary markdown"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-cyan-300"
                >
                  {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            {/* Quick Metrics Ribbon */}
            <section className="relative z-10 grid shrink-0 grid-cols-2 gap-3 border-b border-white/10 bg-white/[0.02] px-6 py-3 sm:grid-cols-4">
              {/* Focus Time */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                  <Clock size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Deep Focus</div>
                  <div className="truncate text-sm font-semibold text-white">
                    {card ? `${card.focusHours}h` : "—"} <span className="text-xs font-normal text-slate-400">({card?.focusMinutes || 0}m)</span>
                  </div>
                </div>
              </div>

              {/* Productivity Score */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                  <TrendingUp size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Productivity</div>
                  <div className="truncate text-sm font-semibold text-emerald-300">
                    {productivityScore}% <span className="text-xs font-normal text-slate-400">Velocity</span>
                  </div>
                </div>
              </div>

              {/* Tasks Status */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
                  <CheckCircle2 size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Tasks Breakdown</div>
                  <div className="truncate text-sm font-semibold text-white">
                    <span className="text-emerald-400">{tasksSummary.completed}</span> done /{" "}
                    <span className="text-amber-400">{tasksSummary.pending}</span> active
                  </div>
                </div>
              </div>

              {/* Ambient Vibe State */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-violet-400/20 bg-violet-400/10 text-violet-300">
                  <Zap size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Vibe Baseline</div>
                  <div className="truncate text-xs font-mono font-medium text-violet-200">
                    {vibeState.replace(/_/g, " ")}
                  </div>
                </div>
              </div>
            </section>

            {/* Flashcard Tab Switcher */}
            <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-2">
              <div className="flex gap-2">
                {[
                  { index: 0, label: "Daily Retrospective", icon: Sparkles },
                  { index: 1, label: "Code Milestones & Files", icon: Code2 },
                  { index: 2, label: "Actionable Priorities", icon: CheckCircle2 },
                ].map(({ index, label, icon: Icon }) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setActiveTab(index);
                      setIsFlipped(false);
                    }}
                    className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition ${
                      activeTab === index
                        ? "border border-cyan-400/30 bg-cyan-500/15 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Flip Button Indicator */}
              <button
                type="button"
                onClick={() => setIsFlipped((prev) => !prev)}
                aria-label="Flip flashcard"
                className="flex items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-mono font-medium text-cyan-300 transition hover:bg-cyan-400/20"
              >
                <RotateCcw size={13} className="transition-transform duration-300" />
                <span>{isFlipped ? "Flip to Front" : "Flip Flashcard"}</span>
              </button>
            </div>

            {/* Interactive Flashcard 3D Stage */}
            <main className="relative flex-1 overflow-y-auto p-6" style={{ perspective: "1200px" }}>
              {loading && !card ? (
                <div className="grid h-full place-items-center">
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
                    <p className="font-mono text-sm text-cyan-200">Synthesizing Second Brain daily pulse…</p>
                  </div>
                </div>
              ) : error && !card ? (
                <div className="grid h-full place-items-center">
                  <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
                    <p className="text-sm text-rose-200">{error}</p>
                    <button
                      type="button"
                      onClick={() => loadSummary(selectedDate, true)}
                      className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/20"
                    >
                      Generate Pulse Now
                    </button>
                  </div>
                </div>
              ) : card ? (
                <motion.div
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformStyle: "preserve-3d" }}
                  className="relative min-h-full w-full"
                >
                  {/* ===================== FRONT SIDE ===================== */}
                  <div
                    style={{ backfaceVisibility: "hidden" }}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 shadow-xl"
                  >
                    {activeTab === 0 && (
                      <div className="space-y-6">
                        {/* JAYRA Sassy Multilingual Quote */}
                        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-indigo-950/40 p-5 backdrop-blur-xl">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <span className="text-2xl">⚡</span>
                              <div>
                                <div className="text-[11px] font-mono uppercase tracking-wider text-cyan-300">
                                  JAYRA Companion Pulse
                                </div>
                                <blockquote className="mt-1 text-sm font-medium italic leading-relaxed text-cyan-100">
                                  "{displayLang === "roman_urdu"
                                    ? (card.sassySummary.romanUrdu || card.sassySummary.hinglish)
                                    : displayLang === "roman_hindi"
                                    ? (card.sassySummary.romanHindi || card.sassySummary.hinglish)
                                    : displayLang === "en"
                                    ? card.sassySummary.english
                                    : card.sassySummary.urdu}"
                                </blockquote>
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-1 rounded-lg border border-white/10 bg-black/40 p-1">
                              {(
                                [
                                  ["roman_urdu", "Roman Urdu"],
                                  ["roman_hindi", "Roman Hindi"],
                                  ["en", "EN"],
                                  ["urdu", "اردو"],
                                ] as const
                              ).map(([code, label]) => (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => setDisplayLang(code)}
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                                    displayLang === code
                                      ? "bg-cyan-500/30 text-cyan-200"
                                      : "text-slate-400 hover:text-slate-200"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Project Time Breakdown */}
                        <div>
                          <h3 className="mb-3 flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                            <Layers size={14} className="text-cyan-400" /> Project Time Breakdown
                          </h3>
                          {card.projectBreakdown.length > 0 ? (
                            <div className="space-y-2.5">
                              {card.projectBreakdown.map((proj: ProjectTimeBreakdown) => {
                                const percentage = Math.min(100, Math.round((proj.durationMinutes / (card.focusMinutes || 1)) * 100));
                                return (
                                  <div key={proj.project} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                                    <div className="flex items-center justify-between text-xs font-medium">
                                      <span className="text-white">{proj.project}</span>
                                      <span className="font-mono text-cyan-300">
                                        {proj.durationMinutes} mins ({proj.activitiesCount} events)
                                      </span>
                                    </div>
                                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400 transition-all duration-500"
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No specific project time records captured today.</p>
                          )}
                        </div>

                        {/* Productivity Bar Meter */}
                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-300 font-medium">Daily Focus Quotient</span>
                            <span className="font-mono text-emerald-400">{productivityScore}/100</span>
                          </div>
                          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400 transition-all duration-700"
                              style={{ width: `${productivityScore}%` }}
                            />
                          </div>
                          <div className="mt-2 flex justify-between text-[10px] font-mono text-slate-500">
                            <span>0m Warmup</span>
                            <span>2h Target</span>
                            <span>4h+ Mastery</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 1 && (
                      <div className="space-y-6">
                        {/* Key Files Edited / Opened */}
                        <div>
                          <h3 className="mb-3 flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                            <FileText size={14} className="text-cyan-400" /> Key Code Contributions & Touchpoints
                          </h3>
                          {card.topFiles.length > 0 ? (
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                              {card.topFiles.map((file: string) => (
                                <div
                                  key={file}
                                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs"
                                >
                                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-300 font-mono text-[11px]">
                                    JS
                                  </div>
                                  <span className="truncate font-mono font-medium text-slate-200">{file}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No file touchpoints recorded on this date.</p>
                          )}
                        </div>

                        {/* Recent User Queries */}
                        <div>
                          <h3 className="mb-3 flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                            <Brain size={14} className="text-indigo-400" /> Research & Inquiries Asked to JAYRA
                          </h3>
                          {card.recentQueries.length > 0 ? (
                            <div className="space-y-2">
                              {card.recentQueries.map((query: string, i: number) => (
                                <div
                                  key={i}
                                  className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-slate-300"
                                >
                                  <span className="font-mono text-indigo-400 mr-2">Q{i + 1}:</span>
                                  {query}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">No recorded technical questions on this date.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === 2 && (
                      <div className="space-y-6">
                        {/* Dynamic Recommended To-Dos */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                              <CheckCircle2 size={14} className="text-emerald-400" /> Recommended Action Items (Tomorrow)
                            </h3>
                            <span className="text-[11px] font-mono text-slate-400">
                              {checkedTodos.size} completed
                            </span>
                          </div>

                          <div className="space-y-2">
                            {card.recommendedTodos.concat(customTodos).map((todo: string, idx: number) => {
                              const isDone = checkedTodos.has(todo);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => toggleTodo(todo)}
                                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-xs transition ${
                                    isDone
                                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200 line-through"
                                      : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-cyan-400/30 hover:bg-white/[0.05]"
                                  }`}
                                >
                                  {isDone ? (
                                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                                  ) : (
                                    <Circle size={16} className="text-slate-500 shrink-0" />
                                  )}
                                  <span className="flex-1">{todo}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Add Custom To-Do Form */}
                          <form onSubmit={addCustomTodo} className="mt-3 flex gap-2">
                            <input
                              type="text"
                              value={newTodoInput}
                              onChange={(e) => setNewTodoInput(e.target.value)}
                              placeholder="Add priority task for tomorrow..."
                              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"
                            />
                            <button
                              type="submit"
                              disabled={!newTodoInput.trim()}
                              className="flex items-center gap-1.5 rounded-xl bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-30"
                            >
                              <Plus size={14} /> Add
                            </button>
                          </form>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ===================== BACK SIDE ===================== */}
                  <div
                    style={{
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                    }}
                    className="absolute inset-0 overflow-y-auto rounded-2xl border border-cyan-500/30 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-2xl"
                  >
                    <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-2">
                          <Brain size={16} className="text-cyan-400" />
                          <h3 className="text-sm font-semibold text-white">
                            Retrospective Backchannel & Knowledge Insights
                          </h3>
                        </div>
                        <span className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                          Flashcard Backside
                        </span>
                      </div>

                      {/* Multilingual Sassy Translations */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3.5">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">Roman Urdu Retrospective</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-200">
                            {card.sassySummary.romanUrdu || card.sassySummary.hinglish}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3.5">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Roman Hindi Retrospective</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-200">
                            {card.sassySummary.romanHindi || card.sassySummary.hinglish}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3.5">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">English Narrative</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-200">{card.sassySummary.english}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3.5">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-pink-400">Urdu Retrospective (Nastaliq)</div>
                          <p className="mt-1 text-sm font-medium leading-relaxed text-pink-100" dir="rtl">
                            {card.sassySummary.urdu}
                          </p>
                        </div>
                      </div>

                      {/* Key Reference URLs */}
                      {card.keyReferences.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
                            External References Visited
                          </div>
                          <div className="space-y-1.5">
                            {card.keyReferences.map((ref: { title?: string; url: string }, i: number) => (
                              <a
                                key={i}
                                href={ref.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-cyan-300 transition hover:bg-white/5 hover:underline"
                              >
                                <span className="truncate">{ref.title || ref.url}</span>
                                <ExternalLink size={12} className="shrink-0 ml-2" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Graph Metrics Summary */}
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs font-mono text-slate-400">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <div>
                            <span className="text-slate-500">Activities:</span> {card.totalActivities}
                          </div>
                          <div>
                            <span className="text-slate-500">Card ID:</span> {card.cardId}
                          </div>
                          <div>
                            <span className="text-slate-500">Vibe Baseline:</span> {card.vibeBaseline || vibeState}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </main>

            {/* Footer Status Bar */}
            <footer className="relative z-10 flex shrink-0 items-center justify-between border-t border-white/10 bg-white/[0.02] px-6 py-3 text-xs text-slate-400">
              <span className="font-mono text-[11px]">
                💡 Tip: Click "Flip Flashcard" or ask JAYRA "Show me today's summary card" anytime.
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
              >
                Close View
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

