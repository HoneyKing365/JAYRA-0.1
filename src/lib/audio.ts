/**
 * Audio handling utility for JAYRA Live API Voice stream.
 * Handles:
 * - 16kHz layout sampling for microphone stream.
 * - Raw Little Endian Int16 PCM translation.
 * - 24kHz layout output sampling for model voice playback.
 * - Gapless double-buffer queue scheduler.
 * - Interrupt signal immediate stop.
 * - Input & Output AnalyserNodes for real-time waveform visuals.
 */
import { authorizeUiCapability } from "./permissionGate";

export type LiveState = "disconnected" | "connecting" | "processing" | "listening" | "speaking";

export interface VadActivity {
  rms: number;
  speaking: boolean;
  started: boolean;
  finished: boolean;
  durationMs: number;
}

export function getSpeechFallbackText(audioReceived: boolean, transcript: string, isLiveVoiceConnected = false): string | null {
  const text = transcript.trim();
  if (isLiveVoiceConnected) return null;
  return !audioReceived && text ? text : null;
}

export function isBargeIn(outputActive: boolean, activity: VadActivity): boolean {
  return outputActive && activity.started;
}

export function flushAudioQueue<T extends { stop: () => void }>(
  sources: T[],
  resetSchedule: () => void,
): void {
  const queuedSources = sources.splice(0);
  for (const source of queuedSources) {
    try {
      source.stop();
    } catch {
      /* already ended */
    }
  }
  resetSchedule();
}

export function schedulePcmChunk(
  currentTime: number,
  nextStartTime: number,
  duration: number,
  leadSeconds = 0.02,
): { startTime: number; nextStartTime: number } {
  const startTime = Math.max(nextStartTime, currentTime + leadSeconds);
  return { startTime, nextStartTime: startTime + duration };
}

export function createMicrophoneAudioPacket(audio: string): { audio: string } {
  return { audio };
}

export class VoiceActivityDetector {
  private voiceFrames = 0;
  private lastVoiceAt = 0;
  private startedAt = 0;
  private active = false;
  private noiseFloor = 0.005;

  constructor(private readonly silenceMs = 2200) {}

  process(
    samples: Float32Array,
    timestamp: number,
    threshold: number,
    requiredFrames: number,
    noiseThreshold = threshold,
  ): VadActivity {
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / Math.max(1, samples.length));
    if (!this.active && rms <= noiseThreshold * 2.2) {
      const adaptation = rms > this.noiseFloor ? 0.5 : 0.08;
      this.noiseFloor += (rms - this.noiseFloor) * adaptation;
    }
    const effectiveThreshold = this.active
      ? Math.max(threshold * 0.65, this.noiseFloor * 0.75 + 0.004)
      : Math.max(threshold, this.noiseFloor + 0.005);
    let started = false;
    let finished = false;
    let durationMs = 0;

    if (rms >= effectiveThreshold) {
      this.lastVoiceAt = timestamp;
      this.voiceFrames += 1;
      if (!this.active && this.voiceFrames >= requiredFrames) {
        this.active = true;
        this.startedAt = timestamp;
        started = true;
      }
    } else {
      this.voiceFrames = 0;
      if (this.active && timestamp - this.lastVoiceAt >= this.silenceMs) {
        this.active = false;
        finished = true;
        durationMs = timestamp - this.startedAt;
        this.startedAt = 0;
      }
    }

    return { rms, speaking: this.active, started, finished, durationMs };
  }

  clearStartFrames(): void {
    this.voiceFrames = 0;
  }

  reset(): void {
    this.voiceFrames = 0;
    this.lastVoiceAt = 0;
    this.startedAt = 0;
    this.active = false;
    this.noiseFloor = 0.005;
  }

  get isSpeaking(): boolean {
    return this.active;
  }
}

// PCM Conversion Helper: converts Float32Array [-1.0, 1.0] to signed Int16 Raw PCM Little Endian
export function encodePcm16LE(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

/**
 * Streaming pitch shifter that raises pitch by `ratio` without changing speed
 * (lip-sync and timing are kept). A single read head plays the delay line a
 * little faster than real time; when it catches up with the newest audio it
 * jumps back by the lag whose waveform matches best (pitch-period aligned)
 * and crossfades for 5 ms. Only one copy of the voice is audible at a time,
 * so there is no doubling or echo (the comb effect of two free-running heads).
 * State carries across chunks, so chunk boundaries stay seamless.
 */
export class PitchShifter {
  private readonly N = 8192;
  private readonly buf = new Float32Array(8192);
  private written = 0;
  private rp: number;
  private fadeFrom = 0;
  private fadeLeft = 0;
  private readonly W: number; // match window
  private readonly X: number; // crossfade length
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly minDelay: number;

  constructor(private readonly ratio: number, sampleRate = 24000) {
    const s = sampleRate / 24000;
    this.W = Math.round(240 * s); // 10 ms
    this.X = Math.round(120 * s); // 5 ms
    this.minLag = Math.round(240 * s);
    this.maxLag = Math.round(720 * s); // 30 ms
    this.minDelay = Math.round(400 * s);
    this.rp = -(this.minDelay + this.maxLag);
  }

  private at(pos: number): number {
    const i = Math.floor(pos);
    const f = pos - i;
    const a = i >= 0 && i < this.written ? this.buf[i % this.N] : 0;
    const b = i + 1 >= 0 && i + 1 < this.written ? this.buf[(i + 1) % this.N] : 0;
    return a + (b - a) * f;
  }

  /** Jump the head back by the best-matching lag and start a crossfade. */
  private splice(): void {
    const base = Math.floor(this.rp);
    let best = this.minLag;
    let bestScore = -Infinity;
    for (let lag = this.minLag; lag <= this.maxLag; lag += 2) {
      let dot = 0;
      let energy = 1e-9;
      for (let k = 0; k < this.W; k += 2) {
        const a = this.at(base + k);
        const b = this.at(base - lag + k);
        dot += a * b;
        energy += b * b;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    this.fadeFrom = this.rp;
    this.rp -= best;
    this.fadeLeft = this.X;
  }

  process(input: Float32Array): Float32Array {
    const out = new Float32Array(input.length);
    for (let n = 0; n < input.length; n++) {
      this.buf[this.written % this.N] = input[n];
      this.written++;
      let y: number;
      if (this.fadeLeft > 0) {
        const t = 1 - this.fadeLeft / this.X;
        y = this.at(this.fadeFrom) * (1 - t) + this.at(this.rp) * t;
        this.fadeFrom += this.ratio;
        this.fadeLeft--;
      } else {
        y = this.at(this.rp);
      }
      out[n] = y;
      this.rp += this.ratio;
      if (this.fadeLeft === 0 && this.written - this.rp < this.minDelay) this.splice();
    }
    return out;
  }
}

// Float conversion helper: converts signed Int16 array buffer to Float32Array [-1.0, 1.0]
function pcm16ToFloats(uint8Array: Uint8Array): Float32Array {
  const int16 = new Int16Array(
    uint8Array.buffer,
    uint8Array.byteOffset,
    uint8Array.byteLength / 2
  );
  const floats = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    floats[i] = int16[i] / 32768.0;
  }
  return floats;
}

// Convert ArrayBuffer to Base64 String
function base64ArrayBuffer(arrayBuffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class MyraaAudioSession {
  private ws: WebSocket | null = null;
  
  // Audios contexts (separate to match exact required sample rates)
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  
  // Audio sources & processors
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micProcessorNode: ScriptProcessorNode | null = null;
  
  // Visualisers
  public inputAnalyser: AnalyserNode | null = null;
  public outputAnalyser: AnalyserNode | null = null;
  private outputGainNode: GainNode | null = null;
  private pitchShifter: PitchShifter | null = null;
  
  // Buffering / Playback details
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private readonly vad = new VoiceActivityDetector(2200);
  private postSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  private postSpeechWindowActive = false;
  private outputSpeechStartedAt = 0;
  private readonly voiceThreshold = 0.02;
  private readonly bargeInGuardMs = 700;
  private readonly bargeInStartFrames = 2;
  private readonly bargeInVoiceThreshold = 0.045;
  
  // State Callbacks
  private onStateChange: (state: LiveState) => void;
  private onTranscription: (role: "user" | "model", text: string) => void;
  private onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
  private onError: (error: string) => void;
  private onMemorySync?: (memories: any[]) => void;
  private onScreenVisionState?: (state: "idle" | "capturing" | "ready" | "error", info: { activeWindow?: string | null; error?: string | null }) => void;
  
  private currentState: LiveState = "disconnected";
  private isActivated = false;
  private useMicrophone = true;
  private isMicMuted = false;
  private manuallyActivated = false;

  public setMicMuted(muted: boolean): void {
    this.isMicMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public getMicMuted(): boolean {
    return this.isMicMuted;
  }

  public isSessionActivated(): boolean {
    return this.isActivated;
  }

  public hasActiveMicStream(): boolean {
    return Boolean(this.micStream && this.micStream.active && this.micStream.getAudioTracks().some((t) => t.readyState === "live"));
  }

  public isManualVoiceActive(): boolean {
    return this.manuallyActivated;
  }

  public async enableMicrophone(isManual = true): Promise<void> {
    this.manuallyActivated = isManual;
    this.cancelPostSpeechWindow();
    this.useMicrophone = true;
    this.setMicMuted(false);

    if (this.inputAudioCtx && this.inputAudioCtx.state === "suspended") {
      await this.inputAudioCtx.resume().catch(() => {});
    }
    if (this.outputAudioCtx && this.outputAudioCtx.state === "suspended") {
      await this.outputAudioCtx.resume().catch(() => {});
    }

    if (!this.micStream || !this.micProcessorNode) {
      await this.setupMicrophone();
    } else {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }

    if (this.currentState === "disconnected" || this.currentState === "connecting") {
      this.setState("listening");
    } else if (this.currentState !== "speaking" && this.currentState !== "processing") {
      this.setState("listening");
    }
  }

  public startPostSpeechWindow(durationMs = 5000): void {
    if (this.manuallyActivated) {
      // In a manual voice session, keep the mic hot and unmuted for natural conversational turns.
      this.cancelPostSpeechWindow();
      this.setMicMuted(false);
      if (this.micStream) {
        this.micStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      }
      if (this.currentState !== "listening" && this.currentState !== "speaking" && this.currentState !== "processing") {
        this.setState("listening");
      }
      return;
    }

    if (this.postSpeechTimer) {
      clearTimeout(this.postSpeechTimer);
      this.postSpeechTimer = null;
    }
    this.postSpeechWindowActive = true;

    // Ensure audio context is running
    if (this.inputAudioCtx && this.inputAudioCtx.state === "suspended") {
      void this.inputAudioCtx.resume().catch(() => {});
    }

    // If session is disconnected or mic stream isn't initialized, initiate connection with mic
    if (!this.isActivated || !this.micStream) {
      void this.connect(true, false, false).then(() => {
        this.setMicMuted(false);
        this.setState("listening");
      }).catch((e) => console.warn("[JAYRA Audio] Auto-connect on post-speech window failed:", e));
    } else {
      this.setMicMuted(false);
      if (this.micStream) {
        this.micStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      }
      this.setState("listening");
    }

    console.info(`[JAYRA Audio] Post-speech active listening window open (${durationMs}ms)`);

    this.postSpeechTimer = setTimeout(() => {
      if (this.postSpeechWindowActive && !this.manuallyActivated) {
        console.info("[JAYRA Audio] Post-speech listening window elapsed without user response; muting mic for passive perception.");
        this.postSpeechWindowActive = false;
        this.setMicMuted(true);
      }
      this.postSpeechTimer = null;
    }, durationMs);
  }

  public cancelPostSpeechWindow(): void {
    if (this.postSpeechTimer) {
      clearTimeout(this.postSpeechTimer);
      this.postSpeechTimer = null;
    }
    this.postSpeechWindowActive = false;
  }

  private liveReady = false;
  private outputReady = false;
  private pendingTextMessages: string[] = [];
  private modelTranscriptForFallback = "";
  private audioReceivedThisTurn = false;
  private suppressOutputUntilUserStops = false;
  private outputVolume = 1;
  public customTtsEnabled = false;
  private onSpeechFallback?: (text: string) => boolean | void;

  public sendRemoteAction(action: string, args: Record<string, unknown> = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "remote_action", action, args }));
    }
  }

  constructor(handlers: {
    onStateChange: (state: LiveState) => void;
    onTranscription: (role: "user" | "model", text: string) => void;
    onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
    onError: (error: string) => void;
    onSpeechFallback?: (text: string) => boolean | void;
    onMemorySync?: (memories: any[]) => void;
    onScreenVisionState?: (state: "idle" | "capturing" | "ready" | "error", info: { activeWindow?: string | null; error?: string | null }) => void;
  }) {
    this.onStateChange = handlers.onStateChange;
    this.onTranscription = handlers.onTranscription;
    this.onToolCall = handlers.onToolCall;
    this.onError = handlers.onError;
    this.onSpeechFallback = handlers.onSpeechFallback;
    this.onMemorySync = handlers.onMemorySync;
    this.onScreenVisionState = handlers.onScreenVisionState;
  }

  private setState(state: LiveState) {
    this.currentState = state;
    this.onStateChange(state);
  }

  public getState(): LiveState {
    return this.currentState;
  }

  public get isLiveVoiceSpeaking(): boolean {
    if (this.customTtsEnabled) return false;
    return this.currentState === "speaking" || this.activeSources.length > 0;
  }

  public setCustomTtsEnabled(enabled: boolean) {
    this.customTtsEnabled = enabled;
    if (enabled && this.activeSources.length > 0) {
      flushAudioQueue(this.activeSources, () => {
        this.nextStartTime = 0;
        this.outputSpeechStartedAt = 0;
      });
    }
  }

  public setOutputVolume(volume: number): void {
    this.outputVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    if (this.outputGainNode) this.outputGainNode.gain.value = this.outputVolume;
  }

  /**
   * Pushes a compressed JPEG base64 screenshot frame directly to the live WebSocket server.
   */
  public sendVideoFrame(
    base64Data: string,
    metadata: { changeScore?: number; heartbeat?: boolean } = {},
  ) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentState !== "disconnected") {
      this.ws.send(JSON.stringify({ type: "video", video: base64Data, ...metadata }));
    }
  }

  /** Queue typed input; it is flushed once Gemini Live is ready. */
  public sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (this.currentState === "speaking") {
      this.handleInterruption(false);
    }

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.liveReady &&
      this.outputReady &&
      this.currentState !== "disconnected"
    ) {
      this.setState("processing");
      this.ws.send(JSON.stringify({ type: "text", text: trimmed }));
      return;
    }
    this.pendingTextMessages.push(trimmed);
  }

  private flushPendingTextMessages() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.liveReady || !this.outputReady) return;
    const pending = this.pendingTextMessages.splice(0);
    if (pending.length) this.setState("processing");
    for (const text of pending) {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  private async setupMicrophone(): Promise<boolean> {
    if (!this.inputAudioCtx) return false;
    if (this.inputAudioCtx.state === "suspended") {
      await this.inputAudioCtx.resume().catch(() => {});
    }

    try {
      await authorizeUiCapability("ui.microphone.access");
    } catch {}

    // Clean up existing mic stream and nodes if any
    if (this.micProcessorNode) {
      try { this.micProcessorNode.disconnect(); } catch {}
      this.micProcessorNode = null;
    }
    if (this.micSourceNode) {
      try { this.micSourceNode.disconnect(); } catch {}
      this.micSourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      this.micStream = null;
    }

    let stream: MediaStream | null = null;
    const isNonSecure = typeof window !== "undefined" && window.isSecureContext === false;

    if (!navigator.mediaDevices?.getUserMedia) {
      const legacyGetUserMedia = (navigator as any).getUserMedia ||
        (navigator as any).webkitGetUserMedia ||
        (navigator as any).mozGetUserMedia;
      if (legacyGetUserMedia) {
        try {
          stream = await new Promise<MediaStream>((resolve, reject) => {
            legacyGetUserMedia.call(navigator, { audio: true }, resolve, reject);
          });
        } catch (e) {
          console.warn("[JAYRA LAN] Legacy getUserMedia fallback failed:", e);
        }
      }
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
      } catch (err: any) {
        if (isNonSecure || err.name === "NotAllowedError" || err.name === "SecurityError") {
          console.warn("[JAYRA LAN] Microphone restricted in non-HTTPS LAN context:", err);
        } else {
          throw err;
        }
      }
    }

    if (!stream) {
      this.useMicrophone = false;
      console.info("[JAYRA] Connected in remote deck mode. Non-secure LAN context allows text, HUD mirroring, and remote actions.");
      return false;
    }

    if (!this.isActivated || !this.inputAudioCtx) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      return false;
    }

    this.micStream = stream;
    this.useMicrophone = true;
    this.setMicMuted(false);

    this.inputAnalyser = this.inputAudioCtx.createAnalyser();
    this.inputAnalyser.fftSize = 256;

    this.micSourceNode = this.inputAudioCtx.createMediaStreamSource(this.micStream);
    this.micSourceNode.connect(this.inputAnalyser);

    this.micProcessorNode = this.inputAudioCtx.createScriptProcessor(1024, 1, 1);
    this.micSourceNode.connect(this.micProcessorNode);
    const silentSink = this.inputAudioCtx.createGain();
    silentSink.gain.value = 0;
    silentSink.connect(this.inputAudioCtx.destination);
    this.micProcessorNode.connect(silentSink);

    this.micProcessorNode.onaudioprocess = (e) => {
      if (this.currentState === "disconnected" || this.currentState === "connecting" || this.isMicMuted) return;

      const channelData = e.inputBuffer.getChannelData(0);
      const shouldForwardMicrophone = this.updateVoiceActivity(channelData);
      if (!shouldForwardMicrophone) return;

      // Convert to base64 Int16 Little Endian PCM
      const pcmBuffer = encodePcm16LE(channelData);
      const base64 = base64ArrayBuffer(pcmBuffer);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(createMicrophoneAudioPacket(base64)));
      }
    };

    return true;
  }

  // Voice mode requests a microphone; typed mode keeps audio responses without one.
  public async connect(useMicrophone = true, activatedByWakeWord = false, isManual = true) {
    this.manuallyActivated = isManual;
    this.cancelPostSpeechWindow();
    this.isMicMuted = false;

    if (this.isActivated) {
      if (useMicrophone && (!this.micStream || this.isMicMuted)) {
        await this.enableMicrophone(isManual);
      }
      return;
    }
    this.isActivated = true;
    this.useMicrophone = useMicrophone;
    this.setState(activatedByWakeWord ? "processing" : "connecting");

    try {
      // 1. Establish custom WebSocket server bridge
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.ws = new WebSocket(`${protocol}//${window.location.host}/live`);
      this.ws.binaryType = "blob";

      this.ws.onopen = async () => {
        console.log("[JAYRA] Connected to server side WS bridge");
        try {
          // Guard against early user disconnect during connection setup
          if (!this.isActivated) return;

          // Safe, cross-browser AudioContext initialization
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) {
            throw new Error("Holographic audio link unsupported: Web Audio API missing in browser.");
          }

          this.inputAudioCtx = new AudioContextClass({ sampleRate: 16000 });
          this.outputAudioCtx = new AudioContextClass({ sampleRate: 24000 });

          // Ensure Audio Contexts are active and resumed to bypass browser security blocks
          if (this.inputAudioCtx.state === "suspended") {
            await this.inputAudioCtx.resume().catch(() => {});
          }
          if (this.outputAudioCtx.state === "suspended") {
            await this.outputAudioCtx.resume().catch(() => {});
          }

          // Setup custom output Analyser & Volume Gains
          this.outputGainNode = this.outputAudioCtx.createGain();
          this.outputGainNode.gain.value = this.outputVolume;
          this.outputAnalyser = this.outputAudioCtx.createAnalyser();
          this.outputAnalyser.fftSize = 256;
          this.outputAnalyser.smoothingTimeConstant = 0.8;

          this.outputGainNode.connect(this.outputAnalyser);
          this.outputAnalyser.connect(this.outputAudioCtx.destination);
          this.outputReady = true;
          this.flushPendingTextMessages();
          // Optional pitch lift (Settings → Voice → Voice pitch).
          this.pitchShifter = null;
          void fetch("/api/app-settings")
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => {
              const semitones = Number(s?.voice?.pitch) || 0;
              this.pitchShifter = semitones > 0 ? new PitchShifter(Math.pow(2, Math.min(5, semitones) / 12)) : null;
            })
            .catch(() => undefined);

          if (!this.useMicrophone) {
            this.setState("listening");
            this.flushPendingTextMessages();
            return;
          }

          const micOk = await this.setupMicrophone();
          if (!micOk) {
            this.useMicrophone = false;
            this.setState("listening");
            this.flushPendingTextMessages();
            return;
          }

          // Sound setups are fully functional
          this.setState("listening");

        } catch (audioError: any) {
          console.error("Audio Context or Microphone Initialization Failed:", audioError);
          this.onError(`Audio setup error: ${audioError.message || "Microphone required for holographic Live link."}`);
          this.disconnect();
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Root Error Handler message
          if (data.type === "error") {
            this.onError(data.error);
            this.disconnect();
            if (data.code === "INVALID_API_KEY") {
              console.warn("[JAYRA] Gemini rejected the configured API key.");
            }
            return;
          }

          // Handle server-side states
          if (data.type === "status") {
            console.log("[JAYRA WS Status]:", data.status);
            if (data.status === "connecting_gemini") {
              // Wait for Gemini Live connection
            } else if (data.status === "connected") {
              this.liveReady = true;
              this.setState("listening");
              this.flushPendingTextMessages();
            } else if (data.status === "session_closed") {
              this.disconnect();
            }
            return;
          }

          // Handle audio payload (24kHzPCM model response)
          if (data.type === "audio" && data.audio) {
            if (this.customTtsEnabled) {
              // Ensure Gemini PCM audio stream is cleanly bypassed and muted during custom TTS
              if (this.activeSources.length > 0) {
                flushAudioQueue(this.activeSources, () => {
                  this.nextStartTime = 0;
                  this.outputSpeechStartedAt = 0;
                });
              }
            } else if (!this.suppressOutputUntilUserStops) {
              if (!this.audioReceivedThisTurn) console.info("[JAYRA TTS] Audio stream started (Gemini Live).");
              this.audioReceivedThisTurn = true;
              this.playAudioPCMChunk(data.audio);
            }
          }

          // Handle interruption signal (e.g. user talked over Myraa)
          if (data.type === "interrupted") {
            this.handleInterruption(false, false);
          }

          // Handle reset speech input command
          if (data.type === "reset_speech") {
            this.handleInterruption(false, false);
            this.onTranscription("user", "");
            this.onTranscription("model", "");
            this.setState("listening");
            return;
          }

          // Handle explicit conversation termination command from agent
          if (data.type === "close_conversation") {
            this.handleInterruption(false, false);
            this.onTranscription("user", "");
            this.onTranscription("model", "");
            this.disconnect();
            return;
          }

          // Turn complete
          if (data.type === "turnComplete") {
            const rawFallbackText = this.customTtsEnabled
              ? this.modelTranscriptForFallback
              : getSpeechFallbackText(
                  this.audioReceivedThisTurn,
                  this.modelTranscriptForFallback,
                  this.isLiveVoiceSpeaking,
                );
            const fallbackText = rawFallbackText.trim();
            const fallbackStarted = fallbackText ? this.onSpeechFallback?.(fallbackText) : false;
            this.audioReceivedThisTurn = false;
            this.modelTranscriptForFallback = "";
            if (!fallbackStarted && this.currentState === "processing") this.setState("listening");
            // Only auto-revert speaking state if custom TTS is NOT active (custom TTS manages its own state via callbacks)
            if (!this.customTtsEnabled) {
              setTimeout(() => {
                if (this.activeSources.length === 0 && this.currentState === "speaking") {
                  if (this.manuallyActivated) {
                    this.setMicMuted(false);
                    this.setState("listening");
                  } else {
                    this.startPostSpeechWindow(5000);
                  }
                }
              }, 100);
            }
          }

          // Handle live captions transcription
          if (data.type === "transcription") {
            this.onTranscription(data.role, data.text);
            if (data.role === "model") this.modelTranscriptForFallback += String(data.text || "");
          }

          // Handle memory synchronization
          if (data.type === "memory_sync" && data.memories) {
            if (this.onMemorySync) {
              this.onMemorySync(data.memories);
            }
          }

          // Handle Knowledge Graph summary opening
          if (data.type === "open_daily_summary" || data.type === "daily_summary_flashcard" || data.type === "runtime:ui:open_daily_summary") {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("jayra:open_daily_summary", { detail: data }));
            }
          }

          // Handle Tool Calling
          if (data.type === "toolCall") {
            const { callId, name, args } = data;
            this.onToolCall(name, args, (result) => {
              // Send back execution result to server bridge
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                  type: "toolResponse",
                  id: callId,
                  name: name,
                  output: result
                }));
              }
            });
          }

          // Screen-vision lifecycle events from the server.
          if (data.type === "screenVisionState") {
            if (this.onScreenVisionState) {
              this.onScreenVisionState(data.state, {
                activeWindow: data.activeWindow ?? null,
                error: data.error ?? null,
              });
            }
          }

        } catch (parseError) {
          console.error("Error reading server packet:", parseError);
        }
      };

      this.ws.onerror = (wsError) => {
        console.error("WebSocket transport error:", wsError);
        this.onError("Holographic network link lost. Please check connection.");
        this.disconnect();
      };

      this.ws.onclose = () => {
        console.log("WebSocket connection closed");
        if (this.isActivated) {
          this.onError("Live voice connection closed unexpectedly.");
        }
        this.disconnect();
      };

    } catch (e: any) {
      console.error("Connection establish sequence failed:", e);
      this.onError(e.message || "Failed to initialize active channel.");
      this.disconnect();
    }
  }

  // Interruption triggers: stops all active audio players immediately
  private handleInterruption(notifyServer = true, suppressOutput = notifyServer) {
    if (notifyServer) console.info("[JAYRA Voice] Interruption detected (Barge-in).");
    if (suppressOutput) this.suppressOutputUntilUserStops = true;
    this.audioReceivedThisTurn = false;
    this.modelTranscriptForFallback = "";
    if (notifyServer && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    flushAudioQueue(this.activeSources, () => {
      this.nextStartTime = 0;
      this.outputSpeechStartedAt = 0;
    });
    this.setState("listening");
  }

  /**
   * Lightweight local VAD for turn-taking. It never calls a model: it only
   * emits start/stop events and flushes buffered TTS immediately on barge-in.
   */
  private updateVoiceActivity(samples: Float32Array): boolean {
    const timestamp = performance.now();
    const myraaOutputActive = this.currentState === "speaking" || this.activeSources.length > 0;

    // Full-duplex speaker playback can leak back into the microphone even with
    const outputRms = myraaOutputActive ? this.readOutputRms() : 0;
    const threshold = myraaOutputActive
      ? Math.max(
          this.bargeInVoiceThreshold,
          Math.min(0.1, outputRms * 0.32 + 0.012),
        )
      : this.voiceThreshold;
    const requiredFrames = myraaOutputActive ? this.bargeInStartFrames : 3;
    const activity = this.vad.process(samples, timestamp, threshold, requiredFrames, this.voiceThreshold);
    if (activity.started) {
      if (this.postSpeechWindowActive) {
        this.cancelPostSpeechWindow();
        this.manuallyActivated = true; // User replied to autonomous remark; promote to active manual conversation
      }
      if (isBargeIn(myraaOutputActive, activity)) {
        this.handleInterruption();
        this.emitConversationEvent("user_interrupted_myraa", activity.rms);
      } else {
        this.setState("listening");
      }
      console.info("[JAYRA VAD] Speech started.");
      this.emitConversationEvent("user_started_speaking", activity.rms);
    }
    if (activity.finished) {
      this.postSpeechWindowActive = false;
      this.suppressOutputUntilUserStops = false;
      console.info(`[JAYRA VAD] Speech finished (${activity.durationMs} ms).`);
      this.emitConversationEvent("user_stopped_speaking", activity.rms);
      this.setState("processing");
    }
    return activity.speaking;
  }

  private readOutputRms(): number {
    if (!this.outputAnalyser) return 0;
    const samples = new Uint8Array(this.outputAnalyser.fftSize);
    this.outputAnalyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      const normalized = (samples[i] - 128) / 128;
      energy += normalized * normalized;
    }
    return Math.sqrt(energy / Math.max(1, samples.length));
  }

  private emitConversationEvent(event: string, rms?: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "conversationEvent", event, rms }));
  }

  // Direct raw PCM chunk scheduled playback at 24kHz
  private playAudioPCMChunk(base64Audio: string) {
    if (!this.outputAudioCtx || !this.outputGainNode) return;

    try {
      if (this.currentState !== "speaking" || this.activeSources.length === 0) {
        this.outputSpeechStartedAt = performance.now();
      }
      this.setState("speaking");
      const uint8Array = base64ToUint8Array(base64Audio);
      const raw = pcm16ToFloats(uint8Array);
      const floats = this.pitchShifter ? this.pitchShifter.process(raw) : raw;

      // Create AudioBuffer of 24000Hz (the exact playback sample rate of Gemini outputs)
      const buffer = this.outputAudioCtx.createBuffer(1, floats.length, 24000);
      buffer.getChannelData(0).set(floats);

      // Create Buffer source
      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = buffer;

      // Connect source to gain which is routed to analyser & speakers
      source.connect(this.outputGainNode);

      const schedule = schedulePcmChunk(
        this.outputAudioCtx.currentTime,
        this.nextStartTime,
        buffer.duration,
      );
      source.start(schedule.startTime);
      this.nextStartTime = schedule.nextStartTime;

      // Keep reference to handle real-time interruptions
      source.onended = () => {
        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }
        
        // If there are no more active play nodes, return to listening or open post-speech window
        if (this.activeSources.length === 0 && this.currentState === "speaking") {
          this.outputSpeechStartedAt = 0;
          if (this.manuallyActivated) {
            this.setMicMuted(false);
            this.setState("listening");
          } else {
            this.startPostSpeechWindow(5000);
          }
        }
      };

      this.activeSources.push(source);

    } catch (playbackError) {
      console.error("PCM Chunk buffering/playback failed:", playbackError);
    }
  }

  // Fully cleanup and release microphones & connection sockets
  public disconnect() {
    this.cancelPostSpeechWindow();
    this.manuallyActivated = false;
    this.isMicMuted = false;
    this.isActivated = false;
    this.liveReady = false;
    this.outputReady = false;
    this.setState("disconnected");

    // Close WS socket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    // Stop and release user microphone streams
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.micStream = null;
    }

    // Disconnect routing nodes
    if (this.micProcessorNode) {
      try {
        this.micProcessorNode.disconnect();
      } catch (e) {}
      this.micProcessorNode = null;
    }

    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (e) {}
      this.micSourceNode = null;
    }

    // Close Audio contexts
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch (e) {}
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch (e) {}
      this.outputAudioCtx = null;
    }

    this.activeSources = [];
    this.nextStartTime = 0;
    this.vad.reset();
    this.outputSpeechStartedAt = 0;
    this.pendingTextMessages = [];
    this.modelTranscriptForFallback = "";
    this.audioReceivedThisTurn = false;
    this.suppressOutputUntilUserStops = false;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputGainNode = null;
  }
}
