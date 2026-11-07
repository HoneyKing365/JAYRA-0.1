import React, { useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, Network, X } from "lucide-react";
import type { SystemTelemetrySnapshot } from "../../services/systemMonitor";
import type { AppSettings } from "../lib/appApi";

interface SystemTelemetryWidgetProps {
  settings: AppSettings["systemMonitor"] | undefined;
  telemetry: SystemTelemetrySnapshot | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "N/A";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function tone(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value > 90) return "text-rose-400";
  if (value > 75) return "text-amber-300";
  return "text-emerald-300";
}

function MetricGauge({ label, value, icon }: { label: string; value: number | null; icon: React.ReactNode }) {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const color = value === null ? "#64748b" : value > 90 ? "#fb7185" : value > 75 ? "#fbbf24" : "#34d399";
  const circumference = 2 * Math.PI * 18;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
      <div className="relative grid h-11 w-11 shrink-0 place-items-center">
        <svg viewBox="0 0 44 44" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r="18" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span className="absolute text-cyan-200">{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-[.18em] text-slate-500">{label}</div>
        <div className={`font-mono text-sm font-semibold tabular-nums ${tone(value)}`}>
          {value === null ? "N/A" : `${Math.round(value)}%`}
        </div>
      </div>
    </div>
  );
}

function MiniHistory({ values, color }: { values: number[]; color: string }) {
  const points = values.length ? values : [0];
  return (
    <div aria-hidden="true" className="flex h-7 items-end gap-[2px] overflow-hidden">
      {points.slice(-24).map((value, index) => (
        <span
          key={`${index}-${value}`}
          className="min-w-[3px] flex-1 rounded-t-sm transition-[height] duration-500"
          style={{ height: `${Math.max(4, Math.min(100, value))}%`, backgroundColor: color, opacity: 0.35 + index / points.length * 0.55 }}
        />
      ))}
    </div>
  );
}

function positionStyle(corner: AppSettings["systemMonitor"]["corner"]): React.CSSProperties {
  const left = "calc(var(--sidebar-width) + 1rem)";
  switch (corner) {
    case "top-left": return { left, top: "1rem" };
    case "top-right": return { right: "1rem", top: "1rem" };
    case "bottom-right": return { right: "1rem", bottom: "1rem" };
    default: return { left, bottom: "1rem" };
  }
}

export const SystemTelemetryWidget: React.FC<SystemTelemetryWidgetProps> = ({ settings, telemetry, open, onOpenChange }) => {
  const [history, setHistory] = useState<{ cpu: number; memory: number; gpu: number }[]>([]);

  useEffect(() => {
    if (!telemetry) return;
    setHistory((previous) => [
      ...previous.slice(-23),
      {
        cpu: telemetry.cpu.usagePercent,
        memory: telemetry.memory.usagePercent,
        gpu: telemetry.gpu?.usagePercent ?? 0,
      },
    ]);
  }, [telemetry?.capturedAt]);

  if (!settings?.enabled) return null;
  const cpu = telemetry ? Math.round(telemetry.cpu.usagePercent) : null;
  const ram = telemetry?.memory.usagePercent ?? null;
  const gpu = telemetry?.gpu?.usagePercent ?? null;
  const dockSide = settings.corner.endsWith("left") ? "left" : "right";

  return (
    <div className="fixed z-40 font-sans" style={positionStyle(settings.corner)}>
      {open && (
        <aside
          aria-label="System telemetry"
            data-side={dockSide}
            className="jayra-telemetry-drawer fixed top-20 bottom-36 z-40 flex flex-col overflow-y-auto overscroll-contain rounded-2xl border border-cyan-300/15 bg-slate-950/95 text-slate-200 shadow-[0_16px_70px_rgba(0,0,0,.65)] backdrop-blur-2xl"
          >
          <header className="flex items-center justify-between border-b border-white/[0.08] bg-gradient-to-r from-cyan-500/[0.09] to-transparent px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
              </span>
              <div>
                <div className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-100">SYSTEM TELEMETRY</div>
                <div className="text-[9px] text-slate-500">LOCAL HARDWARE DIAGNOSTICS</div>
              </div>
            </div>
            <button type="button" aria-label="Collapse telemetry" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
              <X size={14} />
            </button>
          </header>

          <div className="space-y-3 p-3.5">
            <div className="grid grid-cols-2 gap-2">
              <MetricGauge label="CPU LOAD" value={cpu} icon={<Cpu size={15} />} />
              <MetricGauge label="MEMORY" value={ram} icon={<MemoryStick size={15} />} />
              <MetricGauge label="GPU LOAD" value={gpu} icon={<Activity size={15} />} />
              <MetricGauge label="STORAGE" value={telemetry?.disk?.usagePercent ?? null} icon={<HardDrive size={15} />} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "CPU", value: history.map((point) => point.cpu), color: "#22d3ee" },
                { label: "RAM", value: history.map((point) => point.memory), color: "#a78bfa" },
                { label: "GPU", value: history.map((point) => point.gpu), color: "#34d399" },
              ].map((series) => (
                <div key={series.label} className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5">
                  <div className="mb-1 text-[8px] font-mono tracking-widest text-slate-500">{series.label} / HISTORY</div>
                  <MiniHistory values={series.value} color={series.color} />
                </div>
              ))}
            </div>

            {telemetry?.cpu.cores.length ? (
              <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                <div className="mb-1.5 flex items-center justify-between text-[8px] font-mono tracking-widest text-slate-500">
                  <span>PER-CORE LOAD</span>
                  <span>{telemetry.cpu.cores.length} CORES</span>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {telemetry.cpu.cores.slice(0, 32).map((usage, index) => (
                    <div key={index} title={`Core ${index + 1}: ${Math.round(usage)}%`} className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className={`h-full rounded-full transition-[width] duration-700 ${usage > 90 ? "bg-rose-400" : usage > 75 ? "bg-amber-300" : "bg-cyan-400"}`}
                        style={{ width: `${Math.max(0, Math.min(100, usage))}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/[0.07] pt-3 text-[10px]">
              <div className="flex items-center gap-1.5 text-slate-400">
                <MemoryStick size={12} className="text-violet-300" />
                <span>RAM</span>
                <span className="ml-auto font-mono text-slate-200">
                  {telemetry ? `${formatBytes(telemetry.memory.usedBytes)} / ${formatBytes(telemetry.memory.totalBytes)}` : "Sampling..."}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <HardDrive size={12} className="text-cyan-300" />
                <span>FREE</span>
                <span className="ml-auto font-mono text-slate-200">
                  {telemetry?.disk ? `${formatBytes(telemetry.disk.freeBytes)} / ${formatBytes(telemetry.disk.totalBytes)}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Activity size={12} className="text-emerald-300" />
                <span>VRAM</span>
                <span className="ml-auto font-mono text-slate-200">
                  {telemetry?.gpu ? `${formatBytes(telemetry.gpu.vramUsedBytes)} / ${formatBytes(telemetry.gpu.vramTotalBytes)}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Network size={12} className="text-emerald-300" />
                <span>NETWORK</span>
                <span className="ml-auto font-mono text-slate-200">
                  {telemetry?.network.pingMs === null || !telemetry ? "N/A" : `${Math.round(telemetry.network.pingMs)} ms`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Activity size={12} className="text-sky-300" />
                <span>↓ / ↑</span>
                <span className="ml-auto font-mono text-slate-200">
                  {telemetry ? `${formatBytes(telemetry.network.receiveBytesPerSecond)}/s · ${formatBytes(telemetry.network.transmitBytesPerSecond)}/s` : "Sampling..."}
                </span>
              </div>
              <div className="col-span-2 text-right font-mono text-[8px] text-slate-600">
                {telemetry ? `UPDATED ${new Date(telemetry.capturedAt).toLocaleTimeString()}` : "WAITING FOR FIRST SAMPLE"}
              </div>
            </div>
          </div>
        </aside>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse system telemetry" : "Expand system telemetry"}
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-slate-950/85 px-3 py-2 font-mono text-[10px] text-cyan-100 shadow-lg backdrop-blur-xl transition-colors hover:border-cyan-200/50 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <Activity size={13} className="text-cyan-300" />
        <span className="tracking-wider">SYS</span>
        <span className={tone(cpu)}>{cpu === null ? "--" : `CPU ${cpu}%`}</span>
        <span className="text-white/20">/</span>
        <span className={tone(ram)}>{ram === null ? "RAM --" : `RAM ${ram}%`}</span>
      </button>
    </div>
  );
};
