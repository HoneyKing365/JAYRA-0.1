export const MAX_REACT_ITERATIONS = 10;
export const MAX_SELF_HEALING_ATTEMPTS = 3;

export interface ReActIteration {
  allowed: boolean;
  iteration: number;
  maxIterations: number;
}

export interface ReActObservation {
  failed: boolean;
  recoverable: boolean;
  errorTrace?: string;
  exitCode?: number;
  stdoutLength?: number;
  stderrLength?: number;
  recoveryAttempt?: number;
  maxRecoveryAttempts: number;
  exhausted: boolean;
}

interface PromptState {
  iterations: number;
  recoveryAttempts: number;
  exhausted: boolean;
}

export class ReActEngine {
  private readonly prompts = new Map<string, PromptState>();

  begin(promptId: string): void {
    this.prompts.set(promptId, { iterations: 0, recoveryAttempts: 0, exhausted: false });
  }

  nextIteration(promptId: string): ReActIteration {
    const state = this.state(promptId);
    if (state.iterations >= MAX_REACT_ITERATIONS) {
      return { allowed: false, iteration: state.iterations, maxIterations: MAX_REACT_ITERATIONS };
    }
    state.iterations += 1;
    return { allowed: true, iteration: state.iterations, maxIterations: MAX_REACT_ITERATIONS };
  }

  isRecoveryExhausted(promptId: string): boolean {
    return this.state(promptId).exhausted;
  }

  observe(promptId: string, execution: unknown): ReActObservation {
    const state = this.state(promptId);
    const records = collectRecords(execution);
    const root = records[0] || {};
    const terminalStatus = String(root.status || "");
    if (["confirmation_required", "denied", "cancelled"].includes(terminalStatus)) {
      return { failed: false, recoverable: false, maxRecoveryAttempts: MAX_SELF_HEALING_ATTEMPTS, exhausted: state.exhausted };
    }

    const failure = records.find((record) =>
      record.success === false
      || record.ok === false
      || (typeof record.exitCode === "number" && record.exitCode !== 0)
      || (typeof record.exit_code === "number" && record.exit_code !== 0),
    );
    const streams = [...records].reverse().find((record) => typeof record.stdout === "string" || typeof record.stderr === "string" || typeof record.exitCode === "number" || typeof record.exit_code === "number") || failure;
    const exitCode = typeof streams?.exitCode === "number"
      ? streams.exitCode
      : typeof streams?.exit_code === "number" ? streams.exit_code : undefined;
    const stdoutLength = typeof streams?.stdout === "string" ? streams.stdout.length : undefined;
    const stderrLength = typeof streams?.stderr === "string" ? streams.stderr.length : undefined;
    if (!failure && terminalStatus !== "failed" && terminalStatus !== "timed_out") {
      return { failed: false, recoverable: false, exitCode, stdoutLength, stderrLength, maxRecoveryAttempts: MAX_SELF_HEALING_ATTEMPTS, exhausted: state.exhausted };
    }

    const errorTrace = typeof failure?.stderr === "string" && failure.stderr
      ? failure.stderr
      : records.map((record) => record.error).find((value): value is string => typeof value === "string" && Boolean(value))
        || (typeof root.error === "string" ? root.error : "Execution failed without an error trace.");
    if (state.exhausted || state.recoveryAttempts >= MAX_SELF_HEALING_ATTEMPTS) {
      state.exhausted = true;
      return { failed: true, recoverable: false, errorTrace, exitCode, stdoutLength, stderrLength, maxRecoveryAttempts: MAX_SELF_HEALING_ATTEMPTS, exhausted: true };
    }

    state.recoveryAttempts += 1;
    return {
      failed: true,
      recoverable: true,
      errorTrace,
      exitCode,
      stdoutLength,
      stderrLength,
      recoveryAttempt: state.recoveryAttempts,
      maxRecoveryAttempts: MAX_SELF_HEALING_ATTEMPTS,
      exhausted: false,
    };
  }

  private state(promptId: string): PromptState {
    let state = this.prompts.get(promptId);
    if (!state) {
      state = { iterations: 0, recoveryAttempts: 0, exhausted: false };
      this.prompts.set(promptId, state);
    }
    return state;
  }
}

function collectRecords(value: unknown, records: Array<Record<string, unknown>> = [], depth = 0): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) return records;
  const record = value as Record<string, unknown>;
  records.push(record);
  for (const key of ["result", "data", "output"]) {
    if (record[key] && typeof record[key] === "object") collectRecords(record[key], records, depth + 1);
  }
  return records;
}