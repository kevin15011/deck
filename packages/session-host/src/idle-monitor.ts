/** Idle shutdown policy (XR-3.1): no running work and no attached client for `idleMs`. */
import type { Clock, TimerHandle } from "./clock";

export const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 10_000;

export type IdleMonitorOptions = {
  clock: Clock;
  idleMs?: number;
  pollMs?: number;
  isBusy: () => boolean;
  clientCount: () => number;
  onIdle: () => void;
};

export class IdleMonitor {
  private timer: TimerHandle | undefined;
  private idleSince: number | undefined;
  private fired = false;

  constructor(private readonly options: IdleMonitorOptions) {}

  start(): void {
    this.stop();
    this.fired = false;
    this.idleSince = this.isIdle() ? this.options.clock.now() : undefined;
    this.schedule();
  }

  stop(): void {
    if (this.timer !== undefined) this.options.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private isIdle(): boolean { return !this.options.isBusy() && this.options.clientCount() === 0; }

  private schedule(): void {
    this.timer = this.options.clock.setTimeout(() => this.tick(), this.options.pollMs ?? Math.min(DEFAULT_POLL_MS, Math.max(50, Math.floor((this.options.idleMs ?? IDLE_SHUTDOWN_MS) / 3))));
  }

  private tick(): void {
    this.timer = undefined;
    const now = this.options.clock.now();
    if (!this.isIdle()) this.idleSince = undefined;
    else if (this.idleSince === undefined) this.idleSince = now;
    else if (now - this.idleSince >= (this.options.idleMs ?? IDLE_SHUTDOWN_MS) && !this.fired) {
      this.fired = true;
      this.options.onIdle();
      return; // one-shot: the daemon is stopping
    }
    this.schedule();
  }
}
