/**
 * Jarvis Advanced Holographic Core Orb
 *
 * Implements JAYRA's high-fidelity procedural 3D math and Canvas 2D engine:
 *  - Procedural 3D spherical Fibonacci particle cloud (1100+ points on concentric shells)
 *  - Dynamic flaring filaments with travelling dash offsets
 *  - Twisting surface shards and floating radial corona embers
 *  - Counter-rotating 3D hero gyro rings and polyhedral framing cages
 *  - Spherical meridian and parallel wireframe globe
 *  - Real-time audio-reactive multi-layer voice wave synthesis
 *  - Thinking-mode orbiting equatorial scanner arcs
 *  - Two-pass downsampled bloom glow & mirrored floor reflection
 *  - Inertial 3D pointer drag rotation, parallax tracking & click shockwaves
 *  - Fully automated state sync (Cyan Idle -> Emerald Listening -> Amber Thinking -> Radiant Speaking)
 *  - Performance quality scaling (High / Balanced / Low) with dynamic FPS throttling
 */

import React, { useEffect, useRef, useMemo, useCallback } from "react";
import type { MyraaAudioSession, LiveState } from "../lib/audio";
import type { AppSettings } from "../lib/appApi";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type OrbQuality = "high" | "balanced" | "low";

export type MyraaEmotion =
  | "idle"
  | "happy"
  | "excited"
  | "curious"
  | "thinking"
  | "proud"
  | "sad"
  | "confused"
  | "surprised"
  | "embarrassed"
  | "playful";

export interface JarvisOrbProps {
  state?: OrbState | LiveState | string;
  characterState?: string;
  audioSession?: MyraaAudioSession | null;
  audioLevel?: number; // Optional external 0..1 audio level
  quality?: OrbQuality;
  particleDensity?: "high" | "balanced" | "low";
  spinSpeed?: number;
  bloomEffect?: boolean;
  floorReflection?: boolean;
  visualStyle?: "jarvis_classic" | "reactive_pulse" | "quantum_matrix" | "minimal";
  themeColor?: string;
  appSettings?: AppSettings | null;
  interactive?: boolean;
  showTelemetry?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  shell: number;
  size: number;
  phase: number;
  rank: number;
  hot: boolean;
}

interface Filament {
  th: number;
  ph: number;
  dth: number;
  dph: number;
  flare: boolean;
  inner: boolean;
  phase: number;
  width: number;
}

interface Shard {
  th: number;
  ph: number;
  len: number;
  twist: number;
  rad: number;
  phase: number;
}

interface Ember {
  th: number;
  ph: number;
  u: number;
  sp: number;
  size: number;
}

interface Ring {
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  scale: number;
  width: number;
  gaps: number;
  dash: number;
  phase: number;
  hero: boolean;
}

interface FrameMesh {
  n: number;
  verts: [number, number, number][];
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  rank: number;
}

// State color & physics definitions according to Jarvis specs:
// Idle = Cyan/Neutral
// Listening = Emerald/Green pulse
// Thinking = Amber/Yellow rotation/orbit
// Speaking = Dynamic energetic wave/glow
const DEFAULT_STATE_PROFILES: Record<
  OrbState,
  {
    speed: number;
    energy: number;
    wave: number;
    particles: number;
    pulse: number;
    corona: number;
    scan: number;
    core: [number, number, number];
    mid: [number, number, number];
    edge: [number, number, number];
    statusLabel: string;
    subLabel: string;
  }
> = {
  idle: {
    speed: 0.28,
    energy: 0.32,
    wave: 0.0,
    particles: 0.82,
    pulse: 0.02,
    corona: 0.22,
    scan: 0,
    core: [225, 250, 255],
    mid: [0, 210, 255],     // Cyan neutral
    edge: [0, 130, 220],
    statusLabel: "CORE STANDBY",
    subLabel: "PERCEPTION READY",
  },
  listening: {
    speed: 0.52,
    energy: 0.55,
    wave: 0.85,
    particles: 0.85,
    pulse: 0.035,
    corona: 0.38,
    scan: 0,
    core: [230, 255, 240],
    mid: [16, 215, 140],    // Emerald pulse
    edge: [5, 150, 95],
    statusLabel: "NEURAL INPUT",
    subLabel: "MIC HOT // STREAMING",
  },
  thinking: {
    speed: 1.35,
    energy: 0.85,
    wave: 0.06,
    particles: 0.92,
    pulse: 0.015,
    corona: 0.45,
    scan: 1,                // Active orbiting scanner arcs
    core: [255, 255, 255],
    mid: [245, 158, 11],    // Amber/Yellow
    edge: [217, 119, 6],
    statusLabel: "COGNITIVE SYNTHESIS",
    subLabel: "RESOLVING CONTEXT",
  },
  speaking: {
    speed: 1.05,
    energy: 1.15,
    wave: 1.0,
    particles: 1.0,
    pulse: 0.055,
    corona: 0.92,
    scan: 0,
    core: [255, 250, 235],
    mid: [255, 140, 0],     // Vibrant dynamic wave glow
    edge: [255, 72, 0],
    statusLabel: "AUDIO STREAMING",
    subLabel: "24kHz PCM LIVE",
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerpRGB = (
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c: [number, number, number], a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1)})`;

function project(
  x: number,
  y: number,
  z: number,
  cyaw: number,
  syaw: number,
  cp: number,
  sp: number,
  cr: number,
  sr: number
): [number, number, number] {
  const x1 = x * cyaw + z * syaw;
  const z1 = -x * syaw + z * cyaw;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const x3 = x1 * cr - y2 * sr;
  const y3 = x1 * sr + y2 * cr;
  return [x3, y3, z2];
}

function poly(n: number, radius: number): [number, number, number][] {
  const v: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 - Math.PI / 2;
    v.push([Math.cos(th) * radius, Math.sin(th) * radius, 0]);
  }
  return v;
}

export const JarvisOrb: React.FC<JarvisOrbProps> = ({
  state = "idle",
  characterState = "idle",
  audioSession = null,
  audioLevel,
  quality = "high",
  particleDensity = "balanced",
  spinSpeed = 1.0,
  bloomEffect = true,
  floorReflection = true,
  visualStyle = "jarvis_classic",
  themeColor,
  appSettings,
  interactive = true,
  showTelemetry = true,
  className = "",
  style,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bloomCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Map incoming props into canonical OrbState
  const effectiveState: OrbState = useMemo(() => {
    const s = String(characterState || state || "").toLowerCase();
    if (s === "speaking" || s === "talking" || s.includes("speak") || s.includes("answering")) {
      return "speaking";
    }
    if (s === "thinking" || s.includes("think") || s.includes("process") || s.includes("search")) {
      return "thinking";
    }
    if (s === "listening" || (audioSession && !audioSession.isMicMuted && state !== "disconnected")) {
      return "listening";
    }
    return "idle";
  }, [state, characterState, audioSession]);

  // Read settings overrides if provided
  const effectiveQuality: OrbQuality = useMemo(() => {
    return (appSettings?.orbVisualizer?.quality as OrbQuality) || quality;
  }, [appSettings?.orbVisualizer?.quality, quality]);

  const effectiveBloom: boolean = useMemo(() => {
    if (effectiveQuality === "low") return false;
    if (appSettings?.orbVisualizer?.bloomEffect !== undefined) {
      return appSettings.orbVisualizer.bloomEffect;
    }
    return bloomEffect;
  }, [appSettings?.orbVisualizer?.bloomEffect, effectiveQuality, bloomEffect]);

  const effectiveFloorReflection: boolean = useMemo(() => {
    if (effectiveQuality === "low") return false;
    if (appSettings?.orbVisualizer?.floorReflection !== undefined) {
      return appSettings.orbVisualizer.floorReflection;
    }
    return floorReflection;
  }, [appSettings?.orbVisualizer?.floorReflection, effectiveQuality, floorReflection]);

  const effectiveSpinMultiplier: number = useMemo(() => {
    return (appSettings?.orbVisualizer?.spinSpeed ?? spinSpeed);
  }, [appSettings?.orbVisualizer?.spinSpeed, spinSpeed]);

  // Audio spectrum analysis buffer
  const analyserBufRef = useRef<Uint8Array | null>(null);

  // Interaction & animation refs
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  const yawRef = useRef(0);
  const pitchRef = useRef(0.18);
  const velYawRef = useRef(0);
  const velPitchRef = useRef(0);
  const parallaxXRef = useRef(0);
  const parallaxYRef = useRef(0);
  const impulseRef = useRef(0);
  const shockRef = useRef(0);
  const previousStateRef = useRef<OrbState>(effectiveState);

  // Current interpolated physical values
  const currentValuesRef = useRef({
    ...DEFAULT_STATE_PROFILES[effectiveState],
  });

  const levelSmoothRef = useRef(0);

  // Geometry pools
  const partsRef = useRef<Particle[]>([]);
  const filamentsRef = useRef<Filament[]>([]);
  const shardsRef = useRef<Shard[]>([]);
  const embersRef = useRef<Ember[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const framesRef = useRef<FrameMesh[]>([]);
  const ringPoolRef = useRef(
    Array.from({ length: 80 }, () => ({ x: 0, y: 0, dash: false, band: 0 }))
  );

  // Track shockwave on state change
  useEffect(() => {
    if (previousStateRef.current !== effectiveState) {
      previousStateRef.current = effectiveState;
      shockRef.current = 0.001;
    }
  }, [effectiveState]);

  // Geometry generation based on quality scale
  const buildGeometry = useCallback(() => {
    const scaleFactor =
      effectiveQuality === "high"
        ? particleDensity === "high"
          ? 1.15
          : 1.0
        : effectiveQuality === "balanced"
        ? 0.7
        : 0.4;

    // 1. Fibonacci Sphere Particles
    const nParts = Math.max(200, (1100 * scaleFactor) | 0);
    const parts: Particle[] = [];
    const g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nParts; i++) {
      const y = 1 - (i / Math.max(1, nParts - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = g * i;
      const band = i % 5;
      const shell =
        band === 0 ? 0.98 : band === 1 ? 0.9 : band === 2 ? 0.72 : band === 3 ? 0.55 : 0.38;
      parts.push({
        x: Math.cos(th) * rad,
        y,
        z: Math.sin(th) * rad,
        shell,
        size: 0.7 + (i % 4) * 0.18 + (i % 23 === 0 ? 1.1 : 0),
        phase: i * 0.37,
        rank: ((i * 47) % Math.max(1, nParts)) / Math.max(1, nParts),
        hot: i % 19 === 0,
      });
    }
    partsRef.current = parts;

    // 2. Filaments
    const nFilaments = Math.max(8, (34 * scaleFactor) | 0);
    const filaments: Filament[] = [];
    for (let i = 0; i < nFilaments; i++) {
      filaments.push({
        th: Math.random() * Math.PI * 2,
        ph: Math.acos(2 * Math.random() - 1),
        dth: (Math.random() - 0.5) * 1.5,
        dph: (Math.random() - 0.5) * 0.9,
        flare: Math.random() < 0.34,
        inner: Math.random() < 0.28,
        phase: Math.random() * 6.28,
        width: 0.7 + Math.random() * 1.3,
      });
    }
    filamentsRef.current = filaments;

    // 3. Shards
    const nShards = Math.max(14, (64 * scaleFactor) | 0);
    const shards: Shard[] = [];
    for (let i = 0; i < nShards; i++) {
      shards.push({
        th: Math.random() * Math.PI * 2,
        ph: Math.acos(2 * Math.random() - 1),
        len: 0.12 + Math.random() * 0.32,
        twist: Math.random() * Math.PI,
        rad: 0.9 + Math.random() * 0.14,
        phase: Math.random() * 6.28,
      });
    }
    shardsRef.current = shards;

    // 4. Embers
    const nEmbers = Math.max(10, (42 * scaleFactor) | 0);
    const embers: Ember[] = [];
    for (let i = 0; i < nEmbers; i++) {
      embers.push({
        th: Math.random() * Math.PI * 2,
        ph: Math.acos(2 * Math.random() - 1),
        u: Math.random(),
        sp: 0.15 + Math.random() * 0.45,
        size: 1 + Math.random() * 1.6,
      });
    }
    embersRef.current = embers;

    // 5. Gyro Rings
    const rings: Ring[] = [];
    const heroes = [
      { rx: 1.15, ry: 0.15, rz: 0.2, scale: 1.02, width: 2.1, gaps: 3, dash: 0.62, hero: true },
      { rx: 0.35, ry: 1.2, rz: 0.4, scale: 0.96, width: 1.6, gaps: 5, dash: 0.45, hero: true },
      { rx: 1.7, ry: 0.4, rz: 1.1, scale: 0.84, width: 1.3, gaps: 4, dash: 0.4, hero: false },
    ];
    for (const h of heroes) {
      rings.push({
        ...h,
        sx: 0.35,
        sy: 0.22,
        sz: 0.1,
        phase: Math.random() * 6,
      });
    }
    const secondaryRingCount = effectiveQuality === "low" ? 5 : 12;
    for (let i = 0; i < secondaryRingCount; i++) {
      rings.push({
        rx: Math.random() * 6.28,
        ry: Math.random() * 6.28,
        rz: Math.random() * 6.28,
        sx: (Math.random() - 0.5) * 0.9,
        sy: (Math.random() - 0.5) * 0.9,
        sz: (Math.random() - 0.5) * 0.45,
        scale: 0.48 + Math.random() * 0.5,
        width: 0.6 + Math.random() * 1.5,
        gaps: 2 + ((Math.random() * 5) | 0),
        dash: 0.28 + Math.random() * 0.42,
        phase: Math.random() * 6.28,
        hero: false,
      });
    }
    ringsRef.current = rings;

    // 6. Framing Polyhedral Cages
    const kinds = [6, 8, 6, 4];
    framesRef.current = kinds.map((n, i) => ({
      n,
      verts: poly(n, 1.05 + i * 0.045),
      rx: Math.random() * 6.28,
      ry: Math.random() * 6.28,
      rz: Math.random() * 6.28,
      sx: (Math.random() - 0.5) * 0.45,
      sy: (Math.random() - 0.5) * 0.45,
      sz: (Math.random() - 0.5) * 0.2,
      rank: i / kinds.length,
    }));
  }, [effectiveQuality, particleDensity]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!bloomCanvasRef.current) {
      bloomCanvasRef.current = document.createElement("canvas");
    }
    const bloomCanvas = bloomCanvasRef.current;
    const bctx = bloomCanvas.getContext("2d", { alpha: true });

    buildGeometry();

    let animId: number | null = null;
    let t0 = performance.now();
    let time = 0;
    let lastRenderTime = 0;
    const targetFps = effectiveQuality === "low" ? 30 : 60;
    const frameInterval = 1000 / targetFps;

    const handleResize = () => {
      const container = containerRef.current || canvas.parentElement;
      const width = container ? container.clientWidth : window.innerWidth;
      const height = container ? container.clientHeight : window.innerHeight;
      if (width <= 0 || height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, effectiveQuality === "low" ? 1.0 : 1.5);

      canvas.width = Math.max(1, (width * dpr) | 0);
      canvas.height = Math.max(1, (height * dpr) | 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const bw = Math.max(64, (width / 6) | 0);
      const bh = Math.max(48, (height / 6) | 0);
      if (bloomCanvas.width !== bw || bloomCanvas.height !== bh) {
        bloomCanvas.width = bw;
        bloomCanvas.height = bh;
      }
    };

    handleResize();
    const resizeTarget = containerRef.current || canvas.parentElement;
    const resizeObserver = resizeTarget ? new ResizeObserver(handleResize) : null;
    if (resizeTarget) resizeObserver?.observe(resizeTarget);
    window.addEventListener("resize", handleResize);

    const render = (now: number) => {
      if (effectiveQuality === "low") {
        const elapsed = now - lastRenderTime;
        if (elapsed < frameInterval) {
          animId = requestAnimationFrame(render);
          return;
        }
        lastRenderTime = now - (elapsed % frameInterval);
      }

      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;
      time += dt * effectiveSpinMultiplier;

      // 1. Audio Level Detection & RMS
      let currentLevel = 0;
      if (typeof audioLevel === "number") {
        currentLevel = clamp(audioLevel, 0, 1);
      } else {
        const activeAnalyser =
          effectiveState === "speaking"
            ? audioSession?.outputAnalyser ?? null
            : effectiveState === "listening"
            ? audioSession?.inputAnalyser ?? null
            : null;

        if (activeAnalyser) {
          if (!analyserBufRef.current || analyserBufRef.current.length !== activeAnalyser.fftSize) {
            analyserBufRef.current = new Uint8Array(activeAnalyser.fftSize || 512);
          }
          const buf = analyserBufRef.current;
          try {
            activeAnalyser.getByteTimeDomainData(buf);
            let sum = 0;
            const step = 4;
            let count = 0;
            for (let i = 0; i < buf.length; i += step) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
              count++;
            }
            const rms = Math.sqrt(sum / Math.max(1, count));
            currentLevel = clamp(rms * 3.4, 0, 1);
          } catch {
            /* analyser disconnected */
          }
        } else {
          // Synthetic subtle organic pulse when no audio analyser connected
          if (effectiveState === "speaking") {
            const wob = Math.sin(time * 2.1) * 2.4;
            const burst = Math.pow(Math.max(0, Math.sin(time * 8.2 + wob)), 1.55);
            currentLevel = 0.34 + burst * 0.62;
          } else if (effectiveState === "listening") {
            currentLevel = 0.08 + Math.pow(Math.max(0, Math.sin(time * 1.55)), 2) * 0.28;
          }
        }
      }

      levelSmoothRef.current = lerp(levelSmoothRef.current, currentLevel, 1 - Math.pow(0.08, dt));

      // 2. Smooth Physical Transition towards Target State
      const target = DEFAULT_STATE_PROFILES[effectiveState];
      const cur = currentValuesRef.current;
      const k = 1 - Math.pow(0.0015, dt);

      cur.speed = lerp(cur.speed, target.speed, k);
      cur.energy = lerp(cur.energy, target.energy, k);
      cur.wave = lerp(cur.wave, target.wave, k);
      cur.particles = lerp(cur.particles, target.particles, k);
      cur.pulse = lerp(cur.pulse, target.pulse, k);
      cur.corona = lerp(cur.corona, target.corona, k);
      cur.scan = lerp(cur.scan, target.scan, k);
      cur.core = lerpRGB(cur.core, target.core, k);
      cur.mid = lerpRGB(cur.mid, target.mid, k);
      cur.edge = lerpRGB(cur.edge, target.edge, k);

      // Inertial damping & drag rotation
      yawRef.current += velYawRef.current * dt;
      pitchRef.current += velPitchRef.current * dt;
      velYawRef.current *= Math.pow(0.04, dt);
      velPitchRef.current *= Math.pow(0.04, dt);
      pitchRef.current = clamp(pitchRef.current, -0.8, 0.8);
      impulseRef.current = Math.max(0, impulseRef.current - dt * 1.4);

      if (shockRef.current > 0) {
        shockRef.current += dt * 1.7;
        if (shockRef.current > 1) shockRef.current = 0;
      }

      const container = containerRef.current || canvas.parentElement;
      const W = container ? container.clientWidth : window.innerWidth;
      const H = container ? container.clientHeight : window.innerHeight;
      const cx = W / 2;
      const cy = H / 2;
      const sizeFrac = 0.78;
      const R = Math.min(W * 0.92, H * 0.88) * sizeFrac * 0.5;

      const voice = cur.wave * (0.2 + levelSmoothRef.current * 0.8);
      const breathe = 1 + Math.sin(time * 1.5) * cur.pulse + voice * 0.07 + impulseRef.current * 0.12;
      const r = R * breathe;

      const yaw = time * 0.22 * cur.speed + yawRef.current + parallaxYRef.current;
      const pitch = pitchRef.current + parallaxXRef.current + Math.sin(time * 0.3) * 0.04;
      const roll = time * 0.05 * cur.speed;

      const cyaw = Math.cos(yaw),
        syaw = Math.sin(yaw);
      const cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      const cr = Math.cos(roll),
        sr = Math.sin(roll);
      const iy = time * 0.55 * cur.speed;
      const ciy = Math.cos(iy),
        siy = Math.sin(iy);

      const dpr = Math.min(window.devicePixelRatio || 1, effectiveQuality === "low" ? 1.0 : 1.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, W, H);

      // Radial ambient backdrop halo
      let g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * (2.15 + voice * 0.35));
      g.addColorStop(0, rgba(cur.mid, 0.2 + cur.energy * 0.08));
      g.addColorStop(0.45, rgba(cur.edge, 0.06));
      g.addColorStop(1, rgba(cur.edge, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Floor Reflection
      const floorY = cy + r * 0.88;
      if (effectiveFloorReflection) {
        ctx.save();
        ctx.translate(cx, floorY);
        ctx.scale(1.55, 0.32);
        g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
        g.addColorStop(0, rgba(cur.mid, 0.28));
        g.addColorStop(0.6, rgba(cur.edge, 0.05));
        g.addColorStop(1, rgba(cur.edge, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }

      // Outer Glow Corona
      g = ctx.createRadialGradient(cx - r * 0.08, cy - r * 0.1, r * 0.05, cx, cy, r);
      g.addColorStop(0, rgba(cur.core, 0.14));
      g.addColorStop(0.45, rgba(cur.mid, 0.07));
      g.addColorStop(0.82, rgba(cur.edge, 0.05));
      g.addColorStop(1, rgba(cur.edge, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";

      // 3. Polyhedral Framing Cages
      const frames = framesRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.rank > 0.2 + cur.energy * 0.85) continue;
        const ax = f.rx + time * f.sx * cur.speed;
        const ay = f.ry + time * f.sy * cur.speed;
        const az = f.rz + time * f.sz * cur.speed;
        const c1 = Math.cos(ax),
          s1 = Math.sin(ax);
        const c2 = Math.cos(ay),
          s2 = Math.sin(ay);
        const c3 = Math.cos(az),
          s3 = Math.sin(az);
        ctx.beginPath();
        for (let v = 0; v < f.verts.length; v++) {
          const vert = f.verts[v];
          let x = vert[0],
            y = vert[1],
            z = vert[2];
          const y1 = y * c1 - z * s1;
          let z1 = y * s1 + z * c1;
          const x1 = x * c2 + z1 * s2;
          z1 = -x * s2 + z1 * c2;
          const x2 = x1 * c3 - y1 * s3;
          const y2 = x1 * s3 + y1 * c3;
          const p = project(x2, y2, z1, cyaw, syaw, cp, sp, cr, sr);
          const px = cx + p[0] * r;
          const py = cy + p[1] * r;
          if (v) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = rgba(i % 2 ? cur.mid : cur.core, 0.16 + cur.energy * 0.14);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // 4. Inner Meridians & Parallels Globe
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(cur.mid, 0.18 + cur.energy * 0.14);
      const meridians = effectiveQuality === "low" ? 4 : 8;
      const parallels = effectiveQuality === "low" ? 3 : 5;
      const innerR = r * 0.58;
      for (let m = 0; m < meridians; m++) {
        ctx.beginPath();
        const ph = (m / meridians) * Math.PI;
        for (let s = 0; s <= 32; s++) {
          const th = (s / 32) * Math.PI * 2;
          const x = Math.sin(th) * Math.cos(ph);
          const y = Math.cos(th);
          const z = Math.sin(th) * Math.sin(ph);
          const x1 = x * ciy + z * siy;
          const z1 = -x * siy + z * ciy;
          const p = project(x1, y, z1, cyaw, syaw, cp, sp, cr, sr);
          const px = cx + p[0] * innerR,
            py = cy + p[1] * innerR;
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      for (let p = 1; p < parallels; p++) {
        const y = 1 - (p / parallels) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        ctx.beginPath();
        for (let s = 0; s <= 28; s++) {
          const th = (s / 28) * Math.PI * 2;
          const pt = project(Math.cos(th) * rad, y, Math.sin(th) * rad, cyaw, syaw, cp, sp, cr, sr);
          const px = cx + pt[0] * innerR,
            py = cy + pt[1] * innerR;
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }

      // 5. Filaments
      const filaments = filamentsRef.current;
      const fSeg = effectiveQuality === "low" ? 8 : 14;
      for (let i = 0; i < filaments.length; i++) {
        const f = filaments[i];
        ctx.beginPath();
        ctx.lineWidth = f.width * (0.8 + cur.energy * 0.45);
        const travel = f.flare ? 1 : -0.6;
        ctx.setLineDash(f.flare ? [10, 16] : []);
        ctx.lineDashOffset = -time * (26 + cur.speed * 30) * travel;
        for (let s = 0; s <= fSeg; s++) {
          const u = s / fSeg;
          const th = f.th + f.dth * u + time * 0.15 * cur.speed;
          const ph =
            f.ph + f.dph * u + Math.sin(time * 1.5 + f.phase + u * 5) * 0.06 * cur.energy;
          let rad = f.inner
            ? 0.46 + 0.08 * Math.sin(u * 6.2832)
            : 0.9 + 0.07 * Math.sin(u * 6.2832 + f.phase);
          if (f.flare) rad += u * u * 0.42 * cur.corona;
          rad *= 1 + voice * 0.05 * Math.sin(u * 9 + time * 6);
          const x = Math.sin(ph) * Math.cos(th) * rad;
          const y = Math.cos(ph) * rad;
          const z = Math.sin(ph) * Math.sin(th) * rad;
          const p = project(x, y, z, cyaw, syaw, cp, sp, cr, sr);
          const px = cx + p[0] * r,
            py = cy + p[1] * r;
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        const alpha = (f.flare ? 0.28 : 0.4) * (0.45 + cur.energy * 0.55);
        ctx.strokeStyle = rgba(f.flare ? cur.edge : i % 3 === 0 ? cur.core : cur.mid, alpha);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 6. Surface Shards
      const shards = shardsRef.current;
      for (let i = 0; i < shards.length; i++) {
        const sh = shards[i];
        ctx.beginPath();
        ctx.lineWidth = 1.15;
        for (let s = 0; s <= 6; s++) {
          const u = s / 6 - 0.5;
          const th = sh.th + Math.cos(sh.twist) * sh.len * u + time * 0.05;
          const ph = sh.ph + Math.sin(sh.twist) * sh.len * u;
          const rad = sh.rad * (1 + Math.sin(time * 2 + sh.phase) * 0.012 * cur.energy);
          const x = Math.sin(ph) * Math.cos(th) * rad;
          const y = Math.cos(ph) * rad;
          const z = Math.sin(ph) * Math.sin(th) * rad;
          const p = project(x, y, z, cyaw, syaw, cp, sp, cr, sr);
          if (p[2] < -0.15 && s === 0) break;
          const px = cx + p[0] * r,
            py = cy + p[1] * r;
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.strokeStyle = rgba(i % 4 === 0 ? cur.core : cur.mid, 0.22 + cur.energy * 0.25);
        ctx.stroke();
      }

      // 7. Counter-rotating Gyro Rings
      const rings = ringsRef.current;
      const segs = effectiveQuality === "low" ? 36 : 56;
      const ringPool = ringPoolRef.current;
      for (let i = 0; i < rings.length; i++) {
        const rg = rings[i];
        const ax = rg.rx + time * rg.sx * cur.speed;
        const ay = rg.ry + time * rg.sy * cur.speed;
        const az = rg.rz + time * rg.sz * cur.speed;
        const c1 = Math.cos(ax),
          s1 = Math.sin(ax);
        const c2 = Math.cos(ay),
          s2 = Math.sin(ay);
        const c3 = Math.cos(az),
          s3 = Math.sin(az);
        const rr =
          r *
          rg.scale *
          (1 + Math.sin(time * 2.1 + rg.phase) * 0.018 * cur.energy + voice * 0.055);
        const segLen = 1 / rg.gaps;
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const th = u * 6.283185;
          const inDash =
            ((u + time * 0.04 * cur.speed * (i % 2 ? 1 : -1) + rg.phase) % segLen) / segLen <
            rg.dash;
          const wob = 1 + Math.sin(th * 5 + time * (6 + (i % 3)) + rg.phase) * voice * 0.07;
          let x = Math.cos(th) * wob,
            y = Math.sin(th) * wob,
            z = 0;
          let y1 = y * c1 - z * s1,
            z1 = y * s1 + z * c1;
          y = y1;
          z = z1;
          let x1 = x * c2 + z1 * s2;
          z1 = -x * s2 + z1 * c2;
          x = x1;
          z = z1;
          x1 = x * c3 - y * s3;
          y1 = x * s3 + y * c3;
          x = x1;
          y = y1;
          const p = project(x, y, z, cyaw, syaw, cp, sp, cr, sr);
          const depth = (p[2] + 1) / 2;
          const slot = ringPool[s];
          if (slot) {
            slot.x = cx + p[0] * rr;
            slot.y = cy + p[1] * rr;
            slot.dash = inDash;
            slot.band = depth < 0.5 ? 0 : 1;
          }
        }
        for (let band = 0; band < 2; band++) {
          ctx.beginPath();
          let open = false;
          for (let s = 0; s <= segs; s++) {
            const pt = ringPool[s];
            if (!pt || !pt.dash || pt.band !== band) {
              open = false;
              continue;
            }
            if (!open) {
              ctx.moveTo(pt.x, pt.y);
              open = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          const alpha =
            (0.16 + band * 0.34) * (rg.hero ? 1.2 : 0.75) * (0.5 + cur.energy * 0.5);
          const col = rg.hero && band === 1 ? cur.core : band === 0 ? cur.edge : cur.mid;
          ctx.strokeStyle = rgba(col, Math.min(0.95, alpha));
          ctx.lineWidth = rg.width * (0.75 + band * 0.35) * (rg.hero ? 1.1 : 1);
          ctx.stroke();
        }
      }

      // 8. Fibonacci Particle Cloud
      const parts = partsRef.current;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.rank > cur.particles) continue;
        const swirl = p.phase + time * (0.25 + cur.speed * 0.35);
        const cs = Math.cos(swirl),
          sn = Math.sin(swirl);
        const x0 = p.x * cs - p.z * sn;
        const z0 = p.x * sn + p.z * cs;
        const j =
          1 +
          Math.sin(time * (10 + cur.energy * 6) + p.phase) *
            0.035 *
            cur.energy *
            (0.4 + levelSmoothRef.current * 1.6);
        const q = project(x0 * j, p.y * j, z0 * j, cyaw, syaw, cp, sp, cr, sr);
        const depth = (q[2] + 1) * 0.5;
        const light = clamp(depth * 0.85 + -q[0] * 0.18 + -q[1] * 0.12, 0, 1.2);
        const alpha =
          clamp(0.04 + light * (p.hot ? 0.95 : 0.72), 0, 1) * (0.55 + cur.energy * 0.45);
        const sz = p.size * (0.55 + depth * 0.7);
        const px = cx + q[0] * r * p.shell;
        const py = cy + q[1] * r * p.shell;
        ctx.fillStyle = rgba(
          light > 0.75 ? cur.core : light > 0.38 ? cur.mid : cur.edge,
          alpha
        );
        if (p.hot) {
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, 6.2832);
          ctx.fill();
        } else {
          ctx.fillRect(px, py, sz, sz);
        }
      }

      // 9. Floating Corona Embers
      const embers = embersRef.current;
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.u += dt * e.sp * (0.35 + cur.corona);
        if (e.u > 1) {
          e.u = 0;
          e.th = Math.random() * 6.28;
          e.ph = Math.acos(2 * Math.random() - 1);
        }
        const rad = 0.98 + e.u * 0.72 * (0.35 + cur.corona);
        const x = Math.sin(e.ph) * Math.cos(e.th + time * 0.2) * rad;
        const y = Math.cos(e.ph) * rad;
        const z = Math.sin(e.ph) * Math.sin(e.th + time * 0.2) * rad;
        const q = project(x, y, z, cyaw, syaw, cp, sp, cr, sr);
        const fade = 1 - e.u;
        ctx.fillStyle = rgba(cur.mid, 0.15 + fade * 0.55 * cur.corona);
        ctx.beginPath();
        ctx.arc(cx + q[0] * r, cy + q[1] * r, e.size * (1.1 - e.u * 0.5), 0, 6.2832);
        ctx.fill();
      }

      // 10. Real-time Multi-layer Audio Voice Waveform
      if (cur.wave > 0.03) {
        const bars = effectiveQuality === "low" ? 36 : 64;
        for (let layer = 0; layer < 4; layer++) {
          ctx.beginPath();
          const base = r * (0.98 + layer * 0.07);
          for (let b = 0; b <= bars; b++) {
            const th = (b / bars) * 6.283185;
            const n =
              Math.sin(th * (5 + layer * 2) + time * (4.2 + layer)) *
              Math.sin(th * 3 - time * 2.6 + layer);
            const amp = r * 0.065 * cur.wave * (0.18 + levelSmoothRef.current * 1.15) * n;
            const x = cx + Math.cos(th) * (base + amp);
            const y = cy + Math.sin(th) * (base + amp);
            if (b) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = rgba(
            layer % 2 ? cur.mid : cur.core,
            (0.42 - layer * 0.07) * (0.35 + levelSmoothRef.current * 0.65)
          );
          ctx.lineWidth = 1.7 - layer * 0.25;
          ctx.stroke();
        }
      }

      // 11. Central Pulsing Quantum Plasma Core
      const coreR =
        r * (0.11 + voice * 0.07 + impulseRef.current * 0.06 + Math.sin(time * 3) * 0.01);
      g = ctx.createRadialGradient(
        cx - r * 0.03,
        cy - r * 0.04,
        0,
        cx,
        cy,
        coreR * 1.8
      );
      g.addColorStop(0, "rgba(255,255,255,0.96)");
      g.addColorStop(0.22, rgba(cur.core, 0.72));
      g.addColorStop(0.55, rgba(cur.mid, 0.2));
      g.addColorStop(1, rgba(cur.mid, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 1.8, 0, 6.2832);
      ctx.fill();

      // 12. Thinking Mode Orbiting Arc Scanners
      if (cur.scan > 0.02) {
        ctx.lineCap = "round";
        for (let j = 0; j < 3; j++) {
          const a0 = time * (2.4 + j * 0.35) * (j % 2 ? -1 : 1);
          ctx.strokeStyle = rgba(cur.core, 0.72 * cur.scan);
          ctx.lineWidth = 2.4 - j * 0.4;
          ctx.beginPath();
          ctx.arc(cx, cy, r * (1.08 + j * 0.055), a0, a0 + 0.85 - j * 0.12);
          ctx.stroke();
        }
      }

      // 13. Shockwave Ring
      if (shockRef.current > 0) {
        ctx.strokeStyle = rgba(cur.core, (1 - shockRef.current) * 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1 + shockRef.current * 1.35), 0, 6.2832);
        ctx.stroke();
      }

      // 14. Downsampled Bloom Pass
      if (effectiveBloom && bctx) {
        ctx.globalCompositeOperation = "source-over";
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
        bctx.drawImage(canvas, 0, 0, bloomCanvas.width, bloomCanvas.height);

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.34;
        ctx.drawImage(bloomCanvas, -10, -10, W + 20, H + 20);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }

      // 15. Mirrored Floor Reflection Plane
      if (effectiveFloorReflection) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, floorY - 4, W, H - floorY + 4);
        ctx.clip();
        ctx.globalAlpha = 0.16;
        ctx.translate(cx, floorY);
        ctx.scale(1, -0.34);
        ctx.translate(-cx, -cy);
        g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(cur.core, 0.9));
        g.addColorStop(0.35, rgba(cur.mid, 0.45));
        g.addColorStop(1, rgba(cur.mid, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 6.2832);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // 16. Vignette Outer Darkening
      g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, Math.max(W, H) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.58)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      if (animId) cancelAnimationFrame(animId);
    };
  }, [
    effectiveState,
    effectiveQuality,
    effectiveBloom,
    effectiveFloorReflection,
    effectiveSpinMultiplier,
    audioLevel,
    audioSession,
    buildGeometry,
  ]);

  // Pointer Interaction Handlers (Inertial 3D Rotation & Parallax)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;

    const nx = (e.clientX / W - 0.5) * 0.22;
    const ny = (e.clientY / H - 0.5) * 0.16;
    parallaxYRef.current = lerp(parallaxYRef.current, nx, 0.08);
    parallaxXRef.current = lerp(parallaxXRef.current, ny, 0.08);

    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    dragRef.current.moved += Math.abs(dx) + Math.abs(dy);
    velYawRef.current += dx * 0.005;
    velPitchRef.current += dy * 0.004;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (dragRef.current && dragRef.current.moved < 6) {
      // Tap / click produces an immediate quantum impulse shockwave!
      impulseRef.current = 1.0;
      shockRef.current = 0.001;
    }
    dragRef.current = null;
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handlePointerLeave = () => {
    parallaxXRef.current = lerp(parallaxXRef.current, 0, 0.2);
    parallaxYRef.current = lerp(parallaxYRef.current, 0, 0.2);
  };

  const profile = DEFAULT_STATE_PROFILES[effectiveState];

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden select-none ${className}`}
      style={style}
    >
      <canvas
        ref={canvasRef}
        aria-label="Jarvis Holographic AI Core"
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing touch-none z-10"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {/* Subtle Futuristic HUD Diagnostic Overlay */}
      {showTelemetry && (
        <div className="absolute top-6 left-6 right-6 flex items-start justify-between pointer-events-none z-20 font-mono">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full animate-ping"
              style={{ backgroundColor: `rgb(${profile.mid.join(",")})` }}
            />
            <span
              className="inline-block w-2 h-2 rounded-full -ml-3"
              style={{
                backgroundColor: `rgb(${profile.mid.join(",")})`,
                boxShadow: `0 0 10px rgb(${profile.mid.join(",")})`,
              }}
            />
            <div className="text-[11px] tracking-[0.25em] text-white/90 uppercase font-semibold">
              JARVIS <span className="text-white/40 text-[9px]">HOLOGRAPHIC CORE</span>
            </div>
          </div>

          <div className="text-right">
            <div
              className="text-xs tracking-[0.25em] font-bold"
              style={{ color: `rgb(${profile.mid.join(",")})` }}
            >
              {profile.statusLabel}
            </div>
            <div className="text-[9px] tracking-[0.18em] text-white/50">
              {profile.subLabel}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JarvisOrb;
