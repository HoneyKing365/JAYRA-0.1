/**
 * JAYRA Mark LV HUD — Cybernetic Arc Reactor Telemetry & HUD Overlay
 *
 * Implements:
 *  - Mark LV tactical HUD corner brackets
 *  - Real-time diagnostic telemetry (FPS, agent cognition state, system latency)
 *  - Animated rotating Arc Reactor telemetry rings
 *  - Holographic scanline and glitch overlay filter
 *  - Dynamic theme coloring (Mark LV Cyan, Stark Gold, Matrix Green, Cyberpunk)
 */

import React, { useEffect, useState } from "react";
import { Activity, Cpu, Shield, Wifi, Radio } from "lucide-react";
import type { AppSettings } from "../lib/appApi";
import type { MyraaAudioSession } from "../lib/audio";

interface MarkLvHudProps {
  appSettings: AppSettings | null;
  agentState?: string;
  fps?: number;
  audioSession?: MyraaAudioSession | null;
}

export function MarkLvHud({ appSettings, agentState = "IDLE", fps = 60, audioSession }: MarkLvHudProps) {
  const [timeStr, setTimeStr] = useState("");
  const [audioBars, setAudioBars] = useState<number[]>([0.1, 0.2, 0.15, 0.25, 0.1]);
  const hudConfig = appSettings?.hud;

  // Real-time audio reactivity sampling loop
  useEffect(() => {
    let active = true;
    let dataBuffer: Uint8Array | null = null;

    const tick = () => {
      if (!active) return;
      
      const isSpeaking = agentState === "TALKING" || agentState === "SPEAKING";
      const analyser = isSpeaking 
        ? (audioSession?.outputAnalyser || audioSession?.inputAnalyser)
        : (audioSession?.inputAnalyser || audioSession?.outputAnalyser);

      if (analyser) {
        if (!dataBuffer || dataBuffer.length !== analyser.frequencyBinCount) {
          dataBuffer = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(dataBuffer);
        const bars: number[] = [];
        const binCount = dataBuffer.length;
        const step = Math.max(1, Math.floor(binCount / 5));
        
        for (let i = 0; i < 5; i++) {
          let sum = 0;
          const start = i * step;
          const end = Math.min(binCount, start + step);
          for (let j = start; j < end; j++) {
            sum += dataBuffer[j] || 0;
          }
          const avg = sum / (end - start || 1);
          bars.push(Math.min(1, Math.max(0.08, avg / 255)));
        }
        
        setAudioBars((prev) =>
          prev.map((val, idx) => {
            const target = bars[idx] ?? 0.08;
            return val + (target - val) * 0.4;
          })
        );
      } else {
        const t = Date.now() / 400;
        setAudioBars([
          0.08 + Math.sin(t) * 0.04,
          0.12 + Math.cos(t * 1.2) * 0.06,
          0.16 + Math.sin(t * 0.8) * 0.08,
          0.12 + Math.cos(t * 1.1) * 0.05,
          0.08 + Math.sin(t * 1.3) * 0.04,
        ]);
      }
      requestAnimationFrame(tick);
    };

    const id = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(id);
    };
  }, [audioSession, agentState]);

  // Real-time clock update
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const theme = hudConfig?.theme ?? "mark_lv_neon";
  const showScanlines = hudConfig?.scanlines ?? true;
  const showGauges = hudConfig?.diagnosticGauges ?? true;
  const ringOpacity = hudConfig?.ringOpacity ?? 0.85;

  const themeColors = {
    mark_lv_neon: {
      primary: "text-cyan-400",
      border: "border-cyan-500/40",
      bg: "bg-cyan-950/20",
      glow: "shadow-[0_0_15px_rgba(0,212,255,0.25)]",
    },
    iron_man_gold: {
      primary: "text-amber-400",
      border: "border-amber-500/40",
      bg: "bg-amber-950/20",
      glow: "shadow-[0_0_15px_rgba(255,170,0,0.25)]",
    },
    cyber_cyan: {
      primary: "text-emerald-400",
      border: "border-emerald-500/40",
      bg: "bg-emerald-950/20",
      glow: "shadow-[0_0_15px_rgba(0,255,136,0.25)]",
    },
    stealth_dark: {
      primary: "text-purple-400",
      border: "border-purple-500/40",
      bg: "bg-purple-950/20",
      glow: "shadow-[0_0_15px_rgba(168,85,247,0.25)]",
    },
  }[theme] || {
    primary: "text-cyan-400",
    border: "border-cyan-500/40",
    bg: "bg-cyan-950/20",
    glow: "shadow-[0_0_15px_rgba(0,212,255,0.25)]",
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none overflow-hidden">
      {/* CRT Scanline Filter Overlay */}
      {showScanlines && (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.035] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px]"
        />
      )}

      {/* Sci-Fi Tactical Corner Brackets */}
      {/* Top Left — Positioned cleanly inside the main workspace */}
      <div className={`absolute top-4 left-4 sm:left-6 h-8 w-8 border-t-2 border-l-2 ${themeColors.border}`} />
      <div className="absolute top-5 left-14 sm:left-16 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-slate-400">
        <span className={themeColors.primary}>JAYRA // MARK LV</span>
        <span className="text-slate-600">|</span>
        <span>SYS.OK</span>
        <span className="text-slate-600">|</span>
        <span>{timeStr}</span>
      </div>

      {/* Top Right */}
      <div className={`absolute top-4 right-4 sm:right-6 h-8 w-8 border-t-2 border-r-2 ${themeColors.border}`} />

      {/* Bottom Left */}
      <div className={`absolute bottom-4 left-4 sm:left-6 h-8 w-8 border-b-2 border-l-2 ${themeColors.border}`} />

      {/* Bottom Right */}
      <div className={`absolute bottom-4 right-4 sm:right-6 h-8 w-8 border-b-2 border-r-2 ${themeColors.border}`} />

      {/* Diagnostic Gauges (Left Side) — Sits cleanly within main workspace without colliding with sidebar */}
      {showGauges && (
        <div className="absolute left-4 sm:left-6 top-16 sm:top-20 flex flex-col gap-2 font-mono text-[10px]">
          {/* Telemetry Card 1 */}
          <div className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3 py-1.5 backdrop-blur-md ${themeColors.border} ${themeColors.bg}`}>
            <Activity size={12} className={themeColors.primary} />
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider">Mind State</span>
              <span className={`font-semibold tracking-wider ${themeColors.primary}`}>{agentState}</span>
            </div>
          </div>

          {/* Telemetry Card 2 */}
          <div className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3 py-1.5 backdrop-blur-md ${themeColors.border} ${themeColors.bg}`}>
            <Cpu size={12} className={themeColors.primary} />
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider">Engine FPS</span>
              <span className="text-slate-200 font-semibold">{fps} FPS</span>
            </div>
          </div>

          {/* Telemetry Card 3: Live Audio Reactivity */}
          <div className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3 py-1.5 backdrop-blur-md ${themeColors.border} ${themeColors.bg}`}>
            <Radio size={12} className={themeColors.primary} />
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider">Audio Flux</span>
              <div className="flex items-center gap-0.5 h-3 mt-0.5">
                {audioBars.map((b, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-all duration-75 ${themeColors.primary.replace("text-", "bg-")}`}
                    style={{ height: `${Math.max(3, Math.round(b * 12))}px` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rotating Background Arc Reactor Rings (Center Screen) */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-300"
        style={{ opacity: ringOpacity * 0.4 }}
      >
        <div className="relative flex items-center justify-center">
          {/* Outer Segmented Ring */}
          <div
            className={`h-[480px] w-[480px] rounded-full border border-dashed ${themeColors.border} animate-spin`}
            style={{ animationDuration: "60s" }}
          />
          {/* Middle Counter-rotating Ring */}
          <div
            className={`absolute h-[380px] w-[380px] rounded-full border border-dotted ${themeColors.border} animate-spin`}
            style={{ animationDuration: "35s", animationDirection: "reverse" }}
          />
          {/* Inner Compass Ring */}
          <div
            className={`absolute h-[260px] w-[260px] rounded-full border border-double border-cyan-400/30 animate-spin`}
            style={{ animationDuration: "20s" }}
          />
        </div>
      </div>
    </div>
  );
}
