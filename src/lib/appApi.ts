/**
 * Typed client for the runtime REST API (runtime/myraaRuntime.ts) and the
 * `/events` WebSocket. Everything here is renderer-safe: the backend never
 * returns secrets, and nothing in this file sends or stores one except
 * `saveProviderKey`, which posts the key once and keeps no copy.
 */
import type { PhoneRemoteCommand } from "../../mobile/phoneBridge";
import { reportDiagnostic } from "./diagnostics";

// ---- tasks ------------------------------------------------------------------------------

export type TaskState =
  | "queued" | "planning" | "running" | "paused" | "waiting_user" | "waiting_confirmation"
  | "user_takeover" | "recovering" | "completed" | "failed" | "cancelled" | "interrupted";

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(["completed", "failed", "cancelled", "interrupted"]);

export interface TaskActionView {
  id: string;
  step: number;
  at: string;
  tool: string;
  summary: string;
  status: "ok" | "failed" | "denied" | "cancelled" | "skipped";
  durationMs: number;
  error?: string;
  verified: boolean | null;
}

export interface Utility {
  id: string;
  kind: "alarm" | "reminder" | "timer";
  label: string;
  dueAt: number;
  repeat: "none" | "daily" | "weekdays";
  createdAt: number;
  firedAt: number | null;
  status: "scheduled" | "ringing" | "done" | "missed" | "cancelled";
}

export interface CustomAutomationAction {
  id: string;
  name: string;
  trigger: string;
  scriptPath: string;
  runAsAdministrator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskView {
  id: string;
  goal: string;
  state: TaskState;
  origin: string;
  modelId: string | null;
  currentStatus: string;
  plan: { summary: string; steps: Array<{ text: string; status: "pending" | "active" | "done" | "skipped" }> } | null;
  actions: TaskActionView[];
  files: Array<{ path: string; change: string; at: string }>;
  pendingQuestion: { id: string; text: string; options?: string[]; askedAt: string } | null;
  pendingConfirmation: { id: string; capability: string; description: string; askedAt: string } | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  result?: string | null;
  error?: string | null;
  steps?: number;
  sensitive?: boolean;
}

export type TaskAction = "stop" | "pause" | "resume" | "takeover" | "return" | "answer" | "continue";

// ---- confirmations & permissions --------------------------------------------------------

export interface ConfirmationRequest {
  id: string;
  taskId: string | null;
  capability: string;
  title: string;
  description: string;
  details: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  allowRemember: boolean;
}

export type Decision = "allow" | "ask" | "deny";
export type MessageConfirmationMode = "always_confirm" | "confirm_new_recipients" | "trusted_without_confirmation" | "never_without_preview";

export interface PermissionsView {
  policy: {
    capabilities: Record<string, { decision: Decision }>;
    messageConfirmation: MessageConfirmationMode;
  };
  info: Record<string, { label: string; description: string; risk: "low" | "medium" | "high" }>;
}

/** Mirrors permissions/types.ts LOCKED_TO_ASK: these never go below "ask". */
export const LOCKED_CAPABILITIES: ReadonlySet<string> = new Set(["EXECUTE_DOWNLOAD", "INSTALL_SOFTWARE", "PURCHASE", "ACCOUNT_CHANGE", "POWER_CONTROL"]);

// ---- models -----------------------------------------------------------------------------

export type ModelAvailability = "available" | "unverified" | "unavailable" | "not_configured" | "disabled";

export interface ModelView {
  id: string;
  displayName: string;
  provider: string;
  providerName: string;
  locality: "local" | "cloud";
  tier: "fast" | "balanced" | "deep";
  capabilities: { vision: boolean; tools: boolean; reasoning: boolean; liveAudio: boolean; structuredOutput: boolean; streaming: boolean; embedding: boolean };
  contextLength: number;
  description: string;
  availability: ModelAvailability;
}

export interface ModelSelection {
  brain: string;
  live: string;
  background: string;
  fallbackAllowed: boolean;
  offlineLocalFallback: boolean;
}

export interface ModelCatalogue {
  selection: ModelSelection;
  providers: Array<{ id: string; displayName: string; locality: string; enabled: boolean; configured: boolean; verificationError: string | null }>;
  models: ModelView[];
  usage?: { models: Record<string, { calls: number; failures: number; avgLatencyMs: number | null }> };
  health?: Record<string, { recentFailures: number; coolingDown: boolean }>;
  network?: string;
}

// ---- server-side settings (settings/appSettings.ts) -------------------------------------

export interface AppSettings {
  version: 3;
  onboardingComplete: boolean;
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
  autonomy: { maxSteps: number; conflictWaitSec: number; emergencyShortcut: string; showTaskHud: boolean };
  voice: { voiceName: string; ttsProvider?: "gemini" | "mark_lv_jarvis" | "edge_tts" | "web_speech"; style: "natural" | "anime"; pitch: number; bargeIn: boolean; speakTaskUpdates: "all" | "important" | "none"; showSubtitles?: boolean };
  persona: {
    preset: "friendly_caring" | "fun_witty" | "naughty_teasing" | "professional_assistant";
    relationshipRole: "close_friend" | "companion_waifu" | "custom_role";
    customRole: string;
    mood: "balanced" | "cheerful" | "calm" | "encouraging" | "focused";
    customPrompt: string;
    customPersonas: Array<{ id: string; title: string; description: string; createdAt: string }>;
    activeCustomPersonaId: string | null;
  };
  companion: {
    enabled: boolean;
    setupComplete: boolean;
    scale: number;
    fullscreenBehavior: "hide" | "notifications_only" | "always" | "game_aware";
    clickThrough: boolean;
    interactionLevel: "minimal" | "normal" | "playful";
    walkAround: boolean;
    iconPlay: boolean;
    standOut: number;
    hideAndPeek: boolean;
    cursorReactions: boolean;
    danceOnAudio: boolean;
    mangaBubbles: boolean;
    [key: string]: unknown;
  };
  character: { activeCharacterId: string; eyeFollowCursor: boolean; headFollowCursor: boolean; idleVariety: number };
  graphics: { realism: number; quality: "auto" | "potato" | "low" | "balanced" | "high"; autoStep: number };
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
    clothEnabled: boolean;
    clothLooseness: number;
  };
  performance: { activeFps: number; idleFps: number; sleepFps: number; perceptionPollSec: number };
  systemMonitor: {
    enabled: boolean;
    updateIntervalSeconds: 1 | 3 | 5;
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  };
  developer: { debugView: boolean; physicsDebug: boolean; verboseLogs: boolean; showErrorConsole: boolean };
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
    visualMode?: "character" | "hologram_face" | "orb";
    theme: "mark_lv_neon" | "iron_man_gold" | "cyber_cyan" | "stealth_dark";
    soundEffects: boolean;
    scanlines: boolean;
    particleField: boolean;
    diagnosticGauges: boolean;
    ringOpacity: number;
    showSubtitles?: boolean;
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
  orbVisualizer?: {
    quality: "high" | "balanced" | "low";
    particleDensity: "high" | "balanced" | "low";
    bloomEffect: boolean;
    spinSpeed: number;
    floorReflection: boolean;
    style: "jarvis_classic" | "reactive_pulse" | "quantum_matrix" | "minimal";
  };
  weatherNews?: {
    city: string;
    country: string;
    countryCode?: string;
    latitude: number;
    longitude: number;
    temperatureUnit: "celsius" | "fahrenheit";
    newsCategory: "general" | "technology" | "science" | "business";
    autoRefreshMinutes: number;
    customOpenWeatherKey?: string;
    customNewsApiKey?: string;
  };
}

/** Deep-partial patch accepted by POST /api/app-settings. */
export type AppSettingsPatch = { [K in keyof AppSettings]?: AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K] };

// ---- characters -------------------------------------------------------------------------

export interface CharacterSummary {
  id: string;
  displayName: string;
  builtIn?: boolean;
  [key: string]: unknown;
}

// ---- fetch helpers ----------------------------------------------------------------------

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("JAYRA backend returned an invalid response.");
    }
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error || `Request failed (${res.status}).`);
    return data as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportDiagnostic("API request failed", `${method} request failed: ${message}`);
    throw error;
  }
}


export interface KeyDetailView {
  masked: string;
  healthy: boolean;
  failureCount: number;
  successCount: number;
  cooldownRemainingSeconds: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface ProviderKeyPoolDetails {
  provider: string;
  total: number;
  healthy: number;
  coolingDown: number;
  keys: KeyDetailView[];
}

export interface DiscoveredModelInfo {
  id: string;
  name: string;
  contextLength?: number;
}

export interface DiscoveredModelsResult {
  ok: boolean;
  provider: string;
  providerName: string;
  apiType: string;
  baseUrl?: string;
  latencyMs: number;
  models: DiscoveredModelInfo[];
  error?: string;
}

export interface ProjectTimeBreakdown {
  project: string;
  durationMinutes: number;
  activitiesCount: number;
}

export interface DailySummaryFlashcard {
  cardId: string;
  date: string;
  title: string;
  totalActivities: number;
  focusMinutes: number;
  focusHours: number;
  productivityScore?: number;
  vibeBaseline?: string;
  projectBreakdown: ProjectTimeBreakdown[];
  topFiles: string[];
  keyReferences: Array<{ title?: string; url: string }>;
  recentQueries: string[];
  recommendedTodos: string[];
  sassySummary: {
    urdu: string;
    hinglish: string;
    english: string;
  };
  markdownCard: string;
  generatedAt: number;
}

export interface KnowledgeGraphSummaryResponse {
  success: boolean;
  flashcard: DailySummaryFlashcard | null;
  vibeState?: string;
  tasksSummary?: {
    total: number;
    completed: number;
    pending: number;
  };
}

export const api = {
  tasks: (limit = 20) => request<TaskView[]>("GET", `/api/tasks?limit=${limit}`),
  recoverableTasks: () => request<TaskView[]>("GET", "/api/tasks/recoverable"),
  startTask: (goal: string) => request<TaskView>("POST", "/api/tasks", { goal, origin: "text" }),
  taskAction: (id: string, action: TaskAction, text?: string) => request<unknown>("POST", `/api/tasks/${encodeURIComponent(id)}/${action}`, text === undefined ? {} : { text }),
  emergencyStop: () => request<{ stopped: number }>("POST", "/api/autonomy/stop", { reason: "stop_button" }),

  confirmations: () => request<ConfirmationRequest[]>("GET", "/api/confirmations"),
  resolveConfirmation: (id: string, approved: boolean, remember: "once" | "session" = "once") =>
    id.startsWith("cognition:")
      ? request<{ ok: boolean }>("POST", "/api/cognition/confirm", { confirmationId: id.slice("cognition:".length), approved })
      : request<{ ok: boolean }>("POST", `/api/confirmations/${encodeURIComponent(id)}`, { approved, remember }),

  permissions: () => request<PermissionsView>("GET", "/api/permissions"),
  setPermission: (capability: string, decision: Decision) => request<unknown>("POST", `/api/permissions/${encodeURIComponent(capability)}`, { decision }),
  setMessageConfirmation: (mode: MessageConfirmationMode) => request<unknown>("POST", "/api/permissions/messaging", { mode }),

  models: () => request<ModelCatalogue>("GET", "/api/models"),
  selectModels: (patch: Partial<ModelSelection>) => request<ModelSelection>("POST", "/api/models/select", patch),
  switchModelProvider: (providerId: string, modelId?: string) =>
    request<{ providerId: string; modelId: string; selection: ModelSelection }>(
      "POST", "/api/models/switch-provider", { providerId, ...(modelId ? { modelId } : {}) },
    ),
  testModel: (modelId: string) => request<{ ok?: boolean; latencyMs?: number; error?: string; [key: string]: unknown }>("POST", "/api/models/test", { modelId }),
  refreshModels: () => request<ModelCatalogue>("POST", "/api/models/refresh"),
    saveProviderKey: (providerId: string, apiKey: string) => request<{ ok: boolean }>("POST", `/api/providers/${encodeURIComponent(providerId)}/key`, { apiKey }),
  keyPoolStatus: (provider: string) =>
    request<ProviderKeyPoolDetails>("GET", `/api/keys/${encodeURIComponent(provider)}/status`),
  addKeyToPool: (provider: string, key: string) =>
    request<{ ok: boolean; added?: number; details?: ProviderKeyPoolDetails }>("POST", `/api/keys/${encodeURIComponent(provider)}`, { key }),
  removeKeyFromPool: (provider: string, keyOrMask: string) =>
    request<{ ok: boolean; details?: ProviderKeyPoolDetails }>("DELETE", `/api/keys/${encodeURIComponent(provider)}/${encodeURIComponent(keyOrMask)}`),
  testKeyInPool: (provider: string, key: string) =>
    request<{ ok: boolean; latencyMs?: number; error?: string }>("POST", `/api/keys/${encodeURIComponent(provider)}/test`, { key }),
  allKeyPools: () =>
    request<{ providers: Record<string, ProviderKeyPoolDetails> }>("GET", "/api/keys/all"),
  discoverModels: (params: { apiKey?: string; baseUrl?: string; provider?: string }) =>
    request<DiscoveredModelsResult>("POST", "/api/keys/discover", params),
  registerDiscovered: (params: { apiKey?: string; baseUrl?: string; provider?: string; providerName?: string; apiType?: string; models?: Array<{ id: string; name: string }> }) =>
    request<{ ok: boolean; provider: string; registeredCount: number; details: ProviderKeyPoolDetails }>("POST", "/api/keys/register-discovered", params),

  appSettings: () => request<AppSettings>("GET", "/api/app-settings"),
  updateAppSettings: (patch: AppSettingsPatch) => request<AppSettings>("POST", "/api/app-settings", patch),
  createCustomPersona: (persona: { title: string; description: string }) => request<AppSettings>("POST", "/api/personas", persona),
  updateCustomPersona: (id: string, persona: { title: string; description: string }) =>
    request<AppSettings>("PUT", `/api/personas/${encodeURIComponent(id)}`, persona),
  deleteCustomPersona: (id: string) => request<AppSettings>("DELETE", `/api/personas/${encodeURIComponent(id)}`),
  suggestPersonaTitle: (description: string) =>
    request<{ title: string }>("POST", "/api/personas/suggest-title", { description }),
  setDnd: (active: boolean) => request<unknown>("POST", "/api/dnd", { active }),
  utilities: () => request<Utility[]>("GET", "/api/utilities"),
  addUtility: (utility: { kind: "reminder"; label: string; inSeconds: number }) => request<Utility>("POST", "/api/utilities", utility),
  cancelUtility: (id: string) => request<{ ok: boolean }>("DELETE", `/api/utilities/${encodeURIComponent(id)}`),
  automations: () => request<CustomAutomationAction[]>("GET", "/api/automations"),
  addAutomation: (action: Pick<CustomAutomationAction, "name" | "trigger" | "scriptPath" | "runAsAdministrator">) =>
    request<CustomAutomationAction>("POST", "/api/automations", action),
  updateAutomation: (id: string, action: Pick<CustomAutomationAction, "name" | "trigger" | "scriptPath" | "runAsAdministrator">) =>
    request<CustomAutomationAction>("PUT", `/api/automations/${encodeURIComponent(id)}`, action),
  deleteAutomation: (id: string) => request<{ ok: boolean }>("DELETE", `/api/automations/${encodeURIComponent(id)}`),
  runAutomation: (id: string) => request<{ name: string; stdout: string }>("POST", `/api/automations/${encodeURIComponent(id)}/run`),
  mobileBridgeStatus: () => request<{
    enabled: boolean;
    connected: boolean;
    devices: Array<{
      deviceId: string;
      name: string;
      platform: string;
      connectedAt: string;
      lastSeen: string;
      phoneStatus: {
        batteryPercent?: number;
        batteryCharging?: boolean;
        storageFreeBytes?: number;
        storageTotalBytes?: number;
        wifiState?: "connected" | "disconnected" | "unknown";
        wifiSsid?: string | null;
        sensors?: Record<string, boolean>;
      } | null;
      lastAccessibilityEvent: {
        event: "WINDOW_STATE_CHANGED" | "WINDOW_CONTENT_CHANGED" | "VIEW_CLICKED" | "VIEW_FOCUSED" | "TEXT_CHANGED" | "SCROLL" | "SERVICE_STATE_CHANGED";
        at: string;
        packageName?: string;
        className?: string;
        text?: string | null;
      } | null;
    }>;
  }>("GET", "/api/mobile/bridge-status"),
  mobileRemoteCommand: (command: PhoneRemoteCommand, deviceId?: string) =>
    request<{ success: boolean; deviceId: string; result?: unknown; error?: string }>(
      "POST", "/api/mobile/remote-command", { command, ...(deviceId ? { deviceId } : {}) },
    ),

  characters: () => request<CharacterSummary[]>("GET", "/api/characters"),

  getKnowledgeGraphSummary: (date?: string) =>
    request<KnowledgeGraphSummaryResponse>("GET", `/api/kg/summary${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  generateKnowledgeGraphSummary: (date?: string) =>
    request<KnowledgeGraphSummaryResponse>("POST", "/api/kg/generate", { date }),
  getKnowledgeGraphData: () =>
    request<{ success: boolean; nodesCount: number; edgesCount: number; activitiesCount: number; nodes: unknown[]; edges: unknown[] }>("GET", "/api/kg/graph"),
};

export const AVAILABILITY_LABEL: Record<ModelAvailability, string> = {
  available: "Available",
  unverified: "Not yet checked",
  unavailable: "Not available on this key",
  not_configured: "Needs an API key",
  disabled: "Disabled",
};
