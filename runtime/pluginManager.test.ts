import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginManager, type PluginManifest, type SignedPluginPackage } from "./pluginManager";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedPackage(version = "1.0.0", code = '"""Return the input."""\nreturn {"value": value}'): SignedPluginPackage {
  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: "demo-plugin",
    name: "Demo Plugin",
    version,
    description: "A test plugin.",
    tools: [{
      name: "demo_plugin_echo",
      description: "Return an input value.",
      arguments_schema: {
        type: "object",
        properties: { value: { type: "string", description: "Value to return." } },
        required: ["value"],
      },
      entryPoint: "tools/echo.py",
      requiredCapabilities: ["code_execution"],
    }],
  };
  const files = [{ path: "tools/echo.py", contentBase64: Buffer.from(code).toString("base64") }];
  const payload = Buffer.from(canonicalJson({ manifest, files }));
  return {
    manifest,
    files,
    signature: sign(null, payload, privateKey).toString("base64"),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for plugin directory monitoring.");
}

test("plugin manager verifies signatures, persists under user data, and hot-registers tools", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-plugin-manager-"));
  const registered: string[] = [];
  try {
    const manager = new PluginManager({
      dataDir,
      publicKey: publicKeyPem,
      ensureTool: async (_pluginId, tool, code, replace) => {
        registered.push(`${tool.name}:${replace}:${code.includes("Return the input")}`);
      },
      removeTool: async () => undefined,
      reportDiagnostic: () => undefined,
    });

    const status = await manager.install(signedPackage());
    assert.equal(status.status, "active");
    assert.equal(status.version, "1.0.0");
    assert.match(manager.directory, /plugins$/);
    assert.deepEqual(registered, ["demo_plugin_echo:true:true"]);
    assert.equal(manager.status().plugins[0]?.id, "demo-plugin");

    const restartedManager = new PluginManager({
      dataDir,
      publicKey: publicKeyPem,
      ensureTool: async (_pluginId, tool, _code, replace) => {
        registered.push(`${tool.name}:${replace}:restart`);
      },
      removeTool: async () => undefined,
      reportDiagnostic: () => undefined,
    });
    await restartedManager.loadInstalled();
    assert.equal(registered[1], "demo_plugin_echo:false:restart");

    const updated = await restartedManager.install(signedPackage("2.0.0", '"""Return changed output."""\nreturn {"value": value}'));
    assert.equal(updated.version, "2.0.0");
    assert.equal(registered[2], "demo_plugin_echo:true:restart");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("plugin directory monitoring discovers, registers, and unloads external packages", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-plugin-watch-"));
  const registered: string[] = [];
  const removed: string[] = [];
  const manager = new PluginManager({
    dataDir,
    publicKey: publicKeyPem,
    ensureTool: async (_pluginId, tool) => { registered.push(tool.name); },
    removeTool: async (name) => { removed.push(name); },
    reportDiagnostic: () => undefined,
  });
  try {
    await manager.startWatching();
    const pluginDirectory = path.join(manager.directory, "demo-plugin");
    await mkdir(pluginDirectory);
    await writeFile(path.join(pluginDirectory, "manifest.json"), JSON.stringify(signedPackage()));

    await waitFor(() => manager.status().plugins.some((plugin) => plugin.id === "demo-plugin" && plugin.status === "active"));
    assert.deepEqual(registered, ["demo_plugin_echo"]);

    await rm(pluginDirectory, { recursive: true });
    await waitFor(() => !manager.status().plugins.some((plugin) => plugin.id === "demo-plugin"));
    assert.deepEqual(removed, ["demo_plugin_echo"]);
  } finally {
    manager.stopAutoSync();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("plugin update sync refuses downgrades and requires an explicit trust root", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-plugin-version-"));
  try {
    const manager = new PluginManager({
      dataDir,
      publicKey: publicKeyPem,
      updateUrl: "https://updates.example.test/plugin.json",
      fetcher: async () => new Response(JSON.stringify(signedPackage("1.0.0")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      ensureTool: async () => undefined,
      removeTool: async () => undefined,
      reportDiagnostic: () => undefined,
    });

    await manager.install(signedPackage("2.0.0"));
    await assert.rejects(manager.sync(), /older than installed version/);

    const untrusted = new PluginManager({
      dataDir,
      updateUrl: "https://updates.example.test/plugin.json",
      ensureTool: async () => undefined,
      removeTool: async () => undefined,
      reportDiagnostic: () => undefined,
    });
    await assert.rejects(untrusted.sync(), /requires JAYRA_PLUGIN_UPDATE_URL and JAYRA_PLUGIN_PUBLIC_KEY/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("plugin manager rejects modified signatures and unsafe package paths before activation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-plugin-invalid-"));
  let activations = 0;
  const manager = new PluginManager({
    dataDir,
    publicKey: publicKeyPem,
    ensureTool: async () => { activations += 1; },
    removeTool: async () => undefined,
    reportDiagnostic: () => undefined,
  });
  try {
    const changed = signedPackage();
    changed.files[0].contentBase64 = Buffer.from("tampered").toString("base64");
    await assert.rejects(manager.install(changed), /signature verification failed/);

    const traversal = signedPackage();
    traversal.files[0].path = "../outside.py";
    await assert.rejects(manager.install(traversal), /Unsafe plugin package path/);
    assert.equal(activations, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("plugin manifest capability and namespace validation fail closed", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jayra-plugin-manifest-"));
  const manager = new PluginManager({
    dataDir,
    publicKey: publicKeyPem,
    ensureTool: async () => undefined,
    removeTool: async () => undefined,
    reportDiagnostic: () => undefined,
  });
  try {
    const invalidCapability = signedPackage();
    invalidCapability.manifest.tools[0].requiredCapabilities = ["system_control"];
    await assert.rejects(manager.install(invalidCapability), /unsupported capability/);

    const invalidNamespace = signedPackage();
    invalidNamespace.manifest.tools[0].name = "echo_tool";
    await assert.rejects(manager.install(invalidNamespace), /namespace/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
