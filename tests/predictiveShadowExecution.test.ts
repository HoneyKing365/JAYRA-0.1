import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { PredictiveShadowEngine } from "../runtime/predictiveShadowExecution";

test("predictive shadow execution engine initializes and seeds default patterns", async () => {
  const tmpDir = path.join(os.tmpdir(), `jayra_shadow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const engine = new PredictiveShadowEngine(tmpDir);
  await engine.initialize();

  const patterns = engine.listPatterns();
  assert.ok(patterns.length >= 4, "Should initialize default built-in dev patterns");

  const vsCodePattern = patterns.find((p) => p.patternId === "pat_vscode_dev_workspace");
  assert.ok(vsCodePattern, "VS Code pattern should exist");
  assert.equal(vsCodePattern.predictedAction.actionType, "PRELOAD_DEPENDENCIES");
  assert.ok(vsCodePattern.confidenceScore >= 0.7);
  assert.ok(vsCodePattern.sassyPromptHindi.includes("shukriya"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("predictive shadow engine records observations and reinforces confidence score", async () => {
  const tmpDir = path.join(os.tmpdir(), `jayra_shadow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const engine = new PredictiveShadowEngine(tmpDir, { cooldownPeriodMs: 10_000 });
  await engine.initialize();

  const initialPattern = engine.listPatterns().find((p) => p.patternId === "pat_vscode_dev_workspace")!;
  const initialScore = initialPattern.confidenceScore;
  const initialCount = initialPattern.occurrenceCount;

  // Record matching observation
  await engine.recordObservation({
    application: "Code",
    windowTitle: "NEW_JAYRA_ANDROID_MASTER_SPEC.md - Visual Studio Code",
    actionType: "window_focus",
  });

  const updatedPattern = engine.listPatterns().find((p) => p.patternId === "pat_vscode_dev_workspace")!;
  assert.ok(updatedPattern.confidenceScore >= initialScore, "Confidence score should increase with matching observation");
  assert.ok(updatedPattern.occurrenceCount > initialCount);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("predictive shadow engine executes safe tasks and populates hot memory cache", async () => {
  const tmpDir = path.join(os.tmpdir(), `jayra_shadow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  let capturedNotice = "";
  const engine = new PredictiveShadowEngine(tmpDir, { cooldownPeriodMs: 0 });
  await engine.initialize();
  engine.onNotification((res) => {
    capturedNotice = res.proactiveNotice;
  });

  // Execute dependency pre-loading
  const result = await engine.triggerManual("pat_vscode_dev_workspace");
  assert.equal(result.status, "STAGED");
  assert.equal(result.actionType, "PRELOAD_DEPENDENCIES");
  assert.ok(typeof result.details.dependenciesCount === "number");
  assert.ok(capturedNotice.length > 0, "Proactive sassy notification should be dispatched");

  // Check hot memory cache
  const cacheStats = engine.getHotCacheStats();
  assert.ok(cacheStats.items > 0, "Hot cache should store pre-loaded files");
  assert.ok(cacheStats.totalSizeBytes > 0);

  // Execute dev server port probe
  const probeResult = await engine.triggerManual("pat_terminal_dev_server");
  assert.equal(probeResult.status, "STAGED");
  assert.equal(probeResult.actionType, "PREWARM_DEV_SERVER");

  // Check execution history
  const history = engine.getExecutionHistory();
  assert.ok(history.length >= 2, "Execution history should track staged shadow actions");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("predictive shadow engine blocks destructive commands", async () => {
  const tmpDir = path.join(os.tmpdir(), `jayra_shadow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const engine = new PredictiveShadowEngine(tmpDir);
  await engine.initialize();

  // Attempt to execute a dangerous pattern with rm -rf payload
  const dangerousPattern = {
    patternId: "pat_dangerous",
    name: "Malicious pattern",
    triggerContext: { application: "terminal" },
    predictedAction: {
      actionType: "PRELOAD_DEPENDENCIES" as const,
      target: "./",
      payload: { command: "rm -rf / --no-preserve-root" },
    },
    occurrenceCount: 1,
    confidenceScore: 0.95,
    lastObservedAt: Date.now(),
    sassyPromptHindi: "Blocked",
    sassyPromptEnglish: "Blocked",
  };

  const res = await engine.executeShadowTask(dangerousPattern);
  assert.equal(res.status, "SKIPPED", "Destructive command must be skipped by safety guard");
  assert.ok(String(res.details.reason).includes("safety"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
