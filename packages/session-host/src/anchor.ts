/**
 * Child anchor (XR-3.6, D-14, design 6.1): `deck internal child-anchor -- <command> [args...]`.
 *
 * The daemon spawns this process `detached` (it becomes a process-group leader) with an IPC
 * channel. The anchor runs the native CLI inside its own group and:
 *  - kills the whole group (SIGKILL) when IPC disconnects (daemon died) or never existed;
 *  - reports the child's exit only after its stdout/stderr reached EOF (or a 1 s drain
 *    timeout, reported as `drained: false`: failure, never partial success);
 *  - never exits on its own after the child ends: it waits for the daemon's `cleanup`
 *    acknowledgement, which closes the PID-reuse window.
 *
 * Signalling is done here through live handles only: the daemon never signals a PID.
 */
import { spawn, type ChildProcess } from "node:child_process";

export const ANCHOR_NONCE_ENV = "DECK_ANCHOR_NONCE";
export const ANCHOR_DRAIN_MS = 1000;

export type AnchorSignal = "SIGINT" | "SIGTERM" | "SIGKILL";
export type AnchorToDaemon =
  | { type: "anchor_ready"; nonce: string; anchorPid: number; workerPid: number }
  | { type: "child_exit"; nonce: string; code: number | null; signal: string | null; drained: boolean; error?: string };
export type DaemonToAnchor =
  | { type: "signal"; nonce: string; target: "worker" | "group"; signal: AnchorSignal }
  | { type: "cleanup"; nonce: string };

const SIGNALS: readonly string[] = ["SIGINT", "SIGTERM", "SIGKILL"];

/** Parse `child-anchor` argv (optionally preceded by `--`) into the command to run. */
export function parseAnchorArgv(argv: readonly string[]): { command: string; args: string[] } | undefined {
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...args] = rest;
  return command ? { command, args } : undefined;
}

/** Runs forever: the process ends through group cleanup, never by returning. */
export function runChildAnchor(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<never> {
  const nonce = env[ANCHOR_NONCE_ENV] ?? "";
  const target = parseAnchorArgv(argv);
  let worker: ChildProcess | undefined;
  let terminal = false;

  const endGroup = (): void => {
    try { process.kill(-process.pid, "SIGKILL"); } catch {
      // Not a group leader (misuse): fall back to the one live child we own.
      try { worker?.kill("SIGKILL"); } catch { /* already gone */ }
      process.exit(1);
    }
  };

  setInterval(() => {}, 1000); // stay alive until cleanup
  // Group TERM/INT reach the worker; the anchor itself must outlive them until terminal cleanup.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGPIPE"] as const) process.on(sig, () => {});
  process.on("disconnect", endGroup);
  if (!process.connected || !process.send || !target || !nonce) {
    endGroup();
    return new Promise<never>(() => {});
  }

  const send = (message: AnchorToDaemon): void => {
    if (!process.connected) return endGroup();
    process.send!(message, () => {});
  };

  process.on("message", (raw: unknown) => {
    const message = raw as Partial<DaemonToAnchor> | null;
    if (!message || message.nonce !== nonce) return;
    if (message.type === "cleanup") { if (terminal) endGroup(); return; }
    if (message.type !== "signal" || !SIGNALS.includes(message.signal as string)) return;
    if (message.target === "group") {
      try { process.kill(-process.pid, message.signal as AnchorSignal); } catch { /* group already gone */ }
    } else if (message.target === "worker" && !terminal && worker && worker.exitCode === null && worker.signalCode === null) {
      try { worker.kill(message.signal as AnchorSignal); } catch { /* exited concurrently */ }
    }
  });

  const finish = (code: number | null, signal: string | null, drained: boolean, error?: string): void => {
    if (terminal) return;
    terminal = true;
    const flush = () => process.stdout.write("", () => process.stderr.write("", () => send({ type: "child_exit", nonce, code, signal, drained, ...(error ? { error } : {}) })));
    flush();
    // Deliberately no exit here: the daemon's `cleanup` (or its death) ends the group.
  };

  try {
    const childEnv = { ...env };
    delete childEnv[ANCHOR_NONCE_ENV];
    worker = spawn(target.command, target.args, { detached: false, shell: false, stdio: ["pipe", "pipe", "pipe"], env: childEnv });
    const w = worker;
    let exited: { code: number | null; signal: string | null } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = { out: false, err: false };
    const settle = () => {
      if (!exited || !(ended.out && ended.err)) return;
      if (timer) clearTimeout(timer);
      finish(exited.code, exited.signal, true);
    };
    for (const [stream, key, sink] of [[w.stdout!, "out", process.stdout], [w.stderr!, "err", process.stderr]] as const) {
      stream.pipe(sink, { end: false });
      const done = () => { ended[key] = true; settle(); };
      stream.once("end", done);
      stream.once("error", done);
      stream.once("close", done);
    }
    w.stdin!.on("error", () => {});
    process.stdin.on("error", () => {});
    process.stdin.pipe(w.stdin!);
    w.once("exit", (code, signal) => {
      exited = { code, signal };
      // Exit is not EOF: descendants can still own the pipes. Never promote partial output to success.
      timer = setTimeout(() => finish(code ?? 1, signal, false, "Child output streams did not reach EOF before the drain timeout"), ANCHOR_DRAIN_MS);
      settle();
    });
    w.once("error", () => finish(1, null, false, "Unable to spawn child executable"));
    if (w.pid) send({ type: "anchor_ready", nonce, anchorPid: process.pid, workerPid: w.pid });
  } catch {
    finish(1, null, false, "Unable to spawn child executable");
  }
  return new Promise<never>(() => {});
}
