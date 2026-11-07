/**
 * JAYRA HologramFace — Reactive Cybernetic 3D/Vector Holographic Face
 *
 * Visual Mode: 'hologram_face'
 *
 * Implements:
 *  - Reactive 3-state color transitions:
 *      * Cyan (#00f3ff): Passive Perception / Listening
 *      * Amber (#f59e0b): Thinking / Reasoning / Deep Processing
 *      * Emerald (#10b981): Speaking / Neural Voice Active
 *  - Cybernetic face contour wireframe (forehead nodes, jawline, nose bridge, brow ridge)
 *  - Animated ocular sensors (pupil tracking, blink cycles, focus aperture)
 *  - Reactive acoustic mouth waveform (spectrum equalizer mouth bar animation during speech)
 *  - Tactical holographic HUD reticles, coordinates, scanlines & glitch artifacts
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { AppSettings } from "../lib/appApi";

interface HologramFaceProps {
  appSettings?: AppSettings | null;
  state?: "idle" | "listening" | "thinking" | "speaking" | string;
  characterState?: string;
  audioSession?: any;
  themeColor?: string;
}

export function HologramFace({
  appSettings,
  state = "idle",
  characterState = "idle",
  audioSession,
  themeColor,
}: HologramFaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      const nextScale = Math.min(1, stage.clientWidth / 520, stage.clientHeight / 600);
      setStageScale((current) => Math.abs(current - nextScale) < 0.005 ? current : nextScale);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, []);

  // Normalize current operational state
  const effectiveState = useMemo(() => {
    const s = (characterState || state || "").toLowerCase();
    if (s.includes("speak") || s.includes("talk") || s.includes("answering")) return "speaking";
    if (s.includes("think") || s.includes("process") || s.includes("reason") || s.includes("search")) return "thinking";
    return "listening";
  }, [characterState, state]);

  // Color mapping based on unified requirements:
  // Cyan: listening/passive | Amber: thinking | Emerald: speaking
  const palette = useMemo(() => {
    switch (effectiveState) {
      case "speaking":
        return {
          primary: "#10b981", // Emerald
          glow: "rgba(16, 185, 129, 0.4)",
          bgGlow: "rgba(16, 185, 129, 0.08)",
          text: "text-emerald-400",
          border: "border-emerald-500/30",
          statusText: "SYNAPTIC AUDIO ACTIVE",
        };
      case "thinking":
        return {
          primary: "#f59e0b", // Amber
          glow: "rgba(245, 158, 11, 0.4)",
          bgGlow: "rgba(245, 158, 11, 0.08)",
          text: "text-amber-400",
          border: "border-amber-500/30",
          statusText: "COGNITIVE SYNAPSE ACTIVE",
        };
      case "listening":
      default:
        return {
          primary: "#00f3ff", // Cyan
          glow: "rgba(0, 243, 255, 0.35)",
          bgGlow: "rgba(0, 243, 255, 0.06)",
          text: "text-cyan-400",
          border: "border-cyan-500/30",
          statusText: "PASSIVE SENSORS ONLINE",
        };
    }
  }, [effectiveState]);

  // Mouse tracking for subtle ocular gaze direction
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      setMousePos({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Periodic cybernetic eye blink simulation
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 4200 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  // Audio waveform amplitude simulation / reaction for mouth & cheeks
  const [mouthWave, setMouthWave] = useState([0.3, 0.5, 0.8, 0.5, 0.3]);
  useEffect(() => {
    if (effectiveState !== "speaking") {
      setMouthWave([0.15, 0.2, 0.25, 0.2, 0.15]);
      return;
    }
    const timer = setInterval(() => {
      setMouthWave([
        0.2 + Math.random() * 0.7,
        0.3 + Math.random() * 0.8,
        0.5 + Math.random() * 0.9,
        0.3 + Math.random() * 0.8,
        0.2 + Math.random() * 0.7,
      ]);
    }, 90);
    return () => clearInterval(timer);
  }, [effectiveState]);

  const eyeOffsetX = mousePos.x * 12;
  const eyeOffsetY = mousePos.y * 8;

  const showScanlines = appSettings?.hud?.scanlines ?? true;

  return (
    <div ref={stageRef} className="relative h-full w-full flex items-center justify-center select-none overflow-hidden" style={{ transform: `scale(${stageScale})` }}>
      {/* Background radial holographic illumination */}
      <div
        className="absolute h-[600px] w-[600px] rounded-full blur-[140px] pointer-events-none transition-colors duration-700"
        style={{ backgroundColor: palette.bgGlow }}
      />

      {/* Futuristic Concentric Telemetry Target Rings */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          className="h-[520px] w-[520px] rounded-full border border-dashed opacity-25"
          style={{ borderColor: palette.primary }}
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          className="h-[440px] w-[440px] rounded-full border opacity-30"
          style={{
            borderColor: palette.primary,
            borderStyle: "double",
            borderWidth: "3px",
          }}
        />
        <motion.div
          animate={{ scale: effectiveState === "thinking" ? [1, 1.05, 1] : 1 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="h-[360px] w-[360px] rounded-full border border-dotted opacity-20"
          style={{ borderColor: palette.primary }}
        />
      </div>

      {/* Central Holographic Face SVG Rig */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.svg
          width="420"
          height="460"
          viewBox="0 0 420 460"
          className="filter drop-shadow-[0_0_24px_rgba(0,0,0,0.5)]"
          animate={{
            y: effectiveState === "speaking" ? [-2, 2, -2] : [0, -4, 0],
          }}
          transition={{
            duration: effectiveState === "speaking" ? 0.35 : 4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <defs>
            {/* Hologram gradient definition */}
            <linearGradient id="holoLineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.9" />
              <stop offset="50%" stopColor={palette.primary} stopOpacity="0.4" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.8" />
            </linearGradient>

            <filter id="holoGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* FOREHEAD & CRANIAL VECTORS */}
          <path
            d="M 120 70 L 210 40 L 300 70"
            fill="none"
            stroke="url(#holoLineGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            filter="url(#holoGlow)"
          />
          <path
            d="M 150 90 L 210 65 L 270 90"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.2"
            strokeDasharray="4 4"
            opacity="0.7"
          />
          {/* Central Cranial Core Diamond */}
          <polygon
            points="210,32 218,44 210,56 202,44"
            fill={palette.primary}
            fillOpacity={effectiveState === "thinking" ? 0.9 : 0.5}
            stroke={palette.primary}
            strokeWidth="1.5"
          />

          {/* FACIAL CONTOUR / JAWLINE */}
          <path
            d="M 100 130 L 85 220 L 110 320 L 170 385 L 210 400 L 250 385 L 310 320 L 335 220 L 320 130"
            fill="none"
            stroke="url(#holoLineGrad)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            filter="url(#holoGlow)"
          />
          {/* Secondary Chin Plate */}
          <path
            d="M 160 375 L 210 390 L 260 375"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.5"
            opacity="0.6"
          />

          {/* CHEEK / TEMPLE ACCENTS */}
          <path
            d="M 90 200 L 130 220 L 135 260 L 95 240 Z"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1"
            opacity="0.5"
          />
          <path
            d="M 330 200 L 290 220 L 285 260 L 325 240 Z"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1"
            opacity="0.5"
          />

          {/* EYEBROWS / OCULAR RIDGES */}
          <motion.path
            d={
              effectiveState === "thinking"
                ? "M 130 152 L 185 160"
                : effectiveState === "speaking"
                ? "M 130 148 L 185 144"
                : "M 130 150 L 185 148"
            }
            fill="none"
            stroke={palette.primary}
            strokeWidth="3"
            strokeLinecap="round"
            filter="url(#holoGlow)"
          />
          <motion.path
            d={
              effectiveState === "thinking"
                ? "M 235 160 L 290 152"
                : effectiveState === "speaking"
                ? "M 235 144 L 290 148"
                : "M 235 148 L 290 150"
            }
            fill="none"
            stroke={palette.primary}
            strokeWidth="3"
            strokeLinecap="round"
            filter="url(#holoGlow)"
          />

          {/* OCULAR SOCKET FRAMES */}
          {/* Left Eye Socket */}
          <polygon
            points="125,175 185,168 192,195 135,200"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.5"
            opacity="0.8"
          />
          {/* Right Eye Socket */}
          <polygon
            points="295,175 235,168 228,195 285,200"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.5"
            opacity="0.8"
          />

          {/* OCULAR PUPILS / RETICLES (Responsive gaze tracking & blink) */}
          <AnimatePresence>
            {!blink && (
              <g>
                {/* Left Pupil */}
                <circle
                  cx={160 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r={effectiveState === "thinking" ? 8 : 10}
                  fill={palette.primary}
                  fillOpacity="0.3"
                  stroke={palette.primary}
                  strokeWidth="2"
                  filter="url(#holoGlow)"
                />
                <circle
                  cx={160 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r="4"
                  fill="#ffffff"
                />
                <circle
                  cx={160 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r="14"
                  fill="none"
                  stroke={palette.primary}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />

                {/* Right Pupil */}
                <circle
                  cx={260 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r={effectiveState === "thinking" ? 8 : 10}
                  fill={palette.primary}
                  fillOpacity="0.3"
                  stroke={palette.primary}
                  strokeWidth="2"
                  filter="url(#holoGlow)"
                />
                <circle
                  cx={260 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r="4"
                  fill="#ffffff"
                />
                <circle
                  cx={260 + eyeOffsetX}
                  cy={183 + eyeOffsetY}
                  r="14"
                  fill="none"
                  stroke={palette.primary}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
              </g>
            )}
          </AnimatePresence>

          {/* NOSE BRIDGE & SENSORS */}
          <path
            d="M 210 180 L 206 245 L 214 245"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.5"
            opacity="0.6"
          />
          <circle cx="210" cy="254" r="2.5" fill={palette.primary} opacity="0.8" />

          {/* MOUTH & ACOUSTIC WAVEFORM EQUALIZER */}
          {/* Upper Lip Wire */}
          <path
            d="M 180 300 Q 210 295 240 300"
            fill="none"
            stroke={palette.primary}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Lower Lip Wire */}
          <path
            d="M 185 308 Q 210 318 235 308"
            fill="none"
            stroke={palette.primary}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />

          {/* Live Reactive Waveform Bars Inside Mouth Area */}
          <g transform="translate(180, 298)">
            {mouthWave.map((h, i) => (
              <motion.rect
                key={i}
                x={i * 12 + 6}
                y={-h * 12}
                width="4"
                height={h * 24}
                rx="2"
                fill={palette.primary}
                opacity={0.85}
                filter="url(#holoGlow)"
              />
            ))}
          </g>

          {/* Tactical Coordinate Telemetry Overlay */}
          <text x="75" y="80" fill={palette.primary} fontSize="9" fontFamily="monospace" opacity="0.6">
            LOC.SYS: [0x4F.9A]
          </text>
          <text x="75" y="94" fill={palette.primary} fontSize="9" fontFamily="monospace" opacity="0.6">
            RES.HZ: {effectiveState === "speaking" ? "44.1 kHz" : effectiveState === "thinking" ? "96.0 kHz" : "16.0 kHz"}
          </text>
          <text x="285" y="80" fill={palette.primary} fontSize="9" fontFamily="monospace" opacity="0.6">
            LATENCY: 12ms
          </text>
          <text x="285" y="94" fill={palette.primary} fontSize="9" fontFamily="monospace" opacity="0.6">
            PHASE: {effectiveState.toUpperCase()}
          </text>
        </motion.svg>

        {/* Real-time State Badge */}
        <div
          className={`mt-4 flex items-center gap-2 rounded-full border px-4 py-1 backdrop-blur-md transition-all duration-300 ${palette.border}`}
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <span
            className="h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: palette.primary }}
          />
          <span className={`font-mono text-[10px] tracking-widest ${palette.text}`}>
            {palette.statusText}
          </span>
        </div>
      </div>

      {/* Cyber Scanline and Chromatic Aberration Texture */}
      {showScanlines && (
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-40" />
      )}
    </div>
  );
}
