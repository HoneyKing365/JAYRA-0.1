/**
 * runtime/micGating.ts
 * Two-Tier Passive Perception & Flexible Microphone Gating Subsystem for JAYRA.
 *
 * Implements:
 * 1. Muted-by-default microphone gating to prevent ambient noise / YouTube pickup.
 * 2. Background perception isolation: screen vision, action observation, and
 *    proactive speech output remain active even when the mic is gated.
 * 3. Four user-configurable gating modes:
 *    - "hotkey": Push-to-Talk or toggle with global shortcut (e.g. Ctrl+Space)
 *    - "widget": Draggable desktop mic widget (Cyan = Muted, Emerald = Open, Amber = Thinking/Speaking)
 *    - "wakeword": Wake-word detection ("Hey JAYRA")
 *    - "manual": Explicit in-app UI toggle
 * 4. Adaptive Uncapped Listening Window with Voice Activity Detection (VAD):
 *    - Opens on proactive prompts from JAYRA.
 *    - Does NOT cut off while user is speaking (uncapped duration).
 *    - Safely closes after user stops speaking (silence grace period) or initial timeout.
 */

export type MicGatingMode = "hotkey" | "widget" | "wakeword" | "manual";
export type MicState = "muted" | "listening" | "processing" | "speaking";
export type MicIndicatorColor = "cyan" | "emerald" | "amber";

export interface MicGatingConfig {
  defaultMode?: MicGatingMode;
  hotkey?: string;
  initialWindowTimeoutMs?: number;
  silenceGracePeriodMs?: number;
  floatingWidgetPosition?: { x: number; y: number };
  floatingWidgetVisible?: boolean;
  now?: () => number;
}

export interface FloatingWidgetState {
  visible: boolean;
  x: number;
  y: number;
}

export interface MicGatingState {
  mode: MicGatingMode;
  micState: MicState;
  indicatorColor: MicIndicatorColor;
  isMuted: boolean;
  adaptiveWindowActive: boolean;
  hotkeyPressed: boolean;
  floatingWidget: FloatingWidgetState;
  updatedAt: number;
}

export type StateChangeCallback = (state: MicGatingState) => void;
export type WindowOpenedCallback = (data: { reason: string; timestamp: number }) => void;
export type WindowClosedCallback = (data: { reason: string; durationMs: number; timestamp: number }) => void;

export class MicGatingManager {
  private mode: MicGatingMode;
  private micState: MicState = "muted";
  private isMuted = true;
  private adaptiveWindowActive = false;
  private hotkeyPressed = false;
  private floatingWidget: FloatingWidgetState;

  private readonly initialWindowTimeoutMs: number;
  private readonly silenceGracePeriodMs: number;
  private readonly now: () => number;

  private windowOpenedAt: number | null = null;
  private hasSpokenInCurrentWindow = false;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly stateListeners: Set<StateChangeCallback> = new Set();
  private readonly windowOpenedListeners: Set<WindowOpenedCallback> = new Set();
  private readonly windowClosedListeners: Set<WindowClosedCallback> = new Set();

  constructor(config: MicGatingConfig = {}) {
    this.mode = config.defaultMode ?? "hotkey";
    this.initialWindowTimeoutMs = config.initialWindowTimeoutMs ?? 5000;
    this.silenceGracePeriodMs = config.silenceGracePeriodMs ?? 2500;
    this.now = config.now ?? Date.now.bind(Date);
    this.floatingWidget = {
      visible: config.floatingWidgetVisible ?? true,
      x: config.floatingWidgetPosition?.x ?? 50,
      y: config.floatingWidgetPosition?.y ?? 50,
    };
  }

  /**
   * Derive the reactive 3-color indicator based on current state:
   * - cyan: Passive Background Perception Active (Mic Muted)
   * - emerald: Active Listening (Mic Open)
   * - amber: JAYRA Thinking / Speaking
   */
  public getIndicatorColor(): MicIndicatorColor {
    if (this.micState === "speaking" || this.micState === "processing") {
      return "amber";
    }
    if (this.micState === "listening" && !this.isMuted) {
      return "emerald";
    }
    return "cyan";
  }

  public getState(): MicGatingState {
    return {
      mode: this.mode,
      micState: this.micState,
      indicatorColor: this.getIndicatorColor(),
      isMuted: this.isMuted,
      adaptiveWindowActive: this.adaptiveWindowActive,
      hotkeyPressed: this.hotkeyPressed,
      floatingWidget: { ...this.floatingWidget },
      updatedAt: this.now(),
    };
  }

  /** Change user mic gating mode */
  public setMode(mode: MicGatingMode): MicGatingState {
    if (this.mode !== mode) {
      this.mode = mode;
      // When changing mode, unless adaptive window is active, reset to muted state
      if (!this.adaptiveWindowActive && this.micState !== "speaking") {
        this.micState = "muted";
        this.isMuted = true;
      }
      this.notifyState();
    }
    return this.getState();
  }

  /** Handle global hotkey pressed / released */
  public setHotkeyState(pressed: boolean, toggle = false): MicGatingState {
    if (this.mode !== "hotkey") return this.getState();

    if (toggle) {
      if (pressed) {
        // Toggle listening on/off
        if (this.isMuted) {
          this.openManualListening("hotkey_toggle");
        } else {
          this.closeManualListening("hotkey_toggle");
        }
      }
      return this.getState();
    }

    // Push-to-talk hold logic
    this.hotkeyPressed = pressed;
    if (pressed) {
      this.openManualListening("hotkey_hold");
    } else {
      this.closeManualListening("hotkey_release");
    }
    return this.getState();
  }

  /** Toggle microphone for manual mode or widget click */
  public toggleManualMic(source = "manual"): MicGatingState {
    if (this.isMuted) {
      this.openManualListening(source);
    } else {
      this.closeManualListening(source);
    }
    return this.getState();
  }

  /** Triggered by Wake-Word Detection ("Hey JAYRA") */
  public onWakeWordDetected(): MicGatingState {
    if (this.mode === "wakeword" || this.mode === "hotkey" || this.mode === "widget") {
      this.openAdaptiveListeningWindow({ reason: "wake_word_detected", initialTimeoutMs: 8000 });
    }
    return this.getState();
  }

  /**
   * Adaptive Uncapped Listening Window:
   * Opens automatically when JAYRA asks a proactive question or starts a conversational prompt.
   * Remains open without fixed time cut-off as long as user is speaking.
   */
  public openAdaptiveListeningWindow(options: { reason?: string; initialTimeoutMs?: number } = {}): MicGatingState {
    const reason = options.reason ?? "proactive_query";
    const timeoutMs = options.initialTimeoutMs ?? this.initialWindowTimeoutMs;

    this.clearAllTimers();

    this.adaptiveWindowActive = true;
    this.hasSpokenInCurrentWindow = false;
    this.isMuted = false;
    this.micState = "listening";
    this.windowOpenedAt = this.now();

    // Initial timeout in case user ignores or does not respond
    this.initialTimer = setTimeout(() => {
      if (!this.hasSpokenInCurrentWindow && this.adaptiveWindowActive) {
        this.closeListeningWindow("initial_timeout");
      }
    }, timeoutMs);

    for (const listener of this.windowOpenedListeners) {
      try {
        listener({ reason, timestamp: this.windowOpenedAt });
      } catch {
        // Safe callback execution
      }
    }

    this.notifyState();
    return this.getState();
  }

  /**
   * Voice Activity Detection (VAD) Report.
   * Must be called whenever the audio stream/speech engine detects voice energy.
   * Guarantees listening stream does NOT cut off mid-sentence.
   */
  public reportVoiceActivity(isSpeaking: boolean, _energy = 0): void {
    if (!this.adaptiveWindowActive && this.isMuted) {
      return;
    }

    if (isSpeaking) {
      // User is actively speaking: cancel initial silence timeout and grace period
      this.hasSpokenInCurrentWindow = true;
      if (this.initialTimer) {
        clearTimeout(this.initialTimer);
        this.initialTimer = null;
      }
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      // Stream stays open indefinitely while speaking
      if (this.micState !== "listening") {
        this.micState = "listening";
        this.isMuted = false;
        this.notifyState();
      }
    } else {
      // User stopped speaking: start silence grace period to detect end of utterance
      if (this.hasSpokenInCurrentWindow && this.adaptiveWindowActive && !this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this.closeListeningWindow("speech_completed");
        }, this.silenceGracePeriodMs);
      }
    }
  }

  /** Close adaptive listening window */
  public closeListeningWindow(reason = "manual_close"): MicGatingState {
    if (!this.adaptiveWindowActive) {
      return this.getState();
    }

    const durationMs = this.windowOpenedAt ? this.now() - this.windowOpenedAt : 0;
    this.clearAllTimers();

    this.adaptiveWindowActive = false;
    this.windowOpenedAt = null;
    this.hasSpokenInCurrentWindow = false;

    // Transition to processing briefly if speech was detected, or straight to muted
    if (reason === "speech_completed") {
      this.micState = "processing";
      this.isMuted = true;
      this.notifyState();

      // Return to muted after quick processing dispatch indication
      setTimeout(() => {
        if (this.micState === "processing") {
          this.micState = "muted";
          this.notifyState();
        }
      }, 500);
    } else {
      this.micState = "muted";
      this.isMuted = true;
      this.notifyState();
    }

    for (const listener of this.windowClosedListeners) {
      try {
        listener({ reason, durationMs, timestamp: this.now() });
      } catch {
        // Safe callback execution
      }
    }

    return this.getState();
  }

  /** Notify manager when JAYRA speaks (proactive line or answer) */
  public setJayraSpeaking(isSpeaking: boolean, enableContinuation = false): MicGatingState {
    if (isSpeaking) {
      this.micState = "speaking";
      this.clearAllTimers();
    } else {
      if (enableContinuation || this.adaptiveWindowActive) {
        return this.openAdaptiveListeningWindow({
          reason: "post_speech_continuation",
          initialTimeoutMs: 5000,
        });
      } else {
        this.micState = "muted";
        this.isMuted = true;
      }
    }
    this.notifyState();
    return this.getState();
  }

  /**
   * Explicitly triggers the 5-second post-speech listening window when speech finishes.
   * Keeps the microphone open and unmuted for 5 seconds to listen for the user's reply.
   */
  public onJayraSpeechFinished(options: { continuationMs?: number } = {}): MicGatingState {
    return this.openAdaptiveListeningWindow({
      reason: "post_speech_continuation",
      initialTimeoutMs: options.continuationMs ?? 5000,
    });
  }

  /** Update floating desktop widget position */
  public setWidgetPosition(x: number, y: number): MicGatingState {
    this.floatingWidget.x = Math.max(0, Math.round(x));
    this.floatingWidget.y = Math.max(0, Math.round(y));
    this.notifyState();
    return this.getState();
  }

  public setWidgetVisibility(visible: boolean): MicGatingState {
    this.floatingWidget.visible = visible;
    this.notifyState();
    return this.getState();
  }

  private openManualListening(_reason: string): void {
    this.clearAllTimers();
    this.adaptiveWindowActive = false;
    this.micState = "listening";
    this.isMuted = false;
    this.notifyState();
  }

  private closeManualListening(_reason: string): void {
    this.clearAllTimers();
    this.adaptiveWindowActive = false;
    this.micState = "muted";
    this.isMuted = true;
    this.notifyState();
  }

  private clearAllTimers(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private notifyState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // Safe callback execution
      }
    }
  }

  public onStateChange(listener: StateChangeCallback): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onListeningWindowOpened(listener: WindowOpenedCallback): () => void {
    this.windowOpenedListeners.add(listener);
    return () => this.windowOpenedListeners.delete(listener);
  }

  public onListeningWindowClosed(listener: WindowClosedCallback): () => void {
    this.windowClosedListeners.add(listener);
    return () => this.windowClosedListeners.delete(listener);
  }

  public destroy(): void {
    this.clearAllTimers();
    this.stateListeners.clear();
    this.windowOpenedListeners.clear();
    this.windowClosedListeners.clear();
  }
}

