import assert from "node:assert/strict";
import test from "node:test";
import { expressionForCharacterState } from "../character/face/ExpressionLibrary";
import { blinkIntervalRange } from "../character/face/FaceController";

test("neutral app states map to activity-specific facial expressions", () => {
  assert.equal(expressionForCharacterState("idle", "thinking"), "thinking");
  assert.equal(expressionForCharacterState("neutral", "listening"), "listening");
  assert.equal(expressionForCharacterState("idle", "idle"), "neutral");
});

test("explicit emotional states take precedence over activity", () => {
  assert.equal(expressionForCharacterState("happy", "thinking"), "happy");
  assert.equal(expressionForCharacterState("confused", "listening"), "confused");
});

test("automatic blink intervals stay between 2.5 and 6 seconds", () => {
  assert.deepEqual(blinkIntervalRange(2.5, 6), [2.5, 6]);
  assert.deepEqual(blinkIntervalRange(1, 9), [2.5, 6]);
  assert.deepEqual(blinkIntervalRange(8, 9), [6, 6]);
});