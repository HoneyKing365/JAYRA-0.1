import { useEffect, useState } from "react";
import { motion } from "motion/react";
import brandIcon from "../../build/icon.png";
import {
  AudioLines, Brain, ChevronLeft, ChevronRight, Circle, ClipboardCheck, Sparkles, MessageSquare,
  Moon, Settings, ShieldCheck, Smartphone, Sun, UserRound, Code2,
} from "lucide-react";
import type { LiveState } from "../lib/audio";
import { useTheme } from "../theme/ThemeProvider";

export type SidebarDestination = "live" | "chat" | "tasks" | "avatar" | "codestudio" | "recalls" | "summary" | "mobile" | "permissions" | "settings";

interface SidebarProps {
  liveState: LiveState;
  hasActiveTask: boolean;
  tasksEnabled: boolean;
  networkEnabled: boolean;
  activeDestination: SidebarDestination;
  onNavigate: (destination: SidebarDestination) => void;
}

const COLLAPSED_KEY = "jayra.sidebar.collapsed.v1";

export function Sidebar({ liveState, hasActiveTask, tasksEnabled, networkEnabled, activeDestination, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(COLLAPSED_KEY);
    return saved === null ? true : saved === "true";
  });
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const items = [
    { id: "live" as const, label: "Live Assistant", icon: AudioLines, badge: liveState === "disconnected" ? "Ready" : liveState, tone: liveState === "disconnected" ? "neutral" : "live" },
    { id: "chat" as const, label: "Chat History", icon: MessageSquare, badge: "Saved", tone: "neutral" },
    { id: "tasks" as const, label: "Tasks HUD", icon: ClipboardCheck, badge: hasActiveTask ? "Running" : tasksEnabled ? "Ready" : "Hidden", tone: hasActiveTask ? "live" : "neutral" },
    { id: "avatar" as const, label: "3D Avatar Stage", icon: UserRound, badge: liveState === "speaking" ? "Speaking" : liveState === "listening" ? "Listening" : "Stage", tone: liveState === "speaking" || liveState === "listening" ? "live" : "neutral" },
    { id: "codestudio" as const, label: "Code Studio", icon: Code2, badge: "IDE", tone: "neutral" },
    { id: "recalls" as const, label: "Memory & Recalls", icon: Brain, badge: "Memory", tone: "neutral" },
    { id: "summary" as const, label: "Daily Pulse & Flashcards", icon: Sparkles, badge: "Pulse", tone: "neutral" },
    { id: "mobile" as const, label: "Mobile Connect", icon: Smartphone, badge: networkEnabled ? "LAN on" : "LAN off", tone: networkEnabled ? "live" : "neutral" },
    { id: "permissions" as const, label: "PC Permissions", icon: ShieldCheck, badge: "Policy", tone: "neutral" },
    { id: "settings" as const, label: "Settings", icon: Settings, badge: "Configure", tone: "neutral" },
  ];

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 252 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="jayra-sidebar relative z-[60] flex h-full shrink-0 flex-col border-r"
      data-collapsed={collapsed}
      aria-label="JAYRA navigation"
    >
      <div className={`flex h-[72px] shrink-0 items-center border-b ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <img className="jayra-brand-mark h-9 w-9 shrink-0 rounded-xl object-cover" src={brandIcon} alt="JAYRA" />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="font-display text-[13px] font-semibold tracking-[0.16em]">JAYRA</div>
              <div className="jayra-sidebar-muted mt-1 text-[9px] font-mono uppercase tracking-[0.15em]">Private companion</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <span className={`jayra-state-dot ${liveState === "disconnected" ? "is-idle" : "is-active"}`} title={`Voice ${liveState}`} />
        )}
      </div>

      <div className={`px-2 pt-3 ${collapsed ? "flex justify-center" : "flex justify-end"}`}>
        <button
          type="button"
          className="jayra-icon-button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {!collapsed && <div className="jayra-sidebar-label px-4 pb-2 pt-4">Workspace</div>}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3" aria-label="Core modules">
        {items.map(({ id, label, icon: Icon, badge, tone }) => {
          const active = activeDestination === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={collapsed ? `${label} · ${badge}` : undefined}
              className={`jayra-nav-item ${collapsed ? "is-collapsed" : ""} ${active ? "is-active" : ""}`}
            >
              <span className="jayra-nav-icon"><Icon size={17} strokeWidth={1.8} /></span>
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left text-[12px]">{label}</span>}
              {!collapsed && <span className={`jayra-nav-badge ${tone === "live" ? "is-live" : ""}`}>{badge}</span>}
              {collapsed && (tone === "live" || (id === "tasks" && hasActiveTask) || (id === "mobile" && networkEnabled)) && (
                <span className="jayra-nav-indicator" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="jayra-sidebar-footer border-t p-2">
        <button
          type="button"
          role="switch"
          aria-checked={theme === "light"}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className={`jayra-theme-switch ${collapsed ? "is-collapsed" : ""}`}
          onClick={toggleTheme}
        >
          <span className="jayra-theme-icon">{theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}</span>
          {!collapsed && <span className="flex-1 text-left text-[11px]">{theme === "dark" ? "Dark appearance" : "Light appearance"}</span>}
          {!collapsed && <span className={`jayra-switch-track ${theme === "light" ? "is-on" : ""}`}><span /></span>}
        </button>
        {!collapsed && (
          <div className="jayra-sidebar-footnote mt-3 flex items-center gap-2 px-2 pb-1 text-[9px] font-mono uppercase tracking-[0.13em]">
            <Circle size={7} fill="currentColor" /> Local-first · v{__APP_VERSION__}
          </div>
        )}
      </div>
    </motion.aside>
  );
}