/**
 * JAYRA Multi-TTS Engine
 *
 * Supports:
 *  1. Mark LV JARVIS Voice (Ported from Mark LV 5 reference with Ryan/Thomas/Guy neural models)
 *  2. Microsoft Edge TTS (Online neural high-fidelity voices)
 *  3. Web Speech API (Local browser synthesis)
 *  4. Seamless fallback and graceful degradation
 */

export type TtsProvider = "gemini" | "mark_lv_jarvis" | "edge_tts" | "web_speech";

export interface BrowserTtsSettings {
  provider?: TtsProvider;
  voiceURI: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface BrowserTtsCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
}

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  gender: "Male" | "Female";
  tone: string;
}

export const MARK_LV_VOICES: VoiceOption[] = [
  { id: "en-GB-RyanNeural", name: "JARVIS (Mark LV - Ryan UK)", lang: "en-GB", gender: "Male", tone: "Signature British Cadence / Refined" },
  { id: "en-GB-ThomasNeural", name: "JARVIS Analytical (Thomas UK)", lang: "en-GB", gender: "Male", tone: "Calm / Authoritative" },
  { id: "en-US-GuyNeural", name: "JARVIS US (Mark LV Default)", lang: "en-US", gender: "Male", tone: "Crisp / Professional" },
  { id: "en-US-ChristopherNeural", name: "JARVIS Warm (Christopher US)", lang: "en-US", gender: "Male", tone: "Warm / Conversational" },
  { id: "en-GB-SoniaNeural", name: "FRIDAY AI (Sonia UK)", lang: "en-GB", gender: "Female", tone: "Sophisticated / Executive" },
];

export const EDGE_TTS_POPULAR_VOICES: VoiceOption[] = [
  ...MARK_LV_VOICES,
  { id: "en-US-AriaNeural", name: "Aria (US Natural)", lang: "en-US", gender: "Female", tone: "Expressive / Versatile" },
  { id: "en-US-JennyNeural", name: "Jenny (US Assistant)", lang: "en-US", gender: "Female", tone: "Friendly / Clear" },
  { id: "en-IN-NeerjaNeural", name: "Neerja (Indian English)", lang: "en-IN", gender: "Female", tone: "Clear / Natural" },
  { id: "en-IN-PrabhatNeural", name: "Prabhat (Indian English)", lang: "en-IN", gender: "Male", tone: "Formal / Articulate" },
];

export const GEMINI_LIVE_VOICES = [
  "Aoede", "Puck", "Charon", "Fenrir", "Kore", "Leda", "Zephyr",
  "Autonoe", "Laomedeia", "Achernar", "Callirrhoe", "Vindemiatrix", "Sulafat", "Orus"
];

interface SpeechUtterancePort {
  text: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  volume: number;
  lang?: string;
  onstart: ((event?: any) => void) | null;
  onend: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
}

interface SpeechSynthesisPort {
  speak(utterance: SpeechUtterancePort): void;
  cancel(): void;
  pause?(): void;
  resume?(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export function splitSpeechIntoChunks(text: string, maxCharacters = 220): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [normalized];
  const chunks: string[] = [];

  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    if (sentence.length <= maxCharacters) {
      chunks.push(sentence);
      continue;
    }
    let current = "";
    for (const word of sentence.split(" ")) {
      if (current && `${current} ${word}`.length > maxCharacters) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

function browserSpeechSynthesis(): SpeechSynthesisPort | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  return window.speechSynthesis as unknown as SpeechSynthesisPort;
}

function createBrowserUtterance(text: string): SpeechUtterancePort {
  return new SpeechSynthesisUtterance(text) as unknown as SpeechUtterancePort;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && window.speechSynthesis) {
  cachedVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
}

export function getBrowserSpeechVoices(): SpeechSynthesisVoice[] {
  const synth = browserSpeechSynthesis();
  const current = synth?.getVoices() ?? [];
  if (current.length) {
    cachedVoices = current;
    return current;
  }
  return cachedVoices;
}

export class BrowserTts {
  private generation = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private activeUtterances = new Set<SpeechUtterancePort>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly synthesis: SpeechSynthesisPort | null = browserSpeechSynthesis(),
    private readonly createUtterance: (text: string) => SpeechUtterancePort = createBrowserUtterance,
  ) {}

  speak(text: string, settings: BrowserTtsSettings, callbacks: BrowserTtsCallbacks = {}): boolean {
    const provider = settings.provider || "web_speech";

    // 1. Mark LV JARVIS or Edge-TTS online synthesis route
    if (provider === "mark_lv_jarvis" || provider === "edge_tts") {
      return this.speakOnline(text, settings, callbacks);
    }

    // 2. Standard Web Speech fallback
    return this.speakWebSpeech(text, settings, callbacks);
  }

  private speakOnline(text: string, settings: BrowserTtsSettings, callbacks: BrowserTtsCallbacks): boolean {
    const defaultJarvisVoice = "en-GB-RyanNeural";
    const voice = settings.voiceURI && settings.voiceURI.includes("Neural")
      ? settings.voiceURI
      : defaultJarvisVoice;

    this.cancel();
    const generation = ++this.generation;
    console.info(`[JAYRA Multi-TTS] Requesting online synthesis (${voice})...`);

    // Call server TTS endpoint
    fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice,
        rate: settings.rate,
        pitch: settings.pitch,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`TTS server returned ${res.status}`);
        const blob = await res.blob();
        if (generation !== this.generation) return;

        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        audio.volume = Math.max(0, Math.min(1, Number(settings.volume) || 1));
        audio.onplay = () => callbacks.onStart?.();
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          if (this.currentAudio === audio) this.currentAudio = null;
          if (generation === this.generation) callbacks.onEnd?.();
        };
        audio.onerror = (e) => {
          console.warn("[JAYRA Multi-TTS] Audio element error, falling back to Web Speech:", e);
          URL.revokeObjectURL(audioUrl);
          if (this.currentAudio === audio) this.currentAudio = null;
          if (generation === this.generation) {
            this.speakWebSpeech(text, settings, callbacks);
          }
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((playErr) => {
            console.warn("[JAYRA Multi-TTS] Audio play() promise rejected, falling back to Web Speech:", playErr);
            if (generation === this.generation) {
              this.speakWebSpeech(text, settings, callbacks);
            }
          });
        }
      })
      .catch((err) => {
        console.warn("[JAYRA Multi-TTS] Online synthesis unavailable, using Web Speech fallback:", err);
        if (generation === this.generation) {
          this.speakWebSpeech(text, settings, callbacks);
        }
      });

    return true;
  }

  private speakWebSpeech(text: string, settings: BrowserTtsSettings, callbacks: BrowserTtsCallbacks): boolean {
    const chunks = splitSpeechIntoChunks(text);
    if (!chunks.length) return false;

    this.cancel();
    const generation = ++this.generation;

    // Chrome speechSynthesis pause/stall workaround - resume before & start heartbeat
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.resume();
      } catch {}
    }

    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        if (this.activeUtterances.size > 0 && window.speechSynthesis.paused) {
          try { window.speechSynthesis.resume(); } catch {}
        }
      }
    }, 3000);

    const synth = this.synthesis ?? browserSpeechSynthesis();
    if (!synth) return false;

    let voices = synth.getVoices();
    if (!voices.length && cachedVoices.length) {
      voices = cachedVoices;
    }
    
    // Pick appropriate voice
    let voice = voices.find((item) => item.voiceURI === settings.voiceURI) ?? null;
    if (!voice && settings.provider === "mark_lv_jarvis") {
      voice = voices.find((v) => v.lang.startsWith("en-GB") && /male|david|george|oliver/i.test(v.name))
        || voices.find((v) => v.lang.startsWith("en-GB"))
        || voices.find((v) => v.lang.startsWith("en"))
        || null;
    }

    if (!voice && settings.voiceURI) {
      const langMatch = settings.voiceURI.match(/([a-z]{2}-[A-Z]{2})/i)?.[1];
      if (langMatch) {
        voice = voices.find((v) => v.lang.toLowerCase() === langMatch.toLowerCase())
          || voices.find((v) => v.lang.toLowerCase().startsWith(langMatch.slice(0, 2).toLowerCase()))
          || null;
      }
      if (!voice) {
        const cleanName = settings.voiceURI.replace(/^(en|ja|es|fr|de)-[A-Z]{2}-/i, "").replace(/Neural$/i, "").toLowerCase();
        if (cleanName) {
          voice = voices.find((v) => v.name.toLowerCase().includes(cleanName)) || null;
        }
      }
    }

    if (!voice) {
      voice = voices.find((v) => v.lang.startsWith("en"))
        || voices.find((v) => v.default)
        || voices[0]
        || null;
    }

    const rate = Math.max(0.5, Math.min(2, Number(settings.rate) || 1));
    const pitch = Math.max(0, Math.min(2, Number(settings.pitch) || 1));
    const volume = Math.max(0, Math.min(1, Number.isFinite(settings.volume) ? settings.volume : 1));
    let index = 0;

    console.info(`[JAYRA TTS] Audio stream started (${chunks.length} chunks via Web Speech, voice: ${voice?.name || "system default"}).`);
    
    const speakNext = () => {
      if (generation !== this.generation || index >= chunks.length) {
        if (generation === this.generation) {
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
          }
          callbacks.onEnd?.();
        }
        return;
      }
      const chunkIndex = index++;
      const utterance = this.createUtterance(chunks[chunkIndex]);
      this.activeUtterances.add(utterance);

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-US";
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      utterance.onstart = () => {
        if (chunkIndex === 0 && generation === this.generation) {
          callbacks.onStart?.();
        }
      };

      utterance.onend = () => {
        this.activeUtterances.delete(utterance);
        if (generation === this.generation) {
          speakNext();
        }
      };

      utterance.onerror = (e: any) => {
        this.activeUtterances.delete(utterance);
        // If aborted intentionally by cancel(), don't advance
        if (e?.error === "canceled" || e?.error === "interrupted") return;
        console.warn("[JAYRA TTS] Utterance error:", e);
        if (generation === this.generation) {
          speakNext();
        }
      };

      synth.speak(utterance);
      if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
        try { window.speechSynthesis.resume(); } catch {}
      }
    };

    speakNext();
    return true;
  }

  cancel(): void {
    this.generation += 1;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.activeUtterances.clear();
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
    this.synthesis?.cancel();
  }
}