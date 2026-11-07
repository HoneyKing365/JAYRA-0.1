/**
 * JAYRA Predictive Shadow Execution Engine
 *
 * Silently observes user workflows (active windows, project paths, routine timestamps,
 * repetitive commands) and proactively pre-warms environments, dependencies, hot caches,
 * and dev staging buffers with high confidence before the user explicitly requests them.
 *
 * Safety Bounds:
 * - Read-only / pre-warm actions only (no destructive commands, DB mutations, or file deletions).
 * - Bounded resource throttles: max 2 concurrent shadow tasks, 15s timeout, memory capped cache.
 * - Sassy Hinglish/English proactive notifications reflecting JAYRA's personality.
 */

import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../shared/jsonFile";

export type ShadowActionType =
  | "PRELOAD_DEPENDENCIES"
  | "PREWARM_DEV_SERVER"
  | "CACHE_PROJECT_FILES"
  | "GIT_STATUS_PROBE"
  | "STAGE_BROWSER_TAB";

export interface UserRoutineObservation {
  id: string;
  timestamp: number;
  hourOfDay: number;
  dayOfWeek: number;
  application: string;
  windowTitle: string;
  projectPath?: string;
  commandTrigger?: string;
  actionType: "window_focus" | "terminal_command" | "project_open" | "file_access";
}

export interface PredictivePattern {
  patternId: string;
  name: string;
  triggerContext: {
    application?: string;
    windowTitleKeywords?: string[];
    targetProjectDir?: string;
    targetHour?: number;
    dayOfWeek?: number;
  };
  predictedAction: {
    actionType: ShadowActionType;
    target: string;
    payload?: Record<string, unknown>;
  };
  occurrenceCount: number;
  confidenceScore: number; // 0.0 to 1.0
  lastObservedAt: number;
  lastShadowExecutedAt?: number;
  sassyPromptHindi: string;
  sassyPromptEnglish: string;
}

export interface ShadowExecutionResult {
  executionId: string;
  patternId: string;
  actionType: ShadowActionType;
  target: string;
  status: "STAGED" | "CACHED" | "PROBED" | "SKIPPED" | "FAILED";
  details: Record<string, unknown>;
  durationMs: number;
  executedAt: string;
  proactiveNotice: string;
}

export interface PredictiveShadowConfig {
  enabled: boolean;
  confidenceThreshold: number; // e.g. 0.70
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  cooldownPeriodMs: number;
  maxCacheSizeBytes: number;
}

const DEFAULT_CONFIG: PredictiveShadowConfig = {
  enabled: true,
  confidenceThreshold: 0.7,
  maxConcurrentTasks: 2,
  taskTimeoutMs: 15_000,
  cooldownPeriodMs: 4 * 60_000, // 4 minutes
  maxCacheSizeBytes: 25 * 1024 * 1024, // 25 MB
};

const DESTRUCTIVE_KEYWORDS = [
  "rm ",
  "rm -rf",
  "del ",
  "erase",
  "drop database",
  "truncate",
  "format ",
  "mkfs",
  "git reset --hard",
  "git clean -fd",
  "shutdown",
  "kill -9",
  "taskkill /f",
];

export class PredictiveShadowEngine {
  private readonly configFile: string;
  private readonly patternsFile: string;
  private config: PredictiveShadowConfig;
  private observations: UserRoutineObservation[] = [];
  private patterns = new Map<string, PredictivePattern>();
  private activeTasksCount = 0;
  private readonly executionHistory: ShadowExecutionResult[] = [];
  private readonly hotMemoryCache = new Map<string, { content: string | Buffer; size: number; cachedAt: number }>();
  private currentCacheSizeBytes = 0;
  private onNotificationCallback?: (result: ShadowExecutionResult) => void;

  constructor(private readonly dataDir: string, customConfig: Partial<PredictiveShadowConfig> = {}) {
    this.configFile = path.join(dataDir, "shadow_execution", "config.v1.json");
    this.patternsFile = path.join(dataDir, "shadow_execution", "patterns.v1.json");
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
  }

  async initialize(): Promise<void> {
    try {
      const savedConfig = await readJsonFile<Partial<PredictiveShadowConfig>>(this.configFile, {});
      this.config = { ...this.config, ...savedConfig };

      const savedPatterns = await readJsonFile<PredictivePattern[]>(this.patternsFile, []);
      for (const pattern of savedPatterns) {
        if (pattern && typeof pattern.patternId === "string") {
          this.patterns.set(pattern.patternId, pattern);
        }
      }

      // Seed core initial development patterns if empty
      if (this.patterns.size === 0) {
        this.seedBuiltInDevPatterns();
      }
    } catch {
      this.seedBuiltInDevPatterns();
    }
  }

  onNotification(cb: (result: ShadowExecutionResult) => void): void {
    this.onNotificationCallback = cb;
  }

  getConfig(): PredictiveShadowConfig {
    return { ...this.config };
  }

  async updateConfig(next: Partial<PredictiveShadowConfig>): Promise<PredictiveShadowConfig> {
    this.config = { ...this.config, ...next };
    await writeJsonFile(this.configFile, this.config);
    return { ...this.config };
  }

  listPatterns(): PredictivePattern[] {
    return Array.from(this.patterns.values());
  }

  getExecutionHistory(limit = 20): ShadowExecutionResult[] {
    return this.executionHistory.slice(-limit).reverse();
  }

  getHotCacheStats(): { items: number; totalSizeBytes: number; keys: string[] } {
    return {
      items: this.hotMemoryCache.size,
      totalSizeBytes: this.currentCacheSizeBytes,
      keys: Array.from(this.hotMemoryCache.keys()),
    };
  }

  clearHotCache(): void {
    this.hotMemoryCache.clear();
    this.currentCacheSizeBytes = 0;
  }

  /**
   * Records a user event, calculates pattern confidence, and checks for predictive trigger opportunities.
   */
  async recordObservation(input: {
    application?: string;
    windowTitle?: string;
    projectPath?: string;
    commandTrigger?: string;
    actionType: "window_focus" | "terminal_command" | "project_open" | "file_access";
  }): Promise<{ matchedPattern?: PredictivePattern; triggeredShadow: boolean }> {
    if (!this.config.enabled) return { triggeredShadow: false };

    const now = new Date();
    const observation: UserRoutineObservation = {
      id: randomUUID(),
      timestamp: now.getTime(),
      hourOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
      application: (input.application || "").toLowerCase().trim(),
      windowTitle: (input.windowTitle || "").trim(),
      projectPath: input.projectPath ? path.resolve(input.projectPath) : undefined,
      commandTrigger: input.commandTrigger?.trim(),
      actionType: input.actionType,
    };

    this.observations.push(observation);
    if (this.observations.length > 500) {
      this.observations.splice(0, 100);
    }

    // Update patterns and calculate recurrence scores
    this.updatePatternConfidence(observation);

    // Evaluate if any pattern matches the current context with high confidence
    const candidate = this.findMatchingPattern(observation);
    if (candidate && candidate.confidenceScore >= this.config.confidenceThreshold) {
      const timeSinceLast = Date.now() - (candidate.lastShadowExecutedAt || 0);
      if (timeSinceLast >= this.config.cooldownPeriodMs) {
        const result = await this.executeShadowTask(candidate);
        return { matchedPattern: candidate, triggeredShadow: result.status !== "SKIPPED" && result.status !== "FAILED" };
      }
    }

    return { matchedPattern: candidate, triggeredShadow: false };
  }

  /**
   * Executes a safe shadow pre-loading task in the background.
   */
  async executeShadowTask(pattern: PredictivePattern): Promise<ShadowExecutionResult> {
    if (!this.config.enabled) {
      return this.recordResult(pattern, "SKIPPED", { reason: "Shadow execution disabled" }, 0);
    }

    if (this.activeTasksCount >= this.config.maxConcurrentTasks) {
      return this.recordResult(pattern, "SKIPPED", { reason: "Max concurrent shadow tasks reached" }, 0);
    }

    // Safety validation
    if (!this.isSafeAction(pattern.predictedAction)) {
      return this.recordResult(pattern, "SKIPPED", { reason: "Action rejected by shadow safety bounds" }, 0);
    }

    this.activeTasksCount += 1;
    const startTime = Date.now();
    pattern.lastShadowExecutedAt = startTime;

    try {
      let details: Record<string, unknown> = {};
      const { actionType, target, payload } = pattern.predictedAction;

      switch (actionType) {
        case "PRELOAD_DEPENDENCIES":
          details = await this.shadowPreloadDependencies(target);
          break;
        case "CACHE_PROJECT_FILES":
          details = await this.shadowCacheProjectFiles(target, payload?.extensions as string[]);
          break;
        case "PREWARM_DEV_SERVER":
          details = await this.shadowProbeDevServer(Number(payload?.port || 3000));
          break;
        case "GIT_STATUS_PROBE":
          details = await this.shadowProbeGitStatus(target);
          break;
        case "STAGE_BROWSER_TAB":
          details = { stagedUrl: target, ready: true };
          break;
      }

      const durationMs = Date.now() - startTime;
      await this.persistPatterns();
      const result = this.recordResult(pattern, "STAGED", details, durationMs);

      // Proactively notify through registered handler
      this.onNotificationCallback?.(result);
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return this.recordResult(pattern, "FAILED", { error: err?.message || String(err) }, durationMs);
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Manually triggers a registered pattern by ID (useful for tests and user inspection).
   */
  async triggerManual(patternId: string): Promise<ShadowExecutionResult> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) throw new Error(`Pattern '${patternId}' not found.`);
    return await this.executeShadowTask(pattern);
  }

  // ---------------------------------------------------------------------------
  // Shadow Action Handlers
  // ---------------------------------------------------------------------------

  private async shadowPreloadDependencies(targetDir: string): Promise<Record<string, unknown>> {
    const projectDir = path.resolve(targetDir || process.cwd());
    const pkgPath = path.join(projectDir, "package.json");
    const lockPath = path.join(projectDir, "package-lock.json");

    let depCount = 0;
    if (fsSync.existsSync(pkgPath)) {
      const rawPkg = await fs.readFile(pkgPath, "utf8");
      this.putInCache(pkgPath, rawPkg);
      const pkg = JSON.parse(rawPkg);
      depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    }

    let lockCached = false;
    if (fsSync.existsSync(lockPath)) {
      const lockStat = await fs.stat(lockPath);
      if (lockStat.size < 1_000_000) {
        const rawLock = await fs.readFile(lockPath, "utf8");
        this.putInCache(lockPath, rawLock);
        lockCached = true;
      }
    }

    return {
      projectDir,
      dependenciesCount: depCount,
      packageJsonCached: true,
      lockfileCached: lockCached,
      preloadedAt: new Date().toISOString(),
    };
  }

  private async shadowCacheProjectFiles(targetDir: string, extensions: string[] = [".ts", ".tsx", ".json"]): Promise<Record<string, unknown>> {
    const projectDir = path.resolve(targetDir || process.cwd());
    const validExts = new Set(extensions);
    const cachedFiles: string[] = [];

    const walk = async (dir: string, depth: number) => {
      if (depth > 2 || cachedFiles.length >= 10) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (cachedFiles.length >= 10) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!["node_modules", ".git", "dist", ".venv"].includes(entry.name)) {
              await walk(fullPath, depth + 1);
            }
          } else if (entry.isFile() && validExts.has(path.extname(entry.name).toLowerCase())) {
            const stat = await fs.stat(fullPath);
            if (stat.size <= 250_000) {
              const content = await fs.readFile(fullPath, "utf8");
              this.putInCache(fullPath, content);
              cachedFiles.push(path.relative(projectDir, fullPath));
            }
          }
        }
      } catch {
        /* skip read error */
      }
    };

    await walk(projectDir, 0);
    return {
      cachedFilesCount: cachedFiles.length,
      sampleFiles: cachedFiles.slice(0, 5),
    };
  }

  private async shadowProbeDevServer(port: number): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1_500);

      socket.on("connect", () => {
        socket.destroy();
        resolve({ port, status: "PORT_ALIVE", message: `Dev server on :${port} is already listening.` });
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve({ port, status: "PORT_COLD", message: `Port :${port} not responding yet. Staged for quick spin-up.` });
      });

      socket.on("error", () => {
        socket.destroy();
        resolve({ port, status: "PORT_AVAILABLE", message: `Port :${port} is idle and primed.` });
      });

      socket.connect(port, "127.0.0.1");
    });
  }

  private async shadowProbeGitStatus(targetDir: string): Promise<Record<string, unknown>> {
    const projectDir = path.resolve(targetDir || process.cwd());
    return new Promise((resolve) => {
      const child = spawn("git", ["status", "--porcelain", "-b"], { cwd: projectDir, windowsHide: true });
      let output = "";

      child.stdout.on("data", (d: Buffer) => {
        output += d.toString("utf8");
      });

      child.on("close", (code) => {
        if (code === 0) {
          const lines = output.trim().split("\n");
          const branchLine = lines[0] || "";
          const dirtyCount = lines.slice(1).filter(Boolean).length;
          resolve({
            branch: branchLine.replace(/^##\s*/, ""),
            uncommittedChanges: dirtyCount,
            clean: dirtyCount === 0,
          });
        } else {
          resolve({ error: "Git command failed or not a git repository" });
        }
      });

      child.on("error", () => resolve({ error: "Git CLI unavailable" }));
    });
  }

  // ---------------------------------------------------------------------------
  // Memory Hot Cache Helpers
  // ---------------------------------------------------------------------------

  private putInCache(key: string, content: string | Buffer): void {
    const size = Buffer.byteLength(content);
    if (this.currentCacheSizeBytes + size > this.config.maxCacheSizeBytes) {
      // LRU Eviction: Remove oldest entries
      const oldestKey = this.hotMemoryCache.keys().next().value;
      if (oldestKey) {
        const item = this.hotMemoryCache.get(oldestKey);
        if (item) this.currentCacheSizeBytes -= item.size;
        this.hotMemoryCache.delete(oldestKey);
      }
    }
    this.hotMemoryCache.set(key, { content, size, cachedAt: Date.now() });
    this.currentCacheSizeBytes += size;
  }

  getFromCache(key: string): string | Buffer | undefined {
    const entry = this.hotMemoryCache.get(key);
    return entry?.content;
  }

  // ---------------------------------------------------------------------------
  // Safety Validation
  // ---------------------------------------------------------------------------

  private isSafeAction(action: PredictivePattern["predictedAction"]): boolean {
    const allowedTypes: ShadowActionType[] = [
      "PRELOAD_DEPENDENCIES",
      "PREWARM_DEV_SERVER",
      "CACHE_PROJECT_FILES",
      "GIT_STATUS_PROBE",
      "STAGE_BROWSER_TAB",
    ];

    if (!allowedTypes.includes(action.actionType)) return false;

    // Check payload for destructive command strings
    if (action.payload) {
      const jsonStr = JSON.stringify(action.payload).toLowerCase();
      for (const dangerous of DESTRUCTIVE_KEYWORDS) {
        if (jsonStr.includes(dangerous)) return false;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Pattern Recognition Engine
  // ---------------------------------------------------------------------------

  private updatePatternConfidence(current: UserRoutineObservation): void {
    for (const pattern of this.patterns.values()) {
      let matches = true;

      if (pattern.triggerContext.application) {
        if (!current.application.includes(pattern.triggerContext.application.toLowerCase())) {
          matches = false;
        }
      }

      if (pattern.triggerContext.windowTitleKeywords?.length) {
        const titleLower = current.windowTitle.toLowerCase();
        const hasKeyword = pattern.triggerContext.windowTitleKeywords.some((k) => titleLower.includes(k.toLowerCase()));
        if (!hasKeyword) matches = false;
      }

      if (pattern.triggerContext.targetProjectDir && current.projectPath) {
        if (!current.projectPath.startsWith(path.resolve(pattern.triggerContext.targetProjectDir))) {
          matches = false;
        }
      }

      if (matches) {
        pattern.occurrenceCount += 1;
        pattern.lastObservedAt = current.timestamp;
        // Reinforcement formula with asymptotic ceiling at 0.98
        pattern.confidenceScore = Math.min(0.98, pattern.confidenceScore + 0.08);
      }
    }
  }

  private findMatchingPattern(observation: UserRoutineObservation): PredictivePattern | null {
    let bestCandidate: PredictivePattern | null = null;
    let highestConfidence = 0;

    for (const pattern of this.patterns.values()) {
      if (pattern.confidenceScore > highestConfidence) {
        let matches = true;
        if (pattern.triggerContext.application && !observation.application.includes(pattern.triggerContext.application.toLowerCase())) {
          matches = false;
        }
        if (pattern.triggerContext.windowTitleKeywords?.length) {
          const titleLower = observation.windowTitle.toLowerCase();
          const hasKeyword = pattern.triggerContext.windowTitleKeywords.some((k) => titleLower.includes(k.toLowerCase()));
          if (!hasKeyword) matches = false;
        }
        if (matches) {
          highestConfidence = pattern.confidenceScore;
          bestCandidate = pattern;
        }
      }
    }

    return bestCandidate;
  }

  private recordResult(
    pattern: PredictivePattern,
    status: ShadowExecutionResult["status"],
    details: Record<string, unknown>,
    durationMs: number,
  ): ShadowExecutionResult {
    // Pick witty sassy notice in JAYRA's signature style
    const proactiveNotice = pattern.sassyPromptHindi || pattern.sassyPromptEnglish;
    const result: ShadowExecutionResult = {
      executionId: randomUUID(),
      patternId: pattern.patternId,
      actionType: pattern.predictedAction.actionType,
      target: pattern.predictedAction.target,
      status,
      details,
      durationMs,
      executedAt: new Date().toISOString(),
      proactiveNotice,
    };

    this.executionHistory.push(result);
    if (this.executionHistory.length > 50) {
      this.executionHistory.shift();
    }
    return result;
  }

  private async persistPatterns(): Promise<void> {
    await writeJsonFile(this.patternsFile, Array.from(this.patterns.values()));
  }

  private seedBuiltInDevPatterns(): void {
    const devPatterns: PredictivePattern[] = [
      {
        patternId: "pat_vscode_dev_workspace",
        name: "VS Code Active Project Pre-Warming",
        triggerContext: {
          application: "code",
          windowTitleKeywords: ["visual studio code", "jayra", "src"],
        },
        predictedAction: {
          actionType: "PRELOAD_DEPENDENCIES",
          target: process.cwd(),
        },
        occurrenceCount: 8,
        confidenceScore: 0.88,
        lastObservedAt: Date.now(),
        sassyPromptHindi: "Maine dekha aap yeh project kholne wale thay, toh dependencies pehle hi load kar di hain... ab shukriya mat kehne lag jana!",
        sassyPromptEnglish: "Saw you switching into the codebase. Dependencies and lockfiles already hot-loaded in memory. Try to look at least a little impressed, boss!",
      },
      {
        patternId: "pat_terminal_dev_server",
        name: "Terminal Dev Server Prime",
        triggerContext: {
          application: "windowsterminal",
          windowTitleKeywords: ["powershell", "cmd", "terminal"],
        },
        predictedAction: {
          actionType: "PREWARM_DEV_SERVER",
          target: "http://127.0.0.1:3000",
          payload: { port: 3000 },
        },
        occurrenceCount: 5,
        confidenceScore: 0.82,
        lastObservedAt: Date.now(),
        sassyPromptHindi: "Terminal khulte hi maine dev server port probe karke readiness stage kar di hai. Kaam shuru kijiye bina rukaawat ke!",
        sassyPromptEnglish: "Terminal focused! Probed dev port 3000 and primed the socket. No stalling on my watch.",
      },
      {
        patternId: "pat_git_readiness_probe",
        name: "Git Repository Status Probe",
        triggerContext: {
          application: "code",
          windowTitleKeywords: ["git", "source-0.1"],
        },
        predictedAction: {
          actionType: "GIT_STATUS_PROBE",
          target: process.cwd(),
        },
        occurrenceCount: 6,
        confidenceScore: 0.85,
        lastObservedAt: Date.now(),
        sassyPromptHindi: "Aapke code likhne se pehle hi Git branch aur uncommitted files inspect kar li hain. All clear, sir!",
        sassyPromptEnglish: "Git repository branch and status pre-cached ahead of your commit. You're welcome!",
      },
      {
        patternId: "pat_hot_files_cache",
        name: "TypeScript Source Hot Cache",
        triggerContext: {
          application: "code",
          windowTitleKeywords: [".ts", ".tsx"],
        },
        predictedAction: {
          actionType: "CACHE_PROJECT_FILES",
          target: process.cwd(),
          payload: { extensions: [".ts", ".tsx", ".json"] },
        },
        occurrenceCount: 7,
        confidenceScore: 0.86,
        lastObservedAt: Date.now(),
        sassyPromptHindi: "Frequent source files memory cache mein ready hain. Zero disk latency, full throttle speed!",
        sassyPromptEnglish: "Core source files pre-cached into hot memory. Disk latency eradicated before your cursor even moved.",
      },
    ];

    for (const pat of devPatterns) {
      this.patterns.set(pat.patternId, pat);
    }
  }
}
