import assert from "node:assert/strict";
import test from "node:test";
import { getTwoHandZoomDelta, isPinchActive, mapCursorPoint } from "./gestureMath";

test("cursor mapping preserves center and applies bounded sensitivity", () => {
  assert.deepEqual(mapCursorPoint({ x: 0.5, y: 0.5 }, 2), { x: 0.5, y: 0.5 });
  const mapped = mapCursorPoint({ x: 0.6, y: 0.4 }, 2);
  assert.ok(Math.abs(mapped.x - 0.7) < 1e-10);
  assert.ok(Math.abs(mapped.y - 0.3) < 1e-10);
  assert.deepEqual(mapCursorPoint({ x: 0, y: 1 }, 3), { x: 0, y: 1 });
  assert.deepEqual(mapCursorPoint({ x: 0.6, y: 0.4 }, Number.NaN), { x: 0.6, y: 0.4 });
});

test("pinch hysteresis prevents threshold chatter", () => {
  assert.equal(isPinchActive(0.29, false), true);
  assert.equal(isPinchActive(0.35, true), true);
  assert.equal(isPinchActive(0.43, true), false);
  assert.equal(isPinchActive(0.31, false), false);
});

test("two-hand zoom ignores noise and returns relative separation change", () => {
  assert.equal(getTwoHandZoomDelta(null, 0.5), null);
  assert.equal(getTwoHandZoomDelta(0.5, 0.51), null);
  assert.ok(Math.abs((getTwoHandZoomDelta(0.5, 0.55) ?? 0) - 0.1) < 1e-10);
  assert.ok(Math.abs((getTwoHandZoomDelta(0.5, 0.45) ?? 0) + 0.1) < 1e-10);
});
