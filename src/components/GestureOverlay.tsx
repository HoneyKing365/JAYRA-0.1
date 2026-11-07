/**
 * JAYRA Gesture Overlay — Holographic Hand Tracking & Air Control Canvas
 *
 * Provides:
 *  - Floating holographic cursor with gesture animations (pinch, grab, swipe)
 *  - Fullscreen canvas for 21-node skeletal landmark visualization
 *  - WebCam video processing element
 *  - Gesture interaction dispatch (clicking, dragging, swiping HUD elements)
 *  - Sci-fi HUD telemetry badge (FPS, tracking confidence, active gestures)
 */

import React, { useEffect, useRef, useState } from "react";
import { Hand, Eye, EyeOff, Zap, ShieldAlert } from "lucide-react";
import { gestureTracker, type GestureEvent, type HandData } from "../lib/gestureTracker";
import type { AppSettings } from "../lib/appApi";

type NativeGestureInput = {
  gestureInput?: (action: "move" | "press" | "release" | "zoom", x?: number, y?: number, scaleDelta?: number) => void;
};

interface GestureOverlayProps {
  appSettings: AppSettings | null;
  onGestureCommand?: (type: string, data?: GestureEvent) => void;
}

export function GestureOverlay({ appSettings, onGestureCommand }: GestureOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandData[]>([]);
  const [activeGesture, setActiveGesture] = useState<string>("none");
  const [showPip, setShowPip] = useState<boolean>(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isPinching, setIsPinching] = useState(false);

  const gestureConfig = appSettings?.gestures;
  const isEnabled = gestureConfig?.enabled ?? false;
  const isAirMouse = gestureConfig?.mode === "air_mouse";
  const sendNativeInput = (action: "move" | "press" | "release" | "zoom", x?: number, y?: number, scaleDelta?: number) => {
    const bridge = (window as Window & { myraa?: NativeGestureInput }).myraa;
    bridge?.gestureInput?.(action, x, y, scaleDelta);
  };

  // Sync settings with tracker
  useEffect(() => {
    if (gestureConfig) {
      gestureTracker.updateOptions({
        sensitivity: gestureConfig.sensitivity,
        smoothFactor: gestureConfig.smoothFactor,
        feedbackAudio: gestureConfig.feedbackAudio,
        visualLandmarks: gestureConfig.visualLandmarks,
        mode: gestureConfig.mode,
      });
    }
  }, [gestureConfig]);

  // Start / stop tracking based on settings
  useEffect(() => {
    if (!isEnabled) {
      gestureTracker.stop();
      setActive(false);
      setCursorPos(null);
      setHands([]);
      sendNativeInput("release");
      return;
    }

    let isMounted = true;

    const startTracker = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      try {
        setCameraError(null);
        await gestureTracker.start(videoRef.current, canvasRef.current);
        if (isMounted) setActive(true);
      } catch (err: any) {
        if (isMounted) {
          console.error("Camera gesture start error:", err);
          setCameraError(err?.message || "Failed to initialize webcam");
          setActive(false);
          sendNativeInput("release");
        }
      }
    };

    // Subscriptions
    const unsubHands = gestureTracker.onHands((newHands) => {
      if (!isMounted) return;
      setHands(newHands);
      const activeHand = newHands.find((h) => h.present);
      if (activeHand) {
        setCursorPos(activeHand.cursor);
        setIsPinching(activeHand.pinch);
        if (isAirMouse) sendNativeInput("move", activeHand.cursor.x, activeHand.cursor.y);
        if (activeHand.gesture !== "none") {
          setActiveGesture(activeHand.gesture);
        }
      } else {
        setCursorPos(null);
        setIsPinching(false);
        sendNativeInput("release");
      }
    });

    const unsubGesture = gestureTracker.onGesture((event: GestureEvent) => {
      if (!isMounted) return;
      setActiveGesture(event.type);

      if (isAirMouse) {
        if (event.hand === 0 && event.type === "pinch") sendNativeInput("press");
        else if (event.hand === 0 && event.type === "pinch_release") sendNativeInput("release");
        else if (event.type === "zoom" && event.scaleDelta !== undefined) sendNativeInput("zoom", undefined, undefined, event.scaleDelta);
      } else {
        const screenX = event.x * window.innerWidth;
        const screenY = event.y * window.innerHeight;
        if (event.type === "pinch") {
          const el = document.elementFromPoint(screenX, screenY);
          if (el instanceof HTMLElement) {
            el.click();
            el.focus?.();
          }
        } else if (event.type === "swipe_up") {
          window.scrollBy({ top: -320, behavior: "smooth" });
        } else if (event.type === "swipe_down") {
          window.scrollBy({ top: 320, behavior: "smooth" });
        } else if (event.type === "swipe_left") {
          window.history.back();
        } else if (event.type === "swipe_right") {
          window.history.forward();
        }
      }

      onGestureCommand?.(event.type, event);
    });

    void startTracker();

    return () => {
      isMounted = false;
      unsubHands();
      unsubGesture();
      gestureTracker.stop();
      sendNativeInput("release");
      setActive(false);
    };
  }, [isEnabled, gestureConfig?.mode]);

  if (!isEnabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {/* Hidden processing video */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={`fixed bottom-4 right-4 z-50 h-32 w-44 rounded-xl border border-cyan-500/40 object-cover shadow-2xl transition-all duration-300 ${
          showPip ? "opacity-90 scale-100" : "opacity-0 scale-95 pointer-events-none"
        }`}
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Holographic landmark skeleton canvas */}
      <canvas
        ref={canvasRef}
        className={`fixed inset-0 h-full w-full ${gestureConfig?.visualLandmarks ? "opacity-80" : "opacity-0"}`}
      />

      {/* Futuristic Air-Cursor */}
      {cursorPos && !isAirMouse && (
        <div
          className="fixed pointer-events-none transition-transform duration-75 ease-out -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${cursorPos.x * 100}%`,
            top: `${cursorPos.y * 100}%`,
          }}
        >
          {/* Outer rotating reticle */}
          <div
            className={`h-12 w-12 rounded-full border border-dashed transition-all duration-200 animate-spin ${
              isPinching ? "scale-75 border-orange-400 bg-orange-400/20" : "scale-100 border-cyan-400/80 bg-cyan-400/5"
            }`}
            style={{ animationDuration: "8s" }}
          />

          {/* Central target core */}
          <div
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ${
              isPinching ? "h-3.5 w-3.5 bg-orange-400 shadow-[0_0_15px_#ff8800]" : "h-2 w-2 bg-cyan-300 shadow-[0_0_10px_#00ffff]"
            }`}
          />

          {/* Holographic readout label */}
          <div className="absolute left-7 top-7 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300 backdrop-blur-sm border border-cyan-500/30">
            {activeGesture !== "none" ? activeGesture : isPinching ? "PINCH" : "AIM"}
          </div>
        </div>
      )}

      {/* HUD Telemetry Status Badge (Top Right) */}
      <div className="pointer-events-auto fixed top-4 right-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowPip(!showPip)}
          title="Toggle Gesture PIP Camera Preview"
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur-md transition-all cursor-pointer border ${
            active
              ? "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 shadow-[0_0_15px_rgba(0,255,255,0.15)]"
              : "border-slate-700 bg-slate-900/60 text-slate-400"
          }`}
        >
          <Hand size={11} className={active ? "text-cyan-400 animate-pulse" : "text-slate-500"} />
          <span>{active ? `${isAirMouse ? "AIR MOUSE" : "GESTURES"}: ${hands.some((h) => h.present) ? "LOCKED" : "READY"}` : "INITIALIZING"}</span>
          {showPip ? <Eye size={10} className="ml-1 text-cyan-400" /> : <EyeOff size={10} className="ml-1 text-slate-500" />}
        </button>

        {cameraError && (
          <div className="flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-950/60 px-2.5 py-1 text-[10px] font-mono text-rose-300">
            <ShieldAlert size={11} className="text-rose-400" />
            <span>CAM BLOCKED</span>
          </div>
        )}
      </div>
    </div>
  );
}
