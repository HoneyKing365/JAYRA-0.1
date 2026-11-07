import assert from "node:assert/strict";
import test from "node:test";
import {
  createMicrophoneAudioPacket,
  encodePcm16LE,
  flushAudioQueue,
  getSpeechFallbackText,
  isBargeIn,
  VoiceActivityDetector,
} from "../src/lib/audio";
import { BrowserTts, splitSpeechIntoChunks } from "../src/lib/tts";
import { matchesWakePhrase, MyraaWakeWordDetector, type SpeechRecognitionLike } from "../src/lib/wakeWord";
import { normalizeSpeechSettings } from "../src/lib/settingsStore";
import { isPlausibleVoiceTranscript, isVoiceActionIntent } from "../voice/transcriptGuard";

class FakeRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start() { this.onstart?.(); }
  stop() {}
  abort() {}
  recognize(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [[{ transcript }]] });
  }
}

test("wake word accepts the full phrase and the standalone Jayra fallback", () => {
  assert.equal(matchesWakePhrase("Okay, hey Jayra!", "hey jayra"), true);
  assert.equal(matchesWakePhrase("Jayra", "hey jayra"), true);
  assert.equal(matchesWakePhrase("Jayram", "hey jayra"), false);
  assert.equal(matchesWakePhrase("wake up", "computer"), false);
});

test("wake detector transitions to triggered for the fallback phrase", () => {
  let recognition: FakeRecognition | null = null;
  const FakeCtor = class extends FakeRecognition {
    constructor() {
      super();
      recognition = this;
    }
  };
  const states: string[] = [];
  const detected: string[] = [];
  const detector = new MyraaWakeWordDetector(FakeCtor);
  assert.equal(detector.start({ phrase: "hey jayra", onState: (state) => states.push(state), onTriggered: (phrase) => detected.push(phrase) }), true);
  recognition?.recognize("Jayra");
  assert.deepEqual(states, ["listening", "triggered"]);
  assert.deepEqual(detected, ["jayra"]);
  detector.stop();
  assert.equal(states.at(-1), "stopped");
});

test("voice transcript guard accepts recognizable requests and rejects ambient-noise fragments", () => {
  assert.equal(isPlausibleVoiceTranscript("Could you open the browser?"), true);
  assert.equal(isPlausibleVoiceTranscript("open whatsapp"), true);
  assert.equal(isPlausibleVoiceTranscript("open youtube"), true);
  assert.equal(isPlausibleVoiceTranscript("um, open whatsapp"), true);
  assert.equal(isPlausibleVoiceTranscript("please, open youtube"), true);
  assert.equal(isVoiceActionIntent("uh, open whatsapp"), true);
  assert.equal(isVoiceActionIntent("purple chair open"), false);
  assert.equal(isVoiceActionIntent("open close"), false);
  assert.equal(isPlausibleVoiceTranscript("Play music"), true);
  assert.equal(isPlausibleVoiceTranscript("I'm having trouble with this page"), true);
  assert.equal(isPlausibleVoiceTranscript("stop"), true);
  assert.equal(isPlausibleVoiceTranscript("purple chair coconut"), false);
  assert.equal(isPlausibleVoiceTranscript("purple chair open"), false);
  assert.equal(isPlausibleVoiceTranscript("ha ha ha ha ha ha"), false);
  assert.equal(isPlausibleVoiceTranscript(""), false);
});

test("VAD requires sustained input and finishes after the configured silence", () => {
  const detector = new VoiceActivityDetector(800);
  const speech = new Float32Array([0.1, -0.1]);
  const silence = new Float32Array([0, 0]);
  assert.equal(detector.process(speech, 100, 0.02, 2).started, false);
  assert.equal(detector.process(speech, 200, 0.02, 2).started, true);
  assert.equal(detector.process(silence, 999, 0.02, 2).finished, false);
  const finished = detector.process(silence, 1000, 0.02, 2);
  assert.equal(finished.finished, true);
  assert.equal(finished.durationMs, 800);
  assert.equal(detector.isSpeaking, false);
});

test("VAD adapts to steady background noise while preserving normal speech", () => {
  const detector = new VoiceActivityDetector();
  const ambient = new Float32Array(64).fill(0.03);
  const speech = new Float32Array(64).fill(0.06);
  for (let frame = 0; frame < 8; frame += 1) {
    assert.equal(detector.process(ambient, frame * 64, 0.02, 3).started, false);
  }
  assert.equal(detector.process(speech, 600, 0.02, 3).started, false);
  assert.equal(detector.process(speech, 664, 0.02, 3).started, false);
  assert.equal(detector.process(speech, 728, 0.02, 3).started, true);
});

test("browser TTS queues sentence chunks with the configured voice and controls", () => {
  const utterances: Array<{ text: string; voice: SpeechSynthesisVoice | null; rate: number; pitch: number; volume: number; onstart: (() => void) | null; onend: (() => void) | null }> = [];
  let starts = 0;
  let ends = 0;
  const synthesis = {
    speak: (utterance: any) => utterances.push(utterance),
    cancel: () => undefined,
    getVoices: () => [],
  };
  const tts = new BrowserTts(synthesis, (text) => ({ text, voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null }));
  assert.equal(splitSpeechIntoChunks("First sentence. Second sentence!" ).length, 2);
  assert.equal(tts.speak("First sentence. Second sentence!", { voiceURI: "", rate: 1.2, pitch: 1.1, volume: 0.6 }, { onStart: () => starts += 1, onEnd: () => ends += 1 }), true);
  assert.equal(utterances.length, 1, "the next sentence waits until the current utterance completes");
  assert.equal(utterances[0].rate, 1.2);
  assert.equal(utterances[0].pitch, 1.1);
  assert.equal(utterances[0].volume, 0.6);
  utterances[0].onstart?.();
  utterances[0].onend?.();
  assert.equal(utterances.length, 2);
  utterances[1].onend?.();
  assert.equal(starts, 1);
  assert.equal(ends, 1);
});

test("live text falls back to browser speech only when the turn has no audio", () => {
  assert.equal(getSpeechFallbackText(false, "  Hello there.  "), "Hello there.");
  assert.equal(getSpeechFallbackText(true, "Already spoken."), null);
  assert.equal(getSpeechFallbackText(false, "Live audio is speaking.", true), null);
  assert.equal(getSpeechFallbackText(false, "  "), null);
});

test("browser speech settings are clamped to supported ranges", () => {
  assert.deepEqual(normalizeSpeechSettings({ ttsVoice: "voice-1", speechRate: 3, speechPitch: -1, speechVolume: 0.4 }), {
    ttsVoice: "voice-1", speechRate: 2, speechPitch: 0.5, speechVolume: 0.4,
  });
});

test("VAD detects barge-in in two frames while output is active", () => {
  const detector = new VoiceActivityDetector();
  const speech = new Float32Array([0.1, -0.1]);
  const first = detector.process(speech, 100, 0.045, 2);
  const second = detector.process(speech, 164, 0.045, 2);
  assert.equal(isBargeIn(true, first), false);
  assert.equal(isBargeIn(true, second), true);
  assert.equal(isBargeIn(false, second), false);
});

test("microphone PCM encodes signed 16-bit little-endian samples and packet shape", () => {
  const pcm = encodePcm16LE(new Float32Array([-1, 0, 1]));
  const view = new DataView(pcm);
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), 0);
  assert.equal(view.getInt16(4, true), 32767);
  assert.deepEqual(JSON.parse(JSON.stringify(createMicrophoneAudioPacket("AQID"))), { audio: "AQID" });
});

test("barge-in flush stops every queued source and resets the scheduler", () => {
  const stopped: string[] = [];
  const queue = [
    { stop: () => stopped.push("first") },
    { stop: () => { stopped.push("second"); throw new Error("already ended"); } },
  ];
  let scheduleReset = false;
  flushAudioQueue(queue, () => { scheduleReset = true; });
  assert.deepEqual(stopped, ["first", "second"]);
  assert.equal(queue.length, 0);
  assert.equal(scheduleReset, true);
});