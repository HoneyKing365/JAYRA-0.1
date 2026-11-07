/**
 * JAYRA Autonomous Proactive Workspace Briefing.
 *
 * Runs on startup (or via on-demand trigger):
 * 1. Collects live system resources (CPU, RAM, disk, network state).
 * 2. Checks active & pending tasks.
 * 3. Inspects development workspace state (VS Code, terminal, git readiness).
 * 4. Synthesizes a concise, JARVIS-grade morning/daily briefing.
 * 5. Dispatches proactive soft voice alert & publishes app event.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { appEvents } from "../shared/appEvents";
import * as native from "../native/win32";
import type { MyraaRuntime } from "./myraaRuntime";

export interface WorkspaceBriefing {
  id: string;
  generatedAt: string;
  greeting: string;
  system: {
    cpuPercent: number;
    ramPercent: number;
    ramUsedGb: number;
    ramTotalGb: number;
    network: string;
    osPlatform: string;
  };
  tasks: {
    pendingCount: number;
    items: Array<{ id: string; goal: string; state: string }>;
  };
  workspace: {
    ideActive: boolean;
    ideProcess?: string;
    ideTitle?: string;
    projectDir: string;
    gitReady: boolean;
    toolsReady: boolean;
  };
  speechText: string;
  summaryText: string;
}

export class WorkspaceBriefingManager {
  private hasTriggeredOnStartup = false;
  private latestBriefing: WorkspaceBriefing | null = null;

  async generateBriefing(runtime: MyraaRuntime): Promise<WorkspaceBriefing> {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    // 1. System metrics
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    const ramPercent = Math.round((usedMemBytes / totalMemBytes) * 100);
    const ramUsedGb = Math.round((usedMemBytes / (1024 ** 3)) * 10) / 10;
    const ramTotalGb = Math.round((totalMemBytes / (1024 ** 3)) * 10) / 10;

    // Approximate CPU load
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuPercent = Math.min(100, Math.max(0, Math.round(100 - (totalIdle / (totalTick || 1)) * 100)));
    const network = runtime.router.network.current;

    // 2. Pending tasks
    const activeTasks = runtime.tasks.active();
    const taskItems = activeTasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      state: t.state,
    }));

    // 3. Workspace state
    const openWindows = native.nativeAvailable() ? native.listWindows(60) : [];
    const ideWindow = openWindows.find((w) =>
      /code\.exe|windowsterminal\.exe|pycharm|devenv\.exe/i.test(w.process || "") ||
      /visual studio code|\bvscode\b|\bcursor\b/i.test(w.title || "")
    );
    const ideActive = Boolean(ideWindow);

    const projectDir = process.cwd();
    const gitReady = fs.existsSync(path.join(projectDir, ".git")) || fs.existsSync(path.join(projectDir, "..", ".git"));
    const toolsReady = true;

    // 4. Voice & text briefing synthesis
    let taskBrief = "No pending tasks in queue.";
    if (taskItems.length === 1) {
      taskBrief = `1 active task remaining: "${taskItems[0].goal}".`;
    } else if (taskItems.length > 1) {
      taskBrief = `${taskItems.length} active tasks queued.`;
    }

    const ideBrief = ideActive
      ? `VS Code environment is open and ready.`
      : `Workspace is primed and ready.`;

    const summaryText = `${greeting}! System load: ${cpuPercent}% CPU, ${ramPercent}% RAM. Network is ${network}. ${taskBrief} ${ideBrief}`;
    
    // Soft, JARVIS-grade Hinglish speech synthesis
    const speechText = `${greeting}! All systems online. CPU ${cpuPercent}%, RAM ${ramPercent}% use par hai. Network ${network} hai. ${ideActive ? "Workspace environment ready hai." : "Workspace tayar hai."} Aaj ke tasks shuru karein?`;

    const briefing: WorkspaceBriefing = {
      id: `briefing_${Date.now()}`,
      generatedAt: now.toISOString(),
      greeting,
      system: {
        cpuPercent,
        ramPercent,
        ramUsedGb,
        ramTotalGb,
        network,
        osPlatform: os.platform(),
      },
      tasks: {
        pendingCount: taskItems.length,
        items: taskItems,
      },
      workspace: {
        ideActive,
        ideProcess: ideWindow?.process || undefined,
        ideTitle: ideWindow?.title || undefined,
        projectDir,
        gitReady,
        toolsReady,
      },
      speechText,
      summaryText,
    };

    this.latestBriefing = briefing;
    return briefing;
  }

  async triggerStartupBriefing(runtime: MyraaRuntime): Promise<WorkspaceBriefing | null> {
    if (this.hasTriggeredOnStartup) return this.latestBriefing;
    this.hasTriggeredOnStartup = true;

    try {
      const briefing = await this.generateBriefing(runtime);
      appEvents.publish("workspace.briefing", briefing);

      // Issue soft voice announcement via discretionary speech gate
      runtime.speakDiscretionary(
        "casual",
        "normal",
        `Give the user a calm, concise JARVIS-grade morning or workspace startup briefing: ${briefing.summaryText}`,
        briefing.speechText,
        "startup_briefing",
      );

      return briefing;
    } catch (err) {
      console.warn("[WorkspaceBriefing] Failed to execute startup briefing:", err);
      return null;
    }
  }

  get latest(): WorkspaceBriefing | null {
    return this.latestBriefing;
  }
}

export const workspaceBriefingManager = new WorkspaceBriefingManager();
