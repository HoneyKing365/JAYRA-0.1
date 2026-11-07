/**
 * JAYRA Network Connectivity Probe.
 *
 * Provides proactive monitoring of client-side internet and backend sidecar
 * connectivity with exponential backoff probing and reactive event dispatch.
 */

export type ConnectionStatus = "online" | "offline" | "degraded";

export interface NetworkProbeState {
  status: ConnectionStatus;
  isOnline: boolean;
  lastCheckedAt: number;
  latencyMs: number | null;
}

export class NetworkProbe {
  private status: ConnectionStatus = typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online";
  private lastCheckedAt = 0;
  private latencyMs: number | null = null;
  private timer: number | null = null;
  private readonly listeners = new Set<(state: NetworkProbeState) => void>();

  constructor(
    private readonly probeEndpoint = "/api/health",
    private readonly intervalMs = 20_000,
  ) {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnlineEvent);
      window.addEventListener("offline", this.handleOfflineEvent);
    }
  }

  get state(): NetworkProbeState {
    return {
      status: this.status,
      isOnline: this.status === "online",
      lastCheckedAt: this.lastCheckedAt,
      latencyMs: this.latencyMs,
    };
  }

  subscribe(listener: (state: NetworkProbeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.stop();
    void this.checkNow();
    this.timer = window.setInterval(() => {
      void this.checkNow();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkNow(): Promise<NetworkProbeState> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setStatus("offline", null);
      return this.state;
    }

    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      const resp = await fetch(this.probeEndpoint, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Math.round(performance.now() - start);
      if (resp.ok) {
        this.setStatus(elapsed > 2_500 ? "degraded" : "online", elapsed);
      } else {
        this.setStatus("degraded", elapsed);
      }
    } catch {
      // Backend or network probe failed
      this.setStatus("offline", null);
    }

    return this.state;
  }

  private handleOnlineEvent = () => {
    void this.checkNow();
  };

  private handleOfflineEvent = () => {
    this.setStatus("offline", null);
  };

  private setStatus(status: ConnectionStatus, latencyMs: number | null) {
    this.status = status;
    this.latencyMs = latencyMs;
    this.lastCheckedAt = Date.now();
    const current = this.state;
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (err) {
        console.error("[NetworkProbe] Listener error:", err);
      }
    }
  }

  dispose(): void {
    this.stop();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnlineEvent);
      window.removeEventListener("offline", this.handleOfflineEvent);
    }
    this.listeners.clear();
  }
}

export const globalNetworkProbe = new NetworkProbe();
