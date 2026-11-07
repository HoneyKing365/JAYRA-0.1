import assert from "node:assert/strict";
import test from "node:test";
import { WellnessActivityClock } from "./wellness";

test("wellness reminder clock fires at the selected amount of allowed activity", () => {
  const clock = new WellnessActivityClock(30_000);
  for (let i = 0; i < 59; i++) {
    assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), false);
  }
  assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), true);
  assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), false);
});

test("wellness clock resets when disabled or activity is protected", () => {
  const clock = new WellnessActivityClock(30_000);
  for (let i = 0; i < 20; i++) clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true });
  assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: false }), false);
  for (let i = 0; i < 59; i++) {
    assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), false);
  }
  assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), true);
  assert.equal(clock.tick({ enabled: false, intervalMinutes: 30, activityAllowed: true }), false);
  for (let i = 0; i < 59; i++) {
    assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), false);
  }
  assert.equal(clock.tick({ enabled: true, intervalMinutes: 30, activityAllowed: true }), true);
});
