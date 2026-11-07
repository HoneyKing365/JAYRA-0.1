import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppSettingsStore, normalizeSettings } from "./appSettings";

test("weather and news location starts unset and remains unset when omitted", () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.weatherNews.city, "");
  assert.equal(defaults.weatherNews.countryCode, "");
  assert.equal(normalizeSettings({ weatherNews: { city: "   " } }).weatherNews.city, "");
});

test("system telemetry settings normalize visibility, sample rate, and HUD corner", () => {
  const defaults = normalizeSettings({});
  assert.deepEqual(defaults.systemMonitor, {
    enabled: true,
    updateIntervalSeconds: 3,
    corner: "bottom-left",
  });
  const configured = normalizeSettings({
    systemMonitor: { enabled: false, updateIntervalSeconds: 5, corner: "top-right" },
  });
  assert.deepEqual(configured.systemMonitor, {
    enabled: false,
    updateIntervalSeconds: 5,
    corner: "top-right",
  });
  const invalid = normalizeSettings({
    systemMonitor: { updateIntervalSeconds: 2, corner: "middle" },
  });
  assert.equal(invalid.systemMonitor.updateIntervalSeconds, 3);
  assert.equal(invalid.systemMonitor.corner, "bottom-left");
});

test("developer diagnostic console defaults off and persists when enabled", async (t) => {
  assert.equal(normalizeSettings({}).developer.showErrorConsole, false);
  assert.equal(normalizeSettings({ developer: { showErrorConsole: true } }).developer.showErrorConsole, true);

  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-settings-diagnostics-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);
  await settings.initialize();
  const updated = await settings.update({ developer: { showErrorConsole: true } });
  assert.equal(updated.developer.showErrorConsole, true);
  assert.equal((await new AppSettingsStore(dataDir).initialize()).developer.showErrorConsole, true);
});

test("legacy renderer settings migrate into the canonical app settings store", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-settings-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);

  const migrated = await settings.initialize({
    autoStart: true,
    wakeWordEnabled: true,
    wakePhrase: "hello jayra",
    networkAccessEnabled: true,
    ttsProvider: "edge_tts",
  });

  assert.equal(migrated.renderer.autoStart, true);
  assert.equal(migrated.renderer.wakeWordEnabled, true);
  assert.equal(migrated.renderer.wakePhrase, "hello jayra");
  assert.equal(migrated.renderer.networkAccessEnabled, true);
  assert.equal(migrated.voice.ttsProvider, "edge_tts");
});

test("renderer settings updates share validation and persistence with app settings", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-settings-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);
  await settings.initialize();

  const updated = await settings.update({
    renderer: { sensitivity: 120, speechVolume: 4, uiViewMode: "invalid" },
    models3d: { wireframeMode: true },
  });

  const persisted = await new AppSettingsStore(dataDir).initialize();
  assert.equal(updated.renderer.sensitivity, 100);
  assert.equal(updated.renderer.speechVolume, 1);
  assert.equal(updated.renderer.uiViewMode, "companion");
  assert.equal(updated.models3d.wireframeMode, true);
  assert.deepEqual(persisted, updated);
});

test("persona settings validate, persist, and bound user-authored guidance", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-settings-persona-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);
  const defaults = await settings.initialize();
  assert.deepEqual(defaults.persona, {
    preset: "friendly_caring",
    relationshipRole: "close_friend",
    customRole: "",
    mood: "balanced",
    customPrompt: "",
    customPersonas: [],
    activeCustomPersonaId: null,
  });

  const updated = await settings.update({
    persona: {
      preset: "naughty_teasing",
      relationshipRole: "custom_role",
      customRole: `  ${"r".repeat(140)}  `,
      mood: "encouraging",
      customPrompt: "Be playful but focus on practical coding advice.",
    },
  });
  assert.equal(updated.persona.preset, "naughty_teasing");
  assert.equal(updated.persona.relationshipRole, "custom_role");
  assert.equal(updated.persona.customRole, "r".repeat(120));
  assert.equal(updated.persona.mood, "encouraging");
  assert.equal(updated.persona.customPrompt, "Be playful but focus on practical coding advice.");

  const reloaded = await new AppSettingsStore(dataDir).initialize();
  assert.deepEqual(reloaded.persona, updated.persona);
  const invalid = await settings.update({ persona: { preset: "unknown", mood: "unknown" } });
  assert.equal(invalid.persona.preset, "naughty_teasing");
  assert.equal(invalid.persona.mood, "encouraging");
});

test("custom persona library supports multiple saved profiles, selection, edits, and deletion", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-custom-personas-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);
  await settings.initialize();
  const createdAt = "2025-01-01T00:00:00.000Z";
  const customPersonas = [
    { id: "mentor", title: "Tech Mentor", description: "Patiently teaches coding.", createdAt },
    { id: "comedian", title: "Comedic Sidekick", description: "Uses gentle situational humor.", createdAt },
  ];

  const saved = await settings.update({ persona: { customPersonas, activeCustomPersonaId: "mentor" } });
  assert.deepEqual(saved.persona.customPersonas, customPersonas);
  assert.equal(saved.persona.activeCustomPersonaId, "mentor");

  const edited = await settings.update({
    persona: {
      customPersonas: customPersonas.map((persona) => persona.id === "mentor" ? { ...persona, title: "Senior Tech Mentor" } : persona),
    },
  });
  assert.equal(edited.persona.customPersonas[0].title, "Senior Tech Mentor");
  const deleted = await settings.update({
    persona: {
      customPersonas: edited.persona.customPersonas.filter((persona) => persona.id !== "mentor"),
      activeCustomPersonaId: null,
    },
  });
  assert.equal(deleted.persona.customPersonas.length, 1);
  assert.equal(deleted.persona.activeCustomPersonaId, null);
  assert.deepEqual((await new AppSettingsStore(dataDir).initialize()).persona.customPersonas, deleted.persona.customPersonas);
});

test("custom persona normalization removes invalid and duplicate records and bounds fields", () => {
  const normalized = normalizeSettings({
    persona: {
      customPersonas: [
        { id: "valid", title: ` ${"T".repeat(100)} `, description: "  Description  ", createdAt: "2025-01-01T00:00:00.000Z" },
        { id: "valid", title: "Duplicate", description: "Ignored", createdAt: "2025-01-01T00:00:00.000Z" },
        { id: "missing-date", title: "No date", description: "Invalid", createdAt: "not-a-date" },
        { id: "", title: "No id", description: "Invalid", createdAt: "2025-01-01T00:00:00.000Z" },
      ],
      activeCustomPersonaId: "unknown",
    },
  });
  assert.equal(normalized.persona.customPersonas.length, 1);
  assert.equal(normalized.persona.customPersonas[0].title.length, 80);
  assert.equal(normalized.persona.customPersonas[0].description, "Description");
  assert.equal(normalized.persona.activeCustomPersonaId, null);
});

test("gaze defaults to screen focus and preserves an explicit cursor-follow preference", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-settings-gaze-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const settings = new AppSettingsStore(dataDir);
  const defaults = await settings.initialize();
  assert.equal(defaults.character.eyeFollowCursor, false);
  assert.equal(defaults.companion.cursorReactions, true);
  assert.equal(defaults.companion.danceOnAudio, false);
  assert.equal(defaults.companion.mangaBubbles, false);

  const updated = await settings.update({ character: { eyeFollowCursor: true } });
  assert.equal(updated.character.eyeFollowCursor, true);
});

test("wellness alerts default off and validate intervals, messages, and opt-in voice", () => {
  const defaults = normalizeSettings({});
  assert.deepEqual(defaults.wellness, {
    enabled: false,
    intervalMinutes: 45,
    voiceAlerts: true,
    breakMessage: "You have been at your desk for a while. Take a short stretch break.",
    waterMessage: "A quick water break might be nice.",
    eyeRestMessage: "Look away from the screen for a few seconds and rest your eyes.",
  });

  const normalized = normalizeSettings({
    wellness: {
      enabled: true,
      intervalMinutes: 40,
      voiceAlerts: false,
      breakMessage: `  ${"b".repeat(300)}  `,
      waterMessage: "Drink water.",
      eyeRestMessage: "Rest your eyes.",
    },
  });
  assert.equal(normalized.wellness.enabled, true);
  assert.equal(normalized.wellness.intervalMinutes, 45);
  assert.equal(normalized.wellness.voiceAlerts, false);
  assert.equal(normalized.wellness.breakMessage.length, 240);
  assert.equal(normalized.wellness.waterMessage, "Drink water.");
});
