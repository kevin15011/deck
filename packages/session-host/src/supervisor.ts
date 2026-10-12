/**
 * Daemon-side supervised spawn (D-7): every child runs behind a child anchor (anchor.ts).
 * One containment implementation for all drivers; drivers never spawn directly.
 *
 * Signals are routed through the anchor's live IPC channel. A PID read from disk is never
 * signalled; the only direct kill is a last-resort group kill through the live anchor
 * ChildProcess handle after the anchor was lost.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { ANCHOR_NONCE_ENV, type AnchorSignal, type AnchorToDaemon, type DaemonToAnchor } from "./anchor";
import { systemClock, type Clock } from "./clock";
import { writeLease, removeLease, type Lease } from "./lease";
import { createNodeProbe, type ProcessProbe } from "./process-probe";

export type SupervisedExit = {
  /** True only for a clean code-0 exit whose output streams fully drained. */
  ok: boolean;
  code: number | null;
  signal: string | null;
  drained: boolean;
  error?: string;
  /** The anchor ended without reporting the child's exit (killed/crashed). */
  anchorLost: boolean;
};

export type SupervisedProcess = {
  readonly anchorPid: number;
  /** Resolves when the anchor has started the child. Rejects if it never did. */
  readonly ready: Promise<{ workerPid: number }>;
  readonly stdin: Writable;
  /** Consumers MUST attach data listeners synchronously after spawn. */
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** SIGINT to the CLI process only (never the group). Returns false when the anchor is unreachable. */
  interrupt(): boolean;
  /** Group TERM, then KILL after `graceMs`. */
  terminateGroup(graceMs?: number): Promise<void>;
  /** Settles after the terminal cleanup handshake and full output delivery. */
  readonly exited: Promise<SupervisedExit>;
};

export type SupervisorOptions = {
  /** Command prefix that starts the anchor, e.g. [deckBinary, "internal", "child-anchor"]. */
  anchorCommand: readonly string[];
  probe?: ProcessProbe;
  clock?: Clock;
  newNonce?: () => string;
};

export type SupervisedSpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  lease?: { file: string; taskId: string };
};

const GROUP_SETTLE_POLL_MS = 25;
const GROUP_SETTLE_MAX_MS = 1500;

export class Supervisor {
  private readonly live = new Set<SupervisedProcess>();
  private readonly probe: ProcessProbe;
  private readonly clock: Clock;

  constructor(private readonly options: SupervisorOptions) {
    if (options.anchorCommand.length === 0) throw new Error("anchorCommand must not be empty");
    this.probe = options.probe ?? createNodeProbe();
    this.clock = options.clock ?? systemClock;
  }

  /** Adapter for `DriverHostIo.spawn` (SupervisedSpawn in @deck/core). */
  asSupervisedSpawn() {
    return async (command: string, args: readonly string[], options?: SupervisedSpawnOptions): Promise<SupervisedProcess> => this.spawn(command, args, options);
  }

  spawn(command: string, args: readonly string[], options: SupervisedSpawnOptions = {}): SupervisedProcess {
    if (process.platform === "win32") throw new Error("Supervised spawn requires a POSIX platform");
    const nonce = (this.options.newNonce ?? randomUUID)();
    const [anchorBin, ...anchorArgs] = this.options.anchorCommand;
    const baseLease: Lease | undefined = options.lease && {
      v: 1, taskId: options.lease.taskId, nonce, state: "claiming",
      daemon: { pid: process.pid, identity: this.probe.identify(process.pid) }, createdAt: new Date(this.clock.now()).toISOString(),
    };
    // Commit the claim before the child can exist: a crash after this point is "unsettled", never "absent".
    if (baseLease && options.lease) writeLease(options.lease.file, baseLease);

    const child: ChildProcess = spawn(anchorBin!, [...anchorArgs, "--", command, ...args], {
      detached: true, shell: false, cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...(options.env ?? (process.env as Record<string, string>)), [ANCHOR_NONCE_ENV]: nonce },
    });
    child.stdin!.on("error", () => {});

    let resolveReady!: (v: { workerPid: number }) => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<{ workerPid: number }>((res, rej) => { resolveReady = res; rejectReady = rej; });
    ready.catch(() => {});
    let childExit: Extract<AnchorToDaemon, { type: "child_exit" }> | undefined;
    let terminalSeen = false;
    let spawnError: Error | undefined;

    const send = (message: DaemonToAnchor): boolean => {
      if (!child.connected) return false;
      try { return child.send(message, () => {}); } catch { return false; }
    };
    const signalAnchor = (target: "worker" | "group", signal: AnchorSignal) => send({ type: "signal", nonce, target, signal });
    const anchorAlive = () => child.exitCode === null && child.signalCode === null;

    child.on("message", (raw: unknown) => {
      const m = raw as Partial<AnchorToDaemon> | null;
      if (!m || m.nonce !== nonce) return;
      if (m.type === "anchor_ready") {
        resolveReady({ workerPid: m.workerPid! });
        if (baseLease && options.lease) {
          try {
            writeLease(options.lease.file, {
              ...baseLease, state: "live", anchor: this.probe.identify(m.anchorPid!), worker: this.probe.identify(m.workerPid!), group: m.anchorPid,
            });
          } catch { /* lease is best effort after claim; recovery treats a stale claim as unsettled */ }
        }
      } else if (m.type === "child_exit" && !terminalSeen) {
        terminalSeen = true;
        childExit = m as typeof childExit;
        // The daemon acknowledges terminal cleanup; the anchor then ends the group and exits.
        send({ type: "cleanup", nonce });
      }
    });

    const exited = new Promise<SupervisedExit>((resolve) => {
      child.once("error", (error) => { spawnError = error; });
      child.once("exit", () => {
        if (!terminalSeen && child.pid) {
          // Anchor vanished without reporting: the group may still hold the child. A process
          // group id cannot be recycled while the group has members, so this live-handle
          // group kill cannot hit an unrelated process.
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already empty */ }
        }
      });
      child.once("close", () => {
        rejectReady(new Error("Anchor ended before the child started"));
        const result: SupervisedExit = childExit
          ? {
              ok: childExit.code === 0 && !childExit.signal && childExit.drained, code: childExit.code, signal: childExit.signal,
              drained: childExit.drained, anchorLost: false, ...(childExit.error ? { error: childExit.error } : {}),
            }
          : {
              ok: false, code: null, signal: null, drained: false, anchorLost: true,
              error: spawnError ? `Unable to spawn anchor: ${spawnError.message}` : "Anchor ended before reporting the child's exit",
            };
        void this.settleGroup(child.pid, options.lease?.file).then(() => { this.live.delete(proc); resolve(result); });
      });
    });

    const proc: SupervisedProcess = {
      anchorPid: child.pid ?? -1,
      ready,
      stdin: child.stdin!,
      stdout: child.stdout!,
      stderr: child.stderr!,
      interrupt: () => signalAnchor("worker", "SIGINT"),
      exited,
      terminateGroup: async (graceMs = 2000) => {
        if (!anchorAlive()) return;
        let done = false;
        void exited.then(() => { done = true; });
        if (!signalAnchor("group", "SIGTERM") && child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
        await new Promise<void>((resolve) => {
          const timer = this.clock.setTimeout(resolve, graceMs);
          void exited.then(() => { this.clock.clearTimeout(timer); resolve(); });
        });
        if (done || !anchorAlive()) return;
        if (!signalAnchor("group", "SIGKILL") && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }
        await exited;
      },
    };
    this.live.add(proc);
    return proc;
  }

  /** After the anchor exited, wait (bounded) for the group to vanish, then release the lease. */
  private async settleGroup(pgid: number | undefined, leaseFile: string | undefined): Promise<void> {
    if (pgid) {
      const deadline = this.clock.now() + GROUP_SETTLE_MAX_MS;
      while (this.probe.groupPresence(pgid) === "alive" && this.clock.now() < deadline) {
        await new Promise<void>((resolve) => { this.clock.setTimeout(resolve, GROUP_SETTLE_POLL_MS); });
      }
      // Unsettled groups keep their lease so recovery refuses continuation (never guesses).
      if (this.probe.groupPresence(pgid) !== "absent") return;
    }
    if (leaseFile) { try { removeLease(leaseFile); } catch { /* best effort */ } }
  }

  /** Graceful daemon shutdown: end every live group. */
  async shutdown(graceMs = 2000): Promise<void> {
    await Promise.all([...this.live].map((p) => p.terminateGroup(graceMs).catch(() => {})));
  }
}
