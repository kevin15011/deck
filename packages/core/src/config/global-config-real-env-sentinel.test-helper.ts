import { afterAll, beforeAll, expect } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";

const REAL_CONFIG_SENTINELS = [
  "/home/dev/.deck",
  "/home/dev/.deck/config.json",
  "/home/dev/deck/.deck",
  "/home/dev/deck/.deck/config.json",
  "/home/dev/.config/deck/config.json",
] as const;

type Snapshot = Readonly<{
  path: string;
  exists: boolean;
  type: string;
  size: number | null;
  mtimeMs: number | null;
  ino: number | null;
  mode: number | null;
  digest: string | null;
}>;

function snapshot(path: string): Snapshot {
  if (!existsSync(path)) return { path, exists: false, type: "missing", size: null, mtimeMs: null, ino: null, mode: null, digest: null };
  const stat = lstatSync(path);
  const type = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other";
  const digest = stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
  return { path, exists: true, type, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), ino: stat.ino, mode: stat.mode & 0o777, digest };
}

export function installGlobalConfigRealEnvSentinel(): void {
  let before: Snapshot[] = [];
  beforeAll(() => {
    before = REAL_CONFIG_SENTINELS.map(snapshot);
  });
  afterAll(() => {
    expect(REAL_CONFIG_SENTINELS.map(snapshot)).toEqual(before);
  });
}

export function realConfigSentinelSummary(): string {
  return REAL_CONFIG_SENTINELS.map(snapshot)
    .map((entry) => entry.exists
      ? `${entry.path} size=${entry.size} mtimeMs=${entry.mtimeMs} ino=${entry.ino} digest=${entry.digest?.slice(0, 12)}`
      : `${entry.path} missing`)
    .join("\n");
}
