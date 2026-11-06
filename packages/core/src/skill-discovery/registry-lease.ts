import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

export interface RegistryLease { held(): boolean; release(): void }
export type RegistryLeaseResult = { ok: true; lease: RegistryLease } | { ok: false; reason: "busy" | "lock_root_unsafe" | "lock_unavailable" | "lock_unsupported"; path: string; code?: string };
export interface RegistryLeaseDeps { lockRoot?: string; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; lstat?: typeof fs.lstat }
interface Connection { exec(sql: string): unknown; close(...args: any[]): unknown; readonly inTransaction?: boolean; readonly isTransaction?: boolean }

/** Never open or close this inode outside SQLite: POSIX may release all process locks. */
export async function acquireRegistryLease(root: string, deps: RegistryLeaseDeps = {}): Promise<RegistryLeaseResult> {
  const lockRoot = path.resolve(deps.lockRoot ?? path.join(homedir(), ".local/state/deck-locks/registry-v1"));
  const file = path.join(lockRoot, `${createHash("sha256").update(root).digest("hex")}.sqlite`);
  const failure = (reason: "busy" | "lock_root_unsafe" | "lock_unavailable" | "lock_unsupported", code?: string): RegistryLeaseResult => ({ ok: false, reason, path: file, code });
  let db: Connection | undefined;
  const close = () => { if (db) { const connection = db; db = undefined; connection.close(); } };
  try {
    // Check every component before creating the next one. Sticky directories are
    // safe only when the child itself is owned by a trusted user (checked next).
    const lstat = deps.lstat ?? fs.lstat;
    const trusted = (stat: import("node:fs").Stats) => {
      const uid = process.getuid?.();
      return stat.isDirectory() && !stat.isSymbolicLink()
        && (uid === undefined || stat.uid === uid || stat.uid === 0)
        && ((stat.mode & 0o022) === 0 || (stat.mode & 0o1000) !== 0);
    };
    const validateParents = async (create: boolean) => {
      let current = path.parse(lockRoot).root;
      if (!trusted(await lstat(current))) return false;
      for (const part of lockRoot.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        let stat: import("node:fs").Stats;
        try { stat = await lstat(current) as import("node:fs").Stats; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (!create) return true;
          try { await fs.mkdir(current, { mode: 0o700 }); }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
          stat = await lstat(current) as import("node:fs").Stats;
        }
        if (!trusted(stat)) return false;
      }
      return true;
    };
    if (!await validateParents(false) || !await validateParents(true)) return failure("lock_root_unsafe");
    const dir = await lstat(lockRoot);
    if (!await validateParents(false) || !dir.isDirectory() || (process.getuid && dir.uid !== process.getuid()) || (dir.mode & 0o077) !== 0 || await fs.realpath(lockRoot) !== lockRoot) return failure("lock_root_unsafe");
    const statFile = async () => { try { return await fs.lstat(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; } };
    const safe = (s: import("node:fs").Stats) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && (!process.getuid || s.uid === process.getuid()) && (s.mode & 0o077) === 0;
    const before = await statFile();
    if (before && !safe(before)) return failure("lock_root_unsafe");
    try {
      if (process.versions.bun) {
        const { Database } = await import("bun:sqlite");
        db = new Database(file, { create: true, readwrite: true });
      } else {
        const { DatabaseSync } = await import("node:sqlite");
        db = new DatabaseSync(file);
      }
    } catch (error) { return failure("lock_unsupported", (error as NodeJS.ErrnoException).code); }
    if (!before) await fs.chmod(file, 0o600);
    const after = await statFile();
    if (!after || !safe(after) || (before && (before.dev !== after.dev || before.ino !== after.ino))) { close(); return failure("lock_root_unsafe"); }
    db.exec("PRAGMA busy_timeout=0");
    const now = deps.now ?? Date.now;
    const end = now() + (deps.waitMs ?? 1000);
    for (;;) {
      try { db.exec("BEGIN EXCLUSIVE"); break; }
      catch (error) {
        const e = error as { errno?: number; errcode?: number; code?: string };
        if (((e.errno ?? e.errcode ?? 0) & 255) !== 5) { close(); return failure("lock_unavailable", e.code); }
        if (now() >= end) { close(); return failure("busy"); }
        await (deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(deps.pollMs ?? 25);
      }
    }
    const connection = db;
    let active = true;
    return { ok: true, lease: {
      held: () => active && Boolean(connection.inTransaction ?? connection.isTransaction),
      release: () => {
        if (!active) return;
        active = false;
        let error: unknown;
        try { if (connection.inTransaction ?? connection.isTransaction) connection.exec("ROLLBACK"); } catch (e) { error = e; }
        try { connection.close(); } catch (e) { error ??= e; }
        if (error) throw error;
      },
    } };
  } catch (error) {
    try { close(); } catch { /* preserve acquisition failure */ }
    return failure("lock_unavailable", (error as NodeJS.ErrnoException).code);
  }
}
