import { appEvents } from "../shared/appEvents";
import type { ToolExecutor } from "../cognition/toolExecutor";
import type { CognitiveEventInput, ToolExecutionResult } from "../cognition/types";
import type { ToolRegistry } from "../cognition/toolRegistry";
import type { PluginManager, PluginStatus } from "./pluginManager";

export interface CentralBrainOptions {
  registry: ToolRegistry;
  executor: ToolExecutor;
  dispatchContext: (event: CognitiveEventInput) => Promise<unknown>;
  fallbackRoutes?: Record<string, string[]>;
  pluginManager?: PluginManager;
}

export interface BrainToolStatus {
  name: string;
  purpose: string;
  inputSchema?: Record<string, unknown>;
  permission: string;
  riskLevel: number;
  timeoutMs: number;
  maxRetries: number;
  executions: number;
  failures: number;
  lastStatus: ToolExecutionResult["status"] | null;
  lastExecutedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export class CentralBrain {
  private readonly toolHealth = new Map<string, Omit<BrainToolStatus, "name" | "purpose" | "permission" | "riskLevel" | "timeoutMs" | "maxRetries">>();
  private readonly fallbackRoutes = new Map<string, string[]>();
  private readonly runtimeOwnedTools = new Set<string>();
  private pluginManager: PluginManager | null;

  constructor(private readonly options: CentralBrainOptions) {
    this.pluginManager = options.pluginManager || null;
    for (const [source, alternatives] of Object.entries(options.fallbackRoutes || {})) {
      for (const alternative of alternatives) this.registerFallback(source, alternative);
    }
  }

  async dispatchContext(event: CognitiveEventInput): Promise<unknown> {
    try {
      return await this.options.dispatchContext(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportDiagnostic("context.dispatch", message, {
        eventType: event.type,
        source: event.source,
        correlationId: event.correlationId,
      });
      throw error;
    }
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    context: Parameters<ToolExecutor["execute"]>[2] = {},
  ): Promise<ToolExecutionResult> {
    const outcome = await this.executeOne(tool, args, context);
    if (outcome.status !== "failed" && outcome.status !== "timed_out") return outcome;

    const alternatives = this.fallbackRoutes.get(tool) || [];
    for (const alternative of alternatives) {
      const originalDescriptor = this.options.registry.get(tool);
      const fallbackDescriptor = this.options.registry.get(alternative);
      if (!originalDescriptor || !fallbackDescriptor
        || originalDescriptor.permission !== fallbackDescriptor.permission
        || originalDescriptor.riskLevel > 1
        || fallbackDescriptor.riskLevel > 1) continue;

      const fallback = await this.executeOne(alternative, args, context);
      if (fallback.success) {
        return {
          ...fallback,
          fallbackTool: alternative,
          fallbackPathways: alternatives,
          suggestedFallback: `Recovered ${tool} with the registered read-only fallback ${alternative}.`,
        };
      }
    }
    if (alternatives.length) {
      return {
        ...outcome,
        fallbackPathways: alternatives,
        suggestedFallback: `Registered fallback tools were attempted for ${tool} but none succeeded.`,
      };
    }
    return outcome;
  }

  registerFallback(source: string, alternative: string): void {
    const sourceDescriptor = this.options.registry.get(source);
    const alternativeDescriptor = this.options.registry.get(alternative);
    if (!sourceDescriptor || !alternativeDescriptor) {
      throw new Error(`Fallback tools must be registered before routing: ${source} -> ${alternative}.`);
    }
    if (sourceDescriptor.permission !== alternativeDescriptor.permission
      || sourceDescriptor.riskLevel > 1
      || alternativeDescriptor.riskLevel > 1) {
      throw new Error("Fallback routing is limited to read-only tools with matching permission scopes.");
    }
    const alternatives = this.fallbackRoutes.get(source) || [];
    if (!alternatives.includes(alternative)) alternatives.push(alternative);
    this.fallbackRoutes.set(source, alternatives);
  }

  private async executeOne(
    tool: string,
    args: Record<string, unknown>,
    context: Parameters<ToolExecutor["execute"]>[2],
  ): Promise<ToolExecutionResult> {
    let outcome: ToolExecutionResult;
    try {
      outcome = await this.options.executor.execute(tool, args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordExecution(tool, "failed", 0, message);
      this.reportDiagnostic("tool.execute", message, { tool, correlationId: context.correlationId });
      throw error;
    }

    this.recordExecution(tool, outcome.status, outcome.durationMs, outcome.error);
    if (outcome.status === "failed" || outcome.status === "timed_out") {
      this.reportDiagnostic("tool.execute", outcome.error || `Tool ${tool} ${outcome.status}.`, {
        tool,
        status: outcome.status,
        correlationId: context.correlationId,
        suggestedFallback: outcome.suggestedFallback,
        fallbackPathways: outcome.fallbackPathways,
      });
    }
    return outcome;
  }

  async confirm(confirmationId: string): Promise<ToolExecutionResult> {
    const outcome = await this.options.executor.confirm(confirmationId);
    this.trackConfirmedOutcome(outcome);
    return outcome;
  }

  async resolveConfirmation(confirmationId: string, approved: boolean): Promise<ToolExecutionResult> {
    const outcome = await this.options.executor.resolveConfirmation(confirmationId, approved);
    this.trackConfirmedOutcome(outcome);
    return outcome;
  }

  cancel(correlationId: string): boolean {
    return this.options.executor.cancel(correlationId);
  }

  cancelAll(): number {
    return this.options.executor.cancelAll();
  }

  registerDynamicDesktopTool(name: string, purpose: string, inputSchema?: Record<string, unknown>): void {
    this.options.registry.registerDynamicDesktopTool(name, purpose, inputSchema);
  }

  unregisterDynamicDesktopTool(name: string): boolean {
    return this.options.registry.unregisterDynamicDesktopTool(name);
  }

  attachPluginManager(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  pluginStatus(): ReturnType<PluginManager["status"]> {
    if (!this.pluginManager) return { directory: "", remoteSyncEnabled: false, plugins: [] };
    return this.pluginManager.status();
  }

  async installPlugin(packageInput: unknown): Promise<PluginStatus> {
    if (!this.pluginManager) throw new Error("Plugin manager is not configured.");
    return this.pluginManager.install(packageInput);
  }

  async syncPlugins(): Promise<PluginStatus[]> {
    if (!this.pluginManager) throw new Error("Plugin manager is not configured.");
    return this.pluginManager.sync();
  }

  async loadInstalledPlugins(): Promise<PluginStatus[]> {
    if (!this.pluginManager) return [];
    return this.pluginManager.loadInstalled();
  }

  startPluginAutoSync(): void {
    this.pluginManager?.startAutoSync();
  }

  stopPluginAutoSync(): void {
    this.pluginManager?.stopAutoSync();
  }

  async reportToolOutcome(
    tool: string,
    outcome: { success: boolean; result?: unknown; error?: string | null },
    correlationId?: string,
  ): Promise<void> {
    this.runtimeOwnedTools.add(tool);
    const status: ToolExecutionResult["status"] = outcome.success ? "succeeded" : "failed";
    const error = outcome.success ? null : outcome.error || `Runtime-owned tool ${tool} failed.`;
    const resultSummary = summarizeResult(outcome.result);
    this.recordExecution(tool, status, 0, error);
    try {
      await this.dispatchContext({
        type: `tool.${status}`,
        source: "tool",
        correlationId,
        importance: outcome.success ? 0.52 : 0.78,
        metadata: { tool, status, resultSummary, ...(error ? { error } : {}) },
      });
    } catch {
      // dispatchContext has already published the exact diagnostic.
    }
    if (error) this.reportDiagnostic("tool.execute", error, { tool, correlationId });
  }

  listTools(): BrainToolStatus[] {
    const tools: BrainToolStatus[] = this.options.registry.list().map((descriptor) => ({
      ...descriptor,
      ...(this.toolHealth.get(descriptor.name) || {
        executions: 0,
        failures: 0,
        lastStatus: null,
        lastExecutedAt: null,
        lastDurationMs: null,
        lastError: null,
      }),
    }));
    const registeredNames = new Set(tools.map((tool) => tool.name));
    for (const name of this.runtimeOwnedTools) {
      if (registeredNames.has(name)) continue;
      tools.push({
        name,
        purpose: "Runtime-owned capability",
        permission: "runtime",
        riskLevel: 0,
        timeoutMs: 0,
        maxRetries: 0,
        ...(this.toolHealth.get(name) as NonNullable<ReturnType<typeof this.toolHealth.get>>),
      });
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  status(): {
    toolCount: number;
    tools: BrainToolStatus[];
    pendingConfirmations: number;
    plugins: ReturnType<PluginManager["status"]> | null;
  } {
    const tools = this.listTools();
    return {
      toolCount: tools.length,
      tools,
      pendingConfirmations: this.options.executor.confirmations.list().length,
      plugins: this.pluginManager?.status() || null,
    };
  }

  private recordExecution(
    tool: string,
    status: ToolExecutionResult["status"],
    durationMs: number,
    error: string | null,
  ): void {
    const previous = this.toolHealth.get(tool);
    this.toolHealth.set(tool, {
      executions: (previous?.executions || 0) + 1,
      failures: (previous?.failures || 0) + (status === "failed" || status === "timed_out" ? 1 : 0),
      lastStatus: status,
      lastExecutedAt: new Date().toISOString(),
      lastDurationMs: durationMs,
      lastError: error,
    });
  }

  private trackConfirmedOutcome(outcome: ToolExecutionResult): void {
    this.recordExecution(outcome.tool, outcome.status, outcome.durationMs, outcome.error);
    if (outcome.status === "failed" || outcome.status === "timed_out") {
      this.reportDiagnostic("tool.confirmation", outcome.error || `Tool ${outcome.tool} ${outcome.status}.`, {
        tool: outcome.tool,
        status: outcome.status,
        confirmationId: outcome.confirmationId,
      });
    }
  }

  reportDiagnostic(
    action: string,
    error: string,
    metadata: Record<string, unknown>,
  ): void {
    appEvents.publish("error.diagnosed", {
      component: "Central Brain",
      action,
      error,
      metadata,
    });
  }
}

function summarizeResult(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result.slice(0, 200);
  if (typeof result === "object") return Object.keys(result).slice(0, 12).join(", ");
  return String(result).slice(0, 200);
}
