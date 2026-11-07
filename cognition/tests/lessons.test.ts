import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LessonStore } from "../lessons";
import { compilePlannerRequest } from "../../agent/planner/stepPlanner";

test("lessons persist user corrections and retrieve only similar issues", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-lessons-"));
  const file = path.join(dir, "lessons.json");
  const store = new LessonStore(file);
  await store.initialize();
  const saved = await store.add({
    trigger: "Browser search field UI Automation returned no controls",
    correction: "Use screen vision to locate the search field, then click and type.",
    sourceTaskId: "task-1",
  });

  const matches = await store.relevant("Search browser field UI Automation");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, saved.id);
  assert.equal(matches[0].uses, 1);
  assert.deepEqual(await store.relevant("check battery level"), []);

  const reopened = new LessonStore(file);
  await reopened.initialize();
  const persisted = await reopened.relevant("browser search field");
  assert.equal(persisted[0].correction, saved.correction);
  await fs.rm(dir, { recursive: true, force: true });
});

test("lesson inputs must contain a concrete trigger and correction", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-lessons-"));
  const store = new LessonStore(path.join(dir, "lessons.json"));
  await store.initialize();
  await assert.rejects(store.add({ trigger: "UI", correction: "Use vision instead." }), /specific issue/);
  await assert.rejects(store.add({ trigger: "UI Automation failed in browser", correction: "ok" }), /useful user correction/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("planner receives applicable corrections with permission and relevance limits", () => {
  const request = compilePlannerRequest({
    goal: "Find the search field in the browser",
    step: 1,
    maxSteps: 10,
    references: [],
    memories: [],
    lessons: ["When browser search controls are missing: use screen vision to locate the search field."],
    plan: null,
    recentActions: [],
    actionOutputs: [],
    recovery: null,
    userAnswers: [],
    state: {
      activeWindow: null,
      windows: [],
      elements: [],
      elementCountTotal: 0,
      truncated: false,
      browser: null,
      cursor: null,
      idleMs: null,
      change: { changed: false, score: 0, regions: [] },
      dialogs: [],
      notes: [],
      visual: null,
      timings: { totalMs: 1, uiaMs: null },
      id: "state",
      capturedAt: Date.now(),
      snapshotId: null,
    } as never,
    screenshot: null,
    notes: [],
    permissionNote: "No additional confirmation.",
    complexity: 0.5,
  });
  const firstPart = request.messages[0].parts[0];
  const prompt = firstPart.type === "text" ? firstPart.text : "";
  assert.match(prompt, /RELEVANT USER CORRECTIONS/);
  assert.match(prompt, /never override the current request, permissions, or safety/);
  assert.match(prompt, /use screen vision to locate the search field/);
});
