import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SpatialProximityManager, type SpatialHandoffEvent, type ProximityTelemetry, type ProximityState } from "../runtime/spatialProximity";

export type PhoneAccessibilityActionType =
  | "CLICK"
  | "LONG_CLICK"
  | "SCROLL_FORWARD"
  | "SCROLL_BACKWARD"
  | "SET_TEXT"
  | "GLOBAL_BACK"
  | "GLOBAL_HOME"
  | "GLOBAL_RECENTS"
  | "GLOBAL_NOTIFICATIONS"
  | "GLOBAL_QUICK_SETTINGS";

export interface PhoneAccessibilityTarget {
  viewId?: string;
  text?: string;
  contentDescription?: string;
  className?: string;
  coordinates?: { x: number; y: number };
}

export type PhoneRemoteCommand =
  | { action: "TRIGGER_NOTIFICATION"; title: string; body: string; priority: "low" | "normal" | "high" }
  | {
      action: "LAUNCH_APP";
      appId?: string;
      packageName?: string;
      appName?: string;
      uri?: string;
      extras?: Record<string, string | number | boolean>;
    }
  | { action: "WHATSAPP_DRAFT"; phoneNumber: string; message: string }
  | { action: "MEDIA_CONTROL"; operation: "play" | "pause" | "toggle" | "next" | "previous" | "volume"; volume?: number }
  | { action: "QUERY_PHONE_STATUS" }
  | { action: "TRIGGER_RINGTONE_FINDER"; mode: "ring" | "vibrate"; durationSec: number }
  | { action: "OPEN_DEEP_LINK"; uri: string; package?: string }
  | { action: "PHONE_SEARCH_AND_PLAY"; app: string; query: string }
  | {
      action: "ACCESSIBILITY_ACTION";
      actionType: PhoneAccessibilityActionType;
      target?: PhoneAccessibilityTarget;
      text?: string;
    }
  | { action: "INSPECT_SCREEN_HIERARCHY"; maxDepth?: number }
  | { action: "LIST_INSTALLED_APPS" }
  | {
      action: "FILE_TRANSFER_START";
      transferId: string;
      filename: string;
      fileSize: number;
      mimeType?: string;
      direction: "phone_to_pc" | "pc_to_phone";
    }
  | {
      action: "FILE_TRANSFER_CHUNK";
      transferId: string;
      chunkIndex: number;
      totalChunks: number;
      dataBase64: string;
    }
  | {
      action: "FILE_TRANSFER_COMPLETE";
      transferId: string;
      success: boolean;
      savedPath?: string;
      error?: string;
    }
  | {
      action: "SET_AUDIO_ROUTING";
      mode: "DESKTOP_ONLY" | "PHONE_ONLY" | "BOTH";
    }
  | {
      action: "CLIPBOARD_SYNC";
      text: string;
      timestamp: number;
      source: "pc" | "phone";
    }
  | {
      action: "SESSION_HANDOVER";
      session: Record<string, unknown>;
    }
  | {
      action: "REQUEST_AUTHORIZATION";
      authId: string;
      riskLevel: "HIGH" | "CRITICAL";
      actionDescription: string;
      commandSnippet?: string;
      timeoutMs?: number;
    };

interface PhoneSocket {
  readyState: number;
  send(data: string): void;
}

interface PhoneStatus {
  batteryPercent?: number;
  batteryCharging?: boolean;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  wifiState?: "connected" | "disconnected" | "unknown";
  wifiSsid?: string | null;
  sensors?: Record<string, boolean>;
  foregroundApp?: string | null;
  screenOn?: boolean;
}

type PhoneAccessibilityEventName =
  | "WINDOW_STATE_CHANGED"
  | "WINDOW_CONTENT_CHANGED"
  | "VIEW_CLICKED"
  | "VIEW_FOCUSED"
  | "TEXT_CHANGED"
  | "SCROLL"
  | "SERVICE_STATE_CHANGED";

interface PhoneAccessibilityEvent {
  event: PhoneAccessibilityEventName;
  at: string;
  packageName?: string;
  className?: string;
  text?: string | null;
}

export interface InstalledAppInfo {
  name: string;
  packageName: string;
  isSystem?: boolean;
}

interface ConnectedPhone {
  socket: PhoneSocket;
  deviceId: string;
  name: string;
  platform: string;
  connectedAt: string;
  lastSeen: string;
  phoneStatus: PhoneStatus | null;
  lastAccessibilityEvent: PhoneAccessibilityEvent | null;
  installedApps: InstalledAppInfo[] | null;
  lastScreenHierarchy: unknown | null;
}

interface PendingResponse {
  deviceId: string;
  resolve: (result: { success: boolean; result?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function parsePhoneRemoteCommand(input: unknown): PhoneRemoteCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A phone command object is required.");
  const value = input as Record<string, unknown>;
  const action = value.action;

  if (action === "TRIGGER_NOTIFICATION") {
    if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 120) {
      throw new Error("Notification title must contain 1 to 120 characters.");
    }
    if (typeof value.body !== "string" || !value.body.trim() || value.body.trim().length > 1_000) {
      throw new Error("Notification body must contain 1 to 1000 characters.");
    }
    const priority = value.priority ?? "normal";
    if (priority !== "low" && priority !== "normal" && priority !== "high") {
      throw new Error("Notification priority must be low, normal, or high.");
    }
    return { action, title: value.title.trim(), body: value.body.trim(), priority };
  }

  if (action === "LAUNCH_APP") {
    const rawAppId = typeof value.appId === "string" ? value.appId.trim() : undefined;
    const rawPackage = typeof value.packageName === "string" ? value.packageName.trim() : undefined;
    const rawAppName = typeof value.appName === "string" ? value.appName.trim() : undefined;
    const rawUri = typeof value.uri === "string" ? value.uri.trim() : undefined;

    if (!rawAppId && !rawPackage && !rawAppName && !rawUri) {
      throw new Error("Either appId, packageName, appName, or uri is required to launch an app.");
    }

    let parsedExtras: Record<string, string | number | boolean> | undefined;
    if (value.extras && typeof value.extras === "object" && !Array.isArray(value.extras)) {
      parsedExtras = {};
      for (const [k, v] of Object.entries(value.extras as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          parsedExtras[k.slice(0, 80)] = v;
        }
      }
    }

    return {
      action: "LAUNCH_APP",
      ...(rawAppId ? { appId: rawAppId.slice(0, 120) } : {}),
      ...(rawPackage ? { packageName: rawPackage.slice(0, 150) } : {}),
      ...(rawAppName ? { appName: rawAppName.slice(0, 100) } : {}),
      ...(rawUri ? { uri: rawUri.slice(0, 1000) } : {}),
      ...(parsedExtras ? { extras: parsedExtras } : {}),
    };
  }

  if (action === "WHATSAPP_DRAFT") {
    if (typeof value.phoneNumber !== "string" || !/^\+[1-9]\d{7,14}$/.test(value.phoneNumber)) {
      throw new Error("WhatsApp draft phoneNumber must use E.164 format.");
    }
    if (typeof value.message !== "string" || !value.message.trim() || value.message.trim().length > 2_000) {
      throw new Error("WhatsApp draft message must contain 1 to 2000 characters.");
    }
    return { action, phoneNumber: value.phoneNumber, message: value.message.trim() };
  }

  if (action === "MEDIA_CONTROL") {
    const operation = value.operation;
    if (!["play", "pause", "toggle", "next", "previous", "volume"].includes(String(operation))) {
      throw new Error("Unsupported phone media operation.");
    }
    if (operation === "volume") {
      if (!Number.isInteger(value.volume) || Number(value.volume) < 0 || Number(value.volume) > 100) {
        throw new Error("Phone volume must be a whole number from 0 to 100.");
      }
      return { action, operation, volume: Number(value.volume) };
    }
    if (operation === "play" || operation === "pause" || operation === "toggle" || operation === "next" || operation === "previous") {
      return { action, operation };
    }
    throw new Error("Unsupported phone media operation.");
  }

  if (action === "QUERY_PHONE_STATUS") return { action };

  if (action === "TRIGGER_RINGTONE_FINDER") {
    const mode = value.mode ?? "ring";
    const durationSec = value.durationSec ?? 30;
    if (mode !== "ring" && mode !== "vibrate") throw new Error("Finder mode must be ring or vibrate.");
    if (!Number.isInteger(durationSec) || Number(durationSec) < 5 || Number(durationSec) > 60) {
      throw new Error("Finder duration must be a whole number from 5 to 60 seconds.");
    }
    return { action, mode, durationSec: Number(durationSec) };
  }

  if (action === "OPEN_DEEP_LINK") {
    if (typeof value.uri !== "string" || !value.uri.trim() || value.uri.trim().length > 1000) {
      throw new Error("Deep link URI must be between 1 and 1000 characters.");
    }
    const pkg = typeof value.package === "string" && value.package.trim() ? value.package.trim().slice(0, 150) : undefined;
    return { action: "OPEN_DEEP_LINK", uri: value.uri.trim(), ...(pkg ? { package: pkg } : {}) };
  }

  if (action === "PHONE_SEARCH_AND_PLAY") {
    if (typeof value.app !== "string" || !value.app.trim()) {
      throw new Error("Target app name (e.g. 'youtube', 'spotify') is required.");
    }
    if (typeof value.query !== "string" || !value.query.trim() || value.query.trim().length > 500) {
      throw new Error("Search query must contain 1 to 500 characters.");
    }
    return { action: "PHONE_SEARCH_AND_PLAY", app: value.app.trim().toLowerCase(), query: value.query.trim() };
  }

  if (action === "ACCESSIBILITY_ACTION") {
    const allowedActions: PhoneAccessibilityActionType[] = [
      "CLICK",
      "LONG_CLICK",
      "SCROLL_FORWARD",
      "SCROLL_BACKWARD",
      "SET_TEXT",
      "GLOBAL_BACK",
      "GLOBAL_HOME",
      "GLOBAL_RECENTS",
      "GLOBAL_NOTIFICATIONS",
      "GLOBAL_QUICK_SETTINGS",
    ];
    if (typeof value.actionType !== "string" || !allowedActions.includes(value.actionType as PhoneAccessibilityActionType)) {
      throw new Error(`Accessibility actionType must be one of: ${allowedActions.join(", ")}`);
    }
    let target: PhoneAccessibilityTarget | undefined;
    if (value.target && typeof value.target === "object" && !Array.isArray(value.target)) {
      const t = value.target as Record<string, unknown>;
      target = {
        ...(typeof t.viewId === "string" ? { viewId: t.viewId.slice(0, 200) } : {}),
        ...(typeof t.text === "string" ? { text: t.text.slice(0, 200) } : {}),
        ...(typeof t.contentDescription === "string" ? { contentDescription: t.contentDescription.slice(0, 200) } : {}),
        ...(typeof t.className === "string" ? { className: t.className.slice(0, 200) } : {}),
        ...(t.coordinates && typeof t.coordinates === "object" && Number.isFinite((t.coordinates as any).x) && Number.isFinite((t.coordinates as any).y)
          ? { coordinates: { x: Number((t.coordinates as any).x), y: Number((t.coordinates as any).y) } }
          : {}),
      };
    }
    const text = typeof value.text === "string" ? value.text.slice(0, 1000) : undefined;
    return {
      action: "ACCESSIBILITY_ACTION",
      actionType: value.actionType as PhoneAccessibilityActionType,
      ...(target ? { target } : {}),
      ...(text ? { text } : {}),
    };
  }

  if (action === "INSPECT_SCREEN_HIERARCHY") {
    const maxDepth = Number.isInteger(value.maxDepth) && Number(value.maxDepth) >= 1 && Number(value.maxDepth) <= 20
      ? Number(value.maxDepth)
      : 8;
    return { action: "INSPECT_SCREEN_HIERARCHY", maxDepth };
  }

  if (action === "LIST_INSTALLED_APPS") {
    return { action: "LIST_INSTALLED_APPS" };
  }

  if (action === "FILE_TRANSFER_START") {
    if (typeof value.transferId !== "string" || !value.transferId.trim()) throw new Error("transferId is required.");
    if (typeof value.filename !== "string" || !value.filename.trim()) throw new Error("filename is required.");
    if (!Number.isSafeInteger(value.fileSize) || Number(value.fileSize) < 0) throw new Error("fileSize must be a non-negative integer.");
    const direction = value.direction === "pc_to_phone" ? "pc_to_phone" : "phone_to_pc";
    return {
      action: "FILE_TRANSFER_START",
      transferId: value.transferId.trim().slice(0, 80),
      filename: path.basename(value.filename.trim()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200),
      fileSize: Number(value.fileSize),
      ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType.slice(0, 100) } : {}),
      direction,
    };
  }

  if (action === "FILE_TRANSFER_CHUNK") {
    if (typeof value.transferId !== "string" || !value.transferId.trim()) throw new Error("transferId is required.");
    if (!Number.isInteger(value.chunkIndex) || Number(value.chunkIndex) < 0) throw new Error("chunkIndex must be >= 0.");
    if (!Number.isInteger(value.totalChunks) || Number(value.totalChunks) < 1) throw new Error("totalChunks must be >= 1.");
    if (typeof value.dataBase64 !== "string") throw new Error("dataBase64 is required.");
    return {
      action: "FILE_TRANSFER_CHUNK",
      transferId: value.transferId.trim().slice(0, 80),
      chunkIndex: Number(value.chunkIndex),
      totalChunks: Number(value.totalChunks),
      dataBase64: value.dataBase64,
    };
  }

  if (action === "FILE_TRANSFER_COMPLETE") {
    if (typeof value.transferId !== "string" || !value.transferId.trim()) throw new Error("transferId is required.");
    return {
      action: "FILE_TRANSFER_COMPLETE",
      transferId: value.transferId.trim().slice(0, 80),
      success: value.success === true,
      ...(typeof value.savedPath === "string" ? { savedPath: value.savedPath.slice(0, 500) } : {}),
      ...(typeof value.error === "string" ? { error: value.error.slice(0, 500) } : {}),
    };
  }

  if (action === "SET_AUDIO_ROUTING") {
    const mode = value.mode;
    if (mode !== "DESKTOP_ONLY" && mode !== "PHONE_ONLY" && mode !== "BOTH") {
      throw new Error("Audio routing mode must be DESKTOP_ONLY, PHONE_ONLY, or BOTH.");
    }
    return { action: "SET_AUDIO_ROUTING", mode };
  }

  if (action === "CLIPBOARD_SYNC") {
    if (typeof value.text !== "string") throw new Error("Clipboard text must be a string.");
    const source = value.source === "phone" ? "phone" : "pc";
    const timestamp = typeof value.timestamp === "number" && Number.isFinite(value.timestamp) ? value.timestamp : Date.now();
    return {
      action: "CLIPBOARD_SYNC",
      text: value.text.slice(0, 100_000),
      timestamp,
      source,
    };
  }

  if (action === "SESSION_HANDOVER") {
    if (!value.session || typeof value.session !== "object" || Array.isArray(value.session)) {
      throw new Error("Session payload object is required.");
    }
    return {
      action: "SESSION_HANDOVER",
      session: value.session as Record<string, unknown>,
    };
  }

  if (action === "REQUEST_AUTHORIZATION") {
    if (typeof value.actionDescription !== "string" || !value.actionDescription.trim()) {
      throw new Error("actionDescription is required for authorization request.");
    }
    const authId = typeof value.authId === "string" && value.authId.trim() ? value.authId.trim() : randomUUID();
    const riskLevel = value.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH";
    const timeoutMs = Number.isInteger(value.timeoutMs) ? Math.min(Math.max(Number(value.timeoutMs), 5_000), 120_000) : 30_000;
    return {
      action: "REQUEST_AUTHORIZATION",
      authId,
      riskLevel,
      actionDescription: value.actionDescription.trim().slice(0, 500),
      ...(typeof value.commandSnippet === "string" ? { commandSnippet: value.commandSnippet.slice(0, 1000) } : {}),
      timeoutMs,
    };
  }

  throw new Error("Unsupported phone command.");
}

export class PhoneBridgeManager {
  private readonly clients = new Map<string, ConnectedPhone>();
  private readonly pending = new Map<string, PendingResponse>();
  public readonly spatialProximity = new SpatialProximityManager();
  private audioRoutingMode: "DESKTOP_ONLY" | "PHONE_ONLY" | "BOTH" = "DESKTOP_ONLY";
  private sharedClipboard: { text: string; timestamp: number; source: "pc" | "phone" } | null = null;
  private lastSessionHandover: Record<string, unknown> | null = null;
  private onClipboardChangeCallback?: (clip: { text: string; timestamp: number; source: "pc" | "phone" }) => void;
  private onMicAudioFrameCallback?: (audioBase64: string, sampleRate: number, deviceId: string) => void;
  private onVibeTelemetryCallback?: (telemetry: { phoneStepCountDelta?: number; phoneMotionState?: "sedentary" | "walking" | "running" | "unknown"; timestamp: number }) => void;
  private onNotificationPostedCallback?: (notif: { packageName?: string; appName?: string; title: string; body: string; timestamp?: number; category?: string }) => void;
  private onSetMicGatingModeCallback?: (mode: "hotkey" | "widget" | "wakeword" | "manual") => void;
  private onVadReportCallback?: (isSpeaking: boolean, energy?: number) => void;
  private onWhatsappDraftConfirmedCallback?: (notificationId: string) => void;
  private readonly pendingAuth = new Map<string, {
    resolve: (res: { approved: boolean; authId: string; method?: "biometric" | "pin"; reason?: string }) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly activeTransfers = new Map<string, {
    transferId: string;
    filename: string;
    fileSize: number;
    mimeType?: string;
    chunks: Map<number, string>;
    totalChunks: number;
    startedAt: number;
    deviceId: string;
  }>();

  register(socket: PhoneSocket, metadata: { name?: unknown; platform?: unknown }): string {
    const deviceId = randomUUID();
    const now = new Date().toISOString();
    const client: ConnectedPhone = {
      socket,
      deviceId,
      name: typeof metadata.name === "string" ? metadata.name.slice(0, 80) : "Android phone",
      platform: typeof metadata.platform === "string" ? metadata.platform.slice(0, 40) : "Android",
      connectedAt: now,
      lastSeen: now,
      phoneStatus: null,
      lastAccessibilityEvent: null,
      installedApps: null,
      lastScreenHierarchy: null,
    };
    this.clients.set(deviceId, client);

    if (this.clients.size === 1) {
      this.spatialProximity.startPingLoop(
        (targetDeviceId, pingFrame) => {
          const target = this.clients.get(targetDeviceId);
          if (target && target.socket.readyState === 1) {
            try {
              target.socket.send(JSON.stringify(pingFrame));
            } catch {}
          }
        },
        () => [...this.clients.keys()],
      );
    }

    return deviceId;
  }

  unregister(deviceId: string, socket: PhoneSocket): void {
    const client = this.clients.get(deviceId);
    if (!client || client.socket !== socket) return;
    this.clients.delete(deviceId);
    this.spatialProximity.unregisterDevice(deviceId);

    if (this.clients.size === 0) {
      this.spatialProximity.stopPingLoop();
    }

    for (const [id, pending] of this.pending) {
      if (pending.deviceId !== deviceId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ success: false, error: "The phone disconnected before replying." });
    }
  }

  receive(deviceId: string, socket: PhoneSocket, data: string): void {
    const client = this.clients.get(deviceId);
    if (!client || client.socket !== socket || data.length > 256_000) return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const value = message as Record<string, unknown>;
    client.lastSeen = new Date().toISOString();

    if (value.type === "identify") {
      if (typeof value.name === "string") client.name = value.name.slice(0, 80) || client.name;
      if (typeof value.platform === "string") client.platform = value.platform.slice(0, 40) || client.platform;
      return;
    }

    if (value.type === "status_update") {
      client.phoneStatus = this.parseStatus(value.status);
      return;
    }

    if (value.type === "apps_list" && Array.isArray(value.apps)) {
      client.installedApps = (value.apps as unknown[])
        .filter((app): app is Record<string, unknown> => !!app && typeof app === "object")
        .map((app) => ({
          name: String(app.name || "").slice(0, 100),
          packageName: String(app.packageName || "").slice(0, 150),
          isSystem: Boolean(app.isSystem),
        }))
        .slice(0, 1000);
      return;
    }

    if (value.type === "screen_hierarchy") {
      client.lastScreenHierarchy = value.hierarchy ?? null;
      return;
    }

    if (value.type === "accessibility_event") {
      const event = value.event;
      const allowed: PhoneAccessibilityEventName[] = [
        "WINDOW_STATE_CHANGED", "WINDOW_CONTENT_CHANGED", "VIEW_CLICKED", "VIEW_FOCUSED",
        "TEXT_CHANGED", "SCROLL", "SERVICE_STATE_CHANGED",
      ];
      if (typeof event !== "string" || !allowed.includes(event as PhoneAccessibilityEventName)) return;
      client.lastAccessibilityEvent = {
        event: event as PhoneAccessibilityEventName,
        at: typeof value.at === "string" && !Number.isNaN(Date.parse(value.at)) ? value.at : new Date().toISOString(),
        ...(typeof value.packageName === "string" ? { packageName: value.packageName.slice(0, 200) } : {}),
        ...(typeof value.className === "string" ? { className: value.className.slice(0, 200) } : {}),
        ...(value.text === null || typeof value.text === "string"
          ? { text: typeof value.text === "string" ? value.text.slice(0, 256) : null }
          : {}),
      };
      return;
    }

    if (value.type === "set_audio_routing") {
      const mode = value.mode;
      if (mode === "DESKTOP_ONLY" || mode === "PHONE_ONLY" || mode === "BOTH") {
        this.setAudioRoutingMode(mode);
      }
      return;
    }

    if (value.type === "proximity_telemetry") {
      const rssi = typeof value.rssi === "number" ? Number(value.rssi) : (typeof value.wifiRssi === "number" ? Number(value.wifiRssi) : undefined);
      const latencyMs = typeof value.latencyMs === "number" ? Number(value.latencyMs) : undefined;
      this.spatialProximity.recordTelemetry(deviceId, { rssi, latencyMs, rawSource: "device_report" });
      return;
    }

    if (value.type === "proximity_ping_ack") {
      const sentTimestamp = typeof value.timestamp === "number" ? Number(value.timestamp) : (typeof value.sentTimestamp === "number" ? Number(value.sentTimestamp) : Date.now());
      const rssi = typeof value.rssi === "number" ? Number(value.rssi) : undefined;
      this.spatialProximity.handlePingAck(deviceId, sentTimestamp, rssi);
      return;
    }

    if (value.type === "set_spatial_config" && value.config && typeof value.config === "object") {
      this.spatialProximity.updateConfig(value.config as any);
      return;
    }

    if (value.type === "vibe_telemetry" || value.type === "activity_telemetry") {
      const stepCountDelta = typeof value.stepCountDelta === "number" ? Number(value.stepCountDelta) : (typeof value.stepCount === "number" ? Number(value.stepCount) : undefined);
      const motionState = value.motionState === "walking" || value.motionState === "running" || value.motionState === "sedentary" ? value.motionState : undefined;
      this.onVibeTelemetryCallback?.({
        phoneStepCountDelta: stepCountDelta,
        phoneMotionState: motionState,
        timestamp: Date.now(),
      });
      return;
    }

    if (value.type === "clipboard_sync") {
      if (typeof value.text === "string") {
        this.setSharedClipboard(value.text, "phone");
      }
      return;
    }

    if (value.type === "mic_audio_frame") {
      if (typeof value.audio === "string") {
        const rate = Number.isInteger(value.sampleRate) && Number(value.sampleRate) > 0 ? Number(value.sampleRate) : 16000;
        this.onMicAudioFrameCallback?.(value.audio, rate, deviceId);
      }
      return;
    }

    if (value.type === "notification_posted") {
      if (typeof value.title === "string" || typeof value.body === "string") {
        this.onNotificationPostedCallback?.({
          packageName: typeof value.packageName === "string" ? value.packageName : undefined,
          appName: typeof value.appName === "string" ? value.appName : undefined,
          title: String(value.title || ""),
          body: String(value.body || ""),
          timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
          category: typeof value.category === "string" ? value.category : undefined,
        });
      }
      return;
    }

    if (value.type === "set_mic_gating_mode") {
      const mode = value.mode;
      if (mode === "hotkey" || mode === "widget" || mode === "wakeword" || mode === "manual") {
        this.onSetMicGatingModeCallback?.(mode);
      }
      return;
    }

    if (value.type === "vad_report") {
      const isSpeaking = value.isSpeaking === true;
      const energy = typeof value.energy === "number" ? value.energy : 0;
      this.onVadReportCallback?.(isSpeaking, energy);
      return;
    }

    if (value.type === "whatsapp_draft_confirmed") {
      if (typeof value.notificationId === "string") {
        this.onWhatsappDraftConfirmedCallback?.(value.notificationId);
      }
      return;
    }

    if (value.type === "authorization_response") {
      const authId = typeof value.authId === "string" ? value.authId : "";
      if (authId) {
        this.resolveAuthorization(
          authId,
          value.approved === true,
          value.method === "biometric" || value.method === "pin" ? value.method : undefined,
          typeof value.reason === "string" ? value.reason : undefined,
        );
      }
      return;
    }

    if (value.type === "request_session_handover") {
      if (this.lastSessionHandover) {
        try {
          socket.send(JSON.stringify({ type: "session_handover", session: this.lastSessionHandover }));
        } catch {}
      }
      return;
    }

    if (value.type === "file_transfer_start") {
      const transferId = typeof value.transferId === "string" ? value.transferId.slice(0, 80) : "";
      const filename = typeof value.filename === "string" ? path.basename(value.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) : "transfer.bin";
      const totalChunks = Number.isInteger(value.totalChunks) && Number(value.totalChunks) > 0 ? Number(value.totalChunks) : 1;
      const fileSize = Number.isSafeInteger(value.fileSize) && Number(value.fileSize) >= 0 ? Number(value.fileSize) : 0;
      if (transferId) {
        this.activeTransfers.set(transferId, {
          transferId,
          filename,
          fileSize,
          mimeType: typeof value.mimeType === "string" ? value.mimeType.slice(0, 100) : undefined,
          chunks: new Map(),
          totalChunks,
          startedAt: Date.now(),
          deviceId,
        });
        try {
          socket.send(JSON.stringify({ type: "file_transfer_ack", transferId, status: "READY" }));
        } catch {}
      }
      return;
    }

    if (value.type === "file_transfer_chunk") {
      const transferId = typeof value.transferId === "string" ? value.transferId : "";
      const chunkIndex = Number.isInteger(value.chunkIndex) ? Number(value.chunkIndex) : -1;
      const dataBase64 = typeof value.dataBase64 === "string" ? value.dataBase64 : "";
      if (transferId && chunkIndex >= 0 && dataBase64) {
        this.processFileTransferChunk(deviceId, socket, transferId, chunkIndex, dataBase64);
      }
      return;
    }

    if (value.type !== "command_result" || typeof value.id !== "string") return;
    const pending = this.pending.get(value.id);
    if (!pending || pending.deviceId !== deviceId) return;
    clearTimeout(pending.timer);
    this.pending.delete(value.id);

    if (value.success === true && value.result && typeof value.result === "object") {
      const res = value.result as Record<string, unknown>;
      if (Array.isArray(res.apps)) {
        client.installedApps = (res.apps as unknown[])
          .filter((app): app is Record<string, unknown> => !!app && typeof app === "object")
          .map((app) => ({
            name: String(app.name || "").slice(0, 100),
            packageName: String(app.packageName || "").slice(0, 150),
            isSystem: Boolean(app.isSystem),
          }))
          .slice(0, 1000);
      }
      if (res.hierarchy) {
        client.lastScreenHierarchy = res.hierarchy;
      }
      if (typeof res.authId === "string" && typeof res.authorized === "boolean") {
        this.resolveAuthorization(res.authId, res.authorized, res.method as any, typeof res.reason === "string" ? res.reason : undefined);
      }
    }

    pending.resolve({
      success: value.success === true,
      ...(value.success === true ? { result: value.result ?? null } : { error: typeof value.error === "string" ? value.error.slice(0, 500) : "Phone command failed." }),
    });
  }

  async dispatch(command: PhoneRemoteCommand, deviceId?: string): Promise<{ success: boolean; deviceId: string; result?: unknown; error?: string }> {
    const available = [...this.clients.values()].filter((client) => client.socket.readyState === 1);
    let target: ConnectedPhone | undefined;
    if (deviceId) target = available.find((client) => client.deviceId === deviceId);
    else if (available.length === 1) target = available[0];
    else if (available.length > 1) throw new Error("More than one phone is connected; specify deviceId.");
    if (!target) throw new Error("No paired phone is currently connected.");

    const id = randomUUID();
    const result = await new Promise<{ success: boolean; result?: unknown; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ success: false, error: "The phone did not acknowledge the command before timeout." });
      }, 15_000);
      this.pending.set(id, { deviceId: target!.deviceId, resolve, timer });
      try {
        target!.socket.send(JSON.stringify({ type: "command", id, command }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ success: false, error: error instanceof Error ? error.message : "Could not send the phone command." });
      }
    });
    return { ...result, deviceId: target.deviceId };
  }

  get connectedDeviceCount(): number {
    return this.clients.size;
  }

  status(): Array<Omit<ConnectedPhone, "socket"> & { proximity: unknown }> {
    return [...this.clients.values()].map((client) => ({
      deviceId: client.deviceId,
      name: client.name,
      platform: client.platform,
      connectedAt: client.connectedAt,
      lastSeen: client.lastSeen,
      phoneStatus: client.phoneStatus,
      lastAccessibilityEvent: client.lastAccessibilityEvent,
      installedApps: client.installedApps,
      lastScreenHierarchy: client.lastScreenHierarchy,
      proximity: this.spatialProximity.getDeviceRecord(client.deviceId) || null,
    }));
  }

  private parseStatus(input: unknown): PhoneStatus | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    const status: PhoneStatus = {};
    if (Number.isFinite(value.batteryPercent) && Number(value.batteryPercent) >= 0 && Number(value.batteryPercent) <= 100) {
      status.batteryPercent = Number(value.batteryPercent);
    }
    if (typeof value.batteryCharging === "boolean") status.batteryCharging = value.batteryCharging;
    if (Number.isSafeInteger(value.storageFreeBytes) && Number(value.storageFreeBytes) >= 0) status.storageFreeBytes = Number(value.storageFreeBytes);
    if (Number.isSafeInteger(value.storageTotalBytes) && Number(value.storageTotalBytes) >= 0) status.storageTotalBytes = Number(value.storageTotalBytes);
    if (value.wifiState === "connected" || value.wifiState === "disconnected" || value.wifiState === "unknown") status.wifiState = value.wifiState;
    if (value.wifiSsid === null || typeof value.wifiSsid === "string") status.wifiSsid = typeof value.wifiSsid === "string" ? value.wifiSsid.slice(0, 100) : null;
    if (typeof value.foregroundApp === "string") status.foregroundApp = value.foregroundApp.slice(0, 150);
    if (typeof value.screenOn === "boolean") status.screenOn = value.screenOn;
    if (value.sensors && typeof value.sensors === "object" && !Array.isArray(value.sensors)) {
      status.sensors = Object.fromEntries(
        Object.entries(value.sensors as Record<string, unknown>)
          .filter(([key, enabled]) => /^[a-zA-Z0-9_-]{1,40}$/.test(key) && typeof enabled === "boolean")
          .slice(0, 40),
      ) as Record<string, boolean>;
    }
    return status;
  }

  getAudioRoutingMode(): "DESKTOP_ONLY" | "PHONE_ONLY" | "BOTH" {
    return this.audioRoutingMode;
  }

  setAudioRoutingMode(mode: "DESKTOP_ONLY" | "PHONE_ONLY" | "BOTH"): void {
    this.audioRoutingMode = mode;
    this.spatialProximity.setAudioRoutingMode(mode);
    this.broadcastToAll({
      type: "audio_routing_changed",
      mode: this.audioRoutingMode,
    });
  }

  getSharedClipboard(): { text: string; timestamp: number; source: "pc" | "phone" } | null {
    return this.sharedClipboard;
  }

  setSharedClipboard(text: string, source: "pc" | "phone" = "pc"): { text: string; timestamp: number; source: "pc" | "phone" } {
    const clip = { text: text.slice(0, 100_000), timestamp: Date.now(), source };
    this.sharedClipboard = clip;
    this.broadcastToAll({
      type: "clipboard_sync",
      text: clip.text,
      timestamp: clip.timestamp,
      source: clip.source,
    });
    this.onClipboardChangeCallback?.(clip);
    return clip;
  }

  onClipboardChange(cb: (clip: { text: string; timestamp: number; source: "pc" | "phone" }) => void): void {
    this.onClipboardChangeCallback = cb;
  }

  onMicAudioFrame(cb: (audioBase64: string, sampleRate: number, deviceId: string) => void): void {
    this.onMicAudioFrameCallback = cb;
  }

  onVibeTelemetry(cb: (telemetry: { phoneStepCountDelta?: number; phoneMotionState?: "sedentary" | "walking" | "running" | "unknown"; timestamp: number }) => void): void {
    this.onVibeTelemetryCallback = cb;
  }

  onNotificationPosted(cb: (notif: { packageName?: string; appName?: string; title: string; body: string; timestamp?: number; category?: string }) => void): void {
    this.onNotificationPostedCallback = cb;
  }

  onSetMicGatingMode(cb: (mode: "hotkey" | "widget" | "wakeword" | "manual") => void): void {
    this.onSetMicGatingModeCallback = cb;
  }

  onVadReport(cb: (isSpeaking: boolean, energy?: number) => void): void {
    this.onVadReportCallback = cb;
  }

  onWhatsappDraftConfirmed(cb: (notificationId: string) => void): void {
    this.onWhatsappDraftConfirmedCallback = cb;
  }

  broadcastSessionHandover(session: Record<string, unknown>): void {
    this.lastSessionHandover = { ...session, timestamp: Date.now() };
    this.broadcastToAll({
      type: "session_handover",
      session: this.lastSessionHandover,
    });
  }

  getLastSessionHandover(): Record<string, unknown> | null {
    return this.lastSessionHandover;
  }

  async requestAuthorization(request: {
    authId?: string;
    riskLevel?: "HIGH" | "CRITICAL";
    actionDescription: string;
    commandSnippet?: string;
    timeoutMs?: number;
    deviceId?: string;
  }): Promise<{ approved: boolean; authId: string; method?: "biometric" | "pin"; reason?: string }> {
    const authId = request.authId || randomUUID();
    const timeoutMs = Math.min(Math.max(request.timeoutMs || 30_000, 5_000), 120_000);
    const riskLevel = request.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH";

    const promise = new Promise<{ approved: boolean; authId: string; method?: "biometric" | "pin"; reason?: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAuth.delete(authId);
        resolve({ approved: false, authId, reason: "Authorization timed out waiting for user response on phone." });
      }, timeoutMs);
      this.pendingAuth.set(authId, { resolve, timer });
    });

    const available = [...this.clients.values()].filter((client) => client.socket.readyState === 1);
    let target: ConnectedPhone | undefined;
    if (request.deviceId) target = available.find((client) => client.deviceId === request.deviceId);
    else if (available.length === 1) target = available[0];
    else if (available.length > 1) {
      return { approved: false, authId, reason: "More than one phone is connected; specify deviceId." };
    }
    if (!target) {
      return { approved: false, authId, reason: "No paired phone is currently connected." };
    }

    try {
      target.socket.send(JSON.stringify({
        type: "command",
        id: randomUUID(),
        command: {
          action: "REQUEST_AUTHORIZATION",
          authId,
          riskLevel,
          actionDescription: request.actionDescription.slice(0, 500),
          ...(request.commandSnippet ? { commandSnippet: request.commandSnippet.slice(0, 1000) } : {}),
          timeoutMs,
        },
      }));
    } catch (err: any) {
      const pending = this.pendingAuth.get(authId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAuth.delete(authId);
      }
      return { approved: false, authId, reason: err?.message || "Failed to dispatch authorization to phone." };
    }

    return promise;
  }

  resolveAuthorization(authId: string, approved: boolean, method?: "biometric" | "pin", reason?: string): boolean {
    const pending = this.pendingAuth.get(authId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingAuth.delete(authId);
    pending.resolve({ approved, authId, method, reason });
    return true;
  }

  broadcastToAll(data: string | object): void {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === 1) {
        try {
          client.socket.send(str);
        } catch {}
      }
    }
  }

  private processFileTransferChunk(
    deviceId: string,
    socket: PhoneSocket,
    transferId: string,
    chunkIndex: number,
    dataBase64: string,
  ): void {
    const session = this.activeTransfers.get(transferId);
    if (!session || session.deviceId !== deviceId) return;

    session.chunks.set(chunkIndex, dataBase64);
    if (session.chunks.size >= session.totalChunks) {
      // Assemble all chunks in order
      try {
        const sortedIndices = Array.from(session.chunks.keys()).sort((a, b) => a - b);
        const buffers: Buffer[] = [];
        for (const idx of sortedIndices) {
          const chunkStr = session.chunks.get(idx) || "";
          buffers.push(Buffer.from(chunkStr, "base64"));
        }
        const fullBuffer = Buffer.concat(buffers);
        const transferDir = path.join(process.cwd(), "downloads", "mobile_transfers");
        if (!fs.existsSync(transferDir)) {
          fs.mkdirSync(transferDir, { recursive: true });
        }
        const filePath = path.join(transferDir, session.filename);
        fs.writeFileSync(filePath, fullBuffer);
        this.activeTransfers.delete(transferId);

        try {
          socket.send(JSON.stringify({
            type: "file_transfer_complete",
            transferId,
            success: true,
            savedPath: filePath,
            size: fullBuffer.length,
          }));
        } catch {}
      } catch (err: any) {
        this.activeTransfers.delete(transferId);
        try {
          socket.send(JSON.stringify({
            type: "file_transfer_complete",
            transferId,
            success: false,
            error: err?.message || "Failed to assemble file",
          }));
        } catch {}
      }
    }
  }
}
