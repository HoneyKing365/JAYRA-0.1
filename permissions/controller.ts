import { ConfirmationBroker } from "./confirmations";
import type { PermissionEngine } from "./engine";
import type { Capability, PermissionContext, PermissionVerdict } from "./types";

export interface CapabilityAction {
  id: string;
  capability: Capability;
}

export interface CapabilityAuthorizationOptions {
  title?: string;
  description?: string;
  taskId?: string | null;
  signal?: AbortSignal;
}

export class CapabilityAuthorizationError extends Error {
  constructor(
    readonly capability: Capability,
    readonly decision: "ask" | "deny",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityAuthorizationError";
  }

  readonly status = 403;
}

/**
 * The shared capability boundary for backend entry points and dynamically
 * registered modules. Action handlers remain owned by their feature modules.
 */
export class CapabilityController {
  private readonly actions = new Map<string, CapabilityAction>();

  constructor(
    private readonly permissions: PermissionEngine,
    private readonly confirmations: ConfirmationBroker,
  ) {}

  register(action: CapabilityAction): void {
    if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(action.id)) {
      throw new Error(`Invalid capability action id: ${action.id}`);
    }
    if (this.actions.has(action.id)) throw new Error(`Capability action already registered: ${action.id}`);
    this.actions.set(action.id, Object.freeze({ ...action }));
  }

  get(actionId: string): CapabilityAction | undefined {
    return this.actions.get(actionId);
  }

  list(): CapabilityAction[] {
    return [...this.actions.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  evaluate(actionId: string, context: PermissionContext = {}): PermissionVerdict {
    const action = this.requireAction(actionId);
    return this.permissions.check(action.capability, context);
  }

  async authorize(
    actionId: string,
    context: PermissionContext = {},
    options: CapabilityAuthorizationOptions = {},
  ): Promise<PermissionVerdict> {
    const action = this.requireAction(actionId);
    const verdict = this.permissions.check(action.capability, context);
    if (verdict.decision === "deny") {
      throw new CapabilityAuthorizationError(action.capability, "deny", verdict.reason);
    }
    if (verdict.decision === "allow") return verdict;

    const pending = this.confirmations.request({
      taskId: options.taskId ?? null,
      capability: action.capability,
      title: options.title || `Approve ${action.capability}`,
      description: options.description || verdict.reason,
      details: { actionId, ...context },
      allowRemember: false,
    }, { signal: options.signal });
    const answer = await pending.answer;
    if (!answer.approved) {
      throw new CapabilityAuthorizationError(
        action.capability,
        "ask",
        answer.via === "timeout" ? "Permission confirmation expired." : "Permission was not approved.",
      );
    }
    return { ...verdict, decision: "allow", reason: "Approved for this action." };
  }

  async execute<T>(
    actionId: string,
    context: PermissionContext,
    handler: () => Promise<T> | T,
    options: CapabilityAuthorizationOptions = {},
  ): Promise<T> {
    await this.authorize(actionId, context, options);
    return handler();
  }

  private requireAction(actionId: string): CapabilityAction {
    const action = this.actions.get(actionId);
    if (!action) throw new Error(`Unknown capability action: ${actionId}`);
    return action;
  }
}
