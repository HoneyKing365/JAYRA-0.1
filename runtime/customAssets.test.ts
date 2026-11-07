import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverCustomAssets, importCustomAsset } from "./customAssets";

test("custom asset catalog recursively lists supported formats and skips hidden files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = {
    models: path.join(root, "models"),
    objects: path.join(root, "objects"),
    animations: path.join(root, "animations"),
    audio: path.join(root, "audio"),
    voices: path.join(root, "voices"),
    tts: path.join(root, "tts"),
  };

  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.mkdir(path.join(directories.models, "packs", "character"), { recursive: true });
  await fs.mkdir(path.join(directories.animations, "motions"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directories.models, "packs", "character", "avatar.PMX"), "model"),
    fs.writeFile(path.join(directories.models, "ignore.txt"), "unsupported"),
    fs.writeFile(path.join(directories.animations, "motions", "wave.vmd"), "motion"),
    fs.writeFile(path.join(directories.animations, "motions", ".hidden.json"), "hidden"),
    fs.writeFile(path.join(directories.voices, "hello.ogg"), "audio"),
  ]);

  const catalog = await discoverCustomAssets(directories);
  assert.deepEqual(catalog, {
    models: ["packs/character/avatar.PMX"],
    objects: [],
    animations: ["motions/wave.vmd"],
    audio: [],
    voices: ["hello.ogg"],
    tts: [],
  });
});

test("missing category roots produce empty lists", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-missing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const catalog = await discoverCustomAssets({
    models: path.join(root, "models"),
    objects: path.join(root, "objects"),
    animations: path.join(root, "animations"),
    audio: path.join(root, "audio"),
    voices: path.join(root, "voices"),
    tts: path.join(root, "tts"),
  });

  assert.deepEqual(catalog, { models: [], objects: [], animations: [], audio: [], voices: [], tts: [] });
});

test("scan failures are reported instead of appearing as an empty catalog", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-error-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modelPath = path.join(root, "models");
  await fs.writeFile(modelPath, "not a directory");

  await assert.rejects(
    discoverCustomAssets({
      models: modelPath,
      objects: path.join(root, "objects"),
      animations: path.join(root, "animations"),
      audio: path.join(root, "audio"),
      voices: path.join(root, "voices"),
      tts: path.join(root, "tts"),
    }),
    /Unable to scan custom assets/,
  );
});

test("symbolic links are not followed while discovering assets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-links-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-outside-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  const directories = {
    models: path.join(root, "models"),
    objects: path.join(root, "objects"),
    animations: path.join(root, "animations"),
    audio: path.join(root, "audio"),
    voices: path.join(root, "voices"),
    tts: path.join(root, "tts"),
  };

  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(outside, "private.pmx"), "external");
  try {
    await fs.symlink(outside, path.join(directories.models, "linked"), "junction");
  } catch (error) {
    if (process.platform === "win32") {
      t.skip(`Symlink creation is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    throw error;
  }

  const catalog = await discoverCustomAssets(directories);
  assert.deepEqual(catalog.models, []);
});

test("asset import supports extended formats and never overwrites an existing asset", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-import-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "avatar.glb");
  const directories = {
    models: path.join(root, "library", "models"),
    objects: path.join(root, "library", "objects"),
    animations: path.join(root, "library", "animations"),
    audio: path.join(root, "library", "audio"),
    voices: path.join(root, "library", "voices"),
    tts: path.join(root, "library", "tts"),
  };
  await fs.writeFile(source, "model bytes");

  const imported = await importCustomAsset(source, "models", directories);
  assert.equal(imported.fileName, "avatar.glb");
  await fs.writeFile(source, "updated model bytes");
  const second = await importCustomAsset(source, "models", directories);
  assert.equal(second.fileName, "avatar (1).glb");
  assert.equal(await fs.readFile(path.join(directories.models, "avatar.glb"), "utf8"), "model bytes");
});

test("asset import rejects unsupported, empty and non-picker paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-custom-assets-reject-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = {
    models: path.join(root, "models"),
    objects: path.join(root, "objects"),
    animations: path.join(root, "animations"),
    audio: path.join(root, "audio"),
    voices: path.join(root, "voices"),
    tts: path.join(root, "tts"),
  };
  const unsupported = path.join(root, "payload.exe");
  await fs.writeFile(unsupported, "no");
  await assert.rejects(importCustomAsset(unsupported, "models", directories), /not supported/);
  const empty = path.join(root, "empty.wav");
  await fs.writeFile(empty, "");
  await assert.rejects(importCustomAsset(empty, "audio", directories), /non-empty/);
  await assert.rejects(importCustomAsset("relative.glb", "models", directories), /desktop file picker/);
});
