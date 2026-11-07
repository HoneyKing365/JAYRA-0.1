import { randomUUID } from "node:crypto";

export type VibeState =
  | "DAYTIME_NORMAL"
  | "DEEP_FOCUS_NIGHT"
  | "CREATIVE_FLOW"
  | "REST_RECOVERY"
  | "MANUAL_OVERRIDE";

export type AudioVibeProfile =
  | "LO_FI_CYBERPUNK"
  | "SYNTHWAVE_FOCUS"
  | "NIGHT_RAIN"
  | "STANDARD";

export interface VibeConfig {
  enabled: boolean;
  nightStartHour: number; // e.g. 23 (11 PM)
  nightEndHour: number; // e.g. 5 (5 AM)
  sedentaryMinutesThreshold: number; // e.g. 45 min
  heavyProcessKeywords: string[];
  ambientLoFiTrackUrl: string;
  ambientVolume: number; // 0.0 to 1.0 (e.g. 0.22)
  dimmedHudBrightness: number; // 0.1 to 1.0 (e.g. 0.35)
  autoDnd: boolean;
}

export interface ContextTelemetry {
  timestamp?: number;
  currentHour?: number; // 0-23
  activeProcess?: string;
  activeWindowTitle?: string;
  phoneStepCountDelta?: number;
  phoneMotionState?: "sedentary" | "walking" | "running" | "unknown";
  userIdleSeconds?: number;
}

export interface AmbientAudioState {
  playing: boolean;
  track: string;
  volume: number;
  profile: AudioVibeProfile;
}

export interface SassyVibeNotice {
  textUrdu: string;
  textHinglish: string;
  textEnglish: string;
}

export interface VibeShiftEvent {
  type: "ambient_vibe_shift";
  shiftId: string;
  vibe: VibeState;
  previousVibe: VibeState;
  reason: string;
  hudBrightness: number;
  dndEnabled: boolean;
  ambientAudio: AmbientAudioState;
  sassyNotice: SassyVibeNotice;
  timestamp: number;
}

const DEFAULT_CONFIG: VibeConfig = {
  enabled: true,
  nightStartHour: 23,
  nightEndHour: 5,
  sedentaryMinutesThreshold: 45,
  heavyProcessKeywords: [
    "code", "vscode", "visual studio", "cl.exe", "cargo",
    "tsc", "gcc", "python", "node", "nvim", "idea",
    "terminal", "powershell", "bash", "git", "webstorm"
  ],
  ambientLoFiTrackUrl: "/audio/ambient/cyberpunk-night-lofi.mp3",
  ambientVolume: 0.22,
  dimmedHudBrightness: 0.35,
  autoDnd: true,
};

const SASSY_NOTICES: Record<VibeState, SassyVibeNotice[]> = {
  DEEP_FOCUS_NIGHT: [
    {
      textUrdu: "اتنی رات گئی کوڈ میں سر کھپا رہے ہو، یا دماغ کا دہی کرنے کا نیا شوق چڑھا ہے؟ ذرا آنکھیں بند کر کے ریلیکس کرو ورنہ صبح زومبی لگو گے۔",
      textHinglish: "Itni raat gaye code mein sar khapa rahe ho, ya dimaag ka dahi karne ka naya shauq charha hai? Maine lights dim karke Lo-Fi cyberpunk beats laga di hain... thoda aaram se kaam karo!",
      textEnglish: "Grinding code at 2 AM with zero physical movement? I've activated Deep Focus Mode, dimmed your HUD, and cued Lo-Fi cyberpunk beats so your brain doesn't completely fry."
    },
    {
      textUrdu: "رات کے اس پہر اتنی شدید کوڈنگ؟ اسکرین کی چمک کم کر دی ہے اور پرسکون دھنیں چلا دی ہیں، تھوڑا سانس لے لو۔",
      textHinglish: "Raat ke is pehar compile errors se jung? Lights 35% dim ho chuki hain aur DND active hai. Ab shanti se code khatam karo.",
      textEnglish: "Intense coding session detected in deep night hours. DND engaged, brightness adjusted to 35%, and ambient focus audio initiated."
    }
  ],
  DAYTIME_NORMAL: [
    {
      textUrdu: "دن کا اجالا ہو گیا ہے، برائٹنس نارمل پر سیٹ کر دی گئی ہے۔ چلو اب کچھ نیا بناؤ!",
      textHinglish: "Subah ho gayi hai, workstation full brightness aur standard audio par restore ho chuka hai. Let's build something epic!",
      textEnglish: "Daytime environment restored. Display brightness and audio profile transitioned back to normal operational parameters."
    }
  ],
  CREATIVE_FLOW: [
    {
      textUrdu: "تخلیقی موڈ آن ہے! ہموار دھنیں آپ کے کام کی رفتار کو تیز رکھیں گی۔",
      textHinglish: "Creative flow mode active! Smooth synthwave rhythms background mein set hain.",
      textEnglish: "Creative flow state initiated with focused ambient synthwave backdrop."
    }
  ],
  REST_RECOVERY: [
    {
      textUrdu: "اب بس بھی کرو، نیند پوری کرنا بھی عقل مندی کا حصہ ہے۔ اسکرین بند کرو اور سو جاؤ!",
      textHinglish: "Bhai ab so bhi jao! Screen band karo aur phone side pe rakho, kal subah fresh shuru karenge.",
      textEnglish: "Extended sedentary strain detected. HUD dimmed down to minimum. Highly recommend stepping away for recovery rest."
    }
  ],
  MANUAL_OVERRIDE: [
    {
      textUrdu: "آپ کی مرضی، مینوئل وائب موڈ لاگو ہو چکا ہے۔",
      textHinglish: "Manual vibe override set. System parameters aligned to your preferences.",
      textEnglish: "Manual vibe mode configuration applied."
    }
  ]
};

export class AmbientVibeEngine {
  private config: VibeConfig;
  private currentVibe: VibeState = "DAYTIME_NORMAL";
  private hudBrightness = 1.0;
  private dndEnabled = false;
  private ambientAudio: AmbientAudioState = {
    playing: false,
    track: "",
    volume: 0.22,
    profile: "STANDARD",
  };
  private sedentaryMinutes = 0;
  private lastMovementTimestamp: number | null = null;
  private lastContext: ContextTelemetry | null = null;
  private lastShiftEvent: VibeShiftEvent | null = null;
  private shiftListeners: Array<(event: VibeShiftEvent) => void> = [];

  constructor(initialConfig?: Partial<VibeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(initialConfig || {}) };
  }

  getConfig(): VibeConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<VibeConfig>): VibeConfig {
    this.config = {
      ...this.config,
      ...updates,
      ...(typeof updates.nightStartHour === "number" ? { nightStartHour: Math.max(0, Math.min(23, updates.nightStartHour)) } : {}),
      ...(typeof updates.nightEndHour === "number" ? { nightEndHour: Math.max(0, Math.min(23, updates.nightEndHour)) } : {}),
      ...(typeof updates.sedentaryMinutesThreshold === "number" ? { sedentaryMinutesThreshold: Math.max(1, updates.sedentaryMinutesThreshold) } : {}),
      ...(typeof updates.ambientVolume === "number" ? { ambientVolume: Math.max(0, Math.min(1, updates.ambientVolume)) } : {}),
      ...(typeof updates.dimmedHudBrightness === "number" ? { dimmedHudBrightness: Math.max(0.1, Math.min(1, updates.dimmedHudBrightness)) } : {}),
    };
    return this.getConfig();
  }

  setEnabled(enabled: boolean): boolean {
    this.config.enabled = Boolean(enabled);
    return this.config.enabled;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getCurrentVibe(): VibeState {
    return this.currentVibe;
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      currentVibe: this.currentVibe,
      hudBrightness: this.hudBrightness,
      dndEnabled: this.dndEnabled,
      ambientAudio: { ...this.ambientAudio },
      sedentaryMinutes: this.sedentaryMinutes,
      lastShiftEvent: this.lastShiftEvent,
      config: this.getConfig(),
    };
  }

  onVibeShift(listener: (event: VibeShiftEvent) => void): void {
    this.shiftListeners.push(listener);
  }

  recordContext(telemetry: ContextTelemetry, simulatedNow?: number): VibeShiftEvent | null {
    const now = simulatedNow ?? Date.now();
    this.lastContext = { ...telemetry, timestamp: now };

    if (!this.config.enabled) {
      return null;
    }

    const currentHour = typeof telemetry.currentHour === "number"
      ? telemetry.currentHour
      : new Date(now).getHours();

    // Track movement & sedentary state
    const isMoving = (typeof telemetry.phoneStepCountDelta === "number" && telemetry.phoneStepCountDelta > 5) ||
                     telemetry.phoneMotionState === "walking" ||
                     telemetry.phoneMotionState === "running";

    if (this.lastMovementTimestamp === null) {
      this.lastMovementTimestamp = now;
    }

    if (isMoving) {
      this.lastMovementTimestamp = now;
      this.sedentaryMinutes = 0;
    } else {
      const minutesElapsed = Math.floor((now - this.lastMovementTimestamp) / (60 * 1000));
      this.sedentaryMinutes = Math.max(0, minutesElapsed);
    }

    // Evaluate target state
    const isNightTime = this.isNightHour(currentHour);
    const isHeavyDevProcess = this.isHeavyDevActive(telemetry.activeProcess, telemetry.activeWindowTitle);
    const isSedentary = this.sedentaryMinutes >= this.config.sedentaryMinutesThreshold;

    let targetVibe: VibeState = this.currentVibe;
    let reason = "";

    if (isNightTime && isHeavyDevProcess && isSedentary) {
      targetVibe = "DEEP_FOCUS_NIGHT";
      reason = `Late night coding (${currentHour}:00) with heavy dev process and ${this.sedentaryMinutes}m sedentary state.`;
    } else if (!isNightTime && this.currentVibe === "DEEP_FOCUS_NIGHT") {
      targetVibe = "DAYTIME_NORMAL";
      reason = `Daytime hours reached (${currentHour}:00). Restoring daylight parameters.`;
    } else if (isNightTime && !isHeavyDevProcess && this.sedentaryMinutes >= this.config.sedentaryMinutesThreshold * 1.5) {
      targetVibe = "REST_RECOVERY";
      reason = `Late night inactivity detected. System advising rest and recovery.`;
    } else if (isMoving && this.currentVibe === "DEEP_FOCUS_NIGHT") {
      // User stood up during night coding -> soften to Creative Flow
      targetVibe = "CREATIVE_FLOW";
      reason = "Physical movement detected. Softening focus constraints to Creative Flow.";
    }

    if (targetVibe !== this.currentVibe) {
      return this.transitionTo(targetVibe, reason, now);
    }

    return null;
  }

  manualShift(vibe: VibeState, reason = "Manual user selection", simulatedNow?: number): VibeShiftEvent {
    const now = simulatedNow ?? Date.now();
    return this.transitionTo(vibe, reason, now);
  }

  private isNightHour(hour: number): boolean {
    const { nightStartHour, nightEndHour } = this.config;
    if (nightStartHour > nightEndHour) {
      // Wraps around midnight, e.g. 23 (11 PM) to 5 (5 AM)
      return hour >= nightStartHour || hour < nightEndHour;
    }
    return hour >= nightStartHour && hour < nightEndHour;
  }

  private isHeavyDevActive(processName?: string, windowTitle?: string): boolean {
    const text = `${processName || ""} ${windowTitle || ""}`.toLowerCase();
    return this.config.heavyProcessKeywords.some((kw) => text.includes(kw.toLowerCase()));
  }

  private transitionTo(newVibe: VibeState, reason: string, now: number): VibeShiftEvent {
    const previousVibe = this.currentVibe;
    this.currentVibe = newVibe;

    switch (newVibe) {
      case "DEEP_FOCUS_NIGHT":
        this.hudBrightness = this.config.dimmedHudBrightness;
        this.dndEnabled = this.config.autoDnd;
        this.ambientAudio = {
          playing: true,
          track: this.config.ambientLoFiTrackUrl,
          volume: this.config.ambientVolume,
          profile: "LO_FI_CYBERPUNK",
        };
        break;

      case "DAYTIME_NORMAL":
        this.hudBrightness = 1.0;
        this.dndEnabled = false;
        this.ambientAudio = {
          playing: false,
          track: "",
          volume: 0.0,
          profile: "STANDARD",
        };
        break;

      case "CREATIVE_FLOW":
        this.hudBrightness = 0.75;
        this.dndEnabled = false;
        this.ambientAudio = {
          playing: true,
          track: "/audio/ambient/synthwave-flow.mp3",
          volume: this.config.ambientVolume * 0.9,
          profile: "SYNTHWAVE_FOCUS",
        };
        break;

      case "REST_RECOVERY":
        this.hudBrightness = 0.2;
        this.dndEnabled = true;
        this.ambientAudio = {
          playing: true,
          track: "/audio/ambient/gentle-night-rain.mp3",
          volume: 0.15,
          profile: "NIGHT_RAIN",
        };
        break;

      case "MANUAL_OVERRIDE":
        break;
    }

    const notices = SASSY_NOTICES[newVibe] || SASSY_NOTICES.DAYTIME_NORMAL;
    const sassyNotice = notices[Math.floor(Math.random() * notices.length)];

    const event: VibeShiftEvent = {
      type: "ambient_vibe_shift",
      shiftId: randomUUID(),
      vibe: newVibe,
      previousVibe,
      reason,
      hudBrightness: this.hudBrightness,
      dndEnabled: this.dndEnabled,
      ambientAudio: { ...this.ambientAudio },
      sassyNotice,
      timestamp: now,
    };

    this.lastShiftEvent = event;
    for (const listener of this.shiftListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[AmbientVibeEngine] Listener error:", err);
      }
    }

    return event;
  }
}
