import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compareVersions, DaemonStartTimeoutError, ensureDaemon, pingDaemon } from "../daemon-client";
import { startDaemon, type RunningDaemon } from "../daemon";
import { resolveStatePaths } from "../paths";
import { StubSessionService } from "../testing/stub-service";
import { cleanupTempDirs, tempDir } from "./test-helpers";

const running: RunningDaemon[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((d) => d.stop("cleanup"))); cleanupTempDirs(); });

function paths() {
  const base = tempDir();
  return resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
}
const launch = async (p: ReturnType<typeof paths>, version = "1.0.0") => {
  const r = await startDaemon({ paths: p, version, anchorCommand: ["x"], createService: () => new StubSessionService(p.sessionsDir) });
  if (!r.ok) throw new Error("daemon did not start");
  running.push(r.daemon);
  return r.daemon;
};
/** Simulated time: sleeping advances the clock instantly. */
function simulatedTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, elapsed: () => t };
}

describe("compareVersions", () => {
  test("orders semantic versions and treats unknown formats as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-canary.3")).toBe(0);
    expect(compareVersions("dev", "1.0.0")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
  });
});

describe("pingDaemon", () => {
  test("answers with identity for a live daemon and undefined for nothing or a non-daemon", async () => {
    const p = paths();
    expect(await pingDaemon(p.socket.path, { timeoutMs: 300 })).toBeUndefined();
    const d = await launch(p);
    expect(await pingDaemon(p.socket.path, { timeoutMs: 1000 })).toMatchObject({ pid: process.pid, nonce: d.info.nonce, daemonVersion: "1.0.0" });
  });
});

describe("ensureDaemon (auto-start, design 6.3)", () => {
  test("reuses a running daemon without spawning", async () => {
    const p = paths();
    const d = await launch(p);
    let spawned = 0;
    const r = await ensureDaemon({ paths: p, clientVersion: "1.0.0", spawnDaemon: () => { spawned++; } });
    expect(r).toMatchObject({ started: false, restarted: false, daemon: { nonce: d.info.nonce } });
    expect(spawned).toBe(0);
  });

  test("spawns when absent and waits for readiness", async () => {
    const p = paths();
    const time = simulatedTime();
    let polls = 0;
    const r = await ensureDaemon({
      paths: p, clientVersion: "1.0.0", pollMs: 50, ...time,
      spawnDaemon: () => { void launch(p); },
      sleep: async (ms) => { polls++; await time.sleep(ms); await new Promise((res) => setTimeout(res, 20)); },
    });
    expect(r.started).toBe(true);
    expect(polls).toBeGreaterThanOrEqual(0);
    expect(r.daemon.version).toBe("1.0.0");
  });

  test("gives up after the 5 s readiness budget with a clear error", async () => {
    const p = paths();
    const time = simulatedTime();
    await expect(ensureDaemon({ paths: p, clientVersion: "1.0.0", spawnDaemon: () => {}, pollMs: 100, ...time })).rejects.toBeInstanceOf(DaemonStartTimeoutError);
    expect(time.elapsed()).toBeGreaterThanOrEqual(5000);
    expect(time.elapsed()).toBeLessThan(5500);
  });

  test("a newer client restarts an idle older daemon", async () => {
    const p = paths();
    const old = await launch(p, "1.0.0");
    const time = simulatedTime();
    const r = await ensureDaemon({
      paths: p, clientVersion: "2.0.0", pollMs: 25, now: time.now,
      sleep: async (ms) => { await time.sleep(ms); await new Promise((res) => setTimeout(res, 10)); },
      spawnDaemon: () => { void launch(p, "2.0.0"); },
    });
    expect(await old.stopped).toBe("restart");
    expect(r).toMatchObject({ started: true, restarted: true, daemon: { version: "2.0.0" } });
  });

  test("never restarts an older daemon that has running work: it keeps using it and reports the skew", async () => {
    const p = paths();
    let service!: StubSessionService;
    const r0 = await startDaemon({ paths: p, version: "1.0.0", anchorCommand: ["x"], createService: () => (service = new StubSessionService(p.sessionsDir)) });
    if (!r0.ok) throw new Error("start");
    running.push(r0.daemon);
    service.running = true;
    let spawned = 0;
    const r = await ensureDaemon({ paths: p, clientVersion: "2.0.0", spawnDaemon: () => { spawned++; } });
    expect(spawned).toBe(0);
    expect(r).toMatchObject({ started: false, restarted: false, versionSkew: "daemon-older-busy", daemon: { version: "1.0.0" } });
  });

  test("an equal or older client never restarts the daemon", async () => {
    const p = paths();
    await launch(p, "2.0.0");
    const r = await ensureDaemon({ paths: p, clientVersion: "1.0.0", spawnDaemon: () => { throw new Error("must not spawn"); } });
    expect(r.restarted).toBe(false);
  });
});
