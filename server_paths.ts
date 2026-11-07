/**
 * MYRAA — path & secret resolution.
 *
 * Separates read-only *code/asset* locations (shipped with the app) from the
 * writable *data* location (per-user, survives reinstalls). In development both
 * collapse to the project root, so existing behaviour is unchanged. When the
 * packaged Electron app launches the backend it sets MYRAA_DATA_DIR to a
 * writable folder under %APPDATA%\MYRAA, because the install directory
 * (Program Files) is read-only.
 *
 * The Gemini API key is NOT shipped with the app. Each user supplies their own
 * on first run; it is stored here in the per-user data dir (never returned to
 * the frontend).
 */

import fs from "fs";
import path from "path";
import { SecretStore } from "./secrets/secretStore";
import { apiKeyPool, ApiKeyPool, type ProviderKeyPoolDetails, type KeyDetailView } from "./models/keyPool";

/** Writable per-user data directory. Falls back to cwd in development. */
export const DATA_DIR: string = process.env.MYRAA_DATA_DIR || process.cwd();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* already exists / best-effort */
}

/** Absolute path to a file inside the writable data directory. */
export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}

// ---------------------------------------------------------------------------
// Gemini API key store.
//
// The key lives in DPAPI-protected storage (secrets/secretStore.ts). The
// legacy plaintext secrets.json is migrated on first access and afterwards
// only carries the non-secret `ignoreEnvironmentApiKey` flag.
// ---------------------------------------------------------------------------
const SECRETS_FILE = dataFile("secrets.json");
export const secretStore = new SecretStore(DATA_DIR);
const GEMINI_SECRET = "provider:gemini";
let legacyMigrationAttempted = false;

function migrateLegacySecrets(): void {
  if (legacyMigrationAttempted) return;
  legacyMigrationAttempted = true;
  secretStore.migrateLegacyPlaintext(SECRETS_FILE, "geminiApiKey", GEMINI_SECRET);
}

interface Secrets {
  /** Legacy plaintext field; migrated into protected storage. */
  geminiApiKey?: string;
  /** Suppress a rejected development .env key until the user saves a replacement. */
  ignoreEnvironmentApiKey?: boolean;
}

function readSecrets(): Secrets {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf-8")) as Secrets;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return {};
}

/**
 * Resolve the active Gemini API key.
 * Priority: user-entered key (secrets.json) → environment (.env, dev only).
 */
export function getGeminiApiKey(): string | undefined {
  migrateLegacySecrets();
  const keys: string[] = [];
  const stored = secretStore.get(GEMINI_SECRET)?.trim();
  if (stored) keys.push(...ApiKeyPool.parseKeys(stored));
  const storedExtra = secretStore.get("provider:gemini:keys")?.trim();
  if (storedExtra) keys.push(...ApiKeyPool.parseKeys(storedExtra));

  const legacy = readSecrets();
  // A legacy plaintext key that could not be migrated still works.
  if (legacy.geminiApiKey?.trim()) keys.push(...ApiKeyPool.parseKeys(legacy.geminiApiKey));

  if (!legacy.ignoreEnvironmentApiKey) {
    if (process.env.GEMINI_API_KEY) keys.push(...ApiKeyPool.parseKeys(process.env.GEMINI_API_KEY));
    if (process.env.GEMINI_API_KEYS) keys.push(...ApiKeyPool.parseKeys(process.env.GEMINI_API_KEYS));
    for (let i = 1; i <= 10; i++) {
      const indexed = process.env[`GEMINI_API_KEY_${i}`]?.trim();
      if (indexed) keys.push(indexed);
    }
  }

  if (keys.length > 0) {
    apiKeyPool.setKeys("gemini", keys);
    return apiKeyPool.getKey("gemini");
  }

  return undefined;
}

/** Retrieve all configured Gemini keys from the pool. */
export function getGeminiApiKeys(): string[] {
  getGeminiApiKey();
  return apiKeyPool.getAllKeys("gemini");
}

/** Whether any usable key is configured (without revealing it). */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/** Persist a user-supplied key in protected storage. */
export function setGeminiApiKey(key: string): void {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  secretStore.set(GEMINI_SECRET, trimmed);
  apiKeyPool.setKeys("gemini", trimmed);
  const current = readSecrets();
  delete current.geminiApiKey;
  delete current.ignoreEnvironmentApiKey;
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(current, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
}

/** Append a new Gemini key to the pool. */
export function addGeminiApiKey(key: string): void {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  // Ensure existing keys are loaded
  const current = getGeminiApiKeys();
  if (!current.includes(trimmed)) {
    current.push(trimmed);
  }
  // If no primary secret exists yet, save it as primary
  if (!secretStore.get(GEMINI_SECRET)?.trim()) {
    secretStore.set(GEMINI_SECRET, trimmed);
  }
  secretStore.set("provider:gemini:keys", current.join(","));
  apiKeyPool.setKeys("gemini", current);
}

/** Remove a key by exact match or masked key. */
export function removeGeminiApiKey(keyOrMask: string): boolean {
  const removed = apiKeyPool.removeKey("gemini", keyOrMask);
  const remaining = apiKeyPool.getAllKeys("gemini");
  secretStore.set("provider:gemini:keys", remaining.join(","));
  
  const primary = secretStore.get(GEMINI_SECRET)?.trim();
  if (primary && (primary === keyOrMask.trim() || ApiKeyPool.maskKey(primary) === keyOrMask.trim())) {
    if (remaining.length > 0) {
      secretStore.set(GEMINI_SECRET, remaining[0]);
    } else {
      secretStore.delete(GEMINI_SECRET);
    }
  }
  return removed;
}

/** Get detailed health status for the Gemini key pool. */
export function getGeminiKeyPoolDetails(): ProviderKeyPoolDetails {
  getGeminiApiKey(); // Ensure pool is synced
  return apiKeyPool.getDetailedStatus("gemini");
}

/** Append keys to any provider pool. */
export function addProviderApiKey(provider: string, rawKey: string): void {
  const norm = provider.toLowerCase().trim();
  if (norm === "gemini") {
    addGeminiApiKey(rawKey);
    return;
  }
  const keysToAdd = ApiKeyPool.parseKeys(rawKey);
  if (!keysToAdd.length) throw new Error("No valid keys provided.");
  loadProviderKeys(norm);
  for (const k of keysToAdd) {
    apiKeyPool.addKey(norm, k);
  }
  const allKeys = apiKeyPool.getAllKeys(norm);
  secretStore.set(`provider:${norm}:keys`, allKeys.join(","));
  if (allKeys.length > 0) {
    secretStore.set(`provider:${norm}`, allKeys[0]);
  }
}

/** Remove key from any provider pool. */
export function removeProviderApiKey(provider: string, keyOrMask: string): boolean {
  const norm = provider.toLowerCase().trim();
  if (norm === "gemini") {
    return removeGeminiApiKey(keyOrMask);
  }
  loadProviderKeys(norm);
  const removed = apiKeyPool.removeKey(norm, keyOrMask);
  const remaining = apiKeyPool.getAllKeys(norm);
  secretStore.set(`provider:${norm}:keys`, remaining.join(","));
  if (remaining.length > 0) {
    secretStore.set(`provider:${norm}`, remaining[0]);
  } else {
    secretStore.delete(`provider:${norm}`);
  }
  return removed;
}

/** Ensure provider keys are loaded from secretStore and environment. */
export function loadProviderKeys(provider: string): string[] {
  const norm = provider.toLowerCase().trim();
  if (norm === "gemini") {
    getGeminiApiKey();
    return apiKeyPool.getAllKeys("gemini");
  }
  const keys: string[] = [];
  const storedExtra = secretStore.get(`provider:${norm}:keys`);
  if (storedExtra) keys.push(...ApiKeyPool.parseKeys(storedExtra));
  const storedPrimary = secretStore.get(`provider:${norm}`);
  if (storedPrimary) keys.push(...ApiKeyPool.parseKeys(storedPrimary));

  const envMap: Record<string, string[]> = {
    openai: ["OPENAI_API_KEY", "OPENAI_API_KEYS"],
    groq: ["GROQ_API_KEY"],
    grok: ["XAI_API_KEY", "GROK_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    deepseek: ["DEEPSEEK_API_KEY"],
  };
  if (envMap[norm]) {
    for (const varName of envMap[norm]) {
      const val = process.env[varName];
      if (val) keys.push(...ApiKeyPool.parseKeys(val));
    }
  }

  if (keys.length > 0) {
    apiKeyPool.setKeys(norm, keys);
  }
  return apiKeyPool.getAllKeys(norm);
}

/** Get detailed telemetry status for any provider pool. */
export function getUniversalKeyPoolDetails(provider: string): ProviderKeyPoolDetails {
  loadProviderKeys(provider);
  return apiKeyPool.getDetailedStatus(provider);
}

/** Remove the stored key (used by "reset"/sign-out flows). */
export function clearGeminiApiKey(): void {
  secretStore.delete(GEMINI_SECRET);
  apiKeyPool.setKeys("gemini", []);
  const current = readSecrets();
  delete current.geminiApiKey;
  current.ignoreEnvironmentApiKey = true;
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(current, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
}
