import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog } from "../event-log";
import { loadLedger } from "../ledger";
import { writeLease } from "../lease";
import { createDaemonLogger } from "../daemon-logger";
import { createNodeProbe } from "../process-probe";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { recoverAllSessions } from "../recovery";
import { FakeClock, cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);

describe("daemon logger (XR-11.1)", () => {
  test("writes redacted JSONL to a dated 0600 file and rotates by UTC day", () => {
    const dir = tempDir();
    const clock = new FakeClock();
    const logger = createDaemonLogger({ dir, clock });
    logger.info("daemon.started", { pid: 1, note: "Authorization: Bearer abc.def.ghi", token: "supersecret" });
    clock.advance(24 * 3600 * 1000);
    logger.warn("daemon.warn", { reason: "x" });
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["daemon-19700101.jsonl", "daemon-19700102.jsonl"]);
    const first = readFileSync(join(dir, files[0]!), "utf8");
    expect(first).not.toContain("abc.def.ghi");
    expect(first).not.toContain("supersecret");
    expect(JSON.parse(first.trim())).toMatchObject({ level: "info", event: "daemon.started", pid: 1 });
    expect(lstatSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
  });

  test("never throws, even when the directory is unusable", () => {
    const logger = createDaemonLogger({ dir: "/nonexistent-root-dir/deck-logs", clock: new FakeClock() });
    expect(() => logger.error("x", { a: 1 })).not.toThrow();
  });
});

describe("recoverAllSessions (XR-3.7 startup scan)", () => {
  test("recovers every session, skips junk, reports a corrupt session without stopping the others", () => {
    const base = tempDir();
    const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "s") }, tmpdir: base });
    ensureStateLayout(paths);
    const seed = (id: string) => {
      const sp = sessionPaths(paths, id);
      mkdirSync(sp.dir, { recursive: true, mode: 0o700 });
      const log = EventLog.open({ dir: sp.eventsDir, sessionId: id });
      log.appendMany([
        { kind: "session.created", data: { projectRoot: "/p" } },
        { kind: "session.state", data: { state: "running" } },
        { kind: "task.created", source: { taskId: "t" }, data: { taskId: "t", memberId: "lead", runnerId: "claude", modelId: "m" } },
        { kind: "task.state", source: { taskId: "t" }, data: { taskId: "t", state: "running" } },
      ]);
      log.close();
      return sp;
    };
    seed("good-1");
    const good2 = seed("good-2");
    writeLease(good2.taskLeaseFile("t"), { v: 1, taskId: "t", nonce: "n", state: "claiming", daemon: { pid: 1 }, createdAt: "2026-01-01T00:00:00.000Z" });
    const bad = seed("bad");
    writeFileSync(join(bad.eventsDir, "000001.jsonl"), "{corrupt\n{corrupt\n{corrupt\n");
    mkdirSync(join(paths.sessionsDir, "not a valid id"), { recursive: true });
    writeFileSync(join(paths.sessionsDir, "stray-file.txt"), "x");

    const report = recoverAllSessions({ paths, probe: createNodeProbe() });
    expect(report.sessions.map((s) => s.sessionId).sort()).toEqual(["good-1", "good-2"]);
    expect(report.errors.map((e) => e.sessionId)).toEqual(["bad"]);
    const g1 = report.sessions.find((s) => s.sessionId === "good-1")!;
    expect(g1.unsettled).toEqual([{ taskId: "t", reason: "lease-missing" }]);
    expect(report.sessions.find((s) => s.sessionId === "good-2")!.unsettled).toEqual([{ taskId: "t", reason: "lease-claiming" }]);

    // the result is durable: a fresh load sees the recovered state and a snapshot was checkpointed
    const log = EventLog.open({ dir: sessionPaths(paths, "good-1").eventsDir, sessionId: "good-1" });
    const loaded = loadLedger(log, sessionPaths(paths, "good-1").ledgerSnapshotFile);
    expect(loaded.source).toBe("snapshot");
    expect(loaded.ledger.latest("t")?.state).toBe("ownership-unsettled");
    expect(loaded.ledger.session.state).toBe("recovered");
    log.close();
  });

  test("an empty or missing sessions directory is fine", () => {
    const base = tempDir();
    const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "s") }, tmpdir: base });
    expect(recoverAllSessions({ paths, probe: createNodeProbe() })).toEqual({ sessions: [], errors: [] });
    ensureStateLayout(paths);
    expect(recoverAllSessions({ paths, probe: createNodeProbe() })).toEqual({ sessions: [], errors: [] });
  });
});
