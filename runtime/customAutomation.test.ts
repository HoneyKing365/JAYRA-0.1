import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CustomAutomationStore } from "./customAutomation";

test("custom automations persist and match voice triggers exactly", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-automations-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const scriptsDir = path.join(dataDir, "scripts");
  await mkdir(scriptsDir);
  const scriptPath = path.join(scriptsDir, "cleanup.ps1");
  await writeFile(scriptPath, "Write-Output 'test script'\n", "utf8");

  const store = new CustomAutomationStore(dataDir);
  await store.initialize();
  const saved = await store.add({
    name: "Workspace cleanup",
    trigger: "Clean my PC",
    scriptPath,
    runAsAdministrator: false,
  });
  assert.equal(saved.scriptPath, path.resolve(scriptPath));
  assert.equal(store.matchTrigger("  CLEAN my PC!  ")?.id, saved.id);
  assert.equal(store.matchTrigger("Please clean my PC") , null);

  await assert.rejects(
    store.add({ name: "Duplicate", trigger: "clean my pc", scriptPath, runAsAdministrator: false }),
    /unique voice trigger/,
  );
  await assert.rejects(
    store.add({ name: "Unsafe type", trigger: "launch tool", scriptPath: path.join(scriptsDir, "tool.exe") }),
    /Only \.bat, \.cmd, and \.ps1/,
  );

  const reloaded = new CustomAutomationStore(dataDir);
  await reloaded.initialize();
  assert.deepEqual(reloaded.list(), [saved]);
  assert.equal(await reloaded.remove(saved.id), true);
  assert.equal(reloaded.list().length, 0);
});

test("custom automation execution is serialized per action and lock is released on failure", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-automation-lock-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const scriptPath = path.join(dataDir, "task.cmd");
  await writeFile(scriptPath, "@echo off\r\n", "utf8");
  const store = new CustomAutomationStore(dataDir);
  await store.initialize();
  const action = await store.add({ name: "Task", trigger: "run task", scriptPath });

  let release: (() => void) | undefined;
  const first = store.run(action.id, () => new Promise<void>((resolve) => { release = resolve; }));
  await assert.rejects(store.run(action.id, async () => undefined), /already running/);
  release?.();
  await first;
  await assert.rejects(store.run(action.id, async () => { throw new Error("failed"); }), /failed/);
  assert.equal(await store.run(action.id, async () => "recovered"), "recovered");
});

test("custom automation rejects missing paths and requires complete fields", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-automation-validation-"));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const store = new CustomAutomationStore(dataDir);
  await store.initialize();
  await assert.rejects(
    store.add({ name: "Invalid", trigger: "do thing", scriptPath: path.join(dataDir, "absent.bat") }),
    /does not exist/,
  );
  await assert.rejects(store.add({ name: "", trigger: "x", scriptPath: "x.ps1" }), /Name must contain/);
});
