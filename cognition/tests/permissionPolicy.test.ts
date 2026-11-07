import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PermissionEngine } from "../../permissions/engine";
import { loadCognitionConfig } from "../config";
import { ToolExecutor } from "../toolExecutor";
import { isProtectedSystemPath, ToolRegistry } from "../toolRegistry";

function registryWithRiskyTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerDesktopTools([
    "systemInfo",
    "searchWeb",
    "openWebsite",
    "openApplication",
    "createFile",
    "deleteFile",
    "runPythonScript",
    "runPowerShellScript",
    "generate_and_register_tool",
    "click",
  ]);
  return registry;
}

test("tool risk classification separates read, moderate and dangerous actions", () => {
  const registry = registryWithRiskyTools();
  assert.equal(registry.assessRisk("systemInfo", {}), 1);
  assert.equal(registry.assessRisk("searchWeb", { query: "weather" }), 1);
  assert.equal(registry.assessRisk("openWebsite", { url: "https://example.test" }), 2);
  assert.equal(registry.assessRisk("openApplication", { name: "notepad" }), 2);
  assert.equal(registry.assessRisk("createFile", { path: "C:/Users/test/new.txt" }), 2);
  for (const tool of ["deleteFile", "runPythonScript", "runPowerShellScript", "generate_and_register_tool", "click"]) {
    assert.equal(registry.assessRisk(tool, {}), 3, `${tool} must be high risk`);
  }
});

test("clipboard tools use their own centralized permission capability", () => {
  const registry = new ToolRegistry();
  registry.registerDesktopTools(["getClipboard", "setClipboardText"]);
  assert.equal(registry.get("getClipboard")?.permission, "clipboard");
  assert.equal(registry.get("setClipboardText")?.permission, "clipboard");
});

test("legacy tool execution consults the shared capability engine before dispatch", async () => {
  const registry = registryWithRiskyTools();
  const permissions = new PermissionEngine(".", { MYRAA_PERMISSION_CODE_EXECUTION: "off" });
  let executions = 0;
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    permissions,
    handler: async () => {
      executions += 1;
      return { ok: true };
    },
  });

  const outcome = await executor.execute("runPowerShellScript", { path: "C:/Users/test/script.ps1" });
  assert.equal(outcome.status, "denied");
  assert.match(outcome.error || "", /MYRAA_PERMISSION_CODE_EXECUTION/);
  assert.equal(executions, 0);
});

test("an explicit allow executes high-risk non-destructive tools without a confirmation", async () => {
  const registry = registryWithRiskyTools();
  const permissions = new PermissionEngine(".", {});
  let executions = 0;
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    permissions,
    handler: async () => {
      executions += 1;
      return { ok: true, result: { completed: true } };
    },
  });

  const result = await executor.execute("click", { x: 10, y: 20 });
  assert.equal(result.success, true);
  assert.equal(result.confirmationId, undefined);
  assert.equal(executions, 1);
});

test("an explicit allow still asks before permanent deletion", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jayra-permissions-"));
  try {
    const registry = registryWithRiskyTools();
    const permissions = new PermissionEngine(directory, {});
    await permissions.initialize();
    await permissions.setDecision("DELETE_FILE", "allow");
    let executions = 0;
    const executor = new ToolExecutor({
      config: loadCognitionConfig({} as NodeJS.ProcessEnv),
      registry,
      permissions,
      handler: async () => {
        executions += 1;
        return { ok: true };
      },
    });

    const reversible = await executor.execute("deleteFile", { path: "C:/Users/test/notes.txt" });
    assert.equal(reversible.success, true);
    assert.equal(reversible.confirmationId, undefined);
    const result = await executor.execute("deleteFile", {
      path: "C:/Users/test/notes.txt",
      permanent: true,
    });
    assert.equal(result.status, "confirmation_required");
    assert.equal(executions, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("risk-level 3 execution pauses before invoking the tool handler", async () => {
  const registry = registryWithRiskyTools();
  let executions = 0;
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    handler: async () => {
      executions += 1;
      return { ok: true, result: { completed: true } };
    },
  });

  const result = await executor.execute("runPythonScript", { path: "C:/Users/test/script.py" });
  assert.equal(result.status, "confirmation_required");
  assert.ok(result.confirmationId);
  assert.equal(executions, 0);

  const approved = await executor.resolveConfirmation(result.confirmationId!, true);
  assert.equal(approved.success, true);
  assert.equal(executions, 1);
});

test("denial returns USER_DENIED_PERMISSIONS and never invokes the handler", async () => {
  const registry = registryWithRiskyTools();
  let executions = 0;
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    handler: async () => {
      executions += 1;
      return { ok: true };
    },
  });

  const pending = await executor.execute("generate_and_register_tool", { name: "customTool" });
  const denied = await executor.resolveConfirmation(pending.confirmationId!, false);
  assert.equal(denied.status, "USER_DENIED_PERMISSIONS");
  assert.match(denied.error || "", /USER_DENIED_PERMISSIONS/);
  assert.equal(executions, 0);
});

test("protected system paths are rejected before an approval can authorize mutation", async () => {
  const registry = registryWithRiskyTools();
  let executions = 0;
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    handler: async () => {
      executions += 1;
      return { ok: true };
    },
  });

  assert.equal(isProtectedSystemPath("C:/Windows/System32/config/SAM"), true);
  assert.equal(isProtectedSystemPath("C:/Program Files/JAYRA/app.exe"), true);
  assert.equal(isProtectedSystemPath("C:/Users/test/Documents/notes.txt"), false);
  const denied = await executor.execute("deleteFile", { path: "C:/Windows/System32/drivers/etc/hosts" });
  assert.equal(denied.status, "denied");
  assert.match(denied.error || "", /PROTECTED_SYSTEM_PATH/);
  assert.equal(executions, 0);
  assert.equal(executor.confirmations.list().length, 0);

  const adminOverrideRequest = await executor.execute("deleteFile", {
    path: "C:/Windows/System32/drivers/etc/hosts",
    allow_anywhere: true,
  });
  assert.equal(adminOverrideRequest.status, "confirmation_required");
  assert.equal(executions, 0, "the Python sidecar still decides whether the current process is an administrator");
});