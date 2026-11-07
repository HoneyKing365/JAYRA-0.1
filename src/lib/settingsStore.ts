/**
 * JAYRA Settings Store — persistent user preferences (V2).
 *
 * localStorage is an instant renderer cache; the backend AppSettingsStore is
 * the source of truth. settings.json remains a compatibility projection for
 * the Python desktop agent.
 *
 * Pattern follows the existing codebase conventions: plain state + ref mirrors.
 * No Context/Zustand — this is deliberately lightweight to match audio.ts/memoryTypes.ts.
 */

export interface MyraaSettings {
  /** Launch JAYRA (backends + browser tab) silently on Windows login. */
  autoStart: boolean;
  /** Enable the always-listening wake-word detector. */
  wakeWordEnabled: boolean;
  /** Phrase that activates JAYRA (case-insensitive substring match). */
  wakePhrase: string;
  /** Preferred microphone device id ("" = system default). */
  micDeviceId: string;
  /** Wake-word sensitivity: 0 (strict) .. 100 (loose). Affects debounce window. */
  sensitivity: number;
  /** Voice synthesis provider. */
  ttsProvider: "gemini" | "mark_lv_jarvis" | "edge_tts" | "web_speech";
  /** Browser voice used only when the live model returns text without audio. */
  ttsVoice: string;
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  /** Expose the paired mobile gateway on the local network. */
  networkAccessEnabled: boolean;
  /** Master toggle for UI animations. */
  animations: boolean;
  /** Reflected character highlight amount: 0 (matte) .. 100 (strong). */
  characterShine: number;
  /** UI view mode: 'windowed' (full HUD) or 'companion' (floating desktop companion). */
  uiViewMode: "windowed" | "companion";
  /** Language & localization preference (synced with AppSettings). */
  language?: "en" | "roman_urdu" | "roman_hindi" | "custom_script";
}

export const DEFAULT_SETTINGS: MyraaSettings = {
  autoStart: false,
  wakeWordEnabled: false,
  wakePhrase: "hey jayra",
  micDeviceId: "",
  sensitivity: 60,
  ttsProvider: "gemini",
  ttsVoice: "",
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
  networkAccessEnabled: false,
  animations: true,
  characterShine: 50,
  uiViewMode: "companion",
  language: "en",
};

const STORAGE_KEY = "myraa.settings.v2";

/** Settings keys that the browser should never persist (security). */
const NEVER_PERSIST: ReadonlySet<keyof MyraaSettings> = new Set([]);

export function normalizeSpeechSettings(settings: Partial<MyraaSettings>): Pick<MyraaSettings, "ttsVoice" | "speechRate" | "speechPitch" | "speechVolume"> {
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  return {
    ttsVoice: typeof settings.ttsVoice === "string" ? settings.ttsVoice.slice(0, 256) : DEFAULT_SETTINGS.ttsVoice,
    speechRate: clamp(settings.speechRate, 0.5, 2, DEFAULT_SETTINGS.speechRate),
    speechPitch: clamp(settings.speechPitch, 0.5, 2, DEFAULT_SETTINGS.speechPitch),
    speechVolume: clamp(settings.speechVolume, 0, 1, DEFAULT_SETTINGS.speechVolume),
  };
}

/**
 * Load settings from localStorage, merged over defaults so new keys always
 * have a sane value even when an older payload is present.
 */
export function loadSettings(): MyraaSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MyraaSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (merged.wakePhrase.trim().toLowerCase() === "hey myraa") {
      merged.wakePhrase = DEFAULT_SETTINGS.wakePhrase;
    }
    const shine = Number(merged.characterShine);
    return {
      ...merged,
      ...normalizeSpeechSettings(merged),
      characterShine: Number.isFinite(shine) ? Math.max(0, Math.min(100, shine)) : 50,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persist a full or partial settings update to localStorage.
 * Returns the fully merged settings object.
 */
export function saveSettings(
  patch: Partial<MyraaSettings>,
  options: { syncBackend?: boolean } = {},
): MyraaSettings {
  const current = loadSettings();
  const next: MyraaSettings = { ...current, ...patch, ...normalizeSpeechSettings({ ...current, ...patch }) };
  if (typeof window !== "undefined") {
    try {
      // Strip any sensitive keys before writing to localStorage.
      const safe: Record<string, unknown> = {};
      (Object.keys(next) as (keyof MyraaSettings)[]).forEach((k) => {
        if (!NEVER_PERSIST.has(k)) safe[k] = next[k];
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      /* localStorage may be unavailable (private mode) — fail silently. */
    }
  }
  // Best-effort sync to backend so the Python agent can read auto-start state.
  if (options.syncBackend !== false) {
    void syncSettingsToBackend(next).catch((error: unknown) => {
      if (typeof window !== "undefined") {
        const message = error instanceof Error ? error.message : String(error);
        window.dispatchEvent(new CustomEvent("myraa:settings-sync-error", { detail: message }));
      }
    });
  }
  return next;
}

/** Push settings to the backend (server.ts persists to settings.json). */
async function syncSettingsToBackend(settings: MyraaSettings): Promise<void> {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Settings sync failed (${response.status}).`);
}
