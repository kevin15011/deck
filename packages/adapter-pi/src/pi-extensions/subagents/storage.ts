import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Job } from "./jobs";

export function childSessionPath(parentFile: string, parent: string, childId: string): string {
  const key = createHash("sha256").update(parentFile + "\0" + parent).digest("hex");
  return join(dirname(parentFile), ".deck-subagents", key, `${childId}.jsonl`);
}
function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe child session directory");
}
export function prepareChildSession(parentFile: string, job: Job, existingOnly = false): string {
  const file = childSessionPath(parentFile, job.parent, job.childId);
  privateDirectory(dirname(dirname(file))); privateDirectory(dirname(file));
  let stat;
  try { stat = lstatSync(file); } catch (e: any) {
    if (e.code !== "ENOENT" || existingOnly) throw new Error("Exact child history unavailable; continuation refused");
    writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: job.childId, timestamp: new Date().toISOString(), cwd: job.cwd, deckParent: job.parent, deckTaskId: job.id }) + "\n", { mode: 0o600, flag: "wx" });
    stat = lstatSync(file);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe child history file");
  const fd = openSync(file, "r");
  try {
    const bytes = Buffer.alloc(8192); const n = readSync(fd, bytes, 0, bytes.length, 0);
    const line = bytes.subarray(0, n).toString().split("\n")[0]!;
    const h = JSON.parse(line);
    if (h.type !== "session" || h.id !== job.childId || h.cwd !== job.cwd || h.deckParent !== job.parent || h.deckTaskId !== job.id) throw new Error("Exact child history binding mismatch");
  } finally { closeSync(fd); }
  return file;
}
