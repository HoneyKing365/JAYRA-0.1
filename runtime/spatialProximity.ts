import { randomUUID } from "node:crypto";

export type ProximityState = "NEAR" | "AWAY" | "TRANSITIONING_AWAY" | "TRANSITIONING_NEAR" | "UNKNOWN";

export type AudioRoutingMode = "DESKTOP_ONLY" | "PHONE_ONLY" | "BOTH";

export interface SpatialProximityConfig {
  enabled: boolean;
  hysteresisMs: number;
  pingIntervalMs: number;
  rssiAwayThreshold: number;
  rssiNearThreshold: number;
  latencyAwayThresholdMs: number;
  latencyNearThresholdMs: number;
  preferredDesktopAudioMode: AudioRoutingMode;
  preferredAwayAudioMode: AudioRoutingMode;
}

export interface ProximityTelemetry {
  rssi?: number;
  latencyMs?: number;
  rawSource?: "ping_ack" | "device_report" | "manual";
}

export interface DeviceProximityRecord {
  deviceId: string;
  currentState: ProximityState;
  smoothedRssi: number | null;
  smoothedLatencyMs: number | null;
  proximityScore: number; // 0 to 100
  lastReadingAt: number;
  transitionStartedAt: number | null;
  targetTransitionState: ProximityState | null;
  history: Array<{
    timestamp: number;
    rssi?: number;
    latencyMs?: number;
    state: ProximityState;
    proximityScore: number;
  }>;
}

export interface SpatialHandoffEvent {
  type: "spatial_handoff_event";
  state: "AWAY" | "NEAR";
  deviceId: string;
  previousAudioMode: AudioRoutingMode;
  newAudioMode: AudioRoutingMode;
  proximityScore: number;
  smoothedRssi: number | null;
  smoothedLatencyMs: number | null;
  message: string;
  timestamp: number;
}

const DEFAULT_CONFIG: SpatialProximityConfig = {
  enabled: true,
  hysteresisMs: 4000,
  pingIntervalMs: 2500,
  rssiAwayThreshold: -75,
  rssiNearThreshold: -65,
  latencyAwayThresholdMs: 90,
  latencyNearThresholdMs: 40,
  preferredDesktopAudioMode: "DESKTOP_ONLY",
  preferredAwayAudioMode: "PHONE_ONLY",
};

const AWAY_SASSY_MESSAGES = [
  "Dekha aap mujhse door gaye toh main phone pe aa gayi... mere bina ek min bhi nahi reh sakte na?",
  "Aap desktop se dur ja rahe hain, toh JAYRA ab aapke phone par handle karegi. Chalo, main saath chal rahi hoon!",
  "Spatial away trigger activated! Routing audio and active session to your Android deck.",
  "Workstation chhod ke ja rahe ho? Main phone deck pe transfer ho gayi hoon, tension mat lo!",
];

const NEAR_SASSY_MESSAGES = [
  "Wapas aa gaye? Desktop screen aapka intezaar kar rahi thi, ab phone ko aaram do!",
  "Desktop proximity restored! Audio routed back to workstation speakers.",
  "Welcome back to your desk! PC companion HUD active ho chuki hai, ab kaam shuru karo!",
  "Aap wapas aa gaye... toh main bhi badi screen pe shift ho gayi. Chaliye!",
];

export class SpatialProximityManager {
  private config: SpatialProximityConfig;
  private readonly records = new Map<string, DeviceProximityRecord>();
  private currentGlobalAudioMode: AudioRoutingMode = "DESKTOP_ONLY";
  private lastHandoffEvent: SpatialHandoffEvent | null = null;
  private pingIntervalTimer?: NodeJS.Timeout;
  private onHandoffListener?: (event: SpatialHandoffEvent) => void;

  constructor(initialConfig?: Partial<SpatialProximityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(initialConfig || {}) };
  }

  getConfig(): SpatialProximityConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SpatialProximityConfig>): SpatialProximityConfig {
    this.config = {
      ...this.config,
      ...updates,
      ...(typeof updates.hysteresisMs === "number" ? { hysteresisMs: Math.max(500, updates.hysteresisMs) } : {}),
      ...(typeof updates.pingIntervalMs === "number" ? { pingIntervalMs: Math.max(500, updates.pingIntervalMs) } : {}),
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

  setAudioRoutingMode(mode: AudioRoutingMode): void {
    this.currentGlobalAudioMode = mode;
  }

  getAudioRoutingMode(): AudioRoutingMode {
    return this.currentGlobalAudioMode;
  }

  getLastHandoffEvent(): SpatialHandoffEvent | null {
    return this.lastHandoffEvent;
  }

  onHandoff(listener: (event: SpatialHandoffEvent) => void): void {
    this.onHandoffListener = listener;
  }

  getDeviceRecord(deviceId: string): DeviceProximityRecord | undefined {
    return this.records.get(deviceId);
  }

  getAllRecords(): DeviceProximityRecord[] {
    return Array.from(this.records.values());
  }

  getOverallState(): ProximityState {
    const list = this.getAllRecords();
    if (list.length === 0) return "UNKNOWN";
    if (list.some((r) => r.currentState === "AWAY")) return "AWAY";
    if (list.some((r) => r.currentState === "TRANSITIONING_AWAY")) return "TRANSITIONING_AWAY";
    if (list.some((r) => r.currentState === "TRANSITIONING_NEAR")) return "TRANSITIONING_NEAR";
    if (list.some((r) => r.currentState === "NEAR")) return "NEAR";
    return "UNKNOWN";
  }

  unregisterDevice(deviceId: string): void {
    this.records.delete(deviceId);
  }

  recordTelemetry(
    deviceId: string,
    telemetry: ProximityTelemetry,
    simulatedNow?: number,
  ): { record: DeviceProximityRecord; handoffEvent: SpatialHandoffEvent | null } {
    const now = simulatedNow ?? Date.now();
    let record = this.records.get(deviceId);

    if (!record) {
      record = {
        deviceId,
        currentState: "NEAR",
        smoothedRssi: null,
        smoothedLatencyMs: null,
        proximityScore: 80,
        lastReadingAt: now,
        transitionStartedAt: null,
        targetTransitionState: null,
        history: [],
      };
      this.records.set(deviceId, record);
    }

    record.lastReadingAt = now;

    // Smooth RSSI (alpha = 0.35)
    if (typeof telemetry.rssi === "number" && Number.isFinite(telemetry.rssi)) {
      if (record.smoothedRssi === null) {
        record.smoothedRssi = telemetry.rssi;
      } else {
        record.smoothedRssi = Number((0.35 * telemetry.rssi + 0.65 * record.smoothedRssi).toFixed(1));
      }
    }

    // Smooth Latency (alpha = 0.35)
    if (typeof telemetry.latencyMs === "number" && Number.isFinite(telemetry.latencyMs)) {
      if (record.smoothedLatencyMs === null) {
        record.smoothedLatencyMs = telemetry.latencyMs;
      } else {
        record.smoothedLatencyMs = Number((0.35 * telemetry.latencyMs + 0.65 * record.smoothedLatencyMs).toFixed(1));
      }
    }

    // Calculate composite proximity score (0 to 100)
    record.proximityScore = this.calculateProximityScore(record.smoothedRssi, record.smoothedLatencyMs);

    // If disabled, just update readings without state transitions
    if (!this.config.enabled) {
      return { record, handoffEvent: null };
    }

    // Evaluate proximity state
    const assessedState = this.assessInstantaneousState(
      telemetry,
      record.smoothedRssi,
      record.smoothedLatencyMs,
      record.proximityScore,
    );
    const handoffEvent = this.evaluateHysteresisAndTransition(record, assessedState, now);

    // Append to history (keep max 30)
    record.history.push({
      timestamp: now,
      rssi: telemetry.rssi,
      latencyMs: telemetry.latencyMs,
      state: record.currentState,
      proximityScore: record.proximityScore,
    });
    if (record.history.length > 30) {
      record.history.shift();
    }

    return { record, handoffEvent };
  }

  createPing(deviceId: string): { type: "proximity_ping"; pingId: string; timestamp: number } {
    return {
      type: "proximity_ping",
      pingId: randomUUID(),
      timestamp: Date.now(),
    };
  }

  handlePingAck(
    deviceId: string,
    sentTimestamp: number,
    rssi?: number,
    simulatedNow?: number,
  ): { record: DeviceProximityRecord; handoffEvent: SpatialHandoffEvent | null } {
    const now = simulatedNow ?? Date.now();
    const latencyMs = Math.max(1, now - sentTimestamp);
    return this.recordTelemetry(
      deviceId,
      {
        latencyMs,
        ...(typeof rssi === "number" ? { rssi } : {}),
        rawSource: "ping_ack",
      },
      now,
    );
  }

  startPingLoop(
    sender: (deviceId: string, pingFrame: { type: "proximity_ping"; pingId: string; timestamp: number }) => void,
    connectedDeviceIdsProvider: () => string[],
  ): void {
    this.stopPingLoop();
    this.pingIntervalTimer = setInterval(() => {
      if (!this.config.enabled) return;
      const deviceIds = connectedDeviceIdsProvider();
      for (const deviceId of deviceIds) {
        const ping = this.createPing(deviceId);
        try {
          sender(deviceId, ping);
        } catch {
          // ignore transient socket send errors
        }
      }
    }, this.config.pingIntervalMs);
  }

  stopPingLoop(): void {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = undefined;
    }
  }

  private calculateProximityScore(rssi: number | null, latencyMs: number | null): number {
    let rssiScore: number | null = null;
    let latencyScore: number | null = null;

    if (rssi !== null) {
      // Map -50 dBm or higher -> 100, -85 dBm or lower -> 0
      const clamped = Math.min(-50, Math.max(-85, rssi));
      rssiScore = Math.round(((clamped - (-85)) / (-50 - (-85))) * 100);
    }

    if (latencyMs !== null) {
      // Map 10ms or less -> 100, 150ms or more -> 0
      const clamped = Math.min(150, Math.max(10, latencyMs));
      latencyScore = Math.round(((150 - clamped) / (150 - 10)) * 100);
    }

    if (rssiScore !== null && latencyScore !== null) {
      return Math.round(0.5 * rssiScore + 0.5 * latencyScore);
    }
    if (rssiScore !== null) return rssiScore;
    if (latencyScore !== null) return latencyScore;
    return 75; // Default neutral-high score if neither reading is available yet
  }

  private assessInstantaneousState(
    telemetry: ProximityTelemetry,
    rssi: number | null,
    latencyMs: number | null,
    proximityScore: number,
  ): "AWAY" | "NEAR" {
    const rawAwayByRssi = typeof telemetry.rssi === "number" && telemetry.rssi <= this.config.rssiAwayThreshold;
    const rawAwayByLatency = typeof telemetry.latencyMs === "number" && telemetry.latencyMs >= this.config.latencyAwayThresholdMs;
    const rawNearByRssi = typeof telemetry.rssi === "number" && telemetry.rssi >= this.config.rssiNearThreshold;
    const rawNearByLatency = typeof telemetry.latencyMs === "number" && telemetry.latencyMs <= this.config.latencyNearThresholdMs;

    // Direct raw signal takes precedence for directional intent
    if (rawAwayByRssi || rawAwayByLatency) {
      return "AWAY";
    }
    if (rawNearByRssi && rawNearByLatency) {
      return "NEAR";
    }

    // Fallback to smoothed metrics if telemetry is in the intermediate zone
    const smoothedAwayByRssi = rssi !== null && rssi <= this.config.rssiAwayThreshold;
    const smoothedAwayByLatency = latencyMs !== null && latencyMs >= this.config.latencyAwayThresholdMs;
    if (smoothedAwayByRssi || smoothedAwayByLatency || proximityScore <= 40) {
      return "AWAY";
    }

    const smoothedNearByRssi = rssi === null || rssi >= this.config.rssiNearThreshold;
    const smoothedNearByLatency = latencyMs === null || latencyMs <= this.config.latencyNearThresholdMs;
    if (smoothedNearByRssi && smoothedNearByLatency && proximityScore >= 50) {
      return "NEAR";
    }

    return proximityScore >= 50 ? "NEAR" : "AWAY";
  }

  private evaluateHysteresisAndTransition(
    record: DeviceProximityRecord,
    assessed: "AWAY" | "NEAR",
    now: number,
  ): SpatialHandoffEvent | null {
    // Current stable state: NEAR
    if (record.currentState === "NEAR" || record.currentState === "UNKNOWN") {
      if (assessed === "AWAY") {
        if (record.targetTransitionState !== "AWAY" || record.transitionStartedAt === null) {
          record.currentState = "TRANSITIONING_AWAY";
          record.targetTransitionState = "AWAY";
          record.transitionStartedAt = now;
        } else {
          // Check if hysteresis condition has elapsed
          if (now - record.transitionStartedAt >= this.config.hysteresisMs) {
            record.currentState = "AWAY";
            record.targetTransitionState = null;
            record.transitionStartedAt = null;
            return this.triggerHandoff(record, "AWAY", now);
          }
        }
      } else {
        // Condition was NEAR, reset any transition
        record.currentState = "NEAR";
        record.targetTransitionState = null;
        record.transitionStartedAt = null;
      }
      return null;
    }

    // Current transition state: TRANSITIONING_AWAY
    if (record.currentState === "TRANSITIONING_AWAY") {
      if (assessed === "AWAY") {
        if (record.transitionStartedAt !== null && now - record.transitionStartedAt >= this.config.hysteresisMs) {
          record.currentState = "AWAY";
          record.targetTransitionState = null;
          record.transitionStartedAt = null;
          return this.triggerHandoff(record, "AWAY", now);
        }
      } else {
        // Quick abort back to NEAR if proximity returned before hysteresis completed
        record.currentState = "NEAR";
        record.targetTransitionState = null;
        record.transitionStartedAt = null;
      }
      return null;
    }

    // Current stable state: AWAY
    if (record.currentState === "AWAY") {
      if (assessed === "NEAR") {
        if (record.targetTransitionState !== "NEAR" || record.transitionStartedAt === null) {
          record.currentState = "TRANSITIONING_NEAR";
          record.targetTransitionState = "NEAR";
          record.transitionStartedAt = now;
        } else {
          // Return threshold: slightly snappier return (min hysteresis or 3s)
          const returnHysteresis = Math.min(this.config.hysteresisMs, 3000);
          if (now - record.transitionStartedAt >= returnHysteresis) {
            record.currentState = "NEAR";
            record.targetTransitionState = null;
            record.transitionStartedAt = null;
            return this.triggerHandoff(record, "NEAR", now);
          }
        }
      } else {
        record.targetTransitionState = null;
        record.transitionStartedAt = null;
      }
      return null;
    }

    // Current transition state: TRANSITIONING_NEAR
    if (record.currentState === "TRANSITIONING_NEAR") {
      if (assessed === "NEAR") {
        const returnHysteresis = Math.min(this.config.hysteresisMs, 3000);
        if (record.transitionStartedAt !== null && now - record.transitionStartedAt >= returnHysteresis) {
          record.currentState = "NEAR";
          record.targetTransitionState = null;
          record.transitionStartedAt = null;
          return this.triggerHandoff(record, "NEAR", now);
        }
      } else {
        // User wandered away again during return debounce
        record.currentState = "AWAY";
        record.targetTransitionState = null;
        record.transitionStartedAt = null;
      }
      return null;
    }

    return null;
  }

  private triggerHandoff(record: DeviceProximityRecord, newState: "AWAY" | "NEAR", now: number): SpatialHandoffEvent {
    const previousAudioMode = this.currentGlobalAudioMode;
    const newAudioMode = newState === "AWAY"
      ? this.config.preferredAwayAudioMode
      : this.config.preferredDesktopAudioMode;

    this.currentGlobalAudioMode = newAudioMode;

    const message = newState === "AWAY"
      ? AWAY_SASSY_MESSAGES[Math.floor(Math.random() * AWAY_SASSY_MESSAGES.length)]
      : NEAR_SASSY_MESSAGES[Math.floor(Math.random() * NEAR_SASSY_MESSAGES.length)];

    const event: SpatialHandoffEvent = {
      type: "spatial_handoff_event",
      state: newState,
      deviceId: record.deviceId,
      previousAudioMode,
      newAudioMode,
      proximityScore: record.proximityScore,
      smoothedRssi: record.smoothedRssi,
      smoothedLatencyMs: record.smoothedLatencyMs,
      message,
      timestamp: now,
    };

    this.lastHandoffEvent = event;
    this.onHandoffListener?.(event);
    return event;
  }
}
