import { createPublicKey, verify as verifySignature } from "node:crypto";
import { watch as watchDirectory, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { PermissionName } from "../cognition/types";

const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOOLS = 32;
const ALLOWED_CAPABILITIES = new Set<PermissionName>(["code_execution"]);
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,62}$/;

export interface PluginToolManifest {
  name: string;
  description: string;
  arguments_schema: Record<string, unknown>;
  entryPoint: string;
  requiredCapabilities: PermissionName[];
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  tools: PluginToolManifest[];
}

export interface PluginPackageFile {
  path: string;
  contentBase64: string;
}

export interface SignedPluginPackage {
  manifest: PluginManifest;
  files: PluginPackageFile[];
  signature: string;
}

export interface PluginManagerOptions {
  dataDir: string;
  publicKey?: string;
  updateUrl?: string;
  ensureTool: (pluginId: string, tool: PluginToolManifest, code: string, replace: boolean) => Promise<void>;
  removeTool: (name: string) => Promise<void>;
  reportDiagnostic: (action: string, error: string, metadata: Record<string, unknown>) => void;
  fetcher?: typeof fetch;
}

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  status: "active" | "failed";
  error?: string;
}

export class PluginManager {
  readonly directory: string;
  private readonly fetcher: typeof fetch;
  private readonly pluginStatus = new Map<string, PluginStatus>();
  private readonly activePackages = new Map<string, SignedPluginPackage>();
  private readonly pluginDirectoryWatchers = new Map<string, FSWatcher>();
  private rootWatcher: FSWatcher | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private directoryCheckTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private syncing: Promise<PluginStatus[]> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PluginManagerOptions) {
    this.directory = path.join(options.dataDir, "plugins");
    this.fetcher = options.fetcher || fetch;
  }

  status(): { directory: string; remoteSyncEnabled: boolean; plugins: PluginStatus[] } {
    return {
      directory: this.directory,
      remoteSyncEnabled: Boolean(this.options.updateUrl && this.options.publicKey),
      plugins: [...this.pluginStatus.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  startAutoSync(intervalMs = 6 * 60 * 60 * 1000): void {
    void this.startWatching().catch((error) => {
      this.report("plugin.watch", error, { directory: this.directory });
    });
    if (!this.syncTimer && this.options.updateUrl && this.options.publicKey) {
      this.syncTimer = setInterval(() => {
        void this.sync().catch((error) => {
          this.report("plugin.sync", error, { updateUrl: this.options.updateUrl });
        });
      }, intervalMs);
      this.syncTimer.unref?.();
    }
  }

  stopAutoSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.directoryCheckTimer) clearInterval(this.directoryCheckTimer);
    this.directoryCheckTimer = null;
    this.rootWatcher?.close();
    this.rootWatcher = null;
    for (const watcher of this.pluginDirectoryWatchers.values()) watcher.close();
    this.pluginDirectoryWatchers.clear();
  }

  async startWatching(): Promise<void> {
    if (this.rootWatcher) return;
    await this.ensurePluginRoot();
    const watcher = watchDirectory(this.directory, (_eventType, fileName) => {
      if (fileName?.toString().startsWith(".")) return;
      this.scheduleRefresh();
    });
    this.rootWatcher = watcher;
    watcher.on("error", (error) => {
      this.report("plugin.watch", error, { directory: this.directory });
      watcher.close();
      if (this.rootWatcher === watcher) this.rootWatcher = null;
    });
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    this.refreshPluginDirectoryWatchers(new Set(
      entries.filter((entry) => entry.isDirectory() && PLUGIN_ID.test(entry.name)).map((entry) => entry.name),
    ));
    this.directoryCheckTimer = setInterval(() => {
      void this.checkDirectoryChanges();
    }, 1_000);
    this.directoryCheckTimer.unref?.();
  }

  async loadInstalled(): Promise<PluginStatus[]> {
    return this.enqueue(() => this.loadInstalledOnce());
  }

  private async loadInstalledOnce(): Promise<PluginStatus[]> {
    await this.ensurePluginRoot();
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const results: PluginStatus[] = [];
    const discovered = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory() || !PLUGIN_ID.test(entry.name)) continue;
      discovered.add(entry.name);
      try {
        const pluginDir = path.join(this.directory, entry.name);
        const manifestPath = path.join(pluginDir, "manifest.json");
        const manifestInfo = await fs.lstat(manifestPath);
        if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
          throw new Error("Installed plugin manifest must be a regular file.");
        }
        if (manifestInfo.size > MAX_PACKAGE_BYTES * 2) {
          throw new Error("Installed plugin manifest exceeds the size limit.");
        }
        const rawPackage = await fs.readFile(manifestPath, "utf8");
        const installed = JSON.parse(rawPackage) as SignedPluginPackage;
        const validated = this.validatePackage(installed);
        if (validated.manifest.id !== entry.name) throw new Error("Installed plugin directory does not match manifest id.");
        const previous = this.activePackages.get(entry.name);
        const currentStatus = this.pluginStatus.get(entry.name);
        if (previous?.signature === validated.signature && currentStatus?.status === "active") {
          results.push(currentStatus);
          continue;
        }
        await this.activate(validated, pluginDir, false);
        const status = toStatus(validated.manifest, "active");
        this.activePackages.set(status.id, validated);
        this.pluginStatus.set(status.id, status);
        results.push(status);
      } catch (error) {
        const previous = this.activePackages.get(entry.name);
        if (previous) {
          try {
            await this.deactivate(previous);
            this.activePackages.delete(entry.name);
          } catch (deactivationError) {
            this.report("plugin.isolate", deactivationError, { pluginId: entry.name });
          }
        }
        const status: PluginStatus = {
          id: entry.name,
          name: entry.name,
          version: "unknown",
          status: "failed",
          error: messageOf(error),
        };
        this.pluginStatus.set(entry.name, status);
        results.push(status);
        this.report("plugin.load", error, { pluginId: entry.name });
      }
    }
    for (const [pluginId, active] of this.activePackages) {
      if (discovered.has(pluginId)) continue;
      try {
        await this.deactivate(active);
        this.activePackages.delete(pluginId);
        this.pluginStatus.delete(pluginId);
      } catch (error) {
        const status = {
          ...toStatus(active.manifest, "failed"),
          error: `Plugin directory was removed but live tools could not all be removed: ${messageOf(error)}`,
        };
        this.pluginStatus.set(pluginId, status);
        results.push(status);
        this.report("plugin.unload", error, { pluginId });
      }
    }
    for (const pluginId of this.pluginStatus.keys()) {
      if (!discovered.has(pluginId) && !this.activePackages.has(pluginId)) this.pluginStatus.delete(pluginId);
    }
    if (this.rootWatcher) this.refreshPluginDirectoryWatchers(discovered);
    return results;
  }

  async install(packageInput: unknown): Promise<PluginStatus> {
    return this.enqueue(() => this.installOnce(packageInput));
  }

  private async installOnce(packageInput: unknown): Promise<PluginStatus> {
    const signedPackage = this.validatePackage(packageInput);
    const manifest = signedPackage.manifest;
    const staging = path.join(this.directory, `.staging-${manifest.id}-${Date.now()}`);
    const target = path.join(this.directory, manifest.id);
    const backup = path.join(this.directory, `.backup-${manifest.id}-${Date.now()}`);
    let targetBackedUp = false;
    let previousPackage: SignedPluginPackage | null = null;
    await this.ensurePluginRoot();
    try {
      await fs.mkdir(staging, { recursive: false });
      await this.writePackage(staging, signedPackage);
      if (await exists(target)) {
        try {
          previousPackage = this.validatePackage(JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8")) as unknown);
        } catch (error) {
          throw new Error(`Existing plugin cannot be safely replaced: ${messageOf(error)}`);
        }
        await fs.rename(target, backup);
        targetBackedUp = true;
      }
      await fs.rename(staging, target);
      try {
        await this.activate(signedPackage, target, true);
      } catch (error) {
        try {
          await this.deactivate(signedPackage);
        } catch (rollbackError) {
          this.report("plugin.rollback", rollbackError, { pluginId: manifest.id });
        }
        await fs.rm(target, { recursive: true, force: true });
        if (targetBackedUp) {
          await fs.rename(backup, target);
          if (previousPackage) {
            try {
              await this.activate(previousPackage, target, false);
            } catch (restoreError) {
              this.report("plugin.restore", restoreError, { pluginId: manifest.id });
            }
          }
        }
        throw error;
      }
      if (previousPackage) {
        const nextNames = new Set(manifest.tools.map((tool) => tool.name));
        for (const oldTool of previousPackage.manifest.tools) {
          if (nextNames.has(oldTool.name)) continue;
          try {
            await this.options.removeTool(oldTool.name);
          } catch (error) {
            this.report("plugin.cleanup", error, { pluginId: manifest.id, tool: oldTool.name });
          }
        }
      }
      if (targetBackedUp) await fs.rm(backup, { recursive: true, force: true });
      const status = toStatus(manifest, "active");
      this.activePackages.set(manifest.id, signedPackage);
      this.pluginStatus.set(manifest.id, status);
      return status;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      if (targetBackedUp && !(await exists(target))) await fs.rename(backup, target);
      const status = { ...toStatus(manifest, "failed"), error: messageOf(error) };
      this.pluginStatus.set(manifest.id, status);
      this.report("plugin.install", error, { pluginId: manifest.id, version: manifest.version });
      throw error;
    }
  }

  async sync(): Promise<PluginStatus[]> {
    if (this.syncing) return this.syncing;
    this.syncing = this.syncOnce().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async syncOnce(): Promise<PluginStatus[]> {
    if (!this.options.updateUrl || !this.options.publicKey) {
      throw new Error("Remote plugin sync requires JAYRA_PLUGIN_UPDATE_URL and JAYRA_PLUGIN_PUBLIC_KEY.");
    }
    const signedPackage = this.validatePackage(await this.fetchPackage(this.options.updateUrl));
    const currentVersion = await this.installedVersion(signedPackage.manifest.id);
    if (currentVersion && compareVersions(signedPackage.manifest.version, currentVersion) <= 0) {
      if (signedPackage.manifest.version === currentVersion) {
        const existing = this.pluginStatus.get(signedPackage.manifest.id);
        return [existing || toStatus(signedPackage.manifest, "active")];
      }
      throw new Error(`Plugin update ${signedPackage.manifest.version} is older than installed version ${currentVersion}.`);
    }
    const status = await this.install(signedPackage);
    return [status];
  }

  private async installedVersion(pluginId: string): Promise<string | null> {
    const current = this.pluginStatus.get(pluginId);
    if (current?.status === "active") return current.version;
    try {
      const signedPackage = this.validatePackage(JSON.parse(
        await fs.readFile(path.join(this.directory, pluginId, "manifest.json"), "utf8"),
      ) as unknown);
      return signedPackage.manifest.version;
    } catch (error) {
      if (await exists(path.join(this.directory, pluginId))) {
        this.report("plugin.version", error, { pluginId });
      }
      return null;
    }
  }

  private async ensurePluginRoot(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const info = await fs.lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Plugin data directory must be a real directory, not a symbolic link.");
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private scheduleRefresh(): void {
    if (!this.rootWatcher) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.loadInstalled().catch((error) => {
        this.report("plugin.discover", error, { directory: this.directory });
      });
    }, 250);
    this.refreshTimer.unref?.();
  }

  private async checkDirectoryChanges(): Promise<void> {
    if (!this.rootWatcher) return;
    try {
      const entries = await fs.readdir(this.directory, { withFileTypes: true });
      const present = new Set(entries
        .filter((entry) => entry.isDirectory() && PLUGIN_ID.test(entry.name))
        .map((entry) => entry.name));
      const tracked = new Set(this.pluginStatus.keys());
      if (this.rootWatcher && (present.size !== tracked.size || [...present].some((pluginId) => !tracked.has(pluginId)))) {
        await this.loadInstalled();
      }
    } catch (error) {
      this.report("plugin.discover", error, { directory: this.directory });
    }
  }

  private refreshPluginDirectoryWatchers(pluginIds: Set<string>): void {
    for (const [pluginId, watcher] of this.pluginDirectoryWatchers) {
      if (pluginIds.has(pluginId)) continue;
      watcher.close();
      this.pluginDirectoryWatchers.delete(pluginId);
    }
    for (const pluginId of pluginIds) {
      if (this.pluginDirectoryWatchers.has(pluginId)) continue;
      const directory = path.join(this.directory, pluginId);
      try {
        const watcher = watchDirectory(directory, () => this.scheduleRefresh());
        this.pluginDirectoryWatchers.set(pluginId, watcher);
        watcher.on("error", (error) => {
          this.report("plugin.watch", error, { pluginId, directory });
          watcher.close();
          if (this.pluginDirectoryWatchers.get(pluginId) === watcher) {
            this.pluginDirectoryWatchers.delete(pluginId);
          }
          this.scheduleRefresh();
        });
      } catch (error) {
        this.report("plugin.watch", error, { pluginId, directory });
      }
    }
  }

  private async fetchPackage(url: string): Promise<unknown> {
    const body = await this.fetchJson(url, { headers: { Accept: "application/json" } }, "Plugin update endpoint");
    if (isGitHubRelease(body)) {
      const asset = body.assets.find((item) =>
        typeof item.name === "string" && /\.jayra-plugin\.json$/i.test(item.name)
        && typeof item.browser_download_url === "string",
      );
      const assetUrlValue = asset?.browser_download_url;
      if (typeof assetUrlValue !== "string") throw new Error("GitHub release has no .jayra-plugin.json asset.");
      const assetUrl = new URL(assetUrlValue);
      if (assetUrl.protocol !== "https:" || !/(^|\.)github\.com$/i.test(assetUrl.hostname)) {
        throw new Error("GitHub plugin release assets must originate from github.com over HTTPS.");
      }
      return this.fetchJson(assetUrlValue, { headers: { Accept: "application/octet-stream" } }, "Plugin release asset", true);
    }
    return body;
  }

  private async fetchJson(url: string, init: RequestInit, label: string, allowGitHubRedirects = false): Promise<unknown> {
    let parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("Plugin update endpoints must use HTTPS (or loopback for development).");
    }
    if (parsed.username || parsed.password) throw new Error("Plugin update URLs must not embed credentials.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      let response: Response;
      for (let redirects = 0; ; redirects += 1) {
        response = await this.fetcher(parsed.href, {
          ...init,
          signal: controller.signal,
          redirect: "manual",
        });
        if (response.status < 300 || response.status >= 400) break;
        if (!allowGitHubRedirects || redirects >= 3) throw new Error(`${label} attempted an unsupported redirect.`);
        const location = response.headers.get("location");
        if (!location) throw new Error(`${label} redirect omitted its target.`);
        parsed = new URL(location, parsed);
        if (parsed.protocol !== "https:" || !/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(parsed.hostname)) {
          throw new Error("GitHub release asset redirected to an untrusted host.");
        }
      }
      if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
      return await readBoundedJson(response, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private validatePackage(input: unknown): SignedPluginPackage {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Plugin package must be an object.");
    const envelope = input as Record<string, unknown>;
    if (Object.keys(envelope).sort().join(",") !== "files,manifest,signature") {
      throw new Error("Plugin package must contain only manifest, files, and signature.");
    }
    const manifest = validateManifest(envelope.manifest);
    if (!Array.isArray(envelope.files) || envelope.files.length > 128) throw new Error("Plugin package files are invalid or exceed the file limit.");
    let totalFileBytes = 0;
    const files: PluginPackageFile[] = envelope.files.map((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("Plugin package file entry must be an object.");
      const record = file as Record<string, unknown>;
      if (Object.keys(record).sort().join(",") !== "contentBase64,path"
        || typeof record.path !== "string"
        || typeof record.contentBase64 !== "string") {
        throw new Error("Plugin package file entries require only path and contentBase64.");
      }
      validateRelativePath(record.path);
      const content = decodeBase64(record.contentBase64);
      totalFileBytes += content.length;
      if (totalFileBytes > MAX_PACKAGE_BYTES) throw new Error("Plugin package exceeds the 5 MB size limit.");
      return { path: record.path, contentBase64: record.contentBase64 };
    });
    if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length) {
      throw new Error("Plugin package contains duplicate paths (including case-insensitive collisions).");
    }
    for (const tool of manifest.tools) {
      if (!files.some((file) => file.path === tool.entryPoint)) throw new Error(`Missing plugin entry point: ${tool.entryPoint}.`);
    }
    const signature = envelope.signature;
    if (typeof signature !== "string" || !this.options.publicKey) throw new Error("A trusted Ed25519 public key and package signature are required.");
    const key = createPublicKey(this.options.publicKey.includes("-----BEGIN")
      ? this.options.publicKey
      : { key: Buffer.from(this.options.publicKey, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Plugin signing key must be Ed25519.");
    const payload = Buffer.from(canonicalJson({ manifest, files: [...files].sort((a, b) => a.path.localeCompare(b.path)) }));
    if (!verifySignature(null, payload, key, decodeBase64(signature))) throw new Error("Plugin signature verification failed.");
    return { manifest, files, signature };
  }

  private async writePackage(directory: string, signedPackage: SignedPluginPackage): Promise<void> {
    for (const file of signedPackage.files) {
      const target = resolveInside(directory, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, decodeBase64(file.contentBase64), { flag: "wx" });
    }
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(signedPackage, null, 2), { flag: "wx" });
  }

  private async activate(signedPackage: SignedPluginPackage, directory: string, replace: boolean): Promise<void> {
    const sourceByPath = new Map(signedPackage.files.map((file) => [
      file.path,
      decodeBase64(file.contentBase64).toString("utf8"),
    ]));
    const activated: PluginToolManifest[] = [];
    try {
      for (const tool of signedPackage.manifest.tools) {
        const code = sourceByPath.get(tool.entryPoint);
        if (code === undefined) throw new Error(`Plugin entry point is unavailable: ${tool.entryPoint}.`);
        await this.options.ensureTool(signedPackage.manifest.id, tool, code, replace);
        activated.push(tool);
      }
      await fs.access(directory);
    } catch (error) {
      for (const tool of activated.reverse()) {
        try {
          await this.options.removeTool(tool.name);
        } catch (rollbackError) {
          this.report("plugin.rollback", rollbackError, { pluginId: signedPackage.manifest.id, tool: tool.name });
        }
      }
      throw error;
    }
  }

  private async deactivate(signedPackage: SignedPluginPackage): Promise<void> {
    const failures: string[] = [];
    for (const tool of signedPackage.manifest.tools) {
      try {
        await this.options.removeTool(tool.name);
      } catch (error) {
        failures.push(`${tool.name}: ${messageOf(error)}`);
      }
    }
    if (failures.length) throw new Error(`Plugin rollback was incomplete: ${failures.join("; ")}`);
  }

  private report(action: string, error: unknown, metadata: Record<string, unknown>): void {
    this.options.reportDiagnostic(action, messageOf(error), metadata);
  }
}

function validateManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Plugin manifest must be an object.");
  const record = input as Record<string, unknown>;
  const keys = ["description", "id", "name", "schemaVersion", "tools", "version"];
  if (Object.keys(record).sort().join(",") !== keys.join(",")) throw new Error("Plugin manifest has missing or unsupported fields.");
  if (record.schemaVersion !== 1) throw new Error("Unsupported plugin manifest schemaVersion.");
  if (typeof record.id !== "string" || !PLUGIN_ID.test(record.id)) throw new Error("Plugin id must be a lowercase slug.");
  if (typeof record.name !== "string" || !record.name.trim() || record.name.length > 100) throw new Error("Plugin name must contain 1-100 characters.");
  if (typeof record.description !== "string" || !record.description.trim() || record.description.length > 1_000) throw new Error("Plugin description must contain 1-1000 characters.");
  if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(record.version)) throw new Error("Plugin version must use semantic version syntax.");
  if (!Array.isArray(record.tools) || record.tools.length < 1 || record.tools.length > MAX_TOOLS) throw new Error(`Plugin must declare 1-${MAX_TOOLS} tools.`);
  const tools = record.tools.map(validateToolManifest);
  const toolPrefix = `${record.id.replace(/-/g, "_")}_`;
  if (tools.some((tool) => !tool.name.startsWith(toolPrefix))) {
    throw new Error(`Plugin tool names must use the "${toolPrefix}" namespace.`);
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Plugin tool names must be unique.");
  return {
    schemaVersion: 1,
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    tools,
  };
}

function validateToolManifest(input: unknown): PluginToolManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Plugin tool descriptor must be an object.");
  const record = input as Record<string, unknown>;
  const keys = ["arguments_schema", "description", "entryPoint", "name", "requiredCapabilities"];
  if (Object.keys(record).sort().join(",") !== keys.join(",")) throw new Error("Plugin tool descriptor has missing or unsupported fields.");
  if (typeof record.name !== "string" || !TOOL_NAME.test(record.name)) throw new Error("Plugin tool name is invalid.");
  if (typeof record.description !== "string" || !record.description.trim() || record.description.length > 1_000) throw new Error(`Tool ${record.name} has an invalid description.`);
  if (typeof record.entryPoint !== "string") throw new Error(`Tool ${record.name} has an invalid entry point.`);
  validateRelativePath(record.entryPoint);
  if (!record.entryPoint.startsWith("tools/") || !record.entryPoint.endsWith(".py")) throw new Error(`Tool ${record.name} entry point must be a tools/*.py file.`);
  if (!Array.isArray(record.requiredCapabilities) || record.requiredCapabilities.length === 0) throw new Error(`Tool ${record.name} must declare required capabilities.`);
  const capabilities = record.requiredCapabilities.map((capability) => {
    if (typeof capability !== "string" || !ALLOWED_CAPABILITIES.has(capability as PermissionName)) {
      throw new Error(`Tool ${record.name} requests an unsupported capability: ${String(capability)}.`);
    }
    return capability as PermissionName;
  });
  if (!capabilities.includes("code_execution")) throw new Error(`Tool ${record.name} must declare code_execution.`);
  validateObjectSchema(record.arguments_schema);
  return {
    name: record.name,
    description: record.description,
    arguments_schema: record.arguments_schema as Record<string, unknown>,
    entryPoint: record.entryPoint,
    requiredCapabilities: capabilities,
  };
}

function validateObjectSchema(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool arguments_schema must be an object.");
  const schema = input as Record<string, unknown>;
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    throw new Error("Tool arguments_schema must define object type and properties.");
  }
  if (Object.keys(schema).some((key) => !["type", "properties", "required", "description"].includes(key))) {
    throw new Error("Tool arguments_schema contains unsupported JSON Schema keywords.");
  }
  const properties = schema.properties as Record<string, unknown>;
  if (Object.keys(properties).length > 32) throw new Error("Tool schema exceeds the 32-argument limit.");
  for (const [name, definition] of Object.entries(properties)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || !definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new Error(`Invalid schema property: ${name}.`);
    }
    const property = definition as Record<string, unknown>;
    if (!["string", "integer", "number", "boolean", "array", "object"].includes(String(property.type))) {
      throw new Error(`Unsupported schema type for ${name}.`);
    }
    if (Object.keys(property).some((key) => !["type", "description", "items"].includes(key))) {
      throw new Error(`Unsupported schema fields for ${name}.`);
    }
    if (property.description !== undefined && (typeof property.description !== "string" || property.description.length > 500)) {
      throw new Error(`Invalid description for schema property ${name}.`);
    }
    if (property.type === "array") validateArrayItemSchema(property.items, name);
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required)
    || schema.required.some((name) => typeof name !== "string" || !(name in properties)))) {
    throw new Error("Tool schema required fields must reference declared properties.");
  }
}

function validateArrayItemSchema(input: unknown, name: string): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`Array schema ${name} requires an item type.`);
  const itemType = (input as Record<string, unknown>).type;
  if (!["string", "integer", "number", "boolean", "object"].includes(String(itemType))) {
    throw new Error(`Array schema ${name} has an unsupported item type.`);
  }
}

function validateRelativePath(value: string): void {
  const parts = value.split("/");
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || parts.some((part) => !/^[A-Za-z0-9._-]{1,128}$/.test(part)
      || part === "." || part === ".."
      || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
    || path.posix.normalize(value) !== value) {
    throw new Error(`Unsafe plugin package path: ${value}.`);
  }
}

function resolveInside(root: string, relative: string): string {
  validateRelativePath(relative);
  const target = path.resolve(root, ...relative.split("/"));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Plugin package path escaped its install directory.");
  return target;
}

function decodeBase64(value: string): Buffer {
  if (value.length > Math.ceil(MAX_PACKAGE_BYTES * 4 / 3) + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Plugin package contains invalid base64 data.");
  }
  return Buffer.from(value, "base64");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_BYTES) {
    throw new Error("Plugin download exceeds the 5 MB limit.");
  }
  if (!response.body) throw new Error("Plugin update response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      throw new Error("Plugin download timed out.");
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PACKAGE_BYTES) {
      await reader.cancel();
      throw new Error("Plugin download exceeds the 5 MB limit.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Plugin update endpoint did not return valid JSON.");
  }
}

function isGitHubRelease(value: unknown): value is { assets: Array<{ name?: unknown; browser_download_url?: unknown }> } {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).assets)) return false;
  return typeof (value as Record<string, unknown>).url === "string";
}

function toStatus(manifest: PluginManifest, status: PluginStatus["status"]): PluginStatus {
  return { id: manifest.id, name: manifest.name, version: manifest.version, status };
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, prerelease = ""] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease: prerelease ? prerelease.split(".") : [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] || 0) - (b.core[index] || 0);
    if (difference) return Math.sign(difference);
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Math.sign(Number(av) - Number(bv));
    if (an !== bn) return an ? -1 : 1;
    return av.localeCompare(bv);
  }
  return 0;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
