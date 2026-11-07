import test from "node:test";
import assert from "node:assert/strict";
import { SpatialProximityManager, SpatialHandoffEvent } from "../runtime/spatialProximity";

test("spatial proximity manager initializes with default configuration and NEAR state", () => {
  const manager = new SpatialProximityManager();
  const config = manager.getConfig();

  assert.equal(config.enabled, true);
  assert.equal(config.hysteresisMs, 4000);
  assert.equal(config.rssiAwayThreshold, -75);
  assert.equal(config.rssiNearThreshold, -65);
  assert.equal(config.latencyAwayThresholdMs, 90);
  assert.equal(config.latencyNearThresholdMs, 40);
  assert.equal(manager.getAudioRoutingMode(), "DESKTOP_ONLY");
  assert.equal(manager.getOverallState(), "UNKNOWN");
});

test("spatial proximity manager processes telemetry and computes smoothed metrics", () => {
  const manager = new SpatialProximityManager();
  const deviceId = "dev-pixel-9";

  // First reading: strong signal
  const { record: r1 } = manager.recordTelemetry(deviceId, { rssi: -50, latencyMs: 15 }, 1000);
  assert.equal(r1.smoothedRssi, -50);
  assert.equal(r1.smoothedLatencyMs, 15);
  assert.ok(r1.proximityScore >= 80, `Expected score >= 80, got ${r1.proximityScore}`);
  assert.equal(r1.currentState, "NEAR");

  // Second reading: slight fluctuation
  const { record: r2 } = manager.recordTelemetry(deviceId, { rssi: -55, latencyMs: 25 }, 2000);
  // smoothedRssi = 0.35 * -55 + 0.65 * -50 = -51.75 -> -51.8
  assert.ok(r2.smoothedRssi !== null && r2.smoothedRssi < -50 && r2.smoothedRssi > -55);
  assert.equal(r2.currentState, "NEAR");
});

test("spatial proximity manager enforces hysteresis debounce before AWAY handoff", () => {
  const manager = new SpatialProximityManager({ hysteresisMs: 4000 });
  const deviceId = "dev-pixel-9";
  let capturedEvent: SpatialHandoffEvent | null = null;
  manager.onHandoff((evt) => {
    capturedEvent = evt;
  });

  // T = 0: Good signal, initial NEAR
  manager.recordTelemetry(deviceId, { rssi: -52, latencyMs: 18 }, 0);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "NEAR");
  assert.equal(capturedEvent, null);

  // T = 1000: Sudden bad signal (user walks away, RSSI drops to -85, latency spikes to 140ms)
  const { record: r1, handoffEvent: h1 } = manager.recordTelemetry(deviceId, { rssi: -85, latencyMs: 140 }, 1000);
  assert.equal(r1.currentState, "TRANSITIONING_AWAY");
  assert.equal(h1, null);
  assert.equal(capturedEvent, null);
  assert.equal(manager.getAudioRoutingMode(), "DESKTOP_ONLY"); // Still on desktop

  // T = 3000 (2s elapsed < 4s hysteresis): Low signal persists
  const { record: r2, handoffEvent: h2 } = manager.recordTelemetry(deviceId, { rssi: -88, latencyMs: 150 }, 3000);
  assert.equal(r2.currentState, "TRANSITIONING_AWAY");
  assert.equal(h2, null);
  assert.equal(capturedEvent, null);

  // T = 3500: Temporary bounce back to strong signal -> Aborts transition!
  manager.recordTelemetry(deviceId, { rssi: -52, latencyMs: 15 }, 3500);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "NEAR");

  // Now, sustained away from T = 5000 to T = 9500 (> 4s hysteresis)
  manager.recordTelemetry(deviceId, { rssi: -88, latencyMs: 160 }, 5000);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "TRANSITIONING_AWAY");

  manager.recordTelemetry(deviceId, { rssi: -88, latencyMs: 160 }, 7000);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "TRANSITIONING_AWAY");

  // At T = 9050 (4050ms after T = 5000)
  const { record: rFinal, handoffEvent: hFinal } = manager.recordTelemetry(deviceId, { rssi: -90, latencyMs: 180 }, 9050);
  assert.equal(rFinal.currentState, "AWAY");
  assert.ok(hFinal !== null);
  assert.equal(hFinal?.state, "AWAY");
  assert.equal(hFinal?.newAudioMode, "PHONE_ONLY");
  assert.equal(manager.getAudioRoutingMode(), "PHONE_ONLY");
  assert.ok(hFinal?.message && hFinal.message.length > 10);
  assert.equal(capturedEvent, hFinal);
});

test("spatial proximity manager handles return transition back to NEAR", () => {
  const manager = new SpatialProximityManager({ hysteresisMs: 3000 });
  const deviceId = "dev-pixel-9";
  let capturedEvent: SpatialHandoffEvent | null = null;
  manager.onHandoff((evt) => {
    capturedEvent = evt;
  });

  // Start in AWAY state
  manager.recordTelemetry(deviceId, { rssi: -90, latencyMs: 180 }, 0);
  manager.recordTelemetry(deviceId, { rssi: -90, latencyMs: 180 }, 3100);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "AWAY");
  assert.equal(manager.getAudioRoutingMode(), "PHONE_ONLY");

  // User returns to desk (T = 5000: strong RSSI -50, latency 12ms)
  manager.recordTelemetry(deviceId, { rssi: -50, latencyMs: 12 }, 5000);
  assert.equal(manager.getDeviceRecord(deviceId)?.currentState, "TRANSITIONING_NEAR");

  // At T = 8100 (> 3000ms return debounce)
  const { record: rReturn, handoffEvent: hReturn } = manager.recordTelemetry(deviceId, { rssi: -48, latencyMs: 10 }, 8100);
  assert.equal(rReturn.currentState, "NEAR");
  assert.ok(hReturn !== null);
  assert.equal(hReturn?.state, "NEAR");
  assert.equal(hReturn?.newAudioMode, "DESKTOP_ONLY");
  assert.equal(manager.getAudioRoutingMode(), "DESKTOP_ONLY");
  assert.ok(hReturn?.message && hReturn.message.length > 10);
});

test("spatial proximity manager handles ping roundtrip latency acks and config updates", () => {
  const manager = new SpatialProximityManager();
  const deviceId = "dev-pixel-9";

  const ping = manager.createPing(deviceId);
  assert.ok(ping.pingId);
  assert.equal(ping.type, "proximity_ping");

  // Simulating ping ACK received 25ms later with RSSI -58
  const { record } = manager.handlePingAck(deviceId, ping.timestamp, -58, ping.timestamp + 25);
  assert.equal(record.smoothedLatencyMs, 25);
  assert.equal(record.smoothedRssi, -58);
  assert.equal(record.currentState, "NEAR");

  // Config updates
  manager.updateConfig({ hysteresisMs: 6000, rssiAwayThreshold: -80 });
  assert.equal(manager.getConfig().hysteresisMs, 6000);
  assert.equal(manager.getConfig().rssiAwayThreshold, -80);

  // Toggle disable
  manager.setEnabled(false);
  assert.equal(manager.isEnabled(), false);
  const { handoffEvent } = manager.recordTelemetry(deviceId, { rssi: -95, latencyMs: 300 }, ping.timestamp + 10000);
  assert.equal(handoffEvent, null); // Disabled, no transition
});
