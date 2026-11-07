/**
 * tests/micGating.test.ts
 * Unit tests for Two-Tier Passive Perception & Flexible Mic Gating Subsystem
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MicGatingManager } from "../runtime/micGating";

describe("MicGatingManager", () => {
  it("initializes with mic muted by default and cyan indicator", () => {
    const manager = new MicGatingManager({ defaultMode: "hotkey" });
    const state = manager.getState();

    assert.equal(state.isMuted, true, "Mic must be muted by default");
    assert.equal(state.micState, "muted");
    assert.equal(state.indicatorColor, "cyan");
    assert.equal(state.adaptiveWindowActive, false);
    manager.destroy();
  });

  it("handles mode changes cleanly", () => {
    const manager = new MicGatingManager({ defaultMode: "hotkey" });

    manager.setMode("widget");
    assert.equal(manager.getState().mode, "widget");

    manager.setMode("wakeword");
    assert.equal(manager.getState().mode, "wakeword");

    manager.setMode("manual");
    assert.equal(manager.getState().mode, "manual");
    manager.destroy();
  });

  it("operates push-to-talk in hotkey mode", () => {
    const manager = new MicGatingManager({ defaultMode: "hotkey" });

    // Press hotkey (hold)
    manager.setHotkeyState(true, false);
    assert.equal(manager.getState().isMuted, false);
    assert.equal(manager.getState().micState, "listening");
    assert.equal(manager.getState().indicatorColor, "emerald");

    // Release hotkey
    manager.setHotkeyState(false, false);
    assert.equal(manager.getState().isMuted, true);
    assert.equal(manager.getState().micState, "muted");
    assert.equal(manager.getState().indicatorColor, "cyan");
    manager.destroy();
  });

  it("operates toggle in hotkey mode", () => {
    const manager = new MicGatingManager({ defaultMode: "hotkey" });

    // First toggle press: open mic
    manager.setHotkeyState(true, true);
    assert.equal(manager.getState().isMuted, false);
    assert.equal(manager.getState().micState, "listening");
    assert.equal(manager.getState().indicatorColor, "emerald");

    // Second toggle press: mute mic
    manager.setHotkeyState(true, true);
    assert.equal(manager.getState().isMuted, true);
    assert.equal(manager.getState().micState, "muted");
    assert.equal(manager.getState().indicatorColor, "cyan");
    manager.destroy();
  });

  it("transitions indicator to amber when JAYRA speaks and recovers", () => {
    const manager = new MicGatingManager();

    // JAYRA starts speaking
    manager.setJayraSpeaking(true);
    assert.equal(manager.getState().micState, "speaking");
    assert.equal(manager.getState().indicatorColor, "amber");

    // JAYRA finishes speaking
    manager.setJayraSpeaking(false);
    assert.equal(manager.getState().micState, "muted");
    assert.equal(manager.getState().indicatorColor, "cyan");
    manager.destroy();
  });

  it("opens adaptive listening window and closes on initial timeout if silent", async () => {
    let closedReason = "";
    const manager = new MicGatingManager({
      initialWindowTimeoutMs: 50,
      silenceGracePeriodMs: 50,
    });
    manager.onListeningWindowClosed((data) => {
      closedReason = data.reason;
    });

    manager.openAdaptiveListeningWindow({ reason: "proactive_wellness_check" });
    assert.equal(manager.getState().adaptiveWindowActive, true);
    assert.equal(manager.getState().indicatorColor, "emerald");
    assert.equal(manager.getState().isMuted, false);

    // Wait for initial timeout to elapse
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(manager.getState().adaptiveWindowActive, false);
    assert.equal(manager.getState().isMuted, true);
    assert.equal(closedReason, "initial_timeout");
    manager.destroy();
  });

  it("keeps adaptive listening window open continuously while user speaks (VAD uncapped)", async () => {
    let closedReason = "";
    const manager = new MicGatingManager({
      initialWindowTimeoutMs: 40,
      silenceGracePeriodMs: 60,
    });
    manager.onListeningWindowClosed((data) => {
      closedReason = data.reason;
    });

    manager.openAdaptiveListeningWindow({ reason: "proactive_query" });

    // User starts speaking before initial timeout (at 10ms)
    await new Promise((r) => setTimeout(r, 10));
    manager.reportVoiceActivity(true);

    // Initial timeout (40ms) should be bypassed because user is speaking!
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(manager.getState().adaptiveWindowActive, true, "Window must stay open while speaking");
    assert.equal(closedReason, "");

    // User stops speaking
    manager.reportVoiceActivity(false);

    // Wait for silence grace period (60ms) to elapse
    await new Promise((r) => setTimeout(r, 90));

    assert.equal(manager.getState().adaptiveWindowActive, false);
    assert.equal(closedReason, "speech_completed");
    manager.destroy();
  });

  it("handles wake-word trigger", () => {
    const manager = new MicGatingManager({ defaultMode: "wakeword" });

    manager.onWakeWordDetected();
    assert.equal(manager.getState().adaptiveWindowActive, true);
    assert.equal(manager.getState().isMuted, false);
    assert.equal(manager.getState().indicatorColor, "emerald");
    manager.destroy();
  });

  it("updates floating widget coordinates", () => {
    const manager = new MicGatingManager();
    manager.setWidgetPosition(120, 240);
    assert.equal(manager.getState().floatingWidget.x, 120);
    assert.equal(manager.getState().floatingWidget.y, 240);
    manager.destroy();
  });

  it("keeps mic open post-speech for reply window and extends dynamically with VAD", async () => {
    let closedReason = "";
    const manager = new MicGatingManager({
      initialWindowTimeoutMs: 60,
      silenceGracePeriodMs: 60,
    });
    manager.onListeningWindowClosed((data) => {
      closedReason = data.reason;
    });

    // JAYRA starts speaking
    manager.setJayraSpeaking(true);
    assert.equal(manager.getState().micState, "speaking");

    // JAYRA finishes speaking -> 5s post-speech continuation window triggers
    manager.onJayraSpeechFinished({ continuationMs: 60 });
    assert.equal(manager.getState().micState, "listening");
    assert.equal(manager.getState().isMuted, false);
    assert.equal(manager.getState().adaptiveWindowActive, true);

    // User speaks within the continuation window (at 20ms)
    await new Promise((r) => setTimeout(r, 20));
    manager.reportVoiceActivity(true);

    // Initial timeout (60ms) should be cancelled because user is actively speaking
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(manager.getState().adaptiveWindowActive, true);
    assert.equal(closedReason, "");

    // User stops speaking
    manager.reportVoiceActivity(false);
    await new Promise((r) => setTimeout(r, 90));

    assert.equal(manager.getState().adaptiveWindowActive, false);
    assert.equal(closedReason, "speech_completed");
    manager.destroy();
  });
});
