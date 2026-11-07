import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SystemTelemetrySnapshot {
  capturedAt: string;
  cpu: { usagePercent: number; cores: number[] };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number };
  gpu: { name: string | null; usagePercent: number | null; vramUsedBytes: number | null; vramTotalBytes: number | null } | null;
  disk: { path: string; totalBytes: number; freeBytes: number; usedBytes: number; usagePercent: number } | null;
  network: {
    interfaceName: string | null;
    receiveBytesPerSecond: number | null;
    transmitBytesPerSecond: number | null;
    pingMs: number | null;
  };
  errors: string[];
}

interface CpuTimes {
  idle: number;
  total: number;
}

export interface NetworkCounters {
  name: string;
  received: number;
  sent: number;
}

function readCpuTimes(): CpuTimes[] {
  return os.cpus().map(({ times }) => {
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return { idle: times.idle, total };
  });
}

export function calculateCpuUsage(previous: CpuTimes[], current: CpuTimes[]): { usagePercent: number; cores: number[] } {
  const cores = current.map((sample, index) => {
    const before = previous[index];
    if (!before) return 0;
    const elapsed = sample.total - before.total;
    return elapsed > 0 ? Math.max(0, Math.min(100, (1 - (sample.idle - before.idle) / elapsed) * 100)) : 0;
  });
  return {
    usagePercent: cores.length ? cores.reduce((sum, value) => sum + value, 0) / cores.length : 0,
    cores,
  };
}

export function calculateNetworkRates(previous: NetworkCounters[], current: NetworkCounters[], elapsedSeconds: number) {
  if (elapsedSeconds <= 0 || !current.length) {
    return { interfaceName: current[0]?.name ?? null, receiveBytesPerSecond: null, transmitBytesPerSecond: null };
  }
  const before = new Map(previous.map((item) => [item.name, item]));
  const rates = current.flatMap((item) => {
    const old = before.get(item.name);
    if (!old || item.received < old.received || item.sent < old.sent) return [];
    return [{
      name: item.name,
      received: (item.received - old.received) / elapsedSeconds,
      sent: (item.sent - old.sent) / elapsedSeconds,
    }];
  });
  if (!rates.length) {
    return { interfaceName: current[0].name, receiveBytesPerSecond: null, transmitBytesPerSecond: null };
  }
  return {
    interfaceName: rates[0].name,
    receiveBytesPerSecond: Math.round(rates.reduce((sum, item) => sum + item.received, 0)),
    transmitBytesPerSecond: Math.round(rates.reduce((sum, item) => sum + item.sent, 0)),
  };
}

export class SystemMonitorService {
  private previousCpu: CpuTimes[] = [];
  private previousNetwork: NetworkCounters[] = [];
  private previousNetworkAt = 0;
  private latestSnapshot: SystemTelemetrySnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<SystemTelemetrySnapshot> | null = null;

  get latest(): SystemTelemetrySnapshot | null {
    return this.latestSnapshot;
  }

  configure(enabled: boolean, intervalSeconds: 1 | 3 | 5, publish: (snapshot: SystemTelemetrySnapshot) => void): void {
    this.stop();
    if (!enabled) return;
    void this.collect().then(publish).catch((error) => {
      console.error("[SystemMonitor] Initial sample failed:", error);
    });
    this.timer = setInterval(() => {
      void this.collect().then(publish).catch((error) => {
        console.error("[SystemMonitor] Sample failed:", error);
      });
    }, intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async collect(): Promise<SystemTelemetrySnapshot> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collectSnapshot();
    try {
      this.latestSnapshot = await this.inFlight;
      return this.latestSnapshot;
    } finally {
      this.inFlight = null;
    }
  }

  private async collectSnapshot(): Promise<SystemTelemetrySnapshot> {
    const errors: string[] = [];
    const cpuStart = readCpuTimes();
    if (!this.previousCpu.length) await new Promise((resolve) => setTimeout(resolve, 120));
    const cpuEnd = readCpuTimes();
    const cpu = calculateCpuUsage(this.previousCpu.length ? this.previousCpu : cpuStart, cpuEnd);
    this.previousCpu = cpuEnd;

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const memory = {
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usagePercent: totalBytes > 0 ? Math.round((totalBytes - freeBytes) / totalBytes * 100) : 0,
    };

    const [gpu, disk, networkCounters, pingMs] = await Promise.all([
      this.readGpu(errors),
      this.readDisk(errors),
      this.readNetworkCounters(errors),
      this.readPing(),
    ]);

    const now = Date.now();
    const elapsedSeconds = this.previousNetworkAt ? (now - this.previousNetworkAt) / 1000 : 0;
    const network = this.networkRates(this.previousNetwork, networkCounters, elapsedSeconds);
    this.previousNetwork = networkCounters;
    this.previousNetworkAt = now;

    return {
      capturedAt: new Date(now).toISOString(),
      cpu,
      memory,
      gpu,
      disk,
      network: {
        interfaceName: network.interfaceName,
        receiveBytesPerSecond: network.receiveBytesPerSecond,
        transmitBytesPerSecond: network.transmitBytesPerSecond,
        pingMs,
      },
      errors,
    };
  }

  private async readGpu(errors: string[]): Promise<SystemTelemetrySnapshot["gpu"]> {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=name,utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
      ], { timeout: 1500, windowsHide: true });
      const [line] = stdout.trim().split(/\r?\n/);
      if (!line) throw new Error("nvidia-smi returned no GPU data.");
      const [name, usage, used, total] = line.split(",").map((part) => part.trim());
      const values = [usage, used, total].map(Number);
      if (values.some((value) => !Number.isFinite(value))) throw new Error("nvidia-smi returned invalid GPU data.");
      return {
        name: name || null,
        usagePercent: values[0],
        vramUsedBytes: values[1] * 1024 * 1024,
        vramTotalBytes: values[2] * 1024 * 1024,
      };
    } catch (error) {
      errors.push(`GPU telemetry unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async readDisk(errors: string[]): Promise<SystemTelemetrySnapshot["disk"]> {
    try {
      const diskPath = os.homedir();
      const stats = await statfs(diskPath);
      const blockSize = Number(stats.bsize);
      const totalBytes = blockSize * Number(stats.blocks);
      const freeBytes = blockSize * Number(stats.bavail);
      if (![blockSize, totalBytes, freeBytes].every(Number.isFinite) || totalBytes <= 0) {
        throw new Error("Filesystem returned invalid capacity values.");
      }
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return {
        path: diskPath,
        totalBytes,
        freeBytes,
        usedBytes,
        usagePercent: Math.round(usedBytes / totalBytes * 100),
      };
    } catch (error) {
      errors.push(`Storage telemetry unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async readNetworkCounters(errors: string[]): Promise<NetworkCounters[]> {
    try {
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress",
        ], { timeout: 2500, windowsHide: true, maxBuffer: 1024 * 1024 });
        const parsed: unknown = JSON.parse(stdout);
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        return entries.flatMap((entry): NetworkCounters[] => {
          if (!entry || typeof entry !== "object") return [];
          const item = entry as Record<string, unknown>;
          const received = Number(item.ReceivedBytes);
          const sent = Number(item.SentBytes);
          return typeof item.Name === "string" && Number.isFinite(received) && Number.isFinite(sent)
            ? [{ name: item.Name, received, sent }]
            : [];
        });
      }
      if (process.platform === "linux") {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile("/proc/net/dev", "utf8");
        return content.split(/\r?\n/).slice(2).flatMap((line): NetworkCounters[] => {
          const [name, ...values] = line.trim().split(/[:\s]+/);
          if (!name || name === "lo" || values.length < 9) return [];
          const numbers = values.slice(0, 9).map(Number);
          return numbers.every(Number.isFinite)
            ? [{ name, received: numbers[0], sent: numbers[8] }]
            : [];
        });
      }
      const { stdout } = await execFileAsync("netstat", ["-ib"], { timeout: 1500, windowsHide: true });
      return stdout.split(/\r?\n/).flatMap((line): NetworkCounters[] => {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 10 || columns[0] === "Name" || columns[0] === "lo0") return [];
        const received = Number(columns[6]);
        const sent = Number(columns[9]);
        return Number.isFinite(received) && Number.isFinite(sent)
          ? [{ name: columns[0], received, sent }]
          : [];
      });
    } catch (error) {
      errors.push(`Network bandwidth unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private networkRates(previous: NetworkCounters[], current: NetworkCounters[], elapsedSeconds: number) {
    return calculateNetworkRates(previous, current, elapsedSeconds);
  }

  private async readPing(): Promise<number | null> {
    try {
      const args = process.platform === "win32" ? ["-n", "1", "-w", "900", "1.1.1.1"] : ["-c", "1", "-W", "1", "1.1.1.1"];
      const { stdout, stderr } = await execFileAsync("ping", args, { timeout: 1500, windowsHide: true });
      const output = `${stdout}\n${stderr}`;
      const match = output.match(/(?:time|time[=<])\s*[=<]?\s*(\d+(?:\.\d+)?)\s*ms/i);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }
}
