/**
 * JAYRA Autonomous Diagnostic, Error Logging & Telemetry Engine
 *
 * Implements:
 *  - Real-time persistent structured logging to:
 *      logs/jayra_runtime_errors.log (human-readable with full stack traces & state snapshots)
 *      logs/action_failures.jsonl    (structured JSONL for telemetry and machine analysis)
 *  - Rich error context capturing component, action, stack trace, and system state
 *  - In-memory ring buffer for low-latency UI queries
 *  - Real-time event broadcasting to UI listeners
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appEvents } from "./appEvents";
import { redactText } from "./redact";

export interface SystemStateSnapshot {
  memoryRssMb: number;
  memoryHeapMb: number;
  freeMemMb: number;
  activeModel?: string;
  recentPrompt?: string;
  platform: string;
  uptimeSec: number;
}

export interface ErrorDiagnosis {
  cause: string;
  suggestion: string;
  canSelfHeal: boolean;
  autoFixAction?: string;
}

export interface ErrorRecord {
  id: string;
  timestamp: string;
  sessionId: string;
  component: string;
  action: string;
  error: string;
  stackTrace?: string;
  category: string;
  systemState: SystemStateSnapshot;
  diagnosis: ErrorDiagnosis;
}

class DiagnosticLogger {
  private logDir: string;
  private readonly ringBuffer: ErrorRecord[] = [];
  private activeModel = "default";
  private recentPrompt = "";

  constructor() {
    this.logDir = path.resolve(process.cwd(), "logs");
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      /* best effort */
    }
  }

  setLogDir(dir: string): void {
    this.logDir = dir;
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      /* best effort */
    }
  }

  updateContext(context: { activeModel?: string; recentPrompt?: string }): void {
    if (context.activeModel) this.activeModel = context.activeModel;
    if (context.recentPrompt) this.recentPrompt = context.recentPrompt;
  }

  private captureSystemState(): SystemStateSnapshot {
    const mem = process.memoryUsage();
    return {
      memoryRssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      memoryHeapMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      freeMemMb: Math.round((os.freemem() / 1024 / 1024) * 10) / 10,
      activeModel: this.activeModel,
      recentPrompt: redactText(this.recentPrompt, 120),
      platform: process.platform,
      uptimeSec: Math.round(process.uptime()),
    };
  }

  recordFailure(input: {
    sessionId?: string;
    component: string;
    action: string;
    error: unknown;
    category?: string;
    stackTrace?: string;
    diagnosis?: ErrorDiagnosis;
  }): ErrorRecord {
    const errObj = input.error instanceof Error ? input.error : null;
    const errorMessage = input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
      ? input.error
      : JSON.stringify(input.error);

    const stackTrace = input.stackTrace || (errObj?.stack ? errObj.stack : undefined);
    const category = input.category || this.inferCategory(errorMessage, stackTrace);
    const diagnosis = input.diagnosis || this.inferDiagnosis(errorMessage, category, input.action);

    const record: ErrorRecord = {
      id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId || "global",
      component: input.component,
      action: input.action,
      error: errorMessage,
      stackTrace,
      category,
      systemState: this.captureSystemState(),
      diagnosis,
    };

    // Store in ring buffer (keep last 200 records)
    this.ringBuffer.unshift(record);
    if (this.ringBuffer.length > 200) {
      this.ringBuffer.pop();
    }

    // Persist to disk asynchronously
    this.persistToDisk(record);

    // Broadcast in real time
    try {
      appEvents.publish("error.diagnosed", record);
    } catch {
      /* ignore broadcast errors */
    }

    return record;
  }

  private inferCategory(message: string, stack?: string): string {
    const text = `${message} ${stack || ""}`.toLowerCase();
    if (/etimedout|timeout|timed out|socket hang up|econnreset|enotfound/i.test(text)) {
      return "NETWORK_TIMEOUT";
    }
    if (/429|quota|rate limit|too many requests|resource_exhausted/i.test(text)) {
      return "RATE_LIMIT_QUOTA";
    }
    if (/syntaxerror|unexpected token|json\.parse|json parse|malformed/i.test(text)) {
      return "SYNTAX_OR_JSON_PARSE";
    }
    if (/cannot find module|modulenotfound|no module named/i.test(text)) {
      return "DEPENDENCY_MISSING";
    }
    if (/eacces|eperm|permission denied|unauthorized|forbidden|403/i.test(text)) {
      return "PERMISSION_DENIED";
    }
    if (/enoent|no such file|file not found|path out of workspace/i.test(text)) {
      return "FILE_NOT_FOUND";
    }
    if (/element not found|vanished|control disappeared|cannot locate/i.test(text)) {
      return "UI_VANISHED_CONTROL";
    }
    return "RUNTIME_EXCEPTION";
  }

  private inferDiagnosis(message: string, category: string, action: string): ErrorDiagnosis {
    switch (category) {
      case "NETWORK_TIMEOUT":
        return {
          cause: `Network request during "${action}" timed out before receiving a response from the host.`,
          suggestion: "Verify network connectivity and retry the action with exponential backoff.",
          canSelfHeal: true,
          autoFixAction: "retry_with_backoff",
        };
      case "RATE_LIMIT_QUOTA":
        return {
          cause: `Active model or API provider exceeded rate limit/quota for "${action}".`,
          suggestion: "Wait 30-60 seconds for quota replenishment or switch to a fallback model tier in Settings.",
          canSelfHeal: true,
          autoFixAction: "switch_model_tier",
        };
      case "SYNTAX_OR_JSON_PARSE":
        return {
          cause: `Model or parser produced invalid syntax or malformed JSON during "${action}".`,
          suggestion: "Sanitize response output, apply JSON schema repair, and retry parse.",
          canSelfHeal: true,
          autoFixAction: "sanitize_input",
        };
      case "DEPENDENCY_MISSING":
        return {
          cause: `Required runtime package or module is not installed for "${action}".`,
          suggestion: "Install the missing dependency via npm or pip and re-execute.",
          canSelfHeal: true,
          autoFixAction: "install_dependency",
        };
      case "PERMISSION_DENIED":
        return {
          cause: `Operation "${action}" was denied due to missing capability permissions or OS access restrictions.`,
          suggestion: "Grant capability authorization in Settings > Agent Permissions or run with appropriate privileges.",
          canSelfHeal: false,
          autoFixAction: "request_permission",
        };
      case "FILE_NOT_FOUND":
        return {
          cause: `Specified target path for "${action}" does not exist in workspace sandbox.`,
          suggestion: "Verify path casing and confirm the target directory exists.",
          canSelfHeal: true,
          autoFixAction: "verify_path",
        };
      case "UI_VANISHED_CONTROL":
        return {
          cause: `Target UI element disappeared or changed bounds before "${action}" could interact with it.`,
          suggestion: "Re-observe screen UI hierarchy and locate current active window controls.",
          canSelfHeal: true,
          autoFixAction: "reobserve_screen",
        };
      default:
        return {
          cause: `Action "${action}" encountered an unhandled exception: ${message}`,
          suggestion: "Inspect the raw stack trace in logs for details and report to developers if persistent.",
          canSelfHeal: false,
          autoFixAction: "inspect_trace",
        };
    }
  }

  private persistToDisk(record: ErrorRecord): void {
    try {
      // 1. Write structured JSONL line to action_failures.jsonl
      const jsonlPath = path.join(this.logDir, "action_failures.jsonl");
      const jsonlLine = `${JSON.stringify(record)}\n`;
      fs.appendFile(jsonlPath, jsonlLine, () => {});

      // 2. Write human-readable entry to jayra_runtime_errors.log
      const logPath = path.join(this.logDir, "jayra_runtime_errors.log");
      const divider = "=".repeat(80);
      const textEntry = [
        divider,
        `[TIMESTAMP]    ${record.timestamp}`,
        `[ERROR ID]     ${record.id}`,
        `[SESSION]      ${record.sessionId}`,
        `[COMPONENT]    ${record.component}`,
        `[ACTION]       ${record.action}`,
        `[CATEGORY]     ${record.category}`,
        `[ERROR]        ${record.error}`,
        `[DIAGNOSIS]    ${record.diagnosis.cause}`,
        `[SUGGESTION]   ${record.diagnosis.suggestion}`,
        `[CAN SELF-HEAL] ${record.diagnosis.canSelfHeal ? "YES (" + (record.diagnosis.autoFixAction || "auto") + ")" : "NO"}`,
        `[SYSTEM STATE] RSS: ${record.systemState.memoryRssMb}MB | Model: ${record.systemState.activeModel || "N/A"} | OS: ${record.systemState.platform}`,
        record.stackTrace ? `[STACK TRACE]\n${record.stackTrace}` : "[STACK TRACE] None available",
        "",
      ].join("\n");

      fs.appendFile(logPath, textEntry, () => {});
    } catch (err) {
      console.error("[DiagnosticLogger] Failed writing error to disk:", err);
    }
  }

  getRecentErrors(limit = 50, filter?: { category?: string; component?: string }): ErrorRecord[] {
    let result = this.ringBuffer;
    if (filter?.category) {
      result = result.filter((r) => r.category.toLowerCase() === filter.category!.toLowerCase());
    }
    if (filter?.component) {
      result = result.filter((r) => r.component.toLowerCase().includes(filter.component!.toLowerCase()));
    }
    return result.slice(0, limit);
  }

  getRawLog(lines = 100): string {
    try {
      const logPath = path.join(this.logDir, "jayra_runtime_errors.log");
      if (!fs.existsSync(logPath)) return "No errors logged yet. System healthy.";
      const content = fs.readFileSync(logPath, "utf-8");
      const split = content.split("\n");
      return split.slice(-lines * 15).join("\n");
    } catch (err) {
      return `Failed reading log file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  clear(): void {
    this.ringBuffer.length = 0;
    try {
      const logPath = path.join(this.logDir, "jayra_runtime_errors.log");
      const jsonlPath = path.join(this.logDir, "action_failures.jsonl");
      if (fs.existsSync(logPath)) fs.writeFileSync(logPath, "");
      if (fs.existsSync(jsonlPath)) fs.writeFileSync(jsonlPath, "");
    } catch {
      /* best effort */
    }
  }
}

export const diagnosticLogger = new DiagnosticLogger();
