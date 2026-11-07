/**
 * Multi-API Key Pool & Rotation Manager.
 *
 * Supports:
 * - Round-robin key selection among healthy keys
 * - Automatic cooldown tracking when rate limits (429 / RESOURCE_EXHAUSTED) or quota limits are hit
 * - Transparent rotation and fallback across multiple keys per provider (Gemini, Grok, OpenAI, etc.)
 * - Parsing multiple keys from delimited strings (comma, semicolon, newline) and environment arrays
 */
import { createLogger } from "../shared/logger";

const log = createLogger("keyPool");


export interface KeyEntry {
  key: string;
  addedAt: number;
  lastUsedAt: number;
  failureCount: number;
  successCount: number;
  cooldownUntil: number;
  lastError?: string;
}

export interface KeyPoolStatus {
  provider: string;
  total: number;
  healthy: number;
  coolingDown: number;
  currentKeyMasked: string;
}

export interface KeyDetailView {
  masked: string;
  healthy: boolean;
  failureCount: number;
  successCount: number;
  cooldownRemainingSeconds: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface ProviderKeyPoolDetails {
  provider: string;
  total: number;
  healthy: number;
  coolingDown: number;
  keys: KeyDetailView[];
}

export class ApiKeyPool {
  private readonly pools = new Map<string, KeyEntry[]>();
  private readonly indices = new Map<string, number>();

  /** Parse any raw string, array, or comma/newline/semicolon delimited list of keys into a clean string array. */
  static parseKeys(input?: string | string[] | null): string[] {
    if (!input) return [];
    const rawList = Array.isArray(input) ? input : String(input).split(/[\r\n,;]+/);
    const result: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawList) {
      const trimmed = raw.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  /** Mask an API key for safe logging (e.g. "AIzaSy...4aBc"). */
  static maskKey(key?: string): string {
    if (!key) return "(none)";
    if (key.length <= 8) return "********";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  /** Initialize or update keys for a provider. Existing stats are preserved for keys that remain. */
  setKeys(provider: string, keysInput: string | string[]): void {
    const parsed = ApiKeyPool.parseKeys(keysInput);
    const existing = this.pools.get(provider) || [];
    const existingMap = new Map(existing.map((e) => [e.key, e]));

    const updated: KeyEntry[] = parsed.map((key) => {
      const prior = existingMap.get(key);
      if (prior) return prior;
      return {
        key,
        addedAt: Date.now(),
        lastUsedAt: 0,
        failureCount: 0,
        successCount: 0,
        cooldownUntil: 0,
      };
    });

    this.pools.set(provider, updated);
    if (!this.indices.has(provider)) {
      this.indices.set(provider, 0);
    }
  }

  /** Append a single key to a provider's pool if not already present. */
  addKey(provider: string, key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return;
    const entries = this.pools.get(provider) || [];
    if (entries.some((e) => e.key === trimmed)) return;
    entries.push({
      key: trimmed,
      addedAt: Date.now(),
      lastUsedAt: 0,
      failureCount: 0,
      successCount: 0,
      cooldownUntil: 0,
    });
    this.pools.set(provider, entries);
  }

  /** Check if any key is registered for the provider. */
  hasKeys(provider: string): boolean {
    const entries = this.pools.get(provider);
    return Boolean(entries && entries.length > 0);
  }

  /** Check if at least one key is currently not in cooldown. */
  hasHealthyKey(provider: string): boolean {
    const entries = this.pools.get(provider);
    if (!entries || !entries.length) return false;
    const now = Date.now();
    return entries.some((e) => e.cooldownUntil <= now);
  }

  /**
   * Get the active key for a provider.
   * Prioritizes healthy keys via round-robin.
   * If all keys are currently cooling down, falls back to the one whose cooldown expires soonest.
   */
  getKey(provider: string): string | undefined {
    const entries = this.pools.get(provider);
    if (!entries || !entries.length) return undefined;
    if (entries.length === 1) {
      entries[0].lastUsedAt = Date.now();
      return entries[0].key;
    }

    const now = Date.now();
    const healthy = entries.filter((e) => e.cooldownUntil <= now);

    if (healthy.length > 0) {
      let idx = this.indices.get(provider) ?? 0;
      // Find the next healthy entry starting from current idx
      for (let offset = 0; offset < entries.length; offset++) {
        const candidateIdx = (idx + offset) % entries.length;
        const candidate = entries[candidateIdx];
        if (candidate.cooldownUntil <= now) {
          candidate.lastUsedAt = now;
          this.indices.set(provider, (candidateIdx + 1) % entries.length);
          return candidate.key;
        }
      }
    }

    // All keys are in cooldown: pick the one that recovers soonest
    const soonest = [...entries].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
    soonest.lastUsedAt = now;
    return soonest.key;
  }

  /** Explicitly rotate to the next key. */
  rotateKey(provider: string): string | undefined {
    const entries = this.pools.get(provider);
    if (!entries || entries.length <= 1) return this.getKey(provider);

    const currentIdx = this.indices.get(provider) ?? 0;
    this.indices.set(provider, (currentIdx + 1) % entries.length);
    return this.getKey(provider);
  }

  /** Mark a key as having successfully completed a request. */
  markSuccess(provider: string, key: string): void {
    const entries = this.pools.get(provider);
    if (!entries) return;
    const entry = entries.find((e) => e.key === key);
    if (!entry) return;
    entry.successCount++;
    entry.failureCount = 0;
    entry.cooldownUntil = 0;
    entry.lastError = undefined;
  }

  /**
   * Mark a key failure. If rate limit/quota exhausted, puts key into cooldown.
   * Returns whether another healthy key is ready to use immediately, along with the next key.
   */
  markFailure(
    provider: string,
    key: string,
    options: {
      isRateLimit?: boolean;
      retryAfterMs?: number;
      error?: string;
      cooldownMs?: number;
    } = {},
  ): { rotated: boolean; nextKey?: string } {
    const entries = this.pools.get(provider);
    if (!entries || !entries.length) return { rotated: false };

    const entry = entries.find((e) => e.key === key);
    const now = Date.now();
    if (entry) {
      entry.failureCount++;
      entry.lastError = options.error;

      if (options.isRateLimit) {
        // Cooldown for either server retryAfterMs or default 60s
        const cooldown = options.retryAfterMs && options.retryAfterMs > 0
          ? Math.max(options.retryAfterMs, 10_000)
          : options.cooldownMs ?? 60_000;
        entry.cooldownUntil = now + cooldown;
        log.warn(`API key for ${provider} entered cooldown for ${Math.round(cooldown / 1000)}s: ${ApiKeyPool.maskKey(key)}`, {
          error: options.error,
        });
      }
    }

    // Check if there are other healthy keys
    const remainingHealthy = entries.filter((e) => e.key !== key && e.cooldownUntil <= now);
    if (remainingHealthy.length > 0) {
      // Rotate pointer to next key
      const next = this.getKey(provider);
      return { rotated: true, nextKey: next };
    }

    return { rotated: false };
  }

  /** Retrieve all keys for a provider. */
  getAllKeys(provider: string): string[] {
    const entries = this.pools.get(provider);
    return entries ? entries.map((e) => e.key) : [];
  }

  /** Remove a key by exact match or masked match. */
  removeKey(provider: string, keyOrMask: string): boolean {
    const entries = this.pools.get(provider);
    if (!entries) return false;
    const initialLen = entries.length;
    const target = keyOrMask.trim();
    const filtered = entries.filter((e) => e.key !== target && ApiKeyPool.maskKey(e.key) !== target);
    if (filtered.length !== initialLen) {
      this.pools.set(provider, filtered);
      return true;
    }
    return false;
  }

  /** Get detailed telemetry for all keys under a provider. */
  getDetailedStatus(provider: string): ProviderKeyPoolDetails {
    const entries = this.pools.get(provider) || [];
    const now = Date.now();
    let healthyCount = 0;
    let coolingCount = 0;

    const keys: KeyDetailView[] = entries.map((e) => {
      const isHealthy = e.cooldownUntil <= now;
      if (isHealthy) healthyCount++;
      else coolingCount++;

      return {
        masked: ApiKeyPool.maskKey(e.key),
        healthy: isHealthy,
        failureCount: e.failureCount,
        successCount: e.successCount,
        cooldownRemainingSeconds: Math.max(0, Math.ceil((e.cooldownUntil - now) / 1000)),
        lastError: e.lastError,
        lastUsedAt: e.lastUsedAt > 0 ? new Date(e.lastUsedAt).toISOString() : undefined,
      };
    });

    return {
      provider,
      total: entries.length,
      healthy: healthyCount,
      coolingDown: coolingCount,
      keys,
    };
  }

  /** Retrieve all provider IDs that have registered keys. */
  getAllProviders(): string[] {
    return Array.from(this.pools.keys());
  }

  /** Retrieve telemetry status for all providers. */
  getPoolOverview(): Record<string, ProviderKeyPoolDetails> {
    const result: Record<string, ProviderKeyPoolDetails> = {};
    for (const provider of this.pools.keys()) {
      result[provider] = this.getDetailedStatus(provider);
    }
    return result;
  }

  /** Get a summary status for telemetry/debug. */
  getStatus(provider: string): KeyPoolStatus {
    const entries = this.pools.get(provider) || [];
    const now = Date.now();
    const healthy = entries.filter((e) => e.cooldownUntil <= now).length;
    const current = entries[this.indices.get(provider) ?? 0];

    return {
      provider,
      total: entries.length,
      healthy,
      coolingDown: entries.length - healthy,
      currentKeyMasked: ApiKeyPool.maskKey(current?.key),
    };
  }
}

/** Global singleton key pool used across the application. */
export const apiKeyPool = new ApiKeyPool();
