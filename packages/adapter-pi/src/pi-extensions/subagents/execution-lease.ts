import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeSync } from "node:fs";

/** Linux verifies birth identity. Darwin recovers only after PID nonexistence, never from a
 * coarse timestamp or zombie state. A live/reused PID therefore blocks recovery conservatively. */
type Identity = { pid: number; boot: string } & ({ platform?: "linux"; birth: string } | { platform: "darwin"; recovery: "absent-only" });
type Lease = { version: 2; effectsUncertain: boolean; nonce: string; file: string; parentId?: string; taskId?: string; parent?: Identity; child?: Identity; group?: number };
const uncertain = () => new Error("Native detached tool effects ownership is uncertain; exact-history continuation refused");
const refused = () => new Error("Prior execution is not proven settled; continuation refused");
function validIdentity(id: unknown): id is Identity {
  const i = id as Identity | undefined;
  return Boolean(i && Number.isSafeInteger(i.pid) && i.pid > 0
    && (i.platform === "darwin" ? i.recovery === "absent-only" : typeof i.birth === "string" && /^\d+$/.test(i.birth))
    && typeof i.boot === "string" && /^[a-f0-9-]{36}$/.test(i.boot));
}
function stat(pid: number) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)!.split(" ");
    if (!fields[19] || !Number.isInteger(Number(fields[2]))) throw refused();
    return { birth: fields[19], group: Number(fields[2]), state: fields[0] };
  } catch (e: any) { if (["ENOENT", "ESRCH"].includes(e.code)) return undefined; throw refused(); }
}
function darwinBoot(): string {
  const boot = execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 2000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] }).trim().toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(boot)) throw refused();
  return boot;
}
function identity(pid: number): Identity | undefined {
  if (process.platform === "darwin") return { pid, boot: darwinBoot(), platform: "darwin", recovery: "absent-only" };
  if (process.platform !== "linux") return undefined;
  const s = stat(pid);
  return s ? { pid, birth: s.birth, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() } : undefined;
}
function gone(id?: Identity) {
  if (!validIdentity(id)) throw refused();
  if (id.platform === "darwin") {
    if (process.platform !== "darwin" || id.boot !== darwinBoot()) throw refused();
    // Probe only: NEVER signal persisted PIDs. EPERM/unknown/live/reused/zombie all refuse.
    try { process.kill(id.pid, 0); return false; } catch (error: any) { if (error.code === "ESRCH") return true; throw refused(); }
  }
  if (process.platform !== "linux" || id.boot !== readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()) throw refused();
  const s = stat(id.pid);
  if (!s) return true;
  // A recycled PID is not evidence about this execution; never signal a persisted PID.
  if (s.birth !== id.birth) throw refused();
  return s.state === "Z" || s.state === "X";
}
function groupAbsent(group: number): boolean {
  if (process.platform === "win32") return false;
  try { process.kill(-group, 0); return false; } catch (e: any) { return e.code === "ESRCH"; }
}
function darwinProcesses(pid?: number): Array<{ pid: number; group: number; state: string }> {
  const args = pid === undefined ? ["-axo", "pid=,pgid=,stat="] : ["-p", String(pid), "-o", "pid=,pgid=,stat="];
  let text: string;
  try { text = execFileSync("/bin/ps", args, { encoding: "utf8", timeout: 2000, maxBuffer: 4 * 1024 * 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error: any) {
    if (pid !== undefined && error.status === 1 && !String(error.stdout ?? "").trim() && !String(error.stderr ?? "").trim()) return [];
    throw refused();
  }
  return text.trim().split("\n").filter(Boolean).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+([A-Za-z+<NsEXsWLl-]+)\s*$/.exec(line);
    if (!m) throw refused();
    return { pid: Number(m[1]), group: Number(m[2]), state: m[3]! };
  });
}

/** Live inspection only. Darwin birth identity is intentionally not inferred from coarse ps timestamps. */
export function processGroupOf(pid: number): number | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw refused();
  return process.platform === "linux" ? stat(pid)?.group : process.platform === "darwin" ? darwinProcesses(pid)[0]?.group : undefined;
}
export function processIsExecuting(pid: number): boolean {
  const state = process.platform === "linux" ? stat(pid)?.state : process.platform === "darwin" ? darwinProcesses(pid)[0]?.state : undefined;
  if (!["linux", "darwin"].includes(process.platform)) throw refused();
  return state !== undefined && !/^[ZX]/.test(state);
}
export function executionGroupSettled(group: number): boolean {
  if (process.platform === "darwin") {
    try { return !darwinProcesses().some(p => p.group === group && !/^[ZX]/.test(p.state)); }
    catch { return false; }
  }
  if (process.platform === "linux") {
    try {
      const entries = readdirSync("/proc").filter(n => /^\d+$/.test(n));
      if (entries.length > 65536) return false;
      return !entries.some(n => { const s = stat(Number(n)); return s?.group === group && s.state !== "Z" && s.state !== "X"; });
    } catch { return false; }
  }
  return groupAbsent(group);
}
function readLease(path: string): Lease | undefined {
  try {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const s = fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.size > 8192 || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw refused();
      const raw = JSON.parse(readFileSync(fd, "utf8"));
      // Older leases did not account for native detached shell groups. Never reclaim them.
      if (raw.version !== 2 || typeof raw.effectsUncertain !== "boolean" || typeof raw.nonce !== "string" || typeof raw.file !== "string") throw refused();
      return raw;
    } finally { closeSync(fd); }
  } catch (e: any) { if (e.code === "ENOENT") return undefined; throw refused(); }
}
function guard<T>(file: string, action: (path: string) => T): T {
  const path = file + ".execution", gate = path + ".gate";
  // All claims/reclaims use the same exclusive gate. A crash during gate ownership fails closed.
  try { mkdirSync(gate, { mode: 0o700 }); } catch { throw refused(); }
  try { return action(path); } finally { rmdirSync(gate); }
}
function recover(path: string, file: string, parentId?: string, taskId?: string) {
  const old = readLease(path);
  if (!old) return;
  if (old.effectsUncertain) throw uncertain();
  if (old.file !== file || old.parentId !== parentId || old.taskId !== taskId || !gone(old.parent)
    || !validIdentity(old.child) || !Number.isSafeInteger(old.group) || old.group !== old.child.pid || !gone(old.child) || !groupAbsent(old.group!)) throw refused();
  unlinkSync(path);
}
/** Eligibility check; the actual run atomically rechecks and claims before spawning. */
export function assertExecutionSettled(file: string, parentId?: string, taskId?: string) {
  guard(file, path => {
    const old = readLease(path);
    if (!old) return;
    if (old.effectsUncertain) throw uncertain();
    if (old.file !== file || old.parentId !== parentId || old.taskId !== taskId || !gone(old.parent)
      || !validIdentity(old.child) || !Number.isSafeInteger(old.group) || old.group !== old.child.pid || !gone(old.child) || !groupAbsent(old.group!)) throw refused();
  });
}
export function claimExecution(file: string, parentId?: string, taskId?: string, effectsUncertain = true) {
  // Commit uncertainty before spawn. Clear only after the child startup handshake;
  // a crash before acknowledgement must retain the conservative fence.
  const lease: Lease = { version: 2, effectsUncertain, nonce: randomUUID(), file, parentId, taskId, parent: identity(process.pid) };
  guard(file, path => { recover(path, file, parentId, taskId); const fd = openSync(path, "wx", 0o600); try { writeSync(fd, JSON.stringify(lease)); fsyncSync(fd); } finally { closeSync(fd); } });
  const update = () => guard(file, path => {
    if (readLease(path)?.nonce !== lease.nonce) throw refused();
    const fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    try { if (!fstatSync(fd).isFile()) throw refused(); ftruncateSync(fd); writeSync(fd, JSON.stringify(lease)); fsyncSync(fd); } finally { closeSync(fd); }
  });
  return {
    spawned(pid: number) { lease.group = pid; lease.child = identity(pid); update(); },
    contained() { lease.effectsUncertain = false; update(); },
    release() {
      // Only this execution's finalizer may release; recovery never kills orphaned processes.
      if (lease.effectsUncertain || (lease.group !== undefined && !executionGroupSettled(lease.group))) return;
      guard(file, path => { if (readLease(path)?.nonce !== lease.nonce) throw refused(); unlinkSync(path); });
    },
  };
}
