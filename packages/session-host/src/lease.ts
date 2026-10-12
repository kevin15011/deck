/**
 * Persisted execution lease (design 6.1): the facts recovery needs to prove that a previous
 * daemon's child group is settled. Written BEFORE spawn (claiming) and completed once the
 * anchor reports ready. Recovery only ever reads these to PROBE, never to signal.
 */
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { ensurePrivateDir, writePrivateFile } from "./paths";
import type { ProcessIdentity } from "./process-probe";

export const LEASE_VERSION = 1 as const;
export type Lease = {
  v: 1; taskId: string; nonce: string; state: "claiming" | "live";
  daemon: { pid: number; identity?: ProcessIdentity };
  anchor?: ProcessIdentity; worker?: ProcessIdentity; group?: number; createdAt: string;
};

export class LeaseInvalidError extends Error {
  constructor(message: string, readonly file: string) { super(message); this.name = "LeaseInvalidError"; }
}

const isIdentity = (v: unknown): v is ProcessIdentity => {
  const i = v as ProcessIdentity | undefined;
  return !!i && Number.isSafeInteger(i.pid) && i.pid > 0 && typeof i.boot === "string" && /^[a-f0-9-]{36}$/.test(i.boot)
    && (i.platform === "darwin" || (i.platform === "linux" && typeof i.starttime === "string" && /^\d+$/.test(i.starttime)));
};

export function writeLease(file: string, lease: Lease): void {
  mkdirSync(dirname(dirname(file)), { recursive: true, mode: 0o700 });
  ensurePrivateDir(dirname(file));
  writePrivateFile(file, JSON.stringify(lease));
}

export function removeLease(file: string): void {
  try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Returns undefined when there is no lease; throws LeaseInvalidError for anything unsafe or malformed. */
export function readLease(file: string): Lease | undefined {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw new LeaseInvalidError(`Cannot open lease (${code})`, file);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
      throw new LeaseInvalidError("Lease file is not a private regular file", file);
    }
    let raw: Partial<Lease>;
    try { raw = JSON.parse(readFileSync(fd, "utf8")) as Partial<Lease>; } catch { throw new LeaseInvalidError("Lease is not valid JSON", file); }
    if (raw.v !== LEASE_VERSION || typeof raw.taskId !== "string" || typeof raw.nonce !== "string" || (raw.state !== "claiming" && raw.state !== "live")
      || !raw.daemon || !Number.isSafeInteger(raw.daemon.pid) || typeof raw.createdAt !== "string") throw new LeaseInvalidError("Lease has an unexpected shape", file);
    if (raw.anchor !== undefined && !isIdentity(raw.anchor)) throw new LeaseInvalidError("Lease anchor identity invalid", file);
    if (raw.worker !== undefined && !isIdentity(raw.worker)) throw new LeaseInvalidError("Lease worker identity invalid", file);
    if (raw.group !== undefined && !Number.isSafeInteger(raw.group)) throw new LeaseInvalidError("Lease group invalid", file);
    return raw as Lease;
  } finally { closeSync(fd); }
}
