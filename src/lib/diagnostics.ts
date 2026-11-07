export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticEntry {
  id: string;
  title: string;
  message: string;
  severity: DiagnosticSeverity;
  at: number;
}

export const DIAGNOSTIC_EVENT = "jayra:diagnostic";

export function reportDiagnostic(title: string, message: string, severity: DiagnosticSeverity = "error"): void {
  const entry: DiagnosticEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    message: message.trim() || "An unspecified diagnostic occurred.",
    severity,
    at: Date.now(),
  };
  if (severity === "error") console.error(`[JAYRA] ${title}: ${entry.message}`);
  else if (severity === "warning") console.warn(`[JAYRA] ${title}: ${entry.message}`);
  else console.info(`[JAYRA] ${title}: ${entry.message}`);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<DiagnosticEntry>(DIAGNOSTIC_EVENT, { detail: entry }));
  }
}
