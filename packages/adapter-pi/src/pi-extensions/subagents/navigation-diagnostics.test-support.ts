/** Failure-only test evidence; never changes native admission, ownership or cleanup. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childSessionPath } from "./storage";
import { clean } from "./jobs";

type Input = {
  parentFile: string; cwd: string; childLog: string;
  job?: { parent: string; childId: string; [key: string]: unknown };
  accepted: unknown; journal: unknown; controls: unknown;
};
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function bounded(value: unknown, limit: number) {
  const text = JSON.stringify(value, (key, item) => /nonce|token|secret|password|authorization/i.test(key) ? "[redacted]" : item) ?? String(value);
  return { text: clean(text, limit), truncated: text.length > limit };
}
function inspect(path: string) {
  try {
    const s = lstatSync(path);
    return { mode: s.mode & 0o777, uid: s.uid, nlink: s.nlink, size: s.size, symlink: s.isSymbolicLink(), file: s.isFile(), directory: s.isDirectory() };
  } catch (error) { return { error: (error as NodeJS.ErrnoException).code }; }
}
function readPrivate(path: string) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.size > 64 * 1024 || (process.getuid && s.uid !== process.getuid())) throw new Error("Unsafe diagnostic input");
    // Stat is only an initial check: the file may grow before/during reading.
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const received = readSync(fd, bytes, size, bytes.length - size, null);
      if (received === 0) break;
      size += received;
    }
    if (size > 64 * 1024) throw new Error("Unsafe diagnostic input");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
function summary(path: string) {
  const metadata = inspect(path);
  try {
    const bytes = readPrivate(path);
    return { metadata, sha256: hash(bytes), lines: bytes.toString().trim().split("\n").slice(0, 8).map(line => {
      try {
        const item = JSON.parse(line);
        // Keep correlation/header/terminal metadata; never copy child env, task/prompt text or nonce.
        return { type: item.type, id: item.id, version: item.version, cwd: item.cwd, parentId: item.parentId, taskId: item.taskId,
          deckParent: item.deckParent, deckTaskId: item.deckTaskId, role: item.message?.role, stopReason: item.message?.stopReason, pid: item.pid, startedAt: item.startedAt, endedAt: item.endedAt };
      } catch { return { invalidJson: true, bytes: line.length }; }
    }) };
  } catch (error) { return { metadata, error: clean(String(error), 256) }; }
}
const identity = (value: any) => value ? { pid: value.pid, boot: value.boot, birth: value.birth, platform: value.platform, recovery: value.recovery } : undefined;
export function captureNavigationFailure(input: Input): string {
  const root = mkdtempSync(join(tmpdir(), "dnav-failure-"));
  const file = input.job ? childSessionPath(input.parentFile, input.job.parent, input.job.childId) : input.parentFile + ".unknown-child";
  const leasePath = file + ".execution";
  let lease: any;
  try { lease = JSON.parse(readPrivate(leasePath).toString()); } catch { /* Missing/unreadable is recorded by metadata. */ }
  const observer = Reflect.get(globalThis, "__deckPiNavigationTrace");
  let trace: unknown = { available: false };
  try { if (typeof observer === "function") trace = observer(input.cwd); } catch { trace = { observerError: true }; }
  let processes: unknown = { capturedAfterFailure: true, unsupported: process.platform !== "darwin" };
  if (process.platform === "darwin") {
    try {
      const rows = execFileSync("/bin/ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf8", timeout: 2000, maxBuffer: 4 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").filter(Boolean);
      const pattern = /^\s*(\d+)\s+(\d+)\s+([A-Za-z+<NsEXsWLl-]+)\s*$/;
      processes = { capturedAfterFailure: true, rows: rows.length, unparsed: rows.filter(row => !pattern.test(row)).slice(0, 8).map(row => row.slice(0, 128)),
        owned: rows.filter(row => Number(pattern.exec(row)?.[2]) === lease?.group).slice(0, 16) };
    } catch (error) { processes = { capturedAfterFailure: true, error: clean(String(error), 256) }; }
  }
  const artifact = { version: 1, at: new Date().toISOString(), pid: process.pid, bun: Bun.version, platform: process.platform,
    accepted: bounded(input.accepted, 2048), job: bounded(input.job, 8192), journal: bounded(input.journal, 12000), controls: bounded(input.controls, 8192),
    history: summary(file), childLog: summary(input.childLog), gate: inspect(leasePath + ".gate"),
    lease: { metadata: inspect(leasePath), value: lease ? { version: lease.version, effectsUncertain: lease.effectsUncertain, file: lease.file, parentId: lease.parentId, taskId: lease.taskId,
      parent: identity(lease.parent), child: identity(lease.child), group: lease.group, nonceSha256: hash(String(lease.nonce)) } : undefined },
    trace: bounded(trace, 24000), processes };
  const path = join(root, "failure.json");
  writeFileSync(path, JSON.stringify(artifact, null, 2), { mode: 0o600 });
  return path;
}
