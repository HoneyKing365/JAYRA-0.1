import type { CognitionConfig } from "./config";
import { ConfirmationStore, SafetyPolicy } from "./safety";
import { ToolRegistry } from "./toolRegistry";
import type { PermissionEngine } from "../permissions/engine";
import type { Capability, PermissionContext } from "../permissions/types";
import type {
  CognitiveEventInput,
  PermissionName,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export type ToolHandler = (
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export interface ToolExecutorOptions {
  config: CognitionConfig;
  registry: ToolRegistry;
  handler: ToolHandler;
  permissions?: PermissionEngine;
  confirmations?: ConfirmationStore;
  emit?: (event: CognitiveEventInput) => void | Promise<void>;
}

const CAPABILITY_BY_PERMISSION: Record<PermissionName, Capability> = {
  microphone: "ACCESS_MICROPHONE",
  screen_awareness: "SCREEN_CAPTURE",
  filesystem_read: "READ_FILE",
  filesystem_write: "WRITE_FILE",
  desktop_control: "CONTROL_INPUT",
  browser: "BROWSE_WEB",
  network: "NETWORK_API",
  clipboard: "CLIPBOARD",
  automation: "CONTROL_INPUT",
  code_execution: "RUN_COMMAND",
  system_control: "MODIFY_SYSTEM_SETTINGS",
};

export class ToolExecutor {
  readonly confirmations: ConfirmationStore;
  private readonly safety: SafetyPolicy;
  private readonly active = new Map<string, AbortController>();
  private readonly failures = new Map<string, number>();

  constructor(private readonly options: ToolExecutorOptions) {
    this.safety = new SafetyPolicy(options.config);
    this.confirmations = options.confirmations || new ConfirmationStore();
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext = {},
  ): Promise<ToolExecutionResult> {
    const started = Date.now();
    const descriptor = this.options.registry.get(tool);
    if (!descriptor) {
      return result(false, "denied", tool, null, `Unknown or unregistered tool: ${tool}`, 2, started, 0);
    }

    const riskLevel = this.options.registry.assessRisk(tool, args, context.projectRoot);
    if (this.options.registry.isProtectedPathOperation(tool, args)) {
      const error = "PROTECTED_SYSTEM_PATH: This operation cannot modify Windows, Program Files, or ProgramData paths.";
      await this.emit("tool.denied", tool, riskLevel, context, { reason: error });
      return result(false, "denied", tool, null, error, riskLevel, started, 0);
    }
    const permissionContext = permissionContextFor(args);
    const capability = tool === "deleteFile"
      ? "DELETE_FILE"
      : CAPABILITY_BY_PERMISSION[descriptor.permission];
    const verdict = this.options.permissions?.check(capability, permissionContext);
    if (verdict?.decision === "deny") {
      await this.emit("tool.denied", tool, riskLevel, context, { reason: verdict.reason, capability });
      return result(false, "denied", tool, null, verdict.reason, riskLevel, started, 0);
    }

    const assessment = this.options.permissions
      ? this.safety.assessAutonomy(riskLevel, context.confirmed === true)
      : this.safety.assess(descriptor.permission, riskLevel, context.confirmed === true);
    if (!assessment.allowed) {
      await this.emit("tool.denied", tool, riskLevel, context, { reason: assessment.reason });
      return result(false, "denied", tool, null, assessment.reason, riskLevel, started, 0);
    }

    const requiresPermissionConfirmation = verdict?.decision === "ask" && context.confirmed !== true;
    const requiresLegacyRiskConfirmation = !this.options.permissions
      && assessment.requiresConfirmation;
    if (requiresLegacyRiskConfirmation || requiresPermissionConfirmation) {
      const reason = requiresPermissionConfirmation ? verdict.reason : assessment.reason;
      const pending = this.confirmations.create({
        tool,
        args,
        riskLevel,
        reason,
        correlationId: context.correlationId,
      });
      await this.emit("safety.confirmation_required", tool, riskLevel, context, {
        confirmationId: pending.id,
        description: `${tool} requires confirmation: ${reason}`,
        reason,
        ...(capability ? { capability } : {}),
      });
      return {
        ...result(false, "confirmation_required", tool, null, reason, riskLevel, started, 0),
        confirmationId: pending.id,
      };
    }

    const operationId = context.correlationId || `${tool}:${started}`;
    const controller = new AbortController();
    this.active.set(operationId, controller);
    await this.emit("tool.started", tool, riskLevel, context, { operationId });

    let attempts = 0;
    try {
      const allowedAttempts = Math.min(
        descriptor.maxRetries,
        this.options.config.limits.maxRetries,
      ) + 1;
      let lastError = "Tool failed.";
      while (attempts < allowedAttempts) {
        attempts += 1;
        try {
          const response = await withTimeout(
            this.options.handler(tool, args, controller.signal),
            descriptor.timeoutMs,
            controller,
          );
          if (controller.signal.aborted) {
            await this.emit("tool.cancelled", tool, riskLevel, context, { operationId, attempts });
            return result(false, "cancelled", tool, null, "Tool was cancelled.", riskLevel, started, attempts);
          }
          if (response.ok) {
            const previousFailures = this.failures.get(tool) || 0;
            this.failures.set(tool, 0);
            await this.emit("tool.succeeded", tool, riskLevel, context, {
              operationId,
              attempts,
              recoveredAfterFailures: previousFailures > 0,
            });
            return result(true, "succeeded", tool, response.result ?? null, null, riskLevel, started, attempts);
          }
          lastError = response.error || lastError;
        } catch (error) {
          if (controller.signal.aborted) {
            const timedOut = error instanceof Error && error.message === "TOOL_TIMEOUT";
            const status = timedOut ? "timed_out" : "cancelled";
            await this.emit(`tool.${status}`, tool, riskLevel, context, { operationId, attempts });
            return result(false, status, tool, null, timedOut ? "Tool timed out." : "Tool was cancelled.", riskLevel, started, attempts);
          }
          let errMsg = error instanceof Error ? error.message : String(error);
          if (/EACCES|EPERM|access is denied|permission denied|unauthorized/i.test(errMsg)) {
            errMsg = `Permission error: ${errMsg}. System access was restricted; please confirm permissions or run as administrator.`;
          }
          lastError = errMsg;
        }
      }
      this.failures.set(tool, (this.failures.get(tool) || 0) + 1);
      await this.emit("tool.failed", tool, riskLevel, context, { operationId, attempts, error: lastError });
      return result(false, "failed", tool, null, lastError, riskLevel, started, attempts, getFallbackPathways(tool));
    } finally {
      this.active.delete(operationId);
    }
  }

  async confirm(confirmationId: string): Promise<ToolExecutionResult> {
    const pending = this.confirmations.consume(confirmationId);
    if (!pending) {
      return result(false, "denied", "unknown", null, "Confirmation is invalid or expired.", 3, Date.now(), 0);
    }
    await this.emit("safety.confirmation_resolved", pending.tool, pending.riskLevel, {
      correlationId: pending.correlationId,
      confirmed: true,
    }, { confirmationId });
    return this.execute(pending.tool, pending.args, {
      correlationId: pending.correlationId,
      confirmed: true,
    });
  }

  async resolveConfirmation(confirmationId: string, approved: boolean): Promise<ToolExecutionResult> {
    if (approved) return this.confirm(confirmationId);
    const pending = this.confirmations.consume(confirmationId);
    if (!pending) {
      return result(false, "denied", "unknown", null, "Confirmation is invalid or expired.", 3, Date.now(), 0);
    }
    const error = "USER_DENIED_PERMISSIONS: The user denied this action. Do not retry it.";
    await this.emit("safety.confirmation_resolved", pending.tool, pending.riskLevel, {
      correlationId: pending.correlationId,
      confirmed: false,
    }, { approved: false, error });
    return result(false, "USER_DENIED_PERMISSIONS", pending.tool, null, error, pending.riskLevel, Date.now(), 0);
  }

  cancel(correlationId: string): boolean {
    const controller = this.active.get(correlationId);
    if (!controller) return false;
    controller.abort("user_cancelled");
    return true;
  }

  cancelAll(): number {
    const count = this.active.size;
    for (const controller of this.active.values()) controller.abort("user_cancelled");
    this.confirmations.cancelAll();
    return count;
  }

  private async emit(
    type: string,
    tool: string,
    riskLevel: number,
    context: ToolExecutionContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.options.emit?.({
      type,
      source: type.startsWith("safety.") ? "system" : "tool",
      correlationId: context.correlationId,
      importance: type.includes("failed") ? 0.78 : type.includes("confirmation") ? 0.9 : 0.52,
      metadata: { tool, riskLevel, ...metadata },
    });
  }
}

function permissionContextFor(args: Record<string, unknown>): PermissionContext {
  const context: PermissionContext = {};
  if (typeof args.path === "string") context.path = args.path;
  if (typeof args.command === "string") context.command = args.command;
  if (args.permanent === true) context.permanent = true;
  if (typeof args.url === "string") {
    try {
      context.domain = new URL(args.url).hostname;
    } catch {
      // URL parsing is contextual metadata; the tool handler validates its own input.
    }
  }
  return context;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort("timeout");
      reject(new Error("TOOL_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getFallbackPathways(tool: string): { fallbackPathways: string[]; suggestedFallback: string } | null {
  const t = tool.toLowerCase();
  if (t.includes("click") || t.includes("type") || t.includes("press") || t.includes("hotkey") || t.includes("scroll") || t.includes("target")) {
    return {
      fallbackPathways: ["uia_accessibility_click", "keyboard_shortcut_navigation", "direct_mouse_drag_move", "screen_vision_coordinate_locate"],
      suggestedFallback: "Try inspectScreenVision or UIA accessibility tree to re-locate the target control, or use direct keyboard shortcut navigation.",
    };
  }
  if (t.includes("application") || t.includes("window") || t.includes("app")) {
    return {
      fallbackPathways: ["system_catalog_discovery", "powershell_start_process", "windows_search_keyboard", "os_accessibility_wm_close"],
      suggestedFallback: "Fallback to system discovery, PowerShell Start-Process, or Windows Search keyboard accessibility navigation.",
    };
  }
  if (t.includes("file") || t.includes("folder")) {
    return {
      fallbackPathways: ["powershell_file_operation", "shell_execution_fallback"],
      suggestedFallback: "Verify folder permissions or fall back to PowerShell file system management.",
    };
  }
  return null;
}

function result(
  success: boolean,
  status: ToolExecutionResult["status"],
  tool: string,
  value: unknown,
  error: string | null,
  riskLevel: ToolExecutionResult["riskLevel"],
  started: number,
  attempts: number,
  fallbacks?: { fallbackPathways?: string[]; suggestedFallback?: string } | null,
): ToolExecutionResult {
  return {
    success,
    status,
    tool,
    result: value,
    error,
    riskLevel,
    durationMs: Math.max(0, Date.now() - started),
    attempts,
    ...(fallbacks?.fallbackPathways ? { fallbackPathways: fallbacks.fallbackPathways } : {}),
    ...(fallbacks?.suggestedFallback ? { suggestedFallback: fallbacks.suggestedFallback } : {}),
  };
}
