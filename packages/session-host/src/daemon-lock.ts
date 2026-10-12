/**
 * Single-instance daemon lock and discovery file (XR-3.1, design 6.3).
 *
 * `daemon.lock` holds {pid, nonce, startedAt}; liveness uses signal-0 probes plus a socket
 * ping carrying the nonce, so a recycled PID alone never keeps a dead daemon "alive".
 * Stale reclaim is serialised through a gate directory (same fail-closed idea as the config lock).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { Clock } from "./clock";
import { ensurePrivateDir, writePrivateFile, type StatePaths } from "./paths";
import type { Presence } from "./process-probe";

export const STARTUP_GRACE_MS = 10_000;
const GATE_STALE_MS = 10_000;
const GATE_RETRY_MS = 10;
const GATE_ATTEMPTS = 100;

export type LockHolder = { v: 1; pid: number; nonce: string; startedAt: number };
export type LockDeps = {
  clock: Clock;
  /** `kill(pid, 0)` classification. */
  presence: (pid: number) => Presence;
  /** True when the holder's daemon answers on its socket with the holder's nonce. */
  ping: (holder: LockHolder) => Promise<boolean>;
};
export type AcquireOptions = LockDeps & { pid?: number; nonce?: string };
export type AcquireResult =
  | { ok: true; nonce: string; release(): void }
  | { ok: false; reason: "already-running"; holder?: LockHolder }
  | { ok: false; reason: "contended" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readHolder(file: string): LockHolder | undefined | "absent" {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    return undefined;
  }
  try {
    const v = JSON.parse(text) as Partial<LockHolder>;
    if (v.v === 1 && Number.isSafeInteger(v.pid) && typeof v.nonce === "string" && typeof v.startedAt === "number") return v as LockHolder;
  } catch { /* corrupt */ }
  return undefined;
}

/** Current lock holder, if any (exported for restart coordination). */
export function readLockHolder(paths: StatePaths): LockHolder | undefined {
  const h = readHolder(paths.lockFile);
  return h === "absent" ? undefined : h;
}

function tryCreate(file: string, holder: LockHolder): boolean {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, JSON.stringify(holder), { mode: 0o600, flag: "wx" });
  try { linkSync(temp, file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally { try { unlinkSync(temp); } catch { /* best effort */ } }
}

async function holderIsLive(holder: LockHolder, deps: LockDeps): Promise<boolean> {
  if (deps.presence(holder.pid) === "absent") return false;
  if (await deps.ping(holder)) return true;
  return deps.clock.now() - holder.startedAt < STARTUP_GRACE_MS; // still starting up
}

export async function acquireDaemonLock(paths: StatePaths, options: AcquireOptions): Promise<AcquireResult> {
  ensurePrivateDir(paths.daemonDir);
  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? randomUUID();
  const mine: LockHolder = { v: 1, pid, nonce, startedAt: options.clock.now() };
  const gate = `${paths.lockFile}.gate`;

  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    if (tryCreate(paths.lockFile, mine)) {
      return {
        ok: true, nonce,
        release() { const h = readHolder(paths.lockFile); if (h && h !== "absent" && h.nonce === nonce) { try { unlinkSync(paths.lockFile); } catch { /* gone */ } } },
      };
    }
    const holder = readHolder(paths.lockFile);
    if (holder === "absent") continue; // vanished between link and read: retry
    if (holder && (await holderIsLive(holder, options))) return { ok: false, reason: "already-running", holder };

    // Stale (or unreadable). Reclaim under the gate so two reclaimers cannot both unlink a fresh lock.
    try { mkdirSync(gate, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(gate).mtimeMs > GATE_STALE_MS) rmdirSync(gate); } catch { /* raced */ }
      await sleep(GATE_RETRY_MS);
      continue;
    }
    try {
      const again = readHolder(paths.lockFile);
      const unchanged = again === "absent" || (again === undefined && holder === undefined) || (again && holder && again.nonce === holder.nonce);
      if (unchanged && again !== "absent") { try { unlinkSync(paths.lockFile); } catch { /* raced */ } }
    } finally { try { rmdirSync(gate); } catch { /* already removed */ } }
  }
  return { ok: false, reason: "contended" };
}

// ---- daemon.json ------------------------------------------------------------------------

export type DaemonInfo = { v: 1; pid: number; nonce: string; version: string; socketPath: string; startedAt: string };

export function writeDaemonInfo(paths: StatePaths, info: DaemonInfo): void {
  ensurePrivateDir(paths.daemonDir);
  writePrivateFile(paths.daemonInfoFile, JSON.stringify(info));
}

export function readDaemonInfo(paths: StatePaths): DaemonInfo | undefined {
  try {
    const v = JSON.parse(readFileSync(paths.daemonInfoFile, "utf8")) as Partial<DaemonInfo>;
    if (v.v === 1 && Number.isSafeInteger(v.pid) && typeof v.nonce === "string" && typeof v.version === "string" && typeof v.socketPath === "string") return v as DaemonInfo;
  } catch { /* absent or corrupt */ }
  return undefined;
}

/** Remove daemon.json only when it still describes the calling daemon. */
export function removeDaemonInfo(paths: StatePaths, nonce: string): void {
  if (readDaemonInfo(paths)?.nonce !== nonce) return;
  try { unlinkSync(paths.daemonInfoFile); } catch { /* gone */ }
}
