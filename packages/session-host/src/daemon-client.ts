import { validBuildIdentity, type BuildIdentity } from "@deck/core";
import { decideDaemonAction } from "./daemon-build-policy";
/** Client-side daemon discovery: ping, auto-start with a readiness budget, version-skew restart (design 6.3). */
import { spawn } from "node:child_process";
import { ControlClient } from "./control-client";
import { readLockHolder } from "./daemon-lock";
import type { StatePaths } from "./paths";
import { createNodeProbe } from "./process-probe";

export const DAEMON_READY_TIMEOUT_MS = 5000;

export class DaemonStartTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The Deck session daemon did not become ready within ${timeoutMs} ms`);
    this.name = "DaemonStartTimeoutError";
  }
}

export type DaemonIdentity = { pid: number; nonce: string; daemonVersion: string; protocol?: number; build?: BuildIdentity };

/** Identity of the daemon answering on `socketPath`, or undefined when nothing (or no daemon) answers. */
export async function pingDaemon(socketPath: string, options: { timeoutMs?: number } = {}): Promise<DaemonIdentity | undefined> {
  const timeoutMs = options.timeoutMs ?? 1000;
  let client: ControlClient | undefined;
  try {
    client = await ControlClient.connect(socketPath, { timeoutMs });
    const hello = await Promise.race([
      client.request({ t: "hello", clientVersion: "ping" }, timeoutMs),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
    ]);
    return hello.t === "hello" ? { pid: hello.pid, nonce: hello.nonce, daemonVersion: hello.daemonVersion, protocol: hello.protocol, ...(validBuildIdentity(hello.build) ? {build:hello.build} : {}) } : undefined;
  } catch { return undefined; } finally { client?.close(); }
}

/** Numeric dotted-version comparison; prerelease/build suffixes and non-semver strings compare as equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export type EnsureDaemonOptions = {
  paths: StatePaths;
  clientVersion: string;
  clientBuild?: BuildIdentity;
  clientIsInstalledTarget?: boolean;
  /** Start `deck internal session-daemon` detached (see spawnDetachedDaemon). */
  spawnDaemon: () => void;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export type EnsureDaemonResult = {
  socketPath: string;
  daemon: { pid: number; nonce: string; version: string };
  started: boolean;
  restarted: boolean;
  skew?: "daemon-update-pending" | "daemon-other-build" | "daemon-incompatible" | "daemon-incompatible-busy";
  versionSkew?: "daemon-older-busy";
};

export async function ensureDaemon(options: EnsureDaemonOptions): Promise<EnsureDaemonResult> {
  const socketPath = options.paths.socket.path;
  const timeoutMs = options.timeoutMs ?? DAEMON_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 50;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const probe = createNodeProbe();
  const result = (d: DaemonIdentity, extra: Partial<EnsureDaemonResult> = {}): EnsureDaemonResult => ({
    socketPath, daemon: { pid: d.pid, nonce: d.nonce, version: d.daemonVersion }, started: false, restarted: false, ...extra,
  });

  const waitReady = async (): Promise<DaemonIdentity> => {
    const deadline = now() + timeoutMs;
    for (;;) {
      const found = await pingDaemon(socketPath, { timeoutMs: 500 });
      if (found) {
        if (options.clientBuild && found.protocol !== 1) throw new Error("daemon-incompatible: the daemon protocol is not supported by this client");
        return found;
      }
      if (now() >= deadline) throw new DaemonStartTimeoutError(timeoutMs);
      await sleep(pollMs);
    }
  };

  const existing = await pingDaemon(socketPath, { timeoutMs: 1000 });
  let restarted = false;
  if (existing) {
    let busy = true;
    let statusClient: ControlClient | undefined;
    try {
      statusClient = await ControlClient.connect(socketPath, {timeoutMs:1000});
      const reply = await statusClient.request({t:'daemon.status'},1000);
      if (reply.t === 'daemon.status') {
        const status = reply.status as {runningWork?: boolean; activeSessions?: boolean; pendingApprovals?: number; pendingQuestions?: number};
        busy = status.runningWork !== false || status.activeSessions === true || (status.pendingApprovals ?? 0) > 0 || (status.pendingQuestions ?? 0) > 0;
      }
    } catch { /* Unknown busy state cannot authorize replacement. */ } finally {statusClient?.close();}
    const action = options.clientBuild ? decideDaemonAction(options.clientBuild,{protocol:existing.protocol ?? 1,build:existing.build,version:existing.daemonVersion,busy},options.clientIsInstalledTarget === true)
      : compareVersions(options.clientVersion, existing.daemonVersion) <= 0 ? 'use' : 'restart';
    if (action === 'daemon-incompatible' || action === 'daemon-incompatible-busy') throw new Error(`${action}: restart the daemon when idle using the installed Deck command`);
    if (action !== 'restart') return result(existing, action === 'use' ? {} : {skew:action});
    // A newer client asks an OLDER daemon to restart, but never while it has running work.
    let outcome: { ok: boolean } = { ok: false };
    let client: ControlClient | undefined;
    try {
      client = await ControlClient.connect(socketPath, { timeoutMs: 1000 });
      const reply = await client.request({ t: "daemon.restart", ...(options.clientBuild ? {requester:options.clientBuild} : {}) }, 5000);
      if (reply.t === "daemon.restart") outcome = reply.outcome;
    } catch { /* treat as not restartable */ } finally { client?.close(); }
    if (!outcome.ok) return result(existing, { versionSkew: "daemon-older-busy", skew:"daemon-update-pending" });
    const deadline = now() + timeoutMs;
    for (;;) {
      const holder = readLockHolder(options.paths);
      const gone = !(await pingDaemon(socketPath, { timeoutMs: 300 })) && (!holder || probe.presence(holder.pid) === "absent");
      if (gone) break;
      if (now() >= deadline) throw new DaemonStartTimeoutError(timeoutMs);
      await sleep(pollMs);
    }
    restarted = true;
  }

  options.spawnDaemon();
  const ready = await waitReady();
  return result(ready, { started: true, restarted });
}

/** Detached, stdio-less daemon launch: it outlives the client and logs to <state>/logs. */
export function spawnDetachedDaemon(command: readonly string[], env: Record<string, string | undefined> = process.env): number | undefined {
  const [bin, ...args] = command;
  if (!bin) throw new Error("daemon command must not be empty");
  const child = spawn(bin, args, { detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv });
  child.on("error", () => {});
  child.unref();
  return child.pid;
}
