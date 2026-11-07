import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettings } from "../../settings/appSettings";
import { ConversationPresenceEngine } from "../../presence/conversationPresence";

test("proactive companion settings normalize correctly with defaults", () => {
  const norm = normalizeSettings({});
  assert.equal(norm.behavior.focusMode, false);
  assert.equal(norm.behavior.focusModeDurationMin, null);
  assert.equal(norm.behavior.proactiveCompanionEnabled, true);

  const custom = normalizeSettings({
    behavior: {
      focusMode: true,
      focusModeDurationMin: 25,
      proactiveCompanionEnabled: false,
    },
  });
  assert.equal(custom.behavior.focusMode, true);
  assert.equal(custom.behavior.focusModeDurationMin, 25);
  assert.equal(custom.behavior.proactiveCompanionEnabled, false);
});

test("focus mode activates DND in conversation presence engine", () => {
  const engine = new ConversationPresenceEngine();
  assert.equal(engine.dnd.active, false);

  // Focus mode activates DND
  engine.setDnd(true);
  assert.equal(engine.dnd.active, true);

  const verdict = engine.request({
    reason: "casual",
    priority: "normal",
    key: "test:coding",
  });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.why, /Do not disturb/i);

  // Disabling DND restores conversation presence
  engine.setDnd(false);
  assert.equal(engine.dnd.active, false);
});

test("proactivity levels gate casual proactive initiation correctly", () => {
  const engine = new ConversationPresenceEngine();
  engine.configure({ level: "quiet" });

  const quietVerdict = engine.request({
    reason: "casual",
    priority: "normal",
    key: "proactive:test",
  });
  assert.equal(quietVerdict.allowed, false);
  assert.match(quietVerdict.why, /quiet proactivity/i);

  // In lively mode, casual proactive speech is an accepted reason
  engine.configure({ level: "lively" });
  assert.notEqual(engine.request({ reason: "critical_warning", priority: "high" }).why, "Not allowed at quiet proactivity.");
});
