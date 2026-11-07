/**
 * Frontend client and types for JAYRA Autonomous Workspace Briefing.
 */

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

export async function fetchLatestBriefing(): Promise<WorkspaceBriefing | null> {
  try {
    const res = await fetch("/api/workspace/briefing");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.briefing || null;
  } catch {
    return null;
  }
}

export async function triggerBriefing(): Promise<WorkspaceBriefing | null> {
  try {
    const res = await fetch("/api/workspace/briefing/trigger", { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.briefing || null;
  } catch {
    return null;
  }
}
