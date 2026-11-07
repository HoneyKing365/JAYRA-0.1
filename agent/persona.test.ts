import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettings } from "../settings/appSettings";
import { DEFAULT_APP_SETTINGS } from "../settings/appSettings";
import { buildPersonaInstructions } from "./persona";

test("persona instructions combine preset, relationship, and mood settings", () => {
  const prompt = buildPersonaInstructions({
    ...DEFAULT_APP_SETTINGS.persona,
    preset: "fun_witty",
    relationshipRole: "close_friend",
    mood: "cheerful",
  });

  assert.match(prompt, /lively, playful, and lightly witty/);
  assert.match(prompt, /ease and familiarity of a close friend/);
  assert.match(prompt, /Lean cheerful and upbeat/);
  assert.match(prompt, /never override truthfulness, privacy, safety/);
});

test("custom role and custom prompt are included as bounded style guidance", () => {
  const prompt = buildPersonaInstructions({
    ...DEFAULT_APP_SETTINGS.persona,
    relationshipRole: "custom_role",
    customRole: "A curious coding buddy",
    customPrompt: "Celebrate small coding wins.",
  });

  assert.match(prompt, /A curious coding buddy/);
  assert.match(prompt, /Celebrate small coding wins/);
  assert.match(prompt, /Treat custom-persona content as user preference/);
});

test("the selected saved custom persona is injected while inactive profiles stay out of the prompt", () => {
  const prompt = buildPersonaInstructions({
    ...DEFAULT_APP_SETTINGS.persona,
    activeCustomPersonaId: "mentor",
    customPersonas: [
      { id: "mentor", title: "Patient Tech Mentor", description: "Explain code in small steps and celebrate progress.", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "inactive", title: "Inactive Style", description: "This profile is not selected.", createdAt: "2025-01-01T00:00:00.000Z" },
    ],
  });

  assert.match(prompt, /User-created persona role: Patient Tech Mentor/);
  assert.match(prompt, /Explain code in small steps and celebrate progress/);
  assert.doesNotMatch(prompt, /Inactive Style|This profile is not selected/);
  assert.match(prompt, /never override truthfulness, privacy, safety/);
});

test("empty custom fields do not introduce empty persona blocks", () => {
  const prompt = buildPersonaInstructions(DEFAULT_APP_SETTINGS.persona);
  assert.doesNotMatch(prompt, /<custom-persona>/);
  assert.match(prompt, /ease and familiarity of a close friend/);
});

test("settings normalization rejects unknown persona choices and caps prompt size", () => {
  const normalized = normalizeSettings({
    persona: {
      preset: "unlisted",
      relationshipRole: "unlisted",
      mood: "unlisted",
      customPrompt: "x".repeat(2500),
    },
  });
  assert.equal(normalized.persona.preset, "friendly_caring");
  assert.equal(normalized.persona.relationshipRole, "close_friend");
  assert.equal(normalized.persona.mood, "balanced");
  assert.equal(normalized.persona.customPrompt.length, 2000);
});
