/**
 * Live view of the runtime's `/events` WebSocket for the main window.
 *
 * Keeps the latest state of every task, pending confirmations, open questions,
 * the model selection and transient model notices. Reconnects with bounded
 * exponential backoff (1 s → 30 s) and re-syncs over REST after each reconnect,
 * so a dropped socket never leaves stale HUD state behind.
 */
import { useEffect, useRef, useState } from "react";
import { api, type ConfirmationRequest, type ModelSelection, type TaskView } from "./appApi";
import type { SystemTelemetrySnapshot } from "../../services/systemMonitor";
import { reportDiagnostic } from "./diagnostics";

export interface ModelNotice {
  id: number;
  kind: string;
  text: string;
  at: number;
}

export interface QuestionEvent {
  taskId: string;
  id: string;
  question: string;
  options: string[];
}

export interface AppEventsState {
  connected: boolean;
  tasks: Record<string, TaskView>;
  confirmations: ConfirmationRequest[];
  questions: Record<string, QuestionEvent>;
  selection: ModelSelection | null;
  notices: ModelNotice[];
  stopped: { reason: string; tasks: number; at: number } | null;
  wake?: { phrase: string; at: number } | null;
  voiceState?: { state: "disconnected" | "connecting" | "processing" | "listening" | "speaking"; at: number } | null;
  speech?: { id: number; text: string; kind: string; fallbackToRenderer: boolean } | null;
  systemTelemetry?: SystemTelemetrySnapshot | null;
}

const INITIAL: AppEventsState = { connected: false, tasks: {}, confirmations: [], questions: {}, selection: null, notices: [], stopped: null, wake: null, voiceState: null, speech: null, systemTelemetry: null };

/** Human wording for model.status events (models/router.ts). */
function describeModelStatus(payload: Record<string, unknown>): string | null {
  switch (payload.kind) {
    case "fallback": return `Switched to ${payload.using} because ${payload.from} failed.`;
    case "quota_exhausted": {
      const wait = Number(payload.retryAfterMs);
      const models = Array.isArray(payload.models) ? payload.models.join(", ") : "the selected model";
      return `Free-tier quota used up for ${models}.${Number.isFinite(wait) && wait > 0 ? ` Try again in about ${Math.ceil(wait / 60000)} min.` : ""}`;
    }
    case "capability_substitution": return `Using ${payload.using} instead of ${payload.selected} (${payload.reason}).`;
    case "offline_local": return `Offline — using the local model ${payload.using}.`;
    case "network": return payload.state === "offline" ? "Network offline. Cloud models are unavailable." : null;
    default: return null;
  }
}

function isTaskView(value: unknown): value is TaskView {
  return Boolean(value && typeof value === "object" && "id" in value && "goal" in value && "state" in value);
}

export function useAppEvents(enabled = true): AppEventsState & {
  publishWake: (phrase: string) => void;
  publishVoiceState: (state: "disconnected" | "connecting" | "processing" | "listening" | "speaking") => void;
} {
  const [state, setState] = useState<AppEventsState>(INITIAL);
  const noticeId = useRef(0);
  const speechId = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const resync = async () => {
      try {
        const [tasks, confirmations] = await Promise.all([api.tasks(10), api.confirmations()]);
        if (disposed) return;
        setState((s) => ({
          ...s,
          tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
          confirmations,
        }));
      } catch {
        /* backend still starting; the socket replay covers active tasks */
      }
    };

    const handle = (type: string, payload: unknown) => {
      if (type === "error.diagnosed") {
        const diagnostic = payload as { component?: unknown; action?: unknown; error?: unknown };
        const source = [diagnostic.component, diagnostic.action]
          .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
          .join(" / ");
        const message = typeof diagnostic.error === "string" ? diagnostic.error : "A backend diagnostic was reported.";
        reportDiagnostic(source || "Backend diagnostic", message);
        return;
      }
      setState((s) => {
        switch (type) {
          case "task.updated":
          case "task.finished": {
            if (!isTaskView(payload)) return s; // loop.ts also emits a {taskId, success} summary
            const questions = { ...s.questions };
            if (!payload.pendingQuestion) delete questions[payload.id];
            return { ...s, tasks: { ...s.tasks, [payload.id]: payload }, questions };
          }
          case "question.asked": {
            const q = payload as QuestionEvent;
            return { ...s, questions: { ...s.questions, [q.taskId]: q } };
          }
          case "confirmation.requested": {
            const request = payload as ConfirmationRequest;
            return { ...s, confirmations: [...s.confirmations.filter((c) => c.id !== request.id), request] };
          }
          case "confirmation.resolved": {
            const id = (payload as { id: string }).id;
            return { ...s, confirmations: s.confirmations.filter((c) => c.id !== id) };
          }
          case "model.changed":
            return { ...s, selection: payload as ModelSelection };
          case "model.status": {
            const text = describeModelStatus(payload as Record<string, unknown>);
            if (!text) return s;
            const notice = { id: ++noticeId.current, kind: String((payload as { kind: string }).kind), text, at: Date.now() };
            return { ...s, notices: [...s.notices.slice(-3), notice] };
          }
          case "autonomy.stopped": {
            const p = payload as { reason: string; tasks: number };
            return { ...s, stopped: { reason: p.reason, tasks: p.tasks, at: Date.now() } };
          }
          case "voice.wake": {
            const wake = payload as { phrase?: string };
            return { ...s, wake: { phrase: wake.phrase || "jayra", at: Date.now() } };
          }
          case "voice.state": {
            const voice = payload as { state: "disconnected" | "connecting" | "processing" | "listening" | "speaking" };
            return { ...s, voiceState: { state: voice.state, at: Date.now() } };
          }
          case "speech.say": {
            const speech = payload as { text?: string; kind?: string; fallbackToRenderer?: boolean };
            const allowedSpeechKinds = ["wellness_reminder", "user_reminder", "proactive_remark", "casual", "away_checkin", "user_returned", "visual_event", "proactive", "observation", "social_prompt"];
            if (!allowedSpeechKinds.includes(String(speech.kind))
              || typeof speech.text !== "string" || !speech.text.trim()) return s;
            return {
              ...s,
              speech: {
                id: ++speechId.current,
                text: speech.text.slice(0, 500),
                kind: speech.kind,
                fallbackToRenderer: speech.fallbackToRenderer === true,
              },
            };
          }
          case "system.telemetry":
            return { ...s, systemTelemetry: payload as SystemTelemetrySnapshot };
          default:
            return s;
        }
      });
    };

    const connect = () => {
      if (disposed) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/events`);
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setState((s) => ({ ...s, connected: true }));
        void resync();
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as { type: string; payload: unknown };
          handle(event.type, event.payload);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        setState((s) => ({ ...s, connected: false }));
        if (disposed) return;
        reportDiagnostic("Runtime events disconnected", "The live runtime event connection closed. Reconnecting automatically.", "warning");
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      socketRef.current = null;
      socket?.close();
    };
  }, [enabled]);

  // Model notices fade on their own after 12 s.
  useEffect(() => {
    if (!state.notices.length) return;
    const timer = setTimeout(() => setState((s) => ({ ...s, notices: s.notices.filter((n) => Date.now() - n.at < 12_000) })), 12_500);
    return () => clearTimeout(timer);
  }, [state.notices]);

  const publishWake = (phrase: string) => {
    if ((phrase !== "hey jayra" && phrase !== "jayra") || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "voice.wake", phrase }));
  };

  const publishVoiceState = (voiceState: "disconnected" | "connecting" | "processing" | "listening" | "speaking") => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "voice.state", state: voiceState }));
  };

  return { ...state, publishWake, publishVoiceState };
}
