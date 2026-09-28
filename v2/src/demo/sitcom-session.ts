/** Local spending budget, independent of simulation time and provider metadata.
 * A reported provider cap may shorten a session, never extend its deadline. */
export const SITCOM_DURATION = Object.freeze({ min: 10, max: 1800, default: 600 });
export class SitcomSessionBudget {
  readonly requestedSeconds: number;
  private providerSeconds: number | null = null;
  private allocatedAt: number | null = null;
  private readyAt: number | null = null;
  private lastHeartbeatAt: number;
  constructor(readonly startedAt: number, seconds: number) {
    if (!Number.isSafeInteger(seconds) || seconds < SITCOM_DURATION.min || seconds > SITCOM_DURATION.max)
      throw new Error("Choose a session from 10 seconds to 30 minutes");
    this.requestedSeconds = seconds; this.lastHeartbeatAt = startedAt;
  }
  get effectiveSeconds() { return Math.min(this.requestedSeconds, this.providerSeconds ?? Infinity); }
  get providerMaxSessionSeconds() { return this.providerSeconds; }
  allocated(now: number) { this.allocatedAt ??= now; }
  ready(now: number) { this.readyAt ??= now; }
  heartbeat(now: number) { this.lastHeartbeatAt = Math.max(this.lastHeartbeatAt, now); }
  reportProvider(seconds: number | null) {
    if (seconds === null) return;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid provider session limit");
    this.providerSeconds = Math.min(this.providerSeconds ?? Infinity, seconds);
  }
  get deadline() {
    return Math.min(
      this.startedAt + (this.requestedSeconds + 60) * 1000,
      this.readyAt === null ? Infinity : this.readyAt + this.effectiveSeconds * 1000,
      this.providerSeconds === null ? Infinity : (this.allocatedAt ?? this.startedAt) + this.providerSeconds * 1000,
    );
  }
  expiration(now: number): "duration" | "client_disconnected" | null {
    if (now >= this.deadline) return "duration";
    return now - this.lastHeartbeatAt >= 30_000 ? "client_disconnected" : null;
  }
}
