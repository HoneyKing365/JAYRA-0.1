import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspaceRoot(configuredRoot: string): Promise<string> {
  const root = path.resolve(configuredRoot.trim() || process.cwd());
  const canonical = normalizeRealPath(await fs.realpath(root));
  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${canonical}`);
  return canonical;
}

export async function resolveWorkspacePath(rootPath: string, suppliedPath: string, allowMissing = false): Promise<string> {
  const root = await resolveWorkspaceRoot(rootPath);
  const candidate = path.resolve(root, suppliedPath);

  try {
    const canonical = normalizeRealPath(await fs.realpath(candidate));
    assertWithin(root, canonical);
    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !allowMissing) throw error;
    const parent = normalizeRealPath(await fs.realpath(path.dirname(candidate)));
    assertWithin(root, parent);
    return path.join(parent, path.basename(candidate));
  }
}

export interface WorkspaceCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runWorkspaceCommand(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<WorkspaceCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("A workspace command is required.");
  if (trimmed.length > 500) throw new Error("Workspace commands are limited to 500 characters.");

  const windows = process.platform === "win32";
  const executable = windows ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
  const args = windows ? ["/d", "/s", "/c", trimmed] : ["-c", trimmed];

  return await new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer, limit: number) =>
      `${current}${chunk.toString("utf8")}`.slice(0, limit);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk, 20_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk, 5_000); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function assertWithin(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Workspace access is limited to the configured project directory.");
  }
}

function normalizeRealPath(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}
