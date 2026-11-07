import path from "node:path";
import type { PermissionName, RiskLevel, ToolDescriptor } from "./types";

const READ_ONLY = new Set([
  "readFile", "listFiles", "searchFiles", "getClipboard", "takeScreenshot",
  "analyzeScreenshot", "readScreen", "systemInfo", "gpuInfo", "temperatureInfo",
  "getSystemTelemetry", "inspectScreenVision",
  "getAutoStartStatus", "getCursorPosition", "getActiveWindow", "listVisibleWindows",
  "waitForUi", "observeDesktopState",
]);

const BROWSER = new Set([
  "openWebsite", "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub", "browser_control",
]);

const WEB_SEARCH = new Set(["searchWeb", "searchYouTube", "searchGoogle", "searchGitHub"]);

const MODERATE_ACTIONS = new Set(["openApplication", "switchApplication", "minimizeWindow", "maximizeWindow", "openFolder"]);

const NATIVE_UI = new Set([
  "gui_click", "gui_type", "window_control", "click", "doubleClick", "rightClick",
  "clickText", "drag", "scroll", "typeText", "typeUnicode", "pressKey", "hotkey", "uiAction", "windowControl",
]);

const FILE_WRITE = new Set([
  "createFile", "renameFile", "deleteFile", "moveFile", "createPythonFile",
  "createProjectFolder", "writeCodeFile", "copyFile",
]);

const SYSTEM = new Set([
  "volumeUp", "volumeDown", "muteToggle", "setVolume", "requestPowerAction",
  "executePowerAction", "brightnessUp", "brightnessDown", "setBrightness",
  "enableAutoStart", "disableAutoStart", "getAutoStartStatus",
]);

const CLIPBOARD = new Set([
  "getClipboard", "clearClipboard", "copySelected", "pasteClipboard",
  "setClipboardText", "copyFilesToClipboard",
]);

const CODE_EXECUTION = new Set(["runPythonScript", "runPowerShellScript", "generate_and_register_tool"]);

const PROTECTED_WINDOWS_ROOTS = [
  /^[a-z]:\\windows(?:\\|$)/i,
  /^[a-z]:\\program files(?: \(x86\))?(?:\\|$)/i,
  /^[a-z]:\\programdata(?:\\|$)/i,
];

export function isProtectedSystemPath(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const target = path.win32.resolve(value.trim()).replace(/[\\/]+$/, "").toLowerCase();
  return PROTECTED_WINDOWS_ROOTS.some((root) => root.test(target));
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  register(descriptor: ToolDescriptor): void {
    if (this.tools.has(descriptor.name)) throw new Error(`Tool already registered: ${descriptor.name}`);
    this.tools.set(descriptor.name, Object.freeze({ ...descriptor }));
  }

  registerDesktopTools(names: Iterable<string>): void {
    for (const name of names) {
      if (this.tools.has(name)) continue;
      this.register(descriptorFor(name));
    }
  }

  registerDynamicDesktopTool(name: string, purpose: string, inputSchema?: Record<string, unknown>): void {
    if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) throw new Error("Invalid dynamic desktop tool name.");
    if (this.tools.has(name)) return;
    this.register({
      name,
      purpose,
      ...(inputSchema ? { inputSchema: Object.freeze({ ...inputSchema }) } : {}),
      permission: "code_execution",
      riskLevel: 3,
      timeoutMs: 45_000,
      maxRetries: 0,
    });
  }

  unregisterDynamicDesktopTool(name: string): boolean {
    const descriptor = this.tools.get(name);
    if (!descriptor?.inputSchema) return false;
    return this.tools.delete(name);
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  assessRisk(name: string, args: Record<string, unknown>, projectRoot?: string): RiskLevel {
    const descriptor = this.get(name);
    let risk = descriptor?.riskLevel ?? 2;
    const protectedTarget = Object.entries(args).some(([key, value]) => /path|destination|folder|directory|target/i.test(key) && isProtectedSystemPath(value));
    if (args.allow_anywhere === true && protectedTarget) risk = 3;

    if (name === "deleteFile") {
      risk = args.permanent === true ? 4 : 3;
      if (isImportantPath(args.path, projectRoot)) risk = Math.max(risk, 3) as RiskLevel;
    }
    if (WEB_SEARCH.has(name)) risk = 1;
    if (MODERATE_ACTIONS.has(name) || name === "openWebsite" || name === "browser_control") risk = Math.max(risk, 2) as RiskLevel;
    if (NATIVE_UI.has(name) || CODE_EXECUTION.has(name)) risk = 3;
    if (["createFile", "createPythonFile", "writeCodeFile"].includes(name) && args.overwrite === true) {
      risk = 3;
    }
    if (name === "closeApplication" && args.force === true) risk = 3;
    if (name === "browser_control" && ["click_element", "fill_field"].includes(String(args.action || ""))) risk = 3;
    if (name === "executePowerAction" && typeof args.execute_token === "string") {
      // The Python agent validates a short-lived, single-use confirmation token.
      risk = 2;
    }
    return risk;
  }

  isProtectedPathOperation(name: string, args: Record<string, unknown>): boolean {
    if (args.allow_anywhere === true) return false;
    const descriptor = this.get(name);
    const mutable = FILE_WRITE.has(name) || name === "deleteFile" || name === "moveFile" || name === "renameFile";
    if (!mutable && descriptor?.permission !== "code_execution") return false;
    return Object.entries(args).some(([key, value]) => /path|destination|folder|directory|target/i.test(key) && isProtectedSystemPath(value));
  }
}

function descriptorFor(name: string): ToolDescriptor {
  const permission = permissionFor(name);
  const riskLevel = riskFor(name);
  return {
    name,
    purpose: purposeFor(name),
    permission,
    riskLevel,
    timeoutMs: name === "inspectScreenVision" ? 90_000
      : name === "getSystemTelemetry" ? 15_000
        : name === "browser_control" ? 60_000
        : CODE_EXECUTION.has(name) ? 45_000 : BROWSER.has(name) ? 30_000 : 25_000,
    maxRetries: name === "inspectScreenVision" ? 0 : READ_ONLY.has(name) ? 1 : 0,
  };
}

function permissionFor(name: string): PermissionName {
  if (CLIPBOARD.has(name)) return "clipboard";
  if (READ_ONLY.has(name)) {
    if (["readFile", "listFiles", "searchFiles"].includes(name)) return "filesystem_read";
    if (/Screenshot|Screen/.test(name)) return "screen_awareness";
  }
  if (BROWSER.has(name)) return "browser";
  if (NATIVE_UI.has(name)) return "automation";
  if (FILE_WRITE.has(name)) return "filesystem_write";
  if (CODE_EXECUTION.has(name)) return "code_execution";
  if (SYSTEM.has(name)) return "system_control";
  return "desktop_control";
}

function riskFor(name: string): RiskLevel {
  if (READ_ONLY.has(name)) return 1;
  if (WEB_SEARCH.has(name)) return 1;
  if (NATIVE_UI.has(name)) return 3;
  if (CODE_EXECUTION.has(name)) return 3;
  if (["requestPowerAction", "executePowerAction"].includes(name)) return 4;
  if (["deleteFile", "clearClipboard", "closeWindow", "closeApplication"].includes(name)) return 2;
  if (["enableAutoStart", "disableAutoStart"].includes(name)) return 2;
  if (MODERATE_ACTIONS.has(name) || name === "openWebsite" || name === "browser_control") return 2;
  if (FILE_WRITE.has(name)) return 2;
  return 1;
}

function purposeFor(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function isImportantPath(value: unknown, projectRoot?: string): boolean {
  if (typeof value !== "string" || !projectRoot) return false;
  try {
    const target = path.resolve(value).toLowerCase();
    const root = path.resolve(projectRoot).toLowerCase();
    return target === root || root.startsWith(target + path.sep) || target.startsWith(root + path.sep);
  } catch {
    return false;
  }
}
