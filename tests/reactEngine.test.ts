import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REACT_ITERATIONS, MAX_SELF_HEALING_ATTEMPTS, ReActEngine } from "../agent/reactEngine";
import { ToolRegistry } from "../cognition/toolRegistry";

test("ReAct engine allows at most ten iterations per prompt", () => {
  const engine = new ReActEngine();
  engine.begin("voice-1");

  for (let iteration = 1; iteration <= MAX_REACT_ITERATIONS; iteration += 1) {
    assert.deepEqual(engine.nextIteration("voice-1"), {
      allowed: true,
      iteration,
      maxIterations: MAX_REACT_ITERATIONS,
    });
  }
  assert.equal(engine.nextIteration("voice-1").allowed, false);
});

test("ReAct observation unwraps sandbox failures and grants three correction attempts", () => {
  const engine = new ReActEngine();
  engine.begin("script-1");
  const execution = {
    success: true,
    result: { ok: true, result: { success: false, stderr: "SyntaxError: invalid syntax", exitCode: 1 } },
  };

  for (let attempt = 1; attempt <= MAX_SELF_HEALING_ATTEMPTS; attempt += 1) {
    const observation = engine.observe("script-1", execution);
    assert.equal(observation.failed, true);
    assert.equal(observation.recoverable, true);
    assert.equal(observation.errorTrace, "SyntaxError: invalid syntax");
    assert.equal(observation.recoveryAttempt, attempt);
  }
  const exhausted = engine.observe("script-1", execution);
  assert.equal(exhausted.failed, true);
  assert.equal(exhausted.recoverable, false);
  assert.equal(exhausted.exhausted, true);
});

test("ReAct engine does not auto-retry confirmation or permission outcomes", () => {
  const engine = new ReActEngine();
  engine.begin("safety-1");

  const observation = engine.observe("safety-1", {
    success: false,
    status: "confirmation_required",
    error: "User confirmation is required.",
  });

  assert.equal(observation.failed, false);
  assert.equal(observation.recoverable, false);
});

test("Python and PowerShell runners are registered as high-risk code execution", () => {
  const registry = new ToolRegistry();
  registry.registerDesktopTools(["runPythonScript", "runPowerShellScript"]);

  for (const name of ["runPythonScript", "runPowerShellScript"]) {
    const tool = registry.get(name);
    assert.equal(tool?.permission, "code_execution");
    assert.equal(tool?.riskLevel, 3);
    assert.equal(tool?.maxRetries, 0);
  }
});

test("telemetry and screen inspection use read permissions without retrying model analysis", () => {
  const registry = new ToolRegistry();
  registry.registerDesktopTools(["getSystemTelemetry", "inspectScreenVision"]);

  assert.equal(registry.get("getSystemTelemetry")?.riskLevel, 1);
  assert.equal(registry.get("inspectScreenVision")?.permission, "screen_awareness");
  assert.equal(registry.get("inspectScreenVision")?.maxRetries, 0);
  assert.equal(registry.get("inspectScreenVision")?.timeoutMs, 90_000);
});

test("native GUI actions require risk-3 automation confirmation and browser edits are escalated", () => {
  const registry = new ToolRegistry();
  registry.registerDesktopTools(["gui_click", "gui_type", "window_control", "browser_control"]);

  for (const name of ["gui_click", "gui_type", "window_control"]) {
    assert.equal(registry.get(name)?.permission, "automation");
    assert.equal(registry.get(name)?.riskLevel, 3);
  }
  assert.equal(registry.get("browser_control")?.permission, "browser");
  assert.equal(registry.assessRisk("browser_control", { action: "navigate_to" }), 2);
  assert.equal(registry.assessRisk("browser_control", { action: "click_element" }), 3);
  assert.equal(registry.assessRisk("browser_control", { action: "fill_field" }), 3);
});