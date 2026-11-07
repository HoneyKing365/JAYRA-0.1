/**
 * JAYRA Background Scheduler & Proactive Heartbeat Manager.
 *
 * Coordinates non-blocking background routines:
 * - Proactive system telemetry polling
 * - Memory consolidation heartbeat
 * - Unattended task alerts and scheduled reminders
 */

export interface ScheduledTask {
  id: string;
  name: string;
  intervalMs: number;
  lastRunAt: number;
  run: () => Promise<void> | void;
  enabled: boolean;
}

export class BackgroundScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private loopTimer: number | null = null;
  private isRunning = false;

  constructor(private readonly tickIntervalMs = 5_000) {}

  register(
    id: string,
    name: string,
    intervalMs: number,
    run: () => Promise<void> | void,
    enabled = true,
  ): void {
    this.tasks.set(id, {
      id,
      name,
      intervalMs,
      lastRunAt: 0,
      run,
      enabled,
    });
  }

  unregister(id: string): void {
    this.tasks.delete(id);
  }

  setTaskEnabled(id: string, enabled: boolean): void {
    const task = this.tasks.get(id);
    if (task) task.enabled = enabled;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
    this.loopTimer = window.setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      if (now - task.lastRunAt >= task.intervalMs) {
        task.lastRunAt = now;
        try {
          const res = task.run();
          if (res && typeof res.catch === "function") {
            res.catch((err) => {
              console.warn(`[BackgroundScheduler] Task '${task.name}' failed:`, err);
            });
          }
        } catch (err) {
          console.warn(`[BackgroundScheduler] Task '${task.name}' error:`, err);
        }
      }
    }
  }

  dispose(): void {
    this.stop();
    this.tasks.clear();
  }
}

export const globalBackgroundScheduler = new BackgroundScheduler();
