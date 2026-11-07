/**
 * Server-side settings for the agent, presence, companion, character,
 * physics, privacy, performance and developer areas.
 *
 * Stored in `<data>/app-settings.v3.json`. Renderer preferences that were
 * previously stored separately are normalized here; settings.json is retained
 * only as a compatibility projection for the Python sidecar.
 */
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../shared/jsonFile";

export interface RendererSettings {
  autoStart: boolean;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  micDeviceId: string;
  sensitivity: number;
  ttsVoice: string;
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  networkAccessEnabled: boolean;
  animations: boolean;
  characterShine: number;
  uiViewMode: "windowed" | "companion";
}

export interface AppSettings {
  version: 3;
  onboardingComplete: boolean;
  renderer: RendererSettings;
  behavior: {
    proactivity: "quiet" | "balanced" | "lively";
    awayCheckin: boolean;
    returnGreeting: boolean;
    awayAfterMin: number;
    dndManual: boolean;
    autoDndFullscreen: boolean;
    autoDndMeetings: boolean;
    autoDndRecording: boolean;
    focusMode: boolean;
    focusModeDurationMin: number | null;
    proactiveCompanionEnabled: boolean;
  };
  wellness: {
    enabled: boolean;
    intervalMinutes: 30 | 45 | 60;
    voiceAlerts: boolean;
    breakMessage: string;
    waterMessage: string;
    eyeRestMessage: string;
  };
  autonomy: {
    maxSteps: number;
    conflictWaitSec: number;
    emergencyShortcut: string;
    showTaskHud: boolean;
  };
  voice: {
    voiceName: string;
    ttsProvider: "gemini" | "mark_lv_jarvis" | "edge_tts" | "web_speech";
    /** How she delivers lines: natural, or bright and cute (anime heroine). */
    style: "natural" | "anime";
    /** Raise her voice by this many semitones (0 = as Gemini speaks). */
    pitch: number;
    bargeIn: boolean;
    speakTaskUpdates: "all" | "important" | "none";
    showSubtitles: boolean;
  };
  persona: {
    preset: "friendly_caring" | "fun_witty" | "naughty_teasing" | "professional_assistant";
    relationshipRole: "close_friend" | "companion_waifu" | "custom_role";
    customRole: string;
    mood: "balanced" | "cheerful" | "calm" | "encouraging" | "focused";
    customPrompt: string;
    customPersonas: CustomPersona[];
    activeCustomPersonaId: string | null;
  };
  companion: {
    enabled: boolean;
    setupComplete: boolean;
    scale: number;
    monitorId: string | null;
    position: { x: number; y: number } | null;
    anchor: { kind: "free" | "desktop" | "taskbar" | "window"; edge?: "top" | "bottom" | "left" | "right"; offset?: number; windowTitle?: string } | null;
    fullscreenBehavior: "hide" | "notifications_only" | "always" | "game_aware";
    clickThrough: boolean;
    interactionLevel: "minimal" | "normal" | "playful";
    walkAround: boolean;
    /** She may pull desktop icons around (always restorable). Off by default. */
    iconPlay: boolean;
    /** 0..1: outline and shadow that keep her readable on busy wallpapers. */
    standOut: number;
    /** She sometimes hides behind a screen edge and peeks back in. */
    hideAndPeek: boolean;
    /** Small shy reaction when the pointer enters her visible silhouette. */
    cursorReactions: boolean;
    /** Let active voice audio trigger a short procedural dance. */
    danceOnAudio: boolean;
    mangaBubbles: boolean;
  };
  character: {
    activeCharacterId: string;
    eyeFollowCursor: boolean;
    headFollowCursor: boolean;
    idleVariety: number;
  };
  graphics: {
    /** 0 = art-directed anime shading, 1 = physically based "realistic" shading. */
    realism: number;
    /** GPU budget: high, balanced (Medium), low (Optimized), potato. "auto" picks for the PC. */
    quality: "auto" | "potato" | "low" | "balanced" | "high";
    /** Levels Auto has stepped down after crashes on this PC (0..3). */
    autoStep: number;
  };
  physics: {
    enabled: boolean;
    quality: "low" | "balanced" | "high";
    secondaryMotion: number;
    gravityMultiplier: number;
    stiffness: number;
    damping: number;
    drag: number;
    collisionQuality: "off" | "low" | "high";
    wind: number;
    /** Vertex-level cloth on every garment (stays worn). */
    clothEnabled: boolean;
    /** 0..2: how far fabric may move away from the body. */
    clothLooseness: number;
  };
  performance: {
    activeFps: number;
    idleFps: number;
    sleepFps: number;
    perceptionPollSec: number;
  };
  systemMonitor: {
    enabled: boolean;
    updateIntervalSeconds: 1 | 3 | 5;
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  };
  developer: {
    debugView: boolean;
    physicsDebug: boolean;
    verboseLogs: boolean;
    showErrorConsole: boolean;
  };
  gestures: {
    enabled: boolean;
    mode: "air_mouse" | "hud_control" | "presentation";
    sensitivity: number;
    cameraIndex: number;
    smoothFactor: number;
    feedbackAudio: boolean;
    visualLandmarks: boolean;
  };
  hud: {
    visualMode: "character" | "hologram_face" | "orb";
    theme: "mark_lv_neon" | "iron_man_gold" | "cyber_cyan" | "stealth_dark";
    soundEffects: boolean;
    scanlines: boolean;
    particleField: boolean;
    diagnosticGauges: boolean;
    ringOpacity: number;
    showSubtitles: boolean;
  };
  codeEditor: {
    enabled: boolean;
    theme: "vs-dark" | "hc-black" | "cyber-punk";
    fontSize: number;
    autoComplete: boolean;
    aiAssistance: boolean;
    defaultWorkspace: string;
  };
  models3d: {
    activeModel: "jayra_prime" | "evelyn" | "hologram_core" | "custom";
    customModelPath: string;
    wireframeMode: boolean;
    hologramGlitch: boolean;
    rotationSpeed: number;
  };
  localization: {
    language: "en" | "roman_urdu" | "roman_hindi" | "custom_script";
    customPrompt: string;
    scriptStyle: "latin" | "native" | "mixed";
    summaryLanguage: "en" | "roman_urdu" | "roman_hindi" | "multilingual";
    dailyBoardSync: boolean;
  };
  orbVisualizer: {
    quality: "high" | "balanced" | "low";
    particleDensity: "high" | "balanced" | "low";
    bloomEffect: boolean;
    spinSpeed: number;
    floorReflection: boolean;
    style: "jarvis_classic" | "reactive_pulse" | "quantum_matrix" | "minimal";
  };
  weatherNews: {
    city: string;
    country: string;
    countryCode: string;
    latitude: number;
    longitude: number;
    temperatureUnit: "celsius" | "fahrenheit";
    newsCategory: "general" | "technology" | "science" | "business";
    autoRefreshMinutes: number;
    customOpenWeatherKey?: string;
    customNewsApiKey?: string;
  };
}

export interface CustomPersona {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 3,
  onboardingComplete: false,
  renderer: {
    autoStart: false,
    wakeWordEnabled: false,
    wakePhrase: "hey jayra",
    micDeviceId: "",
    sensitivity: 60,
    ttsVoice: "",
    speechRate: 1,
    speechPitch: 1,
    speechVolume: 1,
    networkAccessEnabled: false,
    animations: true,
    characterShine: 50,
    uiViewMode: "companion",
  },
  behavior: {
    proactivity: "balanced",
    awayCheckin: true,
    returnGreeting: true,
    awayAfterMin: 5,
    dndManual: false,
    autoDndFullscreen: true,
    autoDndMeetings: true,
    autoDndRecording: false,
    focusMode: false,
    focusModeDurationMin: null,
    proactiveCompanionEnabled: true,
  },
  wellness: {
    enabled: false,
    intervalMinutes: 45,
    voiceAlerts: true,
    breakMessage: "You have been at your desk for a while. Take a short stretch break.",
    waterMessage: "A quick water break might be nice.",
    eyeRestMessage: "Look away from the screen for a few seconds and rest your eyes.",
  },
  autonomy: {
    maxSteps: 30,
    conflictWaitSec: 6,
    emergencyShortcut: "Control+Alt+Shift+S",
    showTaskHud: true,
  },
  voice: {
    voiceName: "Aoede",
    ttsProvider: "gemini",
    style: "natural",
    pitch: 0,
    bargeIn: true,
    speakTaskUpdates: "important",
    showSubtitles: true,
  },
  persona: {
    preset: "friendly_caring",
    relationshipRole: "close_friend",
    customRole: "",
    mood: "balanced",
    customPrompt: "",
    customPersonas: [],
    activeCustomPersonaId: null,
  },
  companion: {
    enabled: true,
    setupComplete: false,
    scale: 1,
    monitorId: null,
    position: null,
    anchor: { kind: "taskbar", edge: "top", offset: 0.85 },
    fullscreenBehavior: "game_aware",
    clickThrough: true,
    interactionLevel: "normal",
    walkAround: true,
    iconPlay: false,
    standOut: 0.7,
    hideAndPeek: true,
    cursorReactions: true,
    danceOnAudio: false,
    mangaBubbles: false,
  },
  character: {
    activeCharacterId: "astra",
    eyeFollowCursor: false,
    headFollowCursor: true,
    idleVariety: 0.6,
  },
  graphics: {
    realism: 0.85,
    quality: "auto",
    autoStep: 0,
  },
  physics: {
    enabled: true,
    quality: "balanced",
    secondaryMotion: 100,
    gravityMultiplier: 1,
    stiffness: 1,
    damping: 1,
    drag: 1,
    collisionQuality: "low",
    wind: 0,
    clothEnabled: true,
    clothLooseness: 1,
  },
  performance: {
    activeFps: 60,
    idleFps: 30,
    sleepFps: 10,
    perceptionPollSec: 4,
  },
  systemMonitor: {
    enabled: true,
    updateIntervalSeconds: 3,
    corner: "bottom-left",
  },
  developer: {
    debugView: false,
    physicsDebug: false,
    verboseLogs: false,
    showErrorConsole: false,
  },
  gestures: {
    enabled: false,
    mode: "hud_control",
    sensitivity: 1.0,
    cameraIndex: 0,
    smoothFactor: 0.6,
    feedbackAudio: true,
    visualLandmarks: false,
  },
  hud: {
    visualMode: "orb",
    theme: "mark_lv_neon",
    soundEffects: true,
    scanlines: true,
    particleField: true,
    diagnosticGauges: true,
    ringOpacity: 0.85,
    showSubtitles: true,
  },
  codeEditor: {
    enabled: true,
    theme: "cyber-punk",
    fontSize: 14,
    autoComplete: true,
    aiAssistance: true,
    defaultWorkspace: "",
  },
  models3d: {
    activeModel: "jayra_prime",
    customModelPath: "",
    wireframeMode: false,
    hologramGlitch: true,
    rotationSpeed: 0.5,
  },
  localization: {
    language: "en",
    customPrompt: "",
    scriptStyle: "latin",
    summaryLanguage: "multilingual",
    dailyBoardSync: true,
  },
  orbVisualizer: {
    quality: "high",
    particleDensity: "balanced",
    bloomEffect: true,
    spinSpeed: 1.0,
    floorReflection: true,
    style: "jarvis_classic",
  },
  weatherNews: {
    city: "",
    country: "",
    countryCode: "",
    latitude: 0,
    longitude: 0,
    temperatureUnit: "celsius",
    newsCategory: "general",
    autoRefreshMinutes: 30,
    customOpenWeatherKey: "",
    customNewsApiKey: "",
  },
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? value as T : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Merge a (possibly partial or stale) settings object over defaults, validating every field. */
export function normalizeSettings(input: unknown, base: AppSettings = DEFAULT_APP_SETTINGS): AppSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = base;
  const r = raw.renderer || {}, b = raw.behavior || {}, wellness = raw.wellness || {}, a = raw.autonomy || {}, v = raw.voice || {}, persona = raw.persona || {}, c = raw.companion || {}, ch = raw.character || {}, p = raw.physics || {}, pe = raw.performance || {}, sm = raw.systemMonitor || {}, dev = raw.developer || {}, gr = raw.graphics || {};
  const gest = raw.gestures || {}, hud = raw.hud || {}, ce = raw.codeEditor || {}, m3d = raw.models3d || {}, loc = raw.localization || {}, orb = raw.orbVisualizer || {}, wn = raw.weatherNews || {};
  const customPersonas: CustomPersona[] = [];
  const customPersonaIds = new Set<string>();
  const personaEntries = Array.isArray(persona.customPersonas) ? persona.customPersonas : d.persona.customPersonas;
  for (const entry of personaEntries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 128) : "";
    const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 80) : "";
    const description = typeof candidate.description === "string" ? candidate.description.trim().slice(0, 2000) : "";
    const createdAt = typeof candidate.createdAt === "string" && Number.isFinite(Date.parse(candidate.createdAt))
      ? new Date(candidate.createdAt).toISOString()
      : "";
    if (!id || !title || !description || !createdAt || customPersonaIds.has(id)) continue;
    customPersonaIds.add(id);
    customPersonas.push({ id, title, description, createdAt });
  }
  const requestedActivePersonaId = typeof persona.activeCustomPersonaId === "string" ? persona.activeCustomPersonaId : null;
  const activeCustomPersonaId = requestedActivePersonaId && customPersonaIds.has(requestedActivePersonaId)
    ? requestedActivePersonaId
    : null;
  return {
    version: 3,
    onboardingComplete: bool(raw.onboardingComplete, d.onboardingComplete),
    renderer: {
      autoStart: bool(r.autoStart, d.renderer.autoStart),
      wakeWordEnabled: bool(r.wakeWordEnabled, d.renderer.wakeWordEnabled),
      wakePhrase: typeof r.wakePhrase === "string" && r.wakePhrase.trim() ? r.wakePhrase.trim().slice(0, 120) : d.renderer.wakePhrase,
      micDeviceId: typeof r.micDeviceId === "string" ? r.micDeviceId.slice(0, 256) : d.renderer.micDeviceId,
      sensitivity: clamp(r.sensitivity, 0, 100, d.renderer.sensitivity),
      ttsVoice: typeof r.ttsVoice === "string" ? r.ttsVoice.slice(0, 256) : d.renderer.ttsVoice,
      speechRate: clamp(r.speechRate, 0.5, 2, d.renderer.speechRate),
      speechPitch: clamp(r.speechPitch, 0.5, 2, d.renderer.speechPitch),
      speechVolume: clamp(r.speechVolume, 0, 1, d.renderer.speechVolume),
      networkAccessEnabled: bool(r.networkAccessEnabled, d.renderer.networkAccessEnabled),
      animations: bool(r.animations, d.renderer.animations),
      characterShine: clamp(r.characterShine, 0, 100, d.renderer.characterShine),
      uiViewMode: oneOf(r.uiViewMode, ["windowed", "companion"] as const, d.renderer.uiViewMode),
    },
    behavior: {
      proactivity: oneOf(b.proactivity, ["quiet", "balanced", "lively"] as const, d.behavior.proactivity),
      awayCheckin: bool(b.awayCheckin, d.behavior.awayCheckin),
      returnGreeting: bool(b.returnGreeting, d.behavior.returnGreeting),
      awayAfterMin: clamp(b.awayAfterMin, 2, 60, d.behavior.awayAfterMin),
      dndManual: bool(b.dndManual, d.behavior.dndManual),
      autoDndFullscreen: bool(b.autoDndFullscreen, d.behavior.autoDndFullscreen),
      autoDndMeetings: bool(b.autoDndMeetings, d.behavior.autoDndMeetings),
      autoDndRecording: bool(b.autoDndRecording, d.behavior.autoDndRecording),
      focusMode: bool(b.focusMode, d.behavior.focusMode ?? false),
      focusModeDurationMin: typeof b.focusModeDurationMin === "number" ? clamp(b.focusModeDurationMin, 1, 480, 25) : null,
      proactiveCompanionEnabled: bool(b.proactiveCompanionEnabled, d.behavior.proactiveCompanionEnabled ?? true),
    },
    wellness: {
      enabled: bool(wellness.enabled, d.wellness.enabled),
      intervalMinutes: [30, 45, 60].includes(Number(wellness.intervalMinutes))
        ? Number(wellness.intervalMinutes) as AppSettings["wellness"]["intervalMinutes"]
        : d.wellness.intervalMinutes,
      voiceAlerts: bool(wellness.voiceAlerts, d.wellness.voiceAlerts),
      breakMessage: typeof wellness.breakMessage === "string" ? wellness.breakMessage.trim().slice(0, 240) : d.wellness.breakMessage,
      waterMessage: typeof wellness.waterMessage === "string" ? wellness.waterMessage.trim().slice(0, 240) : d.wellness.waterMessage,
      eyeRestMessage: typeof wellness.eyeRestMessage === "string" ? wellness.eyeRestMessage.trim().slice(0, 240) : d.wellness.eyeRestMessage,
    },
    autonomy: {
      maxSteps: clamp(a.maxSteps, 5, 80, d.autonomy.maxSteps),
      conflictWaitSec: clamp(a.conflictWaitSec, 1, 30, d.autonomy.conflictWaitSec),
      emergencyShortcut: typeof a.emergencyShortcut === "string" && /^[A-Za-z0-9+]{3,40}$/.test(a.emergencyShortcut) ? a.emergencyShortcut : d.autonomy.emergencyShortcut,
      showTaskHud: bool(a.showTaskHud, d.autonomy.showTaskHud),
    },
    voice: {
      voiceName: typeof v.voiceName === "string" && /^[A-Za-z0-9_-]{2,64}$/.test(v.voiceName) ? v.voiceName : d.voice.voiceName,
      ttsProvider: oneOf(v.ttsProvider, ["gemini", "mark_lv_jarvis", "edge_tts", "web_speech"] as const, d.voice.ttsProvider),
      style: oneOf(v.style, ["natural", "anime"] as const, d.voice.style),
      pitch: clamp(v.pitch, 0, 5, d.voice.pitch),
      bargeIn: bool(v.bargeIn, d.voice.bargeIn),
      speakTaskUpdates: oneOf(v.speakTaskUpdates, ["all", "important", "none"] as const, d.voice.speakTaskUpdates),
      showSubtitles: bool(v.showSubtitles, d.voice.showSubtitles),
    },
    persona: {
      preset: oneOf(persona.preset, ["friendly_caring", "fun_witty", "naughty_teasing", "professional_assistant"] as const, d.persona.preset),
      relationshipRole: oneOf(persona.relationshipRole, ["close_friend", "companion_waifu", "custom_role"] as const, d.persona.relationshipRole),
      customRole: typeof persona.customRole === "string" ? persona.customRole.trim().slice(0, 120) : d.persona.customRole,
      mood: oneOf(persona.mood, ["balanced", "cheerful", "calm", "encouraging", "focused"] as const, d.persona.mood),
      customPrompt: typeof persona.customPrompt === "string" ? persona.customPrompt.slice(0, 2000) : d.persona.customPrompt,
      customPersonas,
      activeCustomPersonaId,
    },
    companion: {
      enabled: bool(c.enabled, d.companion.enabled),
      setupComplete: bool(c.setupComplete, d.companion.setupComplete),
      scale: clamp(c.scale, 0.4, 2.5, d.companion.scale),
      monitorId: typeof c.monitorId === "string" ? c.monitorId : c.monitorId === null ? null : d.companion.monitorId,
      position: c.position && Number.isFinite(c.position.x) && Number.isFinite(c.position.y) ? { x: Math.round(c.position.x), y: Math.round(c.position.y) } : c.position === null ? null : d.companion.position,
      anchor: c.anchor && typeof c.anchor === "object" && ["free", "desktop", "taskbar", "window"].includes(c.anchor.kind)
        ? {
            kind: c.anchor.kind,
            edge: oneOf(c.anchor.edge, ["top", "bottom", "left", "right"] as const, "top"),
            offset: clamp(c.anchor.offset, 0, 1, 0.5),
            ...(typeof c.anchor.windowTitle === "string" ? { windowTitle: c.anchor.windowTitle.slice(0, 200) } : {}),
          }
        : c.anchor === null ? null : d.companion.anchor,
      fullscreenBehavior: oneOf(c.fullscreenBehavior, ["hide", "notifications_only", "always", "game_aware"] as const, d.companion.fullscreenBehavior),
      clickThrough: bool(c.clickThrough, d.companion.clickThrough),
      interactionLevel: oneOf(c.interactionLevel, ["minimal", "normal", "playful"] as const, d.companion.interactionLevel),
      walkAround: bool(c.walkAround, d.companion.walkAround),
      iconPlay: bool(c.iconPlay, d.companion.iconPlay),
      standOut: clamp(c.standOut, 0, 1, d.companion.standOut),
      hideAndPeek: bool(c.hideAndPeek, d.companion.hideAndPeek),
      cursorReactions: bool(c.cursorReactions, d.companion.cursorReactions),
      danceOnAudio: bool(c.danceOnAudio, d.companion.danceOnAudio),
      mangaBubbles: bool(c.mangaBubbles, d.companion.mangaBubbles),
    },
    character: {
      activeCharacterId: typeof ch.activeCharacterId === "string" && /^[a-z0-9_-]{1,64}$/.test(ch.activeCharacterId) ? ch.activeCharacterId : d.character.activeCharacterId,
      eyeFollowCursor: bool(ch.eyeFollowCursor, d.character.eyeFollowCursor),
      headFollowCursor: bool(ch.headFollowCursor, d.character.headFollowCursor),
      idleVariety: clamp(ch.idleVariety, 0, 1, d.character.idleVariety),
    },
    graphics: {
      realism: clamp(gr.realism, 0, 1, d.graphics.realism),
      quality: oneOf(gr.quality, ["auto", "potato", "low", "balanced", "high"] as const, d.graphics.quality),
      autoStep: Math.round(clamp(gr.autoStep, 0, 3, d.graphics.autoStep)),
    },
    physics: {
      enabled: bool(p.enabled, d.physics.enabled),
      quality: oneOf(p.quality, ["low", "balanced", "high"] as const, d.physics.quality),
      secondaryMotion: clamp(p.secondaryMotion, 0, 100, d.physics.secondaryMotion),
      gravityMultiplier: clamp(p.gravityMultiplier, 0, 3, d.physics.gravityMultiplier),
      stiffness: clamp(p.stiffness, 0.2, 3, d.physics.stiffness),
      damping: clamp(p.damping, 0.2, 3, d.physics.damping),
      drag: clamp(p.drag, 0.2, 3, d.physics.drag),
      collisionQuality: oneOf(p.collisionQuality, ["off", "low", "high"] as const, d.physics.collisionQuality),
      wind: clamp(p.wind, 0, 1, d.physics.wind),
      clothEnabled: bool(p.clothEnabled, d.physics.clothEnabled),
      clothLooseness: clamp(p.clothLooseness, 0, 2, d.physics.clothLooseness),
    },
    performance: {
      activeFps: clamp(pe.activeFps, 24, 144, d.performance.activeFps),
      idleFps: clamp(pe.idleFps, 10, 60, d.performance.idleFps),
      sleepFps: clamp(pe.sleepFps, 2, 30, d.performance.sleepFps),
      perceptionPollSec: clamp(pe.perceptionPollSec, 2, 30, d.performance.perceptionPollSec),
    },
    systemMonitor: {
      enabled: bool(sm.enabled, d.systemMonitor.enabled),
      updateIntervalSeconds: sm.updateIntervalSeconds === 1 || sm.updateIntervalSeconds === 3 || sm.updateIntervalSeconds === 5
        ? sm.updateIntervalSeconds
        : d.systemMonitor.updateIntervalSeconds,
      corner: oneOf(sm.corner, ["top-left", "top-right", "bottom-left", "bottom-right"] as const, d.systemMonitor.corner),
    },
    developer: {
      debugView: bool(dev.debugView, d.developer.debugView),
      physicsDebug: bool(dev.physicsDebug, d.developer.physicsDebug),
      verboseLogs: bool(dev.verboseLogs, d.developer.verboseLogs),
      showErrorConsole: bool(dev.showErrorConsole, d.developer.showErrorConsole),
    },
    gestures: {
      enabled: bool(gest.enabled, d.gestures.enabled),
      mode: oneOf(gest.mode, ["air_mouse", "hud_control", "presentation"] as const, d.gestures.mode),
      sensitivity: clamp(gest.sensitivity, 0.1, 3.0, d.gestures.sensitivity),
      cameraIndex: Math.round(clamp(gest.cameraIndex, 0, 8, d.gestures.cameraIndex)),
      smoothFactor: clamp(gest.smoothFactor, 0.1, 0.95, d.gestures.smoothFactor),
      feedbackAudio: bool(gest.feedbackAudio, d.gestures.feedbackAudio),
      visualLandmarks: bool(gest.visualLandmarks, d.gestures.visualLandmarks),
    },
    hud: {
      visualMode: oneOf(hud.visualMode, ["character", "hologram_face", "orb"] as const, (m3d.activeModel === "hologram_core" ? "orb" : d.hud.visualMode ?? "character")),
      theme: oneOf(hud.theme, ["mark_lv_neon", "iron_man_gold", "cyber_cyan", "stealth_dark"] as const, d.hud.theme),
      soundEffects: bool(hud.soundEffects, d.hud.soundEffects),
      scanlines: bool(hud.scanlines, d.hud.scanlines),
      particleField: bool(hud.particleField, d.hud.particleField),
      diagnosticGauges: bool(hud.diagnosticGauges, d.hud.diagnosticGauges),
      ringOpacity: clamp(hud.ringOpacity, 0, 1, d.hud.ringOpacity),
      showSubtitles: bool(hud.showSubtitles, d.hud.showSubtitles),
    },
    codeEditor: {
      enabled: bool(ce.enabled, d.codeEditor.enabled),
      theme: oneOf(ce.theme, ["vs-dark", "hc-black", "cyber-punk"] as const, d.codeEditor.theme),
      fontSize: clamp(ce.fontSize, 10, 24, d.codeEditor.fontSize),
      autoComplete: bool(ce.autoComplete, d.codeEditor.autoComplete),
      aiAssistance: bool(ce.aiAssistance, d.codeEditor.aiAssistance),
      defaultWorkspace: typeof ce.defaultWorkspace === "string" ? ce.defaultWorkspace : d.codeEditor.defaultWorkspace,
    },
    models3d: {
      activeModel: oneOf(m3d.activeModel, ["jayra_prime", "evelyn", "hologram_core", "custom"] as const, d.models3d.activeModel),
      customModelPath: typeof m3d.customModelPath === "string" ? m3d.customModelPath : d.models3d.customModelPath,
      wireframeMode: bool(m3d.wireframeMode, d.models3d.wireframeMode),
      hologramGlitch: bool(m3d.hologramGlitch, d.models3d.hologramGlitch),
      rotationSpeed: clamp(m3d.rotationSpeed, 0, 3.0, d.models3d.rotationSpeed),
    },
    localization: {
      language: oneOf(loc.language, ["en", "roman_urdu", "roman_hindi", "custom_script"] as const, d.localization?.language ?? "en"),
      customPrompt: typeof loc.customPrompt === "string" ? loc.customPrompt.slice(0, 1000) : (d.localization?.customPrompt ?? ""),
      scriptStyle: oneOf(loc.scriptStyle, ["latin", "native", "mixed"] as const, d.localization?.scriptStyle ?? "latin"),
      summaryLanguage: oneOf(loc.summaryLanguage, ["en", "roman_urdu", "roman_hindi", "multilingual"] as const, d.localization?.summaryLanguage ?? "multilingual"),
      dailyBoardSync: bool(loc.dailyBoardSync, d.localization?.dailyBoardSync ?? true),
    },
    orbVisualizer: {
      quality: oneOf(orb.quality, ["high", "balanced", "low"] as const, d.orbVisualizer?.quality ?? "high"),
      particleDensity: oneOf(orb.particleDensity, ["high", "balanced", "low"] as const, d.orbVisualizer?.particleDensity ?? "balanced"),
      bloomEffect: bool(orb.bloomEffect, d.orbVisualizer?.bloomEffect ?? true),
      spinSpeed: clamp(orb.spinSpeed, 0.2, 3.0, d.orbVisualizer?.spinSpeed ?? 1.0),
      floorReflection: bool(orb.floorReflection, d.orbVisualizer?.floorReflection ?? true),
      style: oneOf(orb.style, ["jarvis_classic", "reactive_pulse", "quantum_matrix", "minimal"] as const, d.orbVisualizer?.style ?? "jarvis_classic"),
    },
    weatherNews: {
      city: typeof wn.city === "string" ? wn.city.trim().slice(0, 100) : (d.weatherNews?.city ?? ""),
      country: typeof wn.country === "string" ? wn.country.trim().slice(0, 100) : (d.weatherNews?.country ?? ""),
      countryCode: typeof wn.countryCode === "string" && /^[a-z]{2}$/i.test(wn.countryCode.trim())
        ? wn.countryCode.trim().toUpperCase()
        : (d.weatherNews?.countryCode ?? ""),
      latitude: typeof wn.latitude === "number" && Number.isFinite(wn.latitude) && wn.latitude >= -90 && wn.latitude <= 90 ? wn.latitude : (d.weatherNews?.latitude ?? 0),
      longitude: typeof wn.longitude === "number" && Number.isFinite(wn.longitude) && wn.longitude >= -180 && wn.longitude <= 180 ? wn.longitude : (d.weatherNews?.longitude ?? 0),
      temperatureUnit: oneOf(wn.temperatureUnit, ["celsius", "fahrenheit"] as const, d.weatherNews?.temperatureUnit ?? "celsius"),
      newsCategory: oneOf(wn.newsCategory, ["general", "technology", "science", "business"] as const, d.weatherNews?.newsCategory ?? "general"),
      autoRefreshMinutes: clamp(wn.autoRefreshMinutes, 5, 120, d.weatherNews?.autoRefreshMinutes ?? 30),
      customOpenWeatherKey: typeof wn.customOpenWeatherKey === "string" ? wn.customOpenWeatherKey.trim().slice(0, 128) : "",
      customNewsApiKey: typeof wn.customNewsApiKey === "string" ? wn.customNewsApiKey.trim().slice(0, 128) : "",
    },
  };
}

/** Deep merge of a partial patch onto current settings, then validation. */
export function patchSettings(current: AppSettings, patch: unknown): AppSettings {
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(source || {})) {
      out[key] = value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object"
        ? merge(target[key] as Record<string, unknown>, value as Record<string, unknown>)
        : value;
    }
    return out;
  };
  return normalizeSettings(merge(current as unknown as Record<string, unknown>, (patch || {}) as Record<string, unknown>), current);
}

export class AppSettingsStore {
  private settings: AppSettings = structuredClone(DEFAULT_APP_SETTINGS);
  private readonly file: string;
  private readonly listeners = new Set<(settings: AppSettings, previous: AppSettings) => void>();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "app-settings.v3.json");
  }

  async initialize(legacy: Record<string, unknown> = {}): Promise<AppSettings> {
    const stored = await readJsonFile<unknown>(this.file, null);
    if (stored) {
      const persisted = stored as Record<string, unknown>;
      const storedRenderer = persisted.renderer && typeof persisted.renderer === "object"
        ? persisted.renderer as Record<string, unknown>
        : {};
      const storedVoice = persisted.voice && typeof persisted.voice === "object"
        ? persisted.voice as Record<string, unknown>
        : {};
      this.settings = normalizeSettings({
        ...persisted,
        renderer: { ...legacy, ...storedRenderer },
        voice: {
          ...(typeof legacy.ttsProvider === "string" ? { ttsProvider: legacy.ttsProvider } : {}),
          ...storedVoice,
        },
      });
    } else {
      // First run of this version: users of the previous release have already
      // been through first-use, so only the new areas get defaults.
      this.settings = normalizeSettings({
        onboardingComplete: false,
        renderer: legacy,
        voice: typeof legacy.ttsProvider === "string" ? { ttsProvider: legacy.ttsProvider } : {},
      });
      if (legacy.autoStart !== undefined || legacy.wakeWordEnabled !== undefined) this.settings.onboardingComplete = false;
      await writeJsonFile(this.file, this.settings);
    }
    return this.get();
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  async update(patch: unknown): Promise<AppSettings> {
    const previous = this.settings;
    const next = patchSettings(previous, patch);
    await writeJsonFile(this.file, next);
    this.settings = next;
    for (const listener of this.listeners) listener(this.get(), previous);
    return this.get();
  }

  onChange(listener: (settings: AppSettings, previous: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
