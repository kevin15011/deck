import type { DriverEvent, DriverHostIo, SupervisedChild, SupervisedChildExit } from "@deck/core/session/driver";

export class FakeChild implements SupervisedChild {
  writes: Record<string, unknown>[] = [];
  terminations = 0;
  ready = Promise.resolve({ workerPid: 42 });
  private resolveExit!: (exit: SupervisedChildExit) => void;
  exited = new Promise<SupervisedChildExit>((r) => { this.resolveExit = r; });
  private out: ((s: string) => void)[] = [];
  responder?: (m: Record<string, unknown>) => void;
  writeStdin(text: string) { const m = JSON.parse(text); this.writes.push(m); this.responder?.(m); }
  endStdin() { this.exit(); }
  onStdout(fn: (s: string) => void) { this.out.push(fn); }
  onStderr(_fn: (s: string) => void) {}
  interrupt() { return true; }
  async terminateGroup() { this.terminations++; this.exit(); }
  stdout(m: unknown) { for (const fn of this.out) fn(`${JSON.stringify(m)}\n`); }
  stdoutRaw(text: string) { for (const fn of this.out) fn(text); }
  exit() { this.resolveExit({ ok: true, code: 0, signal: null, drained: true, anchorLost: false }); }
}
export function harness(respond: (child: FakeChild, index: number, m: Record<string, unknown>) => void) {
  const events: DriverEvent[] = [], children: FakeChild[] = [], spawns: Array<{ command: string; args: readonly string[]; options?: { cwd?: string; env?: Record<string, string> } }> = [];
  const io: DriverHostIo = {
    async spawn(command, args, options) { const child = new FakeChild(); children.push(child); spawns.push({ command, args, options }); child.responder = (m) => respond(child, children.length, m); return child; },
    emit(e) { events.push(e); }, approval: async () => ({ decision: "deny" }), writePrivateFile: (name) => `/private/${name}`,
  };
  return { io, children, spawns, events };
}
