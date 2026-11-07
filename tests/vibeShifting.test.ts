import test from "node:test";
import assert from "node:assert/strict";
import { AmbientVibeEngine, VibeShiftEvent } from "../runtime/ambientVibeShifting";

test("ambient vibe engine initializes with default daylight state and configurations", () => {
  const engine = new AmbientVibeEngine();
  const status = engine.getStatus();

  assert.equal(status.enabled, true);
  assert.equal(status.currentVibe, "DAYTIME_NORMAL");
  assert.equal(status.hudBrightness, 1.0);
  assert.equal(status.dndEnabled, false);
  assert.equal(status.ambientAudio.playing, false);
  assert.equal(status.config.nightStartHour, 23);
  assert.equal(status.config.nightEndHour, 5);
  assert.equal(status.config.sedentaryMinutesThreshold, 45);
});

test("ambient vibe engine does not shift during normal daytime coding hours", () => {
  const engine = new AmbientVibeEngine();
  let shiftCount = 0;
  engine.onVibeShift(() => {
    shiftCount++;
  });

  const event = engine.recordContext({
    currentHour: 14, // 2 PM
    activeProcess: "Code.exe",
    activeWindowTitle: "server.ts - Visual Studio Code",
    phoneStepCountDelta: 0,
    phoneMotionState: "sedentary",
  }, 1000);

  assert.equal(event, null);
  assert.equal(shiftCount, 0);
  assert.equal(engine.getCurrentVibe(), "DAYTIME_NORMAL");
});

test("ambient vibe engine autonomously triggers DEEP_FOCUS_NIGHT upon late-night sedentary coding", () => {
  const engine = new AmbientVibeEngine({
    nightStartHour: 23,
    nightEndHour: 5,
    sedentaryMinutesThreshold: 30,
  });

  let capturedEvent: VibeShiftEvent | null = null;
  engine.onVibeShift((evt) => {
    capturedEvent = evt;
  });

  // T = 0: Initial observation at 2 AM
  const e1 = engine.recordContext({
    currentHour: 2, // 2 AM
    activeProcess: "Code.exe",
    activeWindowTitle: "server.ts - JAYRA - Visual Studio Code",
    phoneStepCountDelta: 0,
    phoneMotionState: "sedentary",
  }, 0);
  assert.equal(e1, null); // 0 minutes sedentary < 30m threshold

  // T = 35 minutes later (2100000ms): Still sitting, still coding at 2 AM
  const e2 = engine.recordContext({
    currentHour: 2,
    activeProcess: "Code.exe",
    activeWindowTitle: "server.ts - JAYRA - Visual Studio Code",
    phoneStepCountDelta: 0,
    phoneMotionState: "sedentary",
  }, 2_100_000);

  assert.ok(e2 !== null);
  assert.equal(e2?.vibe, "DEEP_FOCUS_NIGHT");
  assert.equal(e2?.hudBrightness, 0.35);
  assert.equal(e2?.dndEnabled, true);
  assert.equal(e2?.ambientAudio.playing, true);
  assert.equal(e2?.ambientAudio.profile, "LO_FI_CYBERPUNK");
  assert.equal(e2?.ambientAudio.volume, 0.22);
  assert.ok(e2?.sassyNotice.textUrdu.includes("کوڈ"));
  assert.ok(e2?.sassyNotice.textHinglish.includes("code"));
  assert.equal(capturedEvent, e2);
  assert.equal(engine.getCurrentVibe(), "DEEP_FOCUS_NIGHT");
});

test("ambient vibe engine transitions to CREATIVE_FLOW when user stands up / moves", () => {
  const engine = new AmbientVibeEngine();

  // First put in DEEP_FOCUS_NIGHT
  engine.manualShift("DEEP_FOCUS_NIGHT", "Test setup", 1000);
  assert.equal(engine.getCurrentVibe(), "DEEP_FOCUS_NIGHT");

  // User stands up (phone records 20 steps, walking motion)
  const event = engine.recordContext({
    currentHour: 3,
    activeProcess: "Code.exe",
    phoneStepCountDelta: 20,
    phoneMotionState: "walking",
  }, 2000);

  assert.ok(event !== null);
  assert.equal(event?.vibe, "CREATIVE_FLOW");
  assert.equal(event?.hudBrightness, 0.75);
  assert.equal(event?.ambientAudio.profile, "SYNTHWAVE_FOCUS");
});

test("ambient vibe engine restores DAYTIME_NORMAL once morning arrives", () => {
  const engine = new AmbientVibeEngine();
  engine.manualShift("DEEP_FOCUS_NIGHT", "Night session", 1000);

  // 9 AM arrives
  const event = engine.recordContext({
    currentHour: 9,
    activeProcess: "Code.exe",
    activeWindowTitle: "server.ts - Visual Studio Code",
  }, 5000);

  assert.ok(event !== null);
  assert.equal(event?.vibe, "DAYTIME_NORMAL");
  assert.equal(event?.hudBrightness, 1.0);
  assert.equal(event?.dndEnabled, false);
  assert.equal(event?.ambientAudio.playing, false);
});

test("ambient vibe engine respects disabled toggle and config updates", () => {
  const engine = new AmbientVibeEngine();

  engine.updateConfig({ dimmedHudBrightness: 0.25, ambientVolume: 0.18 });
  assert.equal(engine.getConfig().dimmedHudBrightness, 0.25);
  assert.equal(engine.getConfig().ambientVolume, 0.18);

  engine.setEnabled(false);
  assert.equal(engine.isEnabled(), false);

  // Even at 2 AM with 60 min sedentary, no transition occurs when disabled
  const event = engine.recordContext({
    currentHour: 2,
    activeProcess: "Code.exe",
    phoneStepCountDelta: 0,
    phoneMotionState: "sedentary",
  }, 10_000_000);

  assert.equal(event, null);
  assert.equal(engine.getCurrentVibe(), "DAYTIME_NORMAL");
});
