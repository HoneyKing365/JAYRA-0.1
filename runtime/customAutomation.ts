import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../shared/jsonFile";

export interface CustomAutomationAction {
  id: string;
  name: string;
  trigger: string;
  scriptPath: string;
  runAsAdministrator: boolean;
  createdAt: string;
  updatedAt: string;
}

const MAX_ACTIONS = 100;
const ALLOWED_EXTENSIONS = new Set([".bat", ".cmd", ".ps1"]);

function normalizeTrigger(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function validateText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength) throw new Error(`${field} must contain 1 to ${maxLength} characters.`);
  return clean;
}

export class CustomAutomationStore {
  private actions: CustomAutomationAction[] = [];
  private readonly running = new Set<string>();
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "automations", "actions.v1.json");
  }

  async initialize(): Promise<void> {
    const stored = await readJsonFile<{ actions?: CustomAutomationAction[] }>(this.file, { actions: [] });
    const entries = Array.isArray(stored.actions) ? stored.actions : [];
    if (entries.length > MAX_ACTIONS) throw new Error(`Stored automation list exceeds the ${MAX_ACTIONS}-action limit.`);
    const loaded: CustomAutomationAction[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object"
        || typeof entry.id !== "string" || !entry.id
        || typeof entry.name !== "string" || typeof entry.trigger !== "string"
        || typeof entry.scriptPath !== "string"
        || typeof entry.createdAt !== "string" || typeof entry.updatedAt !== "string") {
        throw new Error("Stored automation data is invalid; review the local automations/actions.v1.json file.");
      }
      const scriptPath = path.resolve(entry.scriptPath);
      if (!ALLOWED_EXTENSIONS.has(path.extname(scriptPath).toLowerCase())) {
        throw new Error(`Stored automation "${entry.name}" uses an unsupported script type.`);
      }
      const action = { ...entry, scriptPath, runAsAdministrator: entry.runAsAdministrator === true };
      if (loaded.some((saved) => normalizeTrigger(saved.trigger) === normalizeTrigger(action.trigger))) {
        throw new Error(`Stored automations contain a duplicate voice trigger: ${action.trigger}`);
      }
      loaded.push(action);
    }
    this.actions = loaded;
  }

  list(): CustomAutomationAction[] {
    return this.actions.map((action) => ({ ...action }));
  }

  matchTrigger(text: string): CustomAutomationAction | null {
    const trigger = normalizeTrigger(text);
    if (!trigger) return null;
    const action = this.actions.find((candidate) => normalizeTrigger(candidate.trigger) === trigger);
    return action ? { ...action } : null;
  }

  async add(input: unknown): Promise<CustomAutomationAction> {
    if (this.actions.length >= MAX_ACTIONS) throw new Error(`You can save up to ${MAX_ACTIONS} automation actions.`);
    const action = await this.normalizeInput(input);
    this.assertUniqueTrigger(action.trigger);
    const now = new Date().toISOString();
    const saved = { ...action, id: randomUUID(), createdAt: now, updatedAt: now };
    await this.save([...this.actions, saved]);
    this.actions.push(saved);
    return { ...saved };
  }

  async update(id: string, input: unknown): Promise<CustomAutomationAction> {
    const index = this.actions.findIndex((action) => action.id === id);
    if (index < 0) throw Object.assign(new Error("Automation action not found."), { status: 404 });
    const action = await this.normalizeInput(input);
    this.assertUniqueTrigger(action.trigger, id);
    const previous = this.actions[index];
    const updated = { ...action, id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() };
    const next = this.actions.map((entry) => entry.id === id ? updated : entry);
    await this.save(next);
    this.actions = next;
    return { ...updated };
  }

  async remove(id: string): Promise<boolean> {
    const index = this.actions.findIndex((action) => action.id === id);
    if (index < 0) return false;
    if (this.running.has(id)) throw new Error("This automation is running and cannot be deleted yet.");
    const next = this.actions.filter((action) => action.id !== id);
    await this.save(next);
    this.actions = next;
    return true;
  }

  async run<T>(id: string, execute: (action: CustomAutomationAction) => Promise<T>): Promise<T> {
    const action = this.actions.find((candidate) => candidate.id === id);
    if (!action) throw Object.assign(new Error("Automation action not found."), { status: 404 });
    if (this.running.has(id)) throw new Error("This automation is already running.");
    this.running.add(id);
    try {
      return await execute({ ...action });
    } finally {
      this.running.delete(id);
    }
  }

  private async normalizeInput(input: unknown): Promise<Omit<CustomAutomationAction, "id" | "createdAt" | "updatedAt">> {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const name = validateText(body.name, "Name", 80);
    const trigger = validateText(body.trigger, "Voice trigger", 100);
    const scriptPath = path.resolve(validateText(body.scriptPath, "Script path", 1024));
    const extension = path.extname(scriptPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Only .bat, .cmd, and .ps1 scripts can be registered.");
    const fileInfo = await stat(scriptPath).catch(() => null);
    if (!fileInfo?.isFile()) throw new Error("The selected script file does not exist or is not a regular file.");
    return { name, trigger, scriptPath, runAsAdministrator: body.runAsAdministrator === true };
  }

  private assertUniqueTrigger(trigger: string, exceptId?: string): void {
    const normalized = normalizeTrigger(trigger);
    if (this.actions.some((action) => action.id !== exceptId && normalizeTrigger(action.trigger) === normalized)) {
      throw new Error("Each automation must have a unique voice trigger.");
    }
  }

  private async save(actions: CustomAutomationAction[]): Promise<void> {
    await writeJsonFile(this.file, { actions });
  }
}

export function executeCustomScript(action: CustomAutomationAction, timeoutMs = 120_000): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const extension = path.extname(action.scriptPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return Promise.reject(new Error("Unsupported automation script type."));

  let executable: string;
  let args: string[];
  if (action.runAsAdministrator) {
    const escapedPath = action.scriptPath.replace(/'/g, "''");
    const scriptArgs = extension === ".ps1"
      ? `@('-NoProfile','-ExecutionPolicy','RemoteSigned','-File','"${escapedPath}"')`
      : `@('/d','/s','/c','""${escapedPath}""')`;
    const file = extension === ".ps1" ? "powershell.exe" : "$env:ComSpec";
    const command = `$p=Start-Process -FilePath ${file} -ArgumentList ${scriptArgs} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    executable = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-Command", command];
  } else if (extension === ".ps1") {
    executable = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File", action.scriptPath];
  } else {
    executable = process.env.ComSpec || "cmd.exe";
    args = ["/d", "/s", "/c", `"${action.scriptPath}"`];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: path.dirname(action.scriptPath), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-8_000); });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Automation timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        return;
      }
      if (exitCode !== 0) {
        reject(new Error(`Automation exited with code ${exitCode ?? "unknown"}.${stderr ? ` ${stderr.trim()}` : ""}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}
