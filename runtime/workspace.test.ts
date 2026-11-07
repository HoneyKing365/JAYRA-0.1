import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveWorkspacePath, resolveWorkspaceRoot, runWorkspaceCommand } from "./workspace";

test("workspace paths allow project files and reject traversal and symlink escapes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-workspace-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-outside-"));
  await fs.writeFile(path.join(root, "main.ts"), "export {};", "utf-8");
  await fs.writeFile(path.join(outside, "private.txt"), "secret", "utf-8");
  const canonicalRoot = await resolveWorkspaceRoot(root);
  assert.equal(await resolveWorkspacePath(root, path.join(root, "main.ts")), path.join(canonicalRoot, "main.ts"));
  await assert.rejects(resolveWorkspacePath(root, path.join(outside, "private.txt")), /limited to the configured project/);
  await assert.rejects(resolveWorkspacePath(root, path.join(outside, "new.txt"), true), /limited to the configured project/);
  const newFile = await resolveWorkspacePath(root, path.join(root, "new.ts"), true);
  assert.equal(newFile, path.join(canonicalRoot, "new.ts"));

  const link = path.join(root, "external");
  try {
    await fs.symlink(outside, link, "junction");
    await assert.rejects(resolveWorkspacePath(root, path.join(link, "private.txt"), true), /limited to the configured project/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("workspace commands execute once in the project working directory and cap output", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-workspace-run-"));
  const command = process.platform === "win32" ? "cd" : "pwd";
  const result = await runWorkspaceCommand(command, dir);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  await fs.writeFile(path.join(dir, "output.js"), "process.stdout.write('x'.repeat(25000));", "utf-8");
  const verbose = await runWorkspaceCommand("node output.js", dir);
  assert.equal(verbose.stdout.length, 20_000);
  await assert.rejects(runWorkspaceCommand(" ".repeat(2), dir), /command is required/);
  await assert.rejects(runWorkspaceCommand("x".repeat(501), dir), /500 characters/);
  await fs.rm(dir, { recursive: true, force: true });
});
