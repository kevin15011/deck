import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireDaemonLock, readDaemonInfo, removeDaemonInfo, writeDaemonInfo, type LockDeps } from "../daemon-lock";
import { resolveStatePaths } from "../paths";
import { FakeClock, cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);

function env() {
  const base = tempDir();
  const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
  mkdirSync(paths.daemonDir, { recursive: true, mode: 0o700 });
  return paths;
}
const deps = (over: Partial<LockDeps> = {}): LockDeps => ({
  clock: new FakeClock(), presence: () => "alive", ping: async () => true, ...over,
});

describe("single-instance lock (XR-3.1)", () => {
  test("the first starter wins and records pid + nonce in a 0600 lock", async () => {
    const paths = env();
    const r = await acquireDaemonLock(paths, { pid: 4242, nonce: "n-1", ...deps() });
    expect(r.ok).toBe(true);
    const lock = JSON.parse(readFileSync(paths.lockFile, "utf8"));
    expect(lock).toMatchObject({ v: 1, pid: 4242, nonce: "n-1" });
    expect(lstatSync(paths.lockFile).mode & 0o777).toBe(0o600);
  });

  test("a second starter is told the daemon is already running and by whom", async () => {
    const paths = env();
    await acquireDaemonLock(paths, { pid: 1, nonce: "a", ...deps() });
    const second = await acquireDaemonLock(paths, { pid: 2, nonce: "b", ...deps() });
    expect(second).toMatchObject({ ok: false, reason: "already-running", holder: { pid: 1, nonce: "a" } });
    expect(JSON.parse(readFileSync(paths.lockFile, "utf8")).nonce).toBe("a");
  });

  test("a lock whose process is gone is reclaimed", async () => {
    const paths = env();
    await acquireDaemonLock(paths, { pid: 1, nonce: "dead", ...deps() });
    const r = await acquireDaemonLock(paths, { pid: 2, nonce: "new", ...deps({ presence: () => "absent" }) });
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(paths.lockFile, "utf8")).nonce).toBe("new");
  });

  test("an alive pid that does not answer is respected while young and reclaimed once past the startup grace", async () => {
    const paths = env();
    const clock = new FakeClock();
    await acquireDaemonLock(paths, { pid: 1, nonce: "slow", ...deps({ clock }) });
    const silent = deps({ clock, ping: async () => false });
    clock.advance(5_000);
    expect(await acquireDaemonLock(paths, { pid: 2, nonce: "x", ...silent })).toMatchObject({ ok: false, reason: "already-running" });
    clock.advance(10_000);
    const r = await acquireDaemonLock(paths, { pid: 2, nonce: "x", ...silent });
    expect(r.ok).toBe(true);
  });

  test("an unreadable lock file is treated as stale", async () => {
    const paths = env();
    writeFileSync(paths.lockFile, "{garbage", { mode: 0o600 });
    expect((await acquireDaemonLock(paths, { pid: 2, nonce: "x", ...deps() })).ok).toBe(true);
  });

  test("racing starters: exactly one wins", async () => {
    const paths = env();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireDaemonLock(paths, { pid: 100 + i, nonce: `n${i}`, ...deps() })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "already-running")).toHaveLength(7);
  });

  test("racing reclaimers of a stale lock: exactly one wins", async () => {
    const paths = env();
    await acquireDaemonLock(paths, { pid: 1, nonce: "dead", ...deps() });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => acquireDaemonLock(paths, { pid: 100 + i, nonce: `n${i}`, ...deps({ presence: (pid) => (pid === 1 ? "absent" : "alive") }) })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test("release removes only the lock this instance owns", async () => {
    const paths = env();
    const r = await acquireDaemonLock(paths, { pid: 1, nonce: "mine", ...deps() });
    if (!r.ok) throw new Error("expected lock");
    writeFileSync(paths.lockFile, JSON.stringify({ v: 1, pid: 9, nonce: "theirs", startedAt: 0 }), { mode: 0o600 });
    r.release();
    expect(existsSync(paths.lockFile)).toBe(true);
    writeFileSync(paths.lockFile, JSON.stringify({ v: 1, pid: 1, nonce: "mine", startedAt: 0 }), { mode: 0o600 });
    r.release();
    expect(existsSync(paths.lockFile)).toBe(false);
  });

  test("a stale reclaim gate left by a crashed starter does not block forever", async () => {
    const paths = env();
    await acquireDaemonLock(paths, { pid: 1, nonce: "dead", ...deps() });
    const clock = new FakeClock();
    mkdirSync(`${paths.lockFile}.gate`, { mode: 0o700 });
    clock.advance(60_000);
    const old = new Date(Date.now() - 60_000);
    require("node:fs").utimesSync(`${paths.lockFile}.gate`, old, old);
    const r = await acquireDaemonLock(paths, { pid: 2, nonce: "x", ...deps({ clock, presence: () => "absent" }) });
    expect(r.ok).toBe(true);
  });
});

describe("daemon.json", () => {
  test("round-trips 0600 and is removed on demand", () => {
    const paths = env();
    expect(readDaemonInfo(paths)).toBeUndefined();
    writeDaemonInfo(paths, { v: 1, pid: 5, nonce: "n", version: "1.0.0", socketPath: paths.socket.path, startedAt: "2026-01-01T00:00:00.000Z" });
    expect(readDaemonInfo(paths)).toMatchObject({ pid: 5, nonce: "n", version: "1.0.0" });
    expect(lstatSync(paths.daemonInfoFile).mode & 0o777).toBe(0o600);
    removeDaemonInfo(paths, "wrong-nonce");
    expect(existsSync(paths.daemonInfoFile)).toBe(true);
    removeDaemonInfo(paths, "n");
    expect(existsSync(paths.daemonInfoFile)).toBe(false);
  });

  test("garbage is treated as absent", () => {
    const paths = env();
    writeFileSync(paths.daemonInfoFile, "nope", { mode: 0o600 });
    expect(readDaemonInfo(paths)).toBeUndefined();
  });
});
