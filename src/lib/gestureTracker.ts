/**
 * JAYRA Gesture Tracker — High-precision MediaPipe Hand Tracking & Air Control
 *
 * Implements:
 *  - OneEuro speed-adaptive filter for zero-jitter cursor tracking
 *  - Palm-distance based persistent hand identity matching
 *  - Gesture recognition: POINT, PINCH/CLICK, DRAG, OPEN_PALM, FIST/GRAB, PEACE, SWIPES
 *  - Procedural WebAudio sci-fi chimes & feedback sound effects
 *  - Holographic 21-landmark wireframe rendering
 */

import { authorizeUiCapability } from "./permissionGate";
import { getTwoHandZoomDelta, isPinchActive, mapCursorPoint } from "./gestureMath";

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export type GestureType =
  | "point"
  | "pinch"
  | "pinch_release"
  | "drag"
  | "open"
  | "fist"
  | "peace"
  | "swipe_left"
  | "swipe_right"
  | "swipe_up"
  | "swipe_down"
  | "zoom";

export interface GestureEvent {
  hand: 0 | 1;
  type: GestureType;
  x: number; // Screen coordinate (0..1)
  y: number;
  rawPoint: { x: number; y: number };
  timestamp: number;
  scaleDelta?: number;
}

export interface HandData {
  id: number;
  present: boolean;
  landmarks: Landmark[];
  palm: { x: number; y: number };
  cursor: { x: number; y: number };
  pinch: boolean;
  pinchedDuration: number;
  gesture: GestureType | "none";
}

export interface GestureTrackerOptions {
  sensitivity?: number;
  smoothFactor?: number;
  feedbackAudio?: boolean;
  visualLandmarks?: boolean;
  mode?: "hud_control" | "air_mouse" | "presentation";
}

// ---- Sci-Fi Web Audio Feedback Synthesizer ----
class SciFiAudio {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  playPinch() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  playRelease() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.06);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playSwipe() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playLock() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [587.33, 880, 1174.66].forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const t = now + i * 0.04;
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  }
}

// ---- OneEuro Filter for Real-time Smooth Cursor ----
interface OneEuroState {
  t: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function filterOneEuro(state: OneEuroState, rawX: number, rawY: number, now: number, smoothFactor: number): { x: number; y: number } {
  let dt = (now - state.t) / 1000;
  if (!(dt > 1 / 240)) dt = 1 / 60;
  if (dt > 0.2) dt = 0.2;
  state.t = now;

  const alpha = (cutoff: number) => {
    const tau = 2 * Math.PI * cutoff * dt;
    return tau / (tau + 1);
  };

  const ad = alpha(2.5);
  state.dx += ((rawX - state.x) / dt - state.dx) * ad;
  state.dy += ((rawY - state.y) / dt - state.dy) * ad;

  const speed = Math.hypot(state.dx, state.dy);
  const cutoff = Math.max(0.55, 3.5 - smoothFactor * 3) + 0.012 * speed;
  const a = alpha(cutoff);

  state.x += (rawX - state.x) * a;
  state.y += (rawY - state.y) * a;

  return { x: state.x, y: state.y };
}

// Hand landmark connections for 21 points
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],// Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17],                              // Palm base
];

export class GestureTracker {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private landmarker: any = null;
  private isRunning = false;
  private animationFrameId: number | null = null;
  private lastVideoTs = -1;
  private lastFrameErrorAt = 0;
  private previousHandSeparation: number | null = null;
  private lastZoomAt = 0;

  public audio = new SciFiAudio();
  public options: Required<GestureTrackerOptions> = {
    sensitivity: 1.0,
    smoothFactor: 0.6,
    feedbackAudio: true,
    visualLandmarks: true,
    mode: "hud_control",
  };

  private listeners: Array<(event: GestureEvent) => void> = [];
  private handsListeners: Array<(hands: HandData[]) => void> = [];

  // Hand persistent states (2 slots)
  private handStates = [
    {
      present: false,
      seen: 0,
      pinch: false,
      pinchStart: 0,
      dragActive: false,
      lastPalm: { x: 0.5, y: 0.5 },
      filter: { t: 0, x: 0.5, y: 0.5, dx: 0, dy: 0 } as OneEuroState,
      velocity: { vx: 0, vy: 0, lastX: 0.5, lastY: 0.5, lastT: 0 },
      lastGesture: "none" as GestureType | "none",
      lastGestureTs: 0,
    },
    {
      present: false,
      seen: 0,
      pinch: false,
      pinchStart: 0,
      dragActive: false,
      lastPalm: { x: 0.5, y: 0.5 },
      filter: { t: 0, x: 0.5, y: 0.5, dx: 0, dy: 0 } as OneEuroState,
      velocity: { vx: 0, vy: 0, lastX: 0.5, lastY: 0.5, lastT: 0 },
      lastGesture: "none" as GestureType | "none",
      lastGestureTs: 0,
    },
  ];

  constructor(opts?: GestureTrackerOptions) {
    if (opts) this.updateOptions(opts);
  }

  updateOptions(opts: Partial<GestureTrackerOptions>) {
    this.options = { ...this.options, ...opts };
    this.audio.enabled = this.options.feedbackAudio;
  }

  onGesture(callback: (event: GestureEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  onHands(callback: (hands: HandData[]) => void): () => void {
    this.handsListeners.push(callback);
    return () => {
      this.handsListeners = this.handsListeners.filter((cb) => cb !== callback);
    };
  }

  private emitGesture(event: GestureEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Gesture listener error:", err);
      }
    }
  }

  private emitHands(hands: HandData[]) {
    for (const listener of this.handsListeners) {
      try {
        listener(hands);
      } catch (err) {
        console.error("Hands listener error:", err);
      }
    }
  }

  async initLandmarker(): Promise<void> {
    if (this.landmarker) return;

    // Load Tasks Vision from CDN or bundled fallback
    const visionWasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
    const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    try {
      // Dynamic import from CDN
      const visionPkg = await (Function('return import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm")')() as Promise<any>);
      const fileset = await visionPkg.FilesetResolver.forVisionTasks(visionWasmUrl);
      this.landmarker = await visionPkg.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath,
          delegate: "GPU",
        },
        numHands: 2,
        runningMode: "VIDEO",
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.5,
      });
    } catch (err) {
      console.warn("GPU Vision Landmarker initialization failed, trying CPU fallback:", err);
      try {
        const visionPkg = await (Function('return import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm")')() as Promise<any>);
        const fileset = await visionPkg.FilesetResolver.forVisionTasks(visionWasmUrl);
        this.landmarker = await visionPkg.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath,
            delegate: "CPU",
          },
          numHands: 2,
          runningMode: "VIDEO",
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.45,
        });
      } catch (innerErr) {
        console.error("Failed to initialize MediaPipe HandLandmarker:", innerErr);
        throw innerErr;
      }
    }
  }

  async start(videoEl: HTMLVideoElement, canvasEl?: HTMLCanvasElement): Promise<void> {
    if (this.isRunning) return;

    await authorizeUiCapability("ui.camera.access");
    this.video = videoEl;
    if (canvasEl) {
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext("2d");
    }

    await this.initLandmarker();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          facingMode: "user",
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await new Promise<void>((resolve) => {
        if (!this.video) return resolve();
        this.video.onloadedmetadata = () => {
          void this.video?.play().then(() => resolve());
        };
      });
    } catch (err) {
      console.error("Failed to open camera for gesture tracking:", err);
      throw err;
    }

    this.isRunning = true;
    this.lastVideoTs = -1;
    this.loop();
  }

  stop(): void {
    this.isRunning = false;
    this.previousHandSeparation = null;
    this.lastZoomAt = 0;
    for (const state of this.handStates) {
      if (state.pinch) {
        state.pinch = false;
        state.dragActive = false;
        this.audio.playRelease();
      }
      state.present = false;
      state.seen = 0;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private loop = () => {
    if (!this.isRunning || !this.video || !this.landmarker) return;

    const now = performance.now();
    if (this.video.currentTime !== this.lastVideoTs && this.video.readyState >= 2) {
      this.lastVideoTs = this.video.currentTime;
      try {
        const results = this.landmarker.detectForVideo(this.video, now);
        this.processLandmarks(results.landmarks || [], now);
      } catch (err) {
        if (now - this.lastFrameErrorAt >= 5000) {
          console.warn("Hand tracking skipped a camera frame after an inference error:", err);
          this.lastFrameErrorAt = now;
        }
      }
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processLandmarks(landmarksList: Landmark[][], now: number) {
    // Canvas sizing
    if (this.canvas && this.video) {
      if (this.canvas.width !== this.video.videoWidth || this.canvas.height !== this.video.videoHeight) {
        this.canvas.width = this.video.videoWidth || 640;
        this.canvas.height = this.video.videoHeight || 480;
      }
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    // Match hands to persistent slots by palm proximity
    const assigned = this.assignSlots(landmarksList);
    const activeHandsData: HandData[] = [];

    for (let slot = 0; slot < 2; slot++) {
      const state = this.handStates[slot];
      const lm = assigned[slot];

      if (!lm) {
        if (state.pinch) {
          state.pinch = false;
          state.dragActive = false;
          this.audio.playRelease();
          this.emitGesture({
            hand: slot as 0 | 1,
            type: "pinch_release",
            x: state.filter.x,
            y: state.filter.y,
            rawPoint: { x: state.filter.x, y: state.filter.y },
            timestamp: now,
          });
        }
        state.present = false;
        state.seen = 0;
        continue;
      }

      state.present = true;
      state.seen++;

      // Landmarks: mirror X coordinate for natural selfie reflection
      const mirroredLm = lm.map((pt) => ({ x: 1 - pt.x, y: pt.y, z: pt.z }));

      // Hand palm center
      const palmX = (mirroredLm[0].x + mirroredLm[9].x) / 2;
      const palmY = (mirroredLm[0].y + mirroredLm[9].y) / 2;
      state.lastPalm = { x: palmX, y: palmY };

      // Hand span
      const span = Math.max(1e-4, Math.hypot(mirroredLm[0].x - mirroredLm[9].x, mirroredLm[0].y - mirroredLm[9].y));

      // Index finger tip (cursor anchor)
      const rawTipX = mirroredLm[8].x;
      const rawTipY = mirroredLm[8].y;

      // Apply OneEuro speed-adaptive smoothing
      const mappedTip = mapCursorPoint({ x: rawTipX, y: rawTipY }, this.options.sensitivity);
      if (state.seen === 1) {
        state.filter = { t: now, x: mappedTip.x, y: mappedTip.y, dx: 0, dy: 0 };
        state.velocity = { vx: 0, vy: 0, lastX: mappedTip.x, lastY: mappedTip.y, lastT: now };
      }
      const smoothed = filterOneEuro(state.filter, mappedTip.x, mappedTip.y, now, this.options.smoothFactor);

      // Velocity calculation
      const dt = (now - state.velocity.lastT) / 1000;
      if (dt > 0.01) {
        state.velocity.vx = (smoothed.x - state.velocity.lastX) / dt;
        state.velocity.vy = (smoothed.y - state.velocity.lastY) / dt;
        state.velocity.lastX = smoothed.x;
        state.velocity.lastY = smoothed.y;
        state.velocity.lastT = now;
      }

      // Tip extension curl ratios
      const curl = (idx: number) => Math.hypot(mirroredLm[idx].x - mirroredLm[0].x, mirroredLm[idx].y - mirroredLm[0].y) / span;
      const tips = [curl(8), curl(12), curl(16), curl(20)]; // index, middle, ring, pinky

      // Gesture criteria
      const pinchGap = Math.hypot(mirroredLm[4].x - mirroredLm[8].x, mirroredLm[4].y - mirroredLm[8].y) / span;
      const isPinching = isPinchActive(pinchGap, state.pinch);
      const isOpen = tips.every((t) => t > 1.35);
      const isFist = tips.every((t) => t < 1.05);
      const isPoint = tips[0] > 1.4 && tips[1] < 1.15 && tips[2] < 1.15 && tips[3] < 1.15;
      const isPeace = tips[0] > 1.4 && tips[1] > 1.4 && tips[2] < 1.15 && tips[3] < 1.15;

      let detectedGesture: GestureType | "none" = "none";

      // Swipe recognition
      const speed = Math.hypot(state.velocity.vx, state.velocity.vy);
      if (speed > 1.8 && now - state.lastGestureTs > 400) {
        if (Math.abs(state.velocity.vx) > Math.abs(state.velocity.vy) * 1.5) {
          detectedGesture = state.velocity.vx > 0 ? "swipe_right" : "swipe_left";
        } else if (Math.abs(state.velocity.vy) > Math.abs(state.velocity.vx) * 1.5) {
          detectedGesture = state.velocity.vy > 0 ? "swipe_down" : "swipe_up";
        }
        if (detectedGesture !== "none") {
          state.lastGestureTs = now;
          this.audio.playSwipe();
          this.emitGesture({
            hand: slot as 0 | 1,
            type: detectedGesture,
            x: smoothed.x,
            y: smoothed.y,
            rawPoint: { x: rawTipX, y: rawTipY },
            timestamp: now,
          });
        }
      }

      // Pinch state machine
      if (isPinching) {
        if (!state.pinch) {
          state.pinch = true;
          state.pinchStart = now;
          this.audio.playPinch();
          detectedGesture = "pinch";
          this.emitGesture({
            hand: slot as 0 | 1,
            type: "pinch",
            x: smoothed.x,
            y: smoothed.y,
            rawPoint: { x: rawTipX, y: rawTipY },
            timestamp: now,
          });
        } else if (now - state.pinchStart > 180) {
          state.dragActive = true;
          detectedGesture = "drag";
          this.emitGesture({
            hand: slot as 0 | 1,
            type: "drag",
            x: smoothed.x,
            y: smoothed.y,
            rawPoint: { x: rawTipX, y: rawTipY },
            timestamp: now,
          });
        }
      } else {
        if (state.pinch) {
          state.pinch = false;
          state.dragActive = false;
          this.audio.playRelease();
          this.emitGesture({
            hand: slot as 0 | 1,
            type: "pinch_release",
            x: smoothed.x,
            y: smoothed.y,
            rawPoint: { x: rawTipX, y: rawTipY },
            timestamp: now,
          });
        }
      }

      if (detectedGesture === "none") {
        if (isPeace) {
          detectedGesture = "peace";
          if (state.lastGesture !== "peace") {
            this.audio.playLock();
            this.emitGesture({
              hand: slot as 0 | 1,
              type: "peace",
              x: smoothed.x,
              y: smoothed.y,
              rawPoint: { x: rawTipX, y: rawTipY },
              timestamp: now,
            });
          }
        } else if (isOpen) {
          detectedGesture = "open";
        } else if (isFist) {
          detectedGesture = "fist";
        } else if (isPoint) {
          detectedGesture = "point";
        }
      }

      state.lastGesture = detectedGesture;

      activeHandsData.push({
        id: slot,
        present: true,
        landmarks: mirroredLm,
        palm: { x: palmX, y: palmY },
        cursor: smoothed,
        pinch: state.pinch,
        pinchedDuration: state.pinch ? now - state.pinchStart : 0,
        gesture: detectedGesture,
      });

      // Render wireframe
      if (this.options.visualLandmarks && this.ctx && this.canvas) {
        this.renderHolographicHand(mirroredLm, smoothed, state.pinch, isPeace, isFist);
      }
    }

    if (activeHandsData.length === 2) {
      const separation = Math.hypot(
        activeHandsData[0].palm.x - activeHandsData[1].palm.x,
        activeHandsData[0].palm.y - activeHandsData[1].palm.y,
      );
      if (this.previousHandSeparation === null) this.previousHandSeparation = separation;
      const scaleDelta = getTwoHandZoomDelta(this.previousHandSeparation, separation);
      if (scaleDelta !== null && now - this.lastZoomAt >= 75) {
        this.lastZoomAt = now;
        this.previousHandSeparation = separation;
        const x = (activeHandsData[0].cursor.x + activeHandsData[1].cursor.x) / 2;
        const y = (activeHandsData[0].cursor.y + activeHandsData[1].cursor.y) / 2;
        this.emitGesture({
          hand: 0,
          type: "zoom",
          x,
          y,
          rawPoint: { x, y },
          timestamp: now,
          scaleDelta,
        });
      }
    } else {
      this.previousHandSeparation = null;
    }

    this.emitHands(activeHandsData);
  }

  private assignSlots(landmarksList: Landmark[][]): (Landmark[] | null)[] {
    const out: (Landmark[] | null)[] = [null, null];
    const claimed = [false, false];

    for (let slot = 0; slot < 2; slot++) {
      const state = this.handStates[slot];
      if (!state.present) continue;
      let bestIdx = -1;
      let minDistance = 1e9;

      landmarksList.forEach((lm, idx) => {
        if (claimed[idx]) return;
        const mirroredPalmX = 1 - (lm[0].x + lm[9].x) / 2;
        const palmY = (lm[0].y + lm[9].y) / 2;
        const d = Math.hypot(mirroredPalmX - state.lastPalm.x, palmY - state.lastPalm.y);
        if (d < minDistance) {
          minDistance = d;
          bestIdx = idx;
        }
      });

      if (bestIdx >= 0 && minDistance < 0.28) {
        out[slot] = landmarksList[bestIdx];
        claimed[bestIdx] = true;
      }
    }

    landmarksList.forEach((lm, idx) => {
      if (claimed[idx]) return;
      const emptySlot = out[0] === null ? 0 : out[1] === null ? 1 : -1;
      if (emptySlot >= 0) {
        out[emptySlot] = lm;
        claimed[idx] = true;
      }
    });

    return out;
  }

  getMediaStream(): MediaStream | null {
    return this.stream;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  captureSnapshot(): string | null {
    if (!this.video || this.video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth || 640;
    canvas.height = this.video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  private renderHolographicHand(
    lm: Landmark[],
    cursor: { x: number; y: number },
    isPinch: boolean,
    isPeace: boolean,
    isFist: boolean
  ) {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const baseColor = isPinch ? "#ff8844" : isPeace ? "#55ffcc" : isFist ? "#ffbb33" : "#00f0ff";
    const cx = cursor.x * w;
    const cy = cursor.y * h;

    ctx.save();
    ctx.shadowColor = baseColor;
    ctx.shadowBlur = isPinch ? 12 : 8;

    // Sleek outer reticle
    const radius = isPinch ? 14 : 22;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = baseColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair ticks
    const tickLen = 6;
    ctx.beginPath();
    ctx.moveTo(cx - radius - tickLen, cy);
    ctx.lineTo(cx - radius + 2, cy);
    ctx.moveTo(cx + radius - 2, cy);
    ctx.lineTo(cx + radius + tickLen, cy);
    ctx.moveTo(cx, cy - radius - tickLen);
    ctx.lineTo(cx, cy - radius + 2);
    ctx.moveTo(cx, cy + radius - 2);
    ctx.lineTo(cx, cy + radius + tickLen);
    ctx.stroke();

    // Luminous central indicator
    ctx.beginPath();
    ctx.arc(cx, cy, isPinch ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isPinch ? "#ffffff" : baseColor;
    ctx.fill();

    // Subtle index vector from knuckle to tip (shows pointing orientation without heavy clutter)
    if (lm[5]) {
      const kx = lm[5].x * w;
      const ky = lm[5].y * h;
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${baseColor}66`;
      ctx.moveTo(kx, ky);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

export const gestureTracker = new GestureTracker();
