import type { DriverEvent, DriverHostIo, SupervisedChild, SupervisedChildExit } from "@deck/core/session/driver";

/** Scriptable stand-in for a child running behind the host's anchor. */
export class FakeChild implements SupervisedChild {
  stdin: string[] = [];
  stdinEnded = false;
  interrupts = 0;
  interruptDelivered = true;
  terminations: Array<number | undefined> = [];
  private out: Array<(c: string) => void> = [];
  private err: Array<(c: string) => void> = [];
  private finish!: (e: SupervisedChildExit) => void;
  readonly ready = Promise.resolve({ workerPid: 4242 });
  readonly exited = new Promise<SupervisedChildExit>((resolve) => { this.finish = resolve; });
  /** When true, `terminateGroup` ends the child like a TERM would. */
  endOnTerminate = true;

  writeStdin(text: string): void { this.stdin.push(text); }
  endStdin(): void { this.stdinEnded = true; }
  onStdout(l: (c: string) => void): void { this.out.push(l); }
  onStderr(l: (c: string) => void): void { this.err.push(l); }
  interrupt(): boolean { this.interrupts++; return this.interruptDelivered; }
  async terminateGroup(graceMs?: number): Promise<void> {
    this.terminations.push(graceMs);
    if (this.endOnTerminate) this.exit({ ok: false, code: null, signal: "SIGTERM", drained: true, anchorLost: false });
    await this.exited;
  }

  stdout(text: string): void { for (const l of this.out) l(text); }
  stderr(text: string): void { for (const l of this.err) l(text); }
  lines(lines: readonly string[]): void { this.stdout(`${lines.join("\n")}\n`); }
  exit(partial: Partial<SupervisedChildExit> = {}): void {
    this.finish({ ok: true, code: 0, signal: null, drained: true, anchorLost: false, ...partial });
  }
}

export type Harness = {
  io: DriverHostIo;
  events: DriverEvent[];
  files: Map<string, string>;
  spawns: Array<{ command: string; args: readonly string[]; options?: { cwd?: string; env?: Record<string, string> } }>;
  children: FakeChild[];
  /** Resolves with the n-th (1-based) spawned child once it exists. */
  nextChild(n?: number): Promise<FakeChild>;
};

export function harness(): Harness {
  const events: DriverEvent[] = [];
  const files = new Map<string, string>();
  const spawns: Harness["spawns"] = [];
  const children: FakeChild[] = [];
  const waiters: Array<{ n: number; resolve: (c: FakeChild) => void }> = [];
  const io: DriverHostIo = {
    spawn: async (command, args, options) => {
      const child = new FakeChild();
      spawns.push({ command, args, options });
      children.push(child);
      for (const w of waiters.filter((x) => x.n === children.length)) w.resolve(child);
      return child;
    },
    emit: (e) => { events.push(e); },
    approval: async () => ({ decision: "deny" }),
    writePrivateFile: (name, content) => { files.set(name, content); return `/state/task/${name}`; },
  };
  return {
    io, events, files, spawns, children,
    nextChild: (n = 1) => children[n - 1] ? Promise.resolve(children[n - 1]!) : new Promise((resolve) => waiters.push({ n, resolve })),
  };
}

/** Manual timers: `advance` fires due callbacks. */
export class FakeTimers {
  private now = 0;
  private id = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): number => { const id = this.id++; this.timers.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = (id: unknown): void => { this.timers.delete(id as number); };
  get pending(): number { return this.timers.size; }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.timers]) if (t.at <= this.now) { this.timers.delete(id); t.fn(); }
  }
}
