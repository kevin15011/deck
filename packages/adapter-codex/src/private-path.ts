import { lstatSync } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/** Owner-only directory check shared by every Deck-owned Codex tool root. */
export function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error(`Codex Deck data directory is not owner-only: ${path}`);
  }
}

/** Root-owned sticky temporary parents (for example /tmp) cannot replace another owner's child. */
export function assertTrustedAncestors(path: string, home: string): void {
  if (!isAbsolute(path) || !isAbsolute(home)) throw new Error("Codex Deck path must be absolute.");
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const homeStat = lstatSync(home);
  if (!homeStat.isDirectory() || (uid !== undefined && homeStat.uid !== uid)) throw new Error("Codex HOME is not owned by the active user.");
  let current = resolve(path);
  while (true) {
    let stat: import("node:fs").Stats | undefined;
    try { stat = lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (stat) {
      if (!stat.isDirectory()) throw new Error(`Untrusted Codex Deck ancestor: ${current}`);
      const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if ((stat.mode & 0o022) !== 0 && !stickyRoot) throw new Error(`Writable Codex Deck ancestor: ${current}`);
      if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) throw new Error(`Foreign Codex Deck ancestor: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** Creates missing Deck data directories as 0700 after validating every existing ancestor. */
export async function ensurePrivatePath(path: string, home: string): Promise<void> {
  if (resolve(path) === resolve(home)) throw new Error("Codex Deck data root cannot be HOME.");
  assertTrustedAncestors(path, home);
  const missing: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || await realpath(current) !== current) throw new Error("Codex Deck data ancestor is not a real directory.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(current);
      const parent = dirname(current);
      if (parent === current) throw new Error("No real Deck data ancestor.");
      current = parent;
    }
  }
  for (const dir of missing.reverse()) {
    assertTrustedAncestors(dirname(dir), home);
    await mkdir(dir, { mode: 0o700 });
    assertPrivateDirectory(dir);
  }
  assertTrustedAncestors(path, home);
  assertPrivateDirectory(path);
}
