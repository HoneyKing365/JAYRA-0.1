import assert from "node:assert/strict";
import test from "node:test";
import { VoiceActivityDetector, schedulePcmChunk } from "../lib/audio";
import { mapAudioFeaturesToVisemes } from "../character/face/LipSync";
import type { LipSyncConfig } from "../character/config/types";

const config: LipSyncConfig = {
  attack: 0.45,
  release: 0.18,
  gain: 1,
  noiseFloor: 0.015,
  maxWeight: 1,
  visemeBlendRate: 0.16,
};

test("PCM chunks schedule contiguously and recover with a small lead after underrun", () => {
  const first = schedulePcmChunk(4, 0, 0.02);
  assert.equal(first.startTime, 4.02);
  assert.ok(Math.abs(first.nextStartTime - 4.04) < 1e-9);

  const contiguous = schedulePcmChunk(4.01, first.nextStartTime, 0.03);
  assert.ok(Math.abs(contiguous.startTime - 4.04) < 1e-9);
  assert.ok(Math.abs(contiguous.nextStartTime - 4.07) < 1e-9);

  const afterUnderrun = schedulePcmChunk(5, contiguous.nextStartTime, 0.01);
  assert.equal(afterUnderrun.startTime, 5.02);
  assert.ok(Math.abs(afterUnderrun.nextStartTime - 5.03) < 1e-9);
});

test("VAD ends a turn after 300 ms of silence", () => {
  const detector = new VoiceActivityDetector();
  const speech = new Float32Array([0.1, -0.1]);
  const silence = new Float32Array([0, 0]);

  detector.process(speech, 0, 0.02, 1);
  assert.equal(detector.process(silence, 299, 0.02, 1).finished, false);
  assert.equal(detector.process(silence, 300, 0.02, 1).finished, true);
});

test("RMS amplitude maps to bounded, increasing mouth aperture", () => {
  const quiet = mapAudioFeaturesToVisemes({ rms: 0.025, low: 0.1, mid: 0.1, high: 0.1 }, config);
  const loud = mapAudioFeaturesToVisemes({ rms: 0.2, low: 0.1, mid: 0.1, high: 0.1 }, config);
  const silence = mapAudioFeaturesToVisemes({ rms: 0, low: 0, mid: 0, high: 0 }, config);

  assert.ok(quiet.openness > 0);
  assert.ok(loud.openness > quiet.openness);
  assert.equal(silence.openness, 0);
  for (const value of Object.values(loud)) assert.ok(value >= 0 && value <= 1);
});

test("frequency bands shift vowel visemes while preserving the aperture range", () => {
  const backVowel = mapAudioFeaturesToVisemes({ rms: 0.12, low: 0.8, mid: 0.1, high: 0.05 }, config);
  const frontVowel = mapAudioFeaturesToVisemes({ rms: 0.12, low: 0.1, mid: 0.4, high: 0.7 }, config);

  assert.ok(backVowel.a > frontVowel.a);
  assert.ok(frontVowel.i > backVowel.i);
  assert.ok(backVowel.openness >= 0 && backVowel.openness <= 1);
  assert.ok(frontVowel.openness >= 0 && frontVowel.openness <= 1);
});