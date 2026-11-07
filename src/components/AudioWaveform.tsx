import { useEffect, useRef, useState } from "react";
import type { MyraaAudioSession, LiveState } from "../lib/audio";

interface AudioWaveformProps {
  session: MyraaAudioSession | null;
  state: LiveState;
  barCount?: number;
  className?: string;
}

export function AudioWaveform({ session, state, barCount = 12, className = "" }: AudioWaveformProps) {
  const [amplitudes, setAmplitudes] = useState<number[]>(() => Array(barCount).fill(0.1));
  const animFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    let active = true;

    const tick = () => {
      if (!active) return;

      const analyser = state === "speaking" ? session?.outputAnalyser : session?.inputAnalyser;

      if (analyser && (state === "speaking" || state === "listening")) {
        if (!dataArrayRef.current || dataArrayRef.current.length !== analyser.frequencyBinCount) {
          dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(dataArrayRef.current);

        const binCount = dataArrayRef.current.length;
        const step = Math.max(1, Math.floor(binCount / barCount));
        const newAmps: number[] = [];

        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          const start = i * step;
          const end = Math.min(binCount, start + step);
          for (let j = start; j < end; j++) {
            sum += dataArrayRef.current[j];
          }
          const avg = sum / (end - start || 1);
          const normalized = Math.min(1, Math.max(0.08, avg / 255));
          newAmps.push(normalized);
        }

        setAmplitudes((prev) =>
          prev.map((val, idx) => {
            const target = newAmps[idx] ?? 0.08;
            // Smooth attack and release
            return val + (target - val) * 0.35;
          })
        );
      } else {
        // Idle breathing wave
        const now = Date.now() / 600;
        setAmplitudes((prev) =>
          prev.map((val, idx) => {
            const target = 0.08 + Math.sin(now + idx * 0.5) * 0.04;
            return val + (target - val) * 0.15;
          })
        );
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [session, state, barCount]);

  const barColor =
    state === "speaking"
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
      : state === "listening"
      ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
      : "bg-white/15";

  return (
    <div className={`flex items-center justify-center gap-1 h-8 ${className}`}>
      {amplitudes.map((amp, index) => {
        const heightPx = Math.max(4, Math.round(amp * 32));
        return (
          <div
            key={index}
            className={`w-1 rounded-full transition-all duration-75 ${barColor}`}
            style={{ height: `${heightPx}px` }}
          />
        );
      })}
    </div>
  );
}
