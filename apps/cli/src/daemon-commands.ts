/** Public lifecycle commands. `daemon.restart` is the backwards-compatible graceful stop handshake. */
import { existsSync, lstatSync } from "node:fs";
import {
  assertPrivateFile, ControlClient, createNodeProbe, readDaemonInfo, readLockHolder,
  resolveStatePaths, spawnDetachedDaemon, type DaemonInfo, type LockHolder, type StatePaths,
} from "@deck/session-host";
import type { Presence } from "@deck/session-host";
import type { DaemonSubcommand } from "./cli-args";
import { deckInternalCommand } from "./runner-adapters";
import { getBuildInfo } from "./runtime/build-info";

type Client = Pick<ControlClient, "request" | "close">;
type Identity = { pid: number; nonce: string; version: string };
type Observation = { client: Client; identity: Identity } | { client?: undefined; holder?: LockHolder };
export type DaemonCommandDeps = {
  paths: StatePaths;
  version: string;
  spawnDaemon: () => number | undefined;
  write: (text: string) => void;
  writeErr: (text: string) => void;
  connect?: (socketPath: string) => Promise<Client>;
  presence?: (pid: number) => Presence;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

class LifecycleError extends Error {
  constructor(readonly code: string, message: string, readonly running?: boolean) { super(message); }
}

/** No directory creation, signaling, lock removal or version-skew auto-restart occurs here. */
export async function runDaemonCommand(deps: DaemonCommandDeps, sub: DaemonSubcommand): Promise<number> {
  const { paths } = deps;
  const presence = deps.presence ?? createNodeProbe().presence;
  const connect = deps.connect ?? ((path) => ControlClient.connect(path, { timeoutMs: 500 }));
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? 15_000, pollMs = deps.pollMs ?? 50;
  const report = (data: Record<string, unknown>) => {
    const result = { action: sub.action, ...data };
    if (sub.json) deps.write(`${JSON.stringify(result)}\n`);
    else if (data.outcome === "error") deps.writeErr(`Deck daemon ${sub.action} failed: ${data.message} (${data.code})\n`);
    else {
      const d = data.daemon as Record<string, unknown> | undefined;
      deps.write(`Deck daemon: ${String(data.outcome)}${d ? ` (pid ${d.pid}, v${d.version})` : ""}\n`);
      if (d && sub.action === "status") deps.write(`state: ${paths.root}\nrunning work: ${d.runningWork ? "yes" : "no"}; pending approvals: ${d.pendingApprovals ?? 0}; clients: ${d.clients ?? 0}\n`);
    }
  };
  const privateDirectory = (dir: string) => {
    if (!existsSync(dir)) return;
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== (process.getuid?.() ?? 0) || (stat.mode & 0o077) !== 0) throw new LifecycleError("unsafe-state", `Daemon directory must be private and owned by this user: ${dir}`);
  };
  const records = (): { holder?: LockHolder; info?: DaemonInfo } => {
    privateDirectory(paths.daemonDir);
    if (paths.socket.dir !== paths.daemonDir) privateDirectory(paths.socket.dir);
    for (const file of [paths.lockFile, paths.daemonInfoFile]) if (existsSync(file)) assertPrivateFile(file);
    const holder = readLockHolder(paths), info = readDaemonInfo(paths);
    if ((existsSync(paths.lockFile) && !holder) || (existsSync(paths.daemonInfoFile) && !info)) throw new LifecycleError("invalid-state", "Daemon discovery or lock file is invalid; refusing to infer process ownership");
    return { holder, info };
  };
  const observe = async (): Promise<Observation> => {
    records(); // Validate ownership before connecting or reading identities.
    let client: Client | undefined;
    try {
      client = await connect(paths.socket.path);
      const hello = await client.request({ t: "hello", clientVersion: deps.version }, 500);
      const { holder, info } = records();
      if (hello.t !== "hello" || !holder || !info || holder.pid !== hello.pid || holder.nonce !== hello.nonce || info.pid !== hello.pid || info.nonce !== hello.nonce || info.socketPath !== paths.socket.path) throw new LifecycleError("identity-mismatch", "Socket identity does not match the owned daemon lock and discovery file");
      return { client, identity: { pid: hello.pid, nonce: hello.nonce, version: hello.daemonVersion } };
    } catch (error) {
      client?.close();
      if (error instanceof LifecycleError) throw error;
      const { holder, info } = records();
      if ((holder && presence(holder.pid) !== "absent") || (info && presence(info.pid) !== "absent")) throw new LifecycleError("daemon-unreachable", "A live or unverified owner holds daemon state, but the daemon is unreachable");
      return { holder };
    }
  };
  const start = async (): Promise<Identity> => {
    const spawnedPid = deps.spawnDaemon();
    if (!Number.isSafeInteger(spawnedPid) || spawnedPid! <= 0) throw new LifecycleError("spawn-failed", "Unable to launch the invoking Deck executable");
    const deadline = now() + timeoutMs;
    for (;;) {
      try {
        const next = await observe();
        if (next.client) {
          next.client.close();
          if (next.identity.pid !== spawnedPid) throw new LifecycleError("start-contended", "Another process started the daemon; the invoking Deck executable was not selected", true);
          return next.identity;
        }
      }
      catch (error) { if (!(error instanceof LifecycleError) || error.code !== "daemon-unreachable") throw error; }
      if (now() >= deadline) throw new LifecycleError("start-timeout", `Daemon did not become ready within ${timeoutMs} ms`);
      await sleep(pollMs);
    }
  };
  try {
    const current = await observe();
    if (!current.client) {
      if (sub.action === "status" || sub.action === "stop") { report({ outcome: "not-running", running: false }); return 0; }
      report({ outcome: "started", running: true, daemon: await start(), statePath: paths.root }); return 0;
    }
    const previous = current.identity;
    try {
      if (sub.action === "status") {
        const status = await current.client.request({ t: "daemon.status" }, 1000);
        if (status.t !== "daemon.status") throw new LifecycleError("unexpected-reply", "Daemon did not return status", true);
        report({ outcome: "running", running: true, daemon: status.status, statePath: paths.root }); return 0;
      }
      if (sub.action === "start") { report({ outcome: "already-running", running: true, daemon: previous, statePath: paths.root }); return 0; }
      const accepted = await current.client.request({ t: "daemon.restart" }, 1000);
      if (accepted.t !== "daemon.restart") throw new LifecycleError("unexpected-reply", "Daemon did not acknowledge graceful shutdown", true);
      if (!accepted.outcome.ok) throw new LifecycleError(accepted.outcome.code, accepted.outcome.message ?? "Daemon refused shutdown", true);
    } finally { current.client.close(); }

    // A disconnected socket alone does not prove shutdown: wait for cleanup and PID absence.
    const deadline = now() + timeoutMs;
    for (;;) {
      const { holder, info } = records();
      if ((holder && holder.nonce !== previous.nonce) || (info && info.nonce !== previous.nonce)) throw new LifecycleError("identity-changed", "Another daemon took ownership during shutdown; refusing to replace it");
      if (!holder && !info && !existsSync(paths.socket.path) && presence(previous.pid) === "absent") break;
      if (now() >= deadline) throw new LifecycleError("stop-timeout", `Daemon shutdown could not be confirmed within ${timeoutMs} ms`);
      await sleep(pollMs);
    }
    if (sub.action === "stop") { report({ outcome: "stopped", running: false, previous }); return 0; }
    const next = await start();
    if (next.nonce === previous.nonce) throw new LifecycleError("identity-unchanged", "Restart did not establish a new daemon identity", true);
    report({ outcome: "restarted", running: true, daemon: next, previous, statePath: paths.root }); return 0;
  } catch (error) {
    const e = error instanceof LifecycleError ? error : new LifecycleError("lifecycle-failed", (error as Error).message);
    report({ outcome: "error", code: e.code, message: e.message, ...(e.running === undefined ? {} : { running: e.running }) }); return 1;
  }
}

export async function runDaemonCli(sub: DaemonSubcommand): Promise<number> {
  return runDaemonCommand({
    paths: resolveStatePaths(), version: getBuildInfo().version,
    spawnDaemon: () => spawnDetachedDaemon(deckInternalCommand("session-daemon")),
    write: (text) => { process.stdout.write(text); }, writeErr: (text) => { process.stderr.write(text); },
  }, sub);
}
