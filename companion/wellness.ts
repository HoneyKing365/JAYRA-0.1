export class WellnessActivityClock {
  private activeMs = 0;

  constructor(private readonly tickMs = 30_000) {}

  tick(options: { enabled: boolean; intervalMinutes: number; activityAllowed: boolean }): boolean {
    if (!options.enabled || !options.activityAllowed) {
      this.activeMs = 0;
      return false;
    }
    this.activeMs += this.tickMs;
    if (this.activeMs < options.intervalMinutes * 60_000) return false;
    this.activeMs = 0;
    return true;
  }

  reset(): void {
    this.activeMs = 0;
  }
}
