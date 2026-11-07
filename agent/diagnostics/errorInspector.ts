/**
 * JAYRA Autonomous Error Inspector & Self-Diagnosis Engine
 *
 * Intercepts action failures, tool crashes, and API exceptions.
 * Performs deep root-cause analysis using signature diagnostics and heuristics
 * to generate human-readable explanations, actionable recommendations, and
 * self-healing action hooks before showing any failure message.
 */

import type { ErrorDiagnosis } from "../../shared/diagnosticLogger";

export interface DiagnosticInspection {
  category: string;
  cause: string;
  suggestion: string;
  canSelfHeal: boolean;
  autoFixAction?: string;
  recommendedPatch?: Record<string, unknown>;
  technicalDetails?: string;
}

export class ErrorInspector {
  /**
   * Diagnoses any task action or runtime error.
   */
  static diagnose(input: {
    tool: string;
    error: unknown;
    stackTrace?: string;
    args?: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): DiagnosticInspection {
    const rawMsg = input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
      ? input.error
      : JSON.stringify(input.error);

    const stack = input.stackTrace || (input.error instanceof Error ? input.error.stack : "") || "";
    const combined = `${rawMsg} ${stack} ${input.tool}`.toLowerCase();

    // 1. Network / Gemini API / WebSocket Timeouts
    if (
      /etimedout|timeout|timed out|socket hang up|econnreset|econnrefused|enotfound|network error/i.test(combined)
    ) {
      return {
        category: "NETWORK_TIMEOUT",
        cause: `The network connection timed out while executing "${input.tool}". The server or endpoint did not acknowledge the request in time.`,
        suggestion: "Verify that your Wi-Fi or Ethernet connection is stable. JAYRA will automatically retry the operation with exponential backoff.",
        canSelfHeal: true,
        autoFixAction: "retry_with_backoff",
        technicalDetails: rawMsg,
      };
    }

    // 2. Gemini API / LLM Rate Limits & Quotas
    if (/429|quota|rate limit|too many requests|resource_exhausted/i.test(combined)) {
      return {
        category: "RATE_LIMIT_EXCEEDED",
        cause: `The Gemini API or model provider returned HTTP 429: Rate limit or per-minute token quota exceeded for "${input.tool}".`,
        suggestion: "Pause task execution for 30-45 seconds to reset quota windows, or switch to a faster/higher quota model in Settings > Models.",
        canSelfHeal: true,
        autoFixAction: "switch_model_tier",
        technicalDetails: rawMsg,
      };
    }

    // 3. Structured Output & JSON Parse Glitches
    if (/syntaxerror|unexpected token|json\.parse|json parse|malformed/i.test(combined)) {
      return {
        category: "JSON_PARSE_ERROR",
        cause: `Model generated invalid JSON or malformed schema arguments for "${input.tool}".`,
        suggestion: "JAYRA can automatically apply JSON repair algorithms to strip markdown backticks, repair unbalanced quotes, and parse arguments again.",
        canSelfHeal: true,
        autoFixAction: "sanitize_json",
        technicalDetails: rawMsg,
      };
    }

    // 4. Missing Dependencies or Modules
    if (/cannot find module|modulenotfound|no module named|is not recognized as an internal/i.test(combined)) {
      const match = rawMsg.match(/cannot find module ['"]([^'"]+)['"]/i) || rawMsg.match(/no module named ['"]([^'"]+)['"]/i);
      const pkg = match ? match[1] : "required package";
      return {
        category: "DEPENDENCY_MISSING",
        cause: `The script or tool "${input.tool}" requires missing package "${pkg}" which is not installed in the environment.`,
        suggestion: `Run "npm install ${pkg}" or "pip install ${pkg}" inside Code Studio's workspace terminal.`,
        canSelfHeal: true,
        autoFixAction: "install_dependency",
        recommendedPatch: { package: pkg },
        technicalDetails: rawMsg,
      };
    }

    // 5. Missing File or Invalid Workspace Path
    if (/enoent|no such file or directory|path out of workspace|invalid path/i.test(combined)) {
      return {
        category: "FILE_NOT_FOUND",
        cause: `Target file or directory path for "${input.tool}" was not found or is outside the configured workspace sandbox.`,
        suggestion: "Check that the target filename is spelled correctly and resides within your project directory.",
        canSelfHeal: true,
        autoFixAction: "verify_path",
        technicalDetails: rawMsg,
      };
    }

    // 6. Permission Denied & OS Authorization
    if (/eacces|eperm|permission denied|unauthorized|forbidden|403/i.test(combined)) {
      return {
        category: "PERMISSION_DENIED",
        cause: `The action "${input.tool}" was blocked by the permission engine or operating system security policy.`,
        suggestion: "Open Settings > Permissions to approve this capability, or run the JAYRA application as Administrator.",
        canSelfHeal: false,
        autoFixAction: "request_permission",
        technicalDetails: rawMsg,
      };
    }

    // 7. UI Element / Control Vanished or Screen Changed
    if (/element not found|vanished|control disappeared|cannot locate|ambiguous target/i.test(combined)) {
      return {
        category: "UI_VANISHED_CONTROL",
        cause: `The target UI button or element for "${input.tool}" changed position or vanished from the active window before clicking.`,
        suggestion: "JAYRA will take a fresh screen observation frame to locate the updated coordinates of the control.",
        canSelfHeal: true,
        autoFixAction: "reobserve_screen",
        technicalDetails: rawMsg,
      };
    }

    // 8. General Unhandled Fallback
    return {
      category: "RUNTIME_EXCEPTION",
      cause: `The action "${input.tool}" failed with an unexpected runtime error: ${rawMsg}`,
      suggestion: "Inspect the raw stack trace below. If this is a script error, open Code Studio to review and edit the file.",
      canSelfHeal: false,
      autoFixAction: "inspect_trace",
      technicalDetails: stack || rawMsg,
    };
  }

  /**
   * Converts an inspection into an ErrorDiagnosis.
   */
  static toDiagnosis(inspection: DiagnosticInspection): ErrorDiagnosis {
    return {
      cause: inspection.cause,
      suggestion: inspection.suggestion,
      canSelfHeal: inspection.canSelfHeal,
      autoFixAction: inspection.autoFixAction,
    };
  }
}
