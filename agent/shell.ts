/**
 * Command execution policy.
 *
 * - Allowlisted read-only diagnostics run without confirmation, and only
 *   when the line contains no shell metacharacters.
 * - Commands that would weaken OS security are refused outright.
 * - Everything else is RUN_COMMAND and needs the user's confirmation; it runs
 *   with a timeout and capped output.
 */
import { spawn } from "node:child_process";

const SAFE: RegExp[] = [
  /^ipconfig(\s+\/all)?$/i,
  /^systeminfo$/i,
  /^hostname$/i,
  /^whoami(\s+\/(user|groups|priv))?$/i,
  /^ver$/i,
  /^tasklist(\s+\/fi\s+"[^"&|<>^]{1,60}")?$/i,
  /^where\s+[\w.\-]{1,60}$/i,
  /^ping\s+(-n\s+[1-4]\s+)?[\w.\-]{1,100}$/i,
  /^nslookup\s+[\w.\-]{1,100}$/i,
  /^netstat\s+-an?o?$/i,
  /^dir(\s+"?[^"&|<>^]{1,200}"?)?(\s+\/[a-z]+)*$/i,
  /^(node|python|py|git|npm)\s+(--version|-v|-V)$/i,
];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/set-mppreference|disable(realtime|behavior|ioav)monitoring|add-mppreference\s+-exclusion/i, "disabling or bypassing Microsoft Defender"],
  [/netsh\s+(adv)?firewall.*(state\s+off|disable)/i, "turning off the firewall"],
  [/enablelua|consentpromptbehavior|\buac\b/i, "changing User Account Control"],
  [/bcdedit|diskpart|format\s+[a-z]:|cipher\s+\/w/i, "disk or boot configuration changes"],
  [/vssadmin\s+delete|wbadmin\s+delete|shadowcopy/i, "deleting system backups"],
  [/(rm\s+-rf\s+[\/~]|rd\s+\/s\s+\/q\s+[a-z]:\\?$|del\s+\/[fsq].*[a-z]:\\\*)/i, "mass deletion"],
];

export type ShellVerdict = { kind: "safe" } | { kind: "needs_confirmation"; reason: string } | { kind: "forbidden"; reason: string };

export function classifyCommand(command: string): ShellVerdict {
  const trimmed = command.trim();
  for (const [pattern, reason] of FORBIDDEN) {
    if (pattern.test(trimmed)) return { kind: "forbidden", reason: `Refused: ${reason} is never automated.` };
  }
  if (!/[&|<>^`;$]/.test(trimmed) && SAFE.some((pattern) => pattern.test(trimmed))) return { kind: "safe" };
  return { kind: "needs_confirmation", reason: "This command is not on the read-only list." };
}

async function spawnShell(shell: string, args: string[], options: { signal?: AbortSignal; timeoutMs?: number; cwd?: string }): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, args, { cwd: options.cwd, windowsHide: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return resolve({ exitCode: 1, stdout: "", stderr: msg, timedOut: false });
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (current: string, chunk: Buffer) => (current.length > 20_000 ? current : current + chunk.toString("utf8"));
    child.stdout?.on("data", (chunk: Buffer) => { stdout = cap(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = cap(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, options.timeoutMs ?? 60_000);
    const onAbort = () => {
      try { child.kill(); } catch { /* ignore */ }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: "", stderr: error.message, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, stdout: stdout.slice(0, 20_000), stderr: stderr.slice(0, 5_000), timedOut });
    });
  });
}

export async function runCommand(command: string, options: { signal?: AbortSignal; timeoutMs?: number; cwd?: string } = {}): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  // Primary execution via cmd.exe
  const primary = await spawnShell("cmd.exe", ["/d", "/s", "/c", command], options);
  if (primary.exitCode === 0 || primary.timedOut) {
    return primary;
  }

  // Fallback execution via powershell.exe if cmd failed with command not found or execution error
  const isCmdFailure = primary.exitCode !== 0 && (
    /is not recognized|cannot find the path|access is denied/i.test(primary.stderr) ||
    !primary.stdout.trim()
  );

  if (isCmdFailure && !options.signal?.aborted) {
    const fallback = await spawnShell("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], options);
    if (fallback.exitCode === 0) {
      return fallback;
    }
    // Check for clear permission errors
    if (/UnauthorizedAccess|PermissionDenied|Access is denied/i.test(fallback.stderr) || /Access is denied/i.test(primary.stderr)) {
      return {
        exitCode: fallback.exitCode ?? 1,
        stdout: fallback.stdout || primary.stdout,
        stderr: "Permission denied: This command requires elevated permissions or access to protected resources. Please run as administrator or grant access.",
        timedOut: fallback.timedOut,
      };
    }
    return fallback;
  }

  return primary;
}
