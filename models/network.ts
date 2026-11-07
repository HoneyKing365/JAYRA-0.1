/**
 * Connectivity awareness. Cloud failures flagged as NETWORK flip the monitor
 * to "suspect"; a multi-host probe confirms. While offline, cloud models are
 * skipped instead of retried, and the probe backs off.
 */
import dns from "node:dns/promises";

export type NetworkState = "online" | "offline" | "unknown";

export class NetworkMonitor {
  private state: NetworkState = "unknown";
  private lastProbeAt = 0;
  private probing: Promise<NetworkState> | null = null;
  private readonly listeners = new Set<(state: NetworkState) => void>();
  private probeTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private readonly probeHosts: string[];

  constructor(
    probeHost: string | string[] = [
      "generativelanguage.googleapis.com",
      "api.x.ai",
      "api.openai.com",
      "1.1.1.1",
    ],
    private readonly lookup: (host: string) => Promise<unknown> = (host) => dns.lookup(host),
  ) {
    this.probeHosts = Array.isArray(probeHost) ? probeHost : [probeHost];
  }

  get current(): NetworkState {
    return this.state;
  }

  onChange(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markSuccess(): void {
    this.consecutiveFailures = 0;
    this.set("online");
  }

  /** Called on a NETWORK-class failure; returns the confirmed state. */
  async markNetworkFailure(): Promise<NetworkState> {
    return this.probe(true);
  }

  /**
   * Probe connectivity across candidate cloud endpoints.
   * If any endpoint resolves or connects, network is online.
   */
  async probe(force = false): Promise<NetworkState> {
    const minInterval = this.state === "offline" ? 15_000 : 5_000;
    if (!force && Date.now() - this.lastProbeAt < minInterval && this.state !== "unknown") {
      return this.state;
    }
    if (this.probing) return this.probing;

    this.lastProbeAt = Date.now();
    this.probing = (async () => {
      let anySucceeded = false;

      // Allow 6 seconds on startup or explicit probe to prevent false offline flags on cold boot
      const probeTimeoutMs = this.state === "unknown" ? 6_000 : 4_500;

      for (const host of this.probeHosts) {
        try {
          await Promise.race([
            this.lookup(host),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("probe timeout")), probeTimeoutMs).unref?.(),
            ),
          ]);
          anySucceeded = true;
          break;
        } catch {
          // Check next candidate host
        }
      }

      if (anySucceeded) {
        this.consecutiveFailures = 0;
        this.set("online");
      } else {
        this.consecutiveFailures += 1;
        // Require at least 2 consecutive failures unless forced or already marked offline
        if (force || this.consecutiveFailures >= 2 || this.state === "offline") {
          this.set("offline");
        }
      }

      this.probing = null;
      return this.state;
    })();

    return this.probing;
  }

  private set(state: NetworkState): void {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  startPeriodicProbe(intervalMs = 30_000): () => void {
    this.stopPeriodicProbe();
    // Warm up probe asynchronously without blocking startup
    if (this.state === "unknown") {
      void this.probe();
    }
    this.probeTimer = setInterval(() => {
      void this.probe();
    }, intervalMs);
    this.probeTimer.unref?.();
    return () => this.stopPeriodicProbe();
  }

  stopPeriodicProbe(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }
}
