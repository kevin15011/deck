import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog, type EventDraft } from "../event-log";
import { Ledger } from "../ledger";
import { writeLease, type Lease } from "../lease";
import { createNodeProbe, type ProcessIdentity } from "../process-probe";
import { continuationBlock, recoverSession, verifyLeaseSettled } from "../recovery";
import { cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);

const BOOT = "11111111-2222-3333-4444-555555555555";
const OTHER_BOOT = "99999999-2222-3333-4444-555555555555";

/** Synthetic OS: records every kill() call so tests can prove nothing but signal 0 is ever sent. */
function fakeOs(platform: "linux" | "darwin", boot = BOOT) {
  const procs = new Map<number, { starttime: string; state: string }>();
  const groups = new Set<number>();
  const denied = new Set<number>();
  const kills: Array<[number, unknown]> = [];
  const probe = createNodeProbe({
    platform,
    kill: (pid, signal) => {
      kills.push([pid, signal]);
      const err = (code: string) => Object.assign(new Error(code), { code });
      if (pid < 0) { if (groups.has(-pid)) return; throw err("ESRCH"); }
      if (denied.has(pid)) throw err("EPERM");
      if (procs.has(pid)) return;
      throw err("ESRCH");
    },
    readFile: (path) => {
      if (path === "/proc/sys/kernel/random/boot_id") return `${boot}\n`;
      const m = /^\/proc\/(\d+)\/stat$/.exec(path);
      const p = m && procs.get(Number(m[1]));
      if (!p) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return `${m![1]} (fake cmd) ${p.state} 1 ${m![1]} ${Array(16).fill("0").join(" ")} ${p.starttime} 0 0`;
    },
    sysctlBootSession: () => `${boot}\n`,
  });
  return { probe, procs, groups, denied, kills };
}

const id = (pid: number, platform: "linux" | "darwin" = "linux", starttime = "1000", boot = BOOT): ProcessIdentity =>
  platform === "linux" ? { pid, boot, platform, starttime } : { pid, boot, platform };
const lease = (taskId: string, over: Partial<Lease> = {}, platform: "linux" | "darwin" = "linux"): Lease => ({
  v: 1, taskId, nonce: "n", state: "live", daemon: { pid: 1 }, anchor: id(500, platform), worker: id(501, platform), group: 500, createdAt: "2026-01-01T00:00:00.000Z", ...over,
});

describe("verifyLeaseSettled (design 6.1, XR-3.7)", () => {
  test("Linux: everything absent within the same boot is settled", () => {
    const os = fakeOs("linux");
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: true });
  });

  test("Linux: same pid and start time means still running", () => {
    const os = fakeOs("linux");
    os.procs.set(500, { starttime: "1000", state: "S" });
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: false, reason: "pid-alive" });
  });

  test("Linux: a zombie counts as dead, a different start time as a reused pid (never settled)", () => {
    const os = fakeOs("linux");
    os.procs.set(500, { starttime: "1000", state: "Z" });
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: true });
    os.procs.set(500, { starttime: "2222", state: "S" });
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: false, reason: "pid-reused" });
  });

  test("Linux: a live worker blocks settlement even when the anchor is gone", () => {
    const os = fakeOs("linux");
    os.procs.set(501, { starttime: "1000", state: "S" });
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: false, reason: "pid-alive" });
  });

  test("a surviving group member blocks settlement even when both pids are gone", () => {
    const os = fakeOs("linux");
    os.groups.add(500);
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: false, reason: "group-alive" });
  });

  test("a different boot session settles: a reboot proves the processes are dead (PIDs are not consulted)", () => {
    const os = fakeOs("linux", OTHER_BOOT);
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: true });
    // even a live process that reuses the same pid and group in the new boot is irrelevant
    os.groups.add(500);
    expect(verifyLeaseSettled(lease("t"), os.probe)).toEqual({ settled: true });
    const darwin = fakeOs("darwin", OTHER_BOOT);
    expect(verifyLeaseSettled(lease("t", {}, "darwin"), darwin.probe)).toEqual({ settled: true });
  });

  test("an unknown current boot is still unprovable", () => {
    const os = fakeOs("linux");
    const probe = { ...os.probe, bootId: () => undefined };
    expect(verifyLeaseSettled(lease("t"), probe as never)).toEqual({ settled: false, reason: "boot-unknown" });
  });

  test("Darwin: only proven absence (ESRCH) within the same boot settles; alive and EPERM do not", () => {
    const os = fakeOs("darwin");
    const l = lease("t", {}, "darwin");
    expect(verifyLeaseSettled(l, os.probe)).toEqual({ settled: true });
    os.procs.set(500, { starttime: "0", state: "S" });
    expect(verifyLeaseSettled(l, os.probe)).toEqual({ settled: false, reason: "pid-alive" });
    os.procs.delete(500);
    os.denied.add(501);
    expect(verifyLeaseSettled(l, os.probe)).toEqual({ settled: false, reason: "probe-unknown" });
  });

  test("Darwin: a lease from another platform is refused", () => {
    expect(verifyLeaseSettled(lease("t", {}, "linux"), fakeOs("darwin").probe)).toEqual({ settled: false, reason: "platform-mismatch" });
  });

  test("missing, claiming and incomplete leases are unsettled", () => {
    const os = fakeOs("linux");
    expect(verifyLeaseSettled(undefined, os.probe)).toEqual({ settled: false, reason: "lease-missing" });
    expect(verifyLeaseSettled(lease("t", { state: "claiming", anchor: undefined, worker: undefined, group: undefined }), os.probe)).toEqual({ settled: false, reason: "lease-claiming" });
    expect(verifyLeaseSettled(lease("t", { group: undefined }), os.probe)).toEqual({ settled: false, reason: "lease-incomplete" });
    expect(verifyLeaseSettled(lease("t", { group: 999 }), os.probe)).toEqual({ settled: false, reason: "lease-incomplete" });
  });

  test("never sends a real signal: every kill() is signal 0", () => {
    const os = fakeOs("darwin");
    os.procs.set(500, { starttime: "0", state: "S" });
    os.groups.add(500);
    verifyLeaseSettled(lease("t", {}, "darwin"), os.probe);
    os.procs.delete(500);
    verifyLeaseSettled(lease("t", {}, "darwin"), os.probe);
    const linux = fakeOs("linux");
    linux.groups.add(500);
    verifyLeaseSettled(lease("t"), linux.probe);
    expect(os.kills.length).toBeGreaterThan(2);
    expect(linux.kills.length).toBeGreaterThan(0);
    expect([...os.kills, ...linux.kills].every(([, sig]) => sig === 0)).toBe(true);
  });

  test("recovery and lease sources never call kill; the probe's only kill is typed to signal 0", () => {
    const read = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8");
    for (const file of ["recovery.ts", "lease.ts"]) expect(read(file)).not.toMatch(/\.kill\(/);
    const probe = read("process-probe.ts");
    expect(probe.match(/\.kill\(/g)).toHaveLength(1);
    expect(probe).toContain("kill?: (pid: number, signal: 0) => void");
    expect(probe).not.toMatch(/SIG(?:KILL|TERM|INT|HUP|STOP)/);
  });
});

describe("recoverSession (XR-3.7)", () => {
  const created = (taskId: string): EventDraft => ({ kind: "task.created", source: { taskId, memberId: "m", runnerId: "claude" }, data: { taskId, memberId: "m", runnerId: "claude", modelId: "opus" } });
  const st = (taskId: string, state: string): EventDraft => ({ kind: "task.state", source: { taskId }, data: { taskId, state } });

  function setup(os = fakeOs("linux")) {
    const dir = tempDir();
    const log = EventLog.open({ dir: join(dir, "events"), sessionId: "s-1" });
    log.appendMany([
      { kind: "session.created", data: { projectRoot: "/p" } },
      { kind: "session.state", data: { state: "running" } },
      created("settled"), st("settled", "running"),
      created("alive"), st("alive", "running"),
      created("nolease"), st("nolease", "running"),
      created("done"), st("done", "running"), st("done", "completed"),
      created("queued"), st("queued", "queued"),
      { kind: "approval.requested", source: { taskId: "alive" }, data: { approvalId: "a1", taskId: "alive", tool: "Bash" } },
    ]);
    const ledger = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) ledger.apply(e);
    const leaseFile = (t: string) => join(dir, `${t}.lease.json`);
    writeLease(leaseFile("settled"), lease("settled", { anchor: id(500), worker: id(501), group: 500 }));
    writeLease(leaseFile("alive"), lease("alive", { anchor: id(600), worker: id(601), group: 600 }));
    os.procs.set(600, { starttime: "1000", state: "S" });
    return { dir, log, ledger, os, leaseFile };
  }

  test("settled running tasks become interrupted(daemon-restart); unprovable ones become ownership-unsettled", () => {
    const { log, ledger, os, leaseFile } = setup();
    const report = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(report.interrupted.sort()).toEqual(["queued", "settled"]);
    expect(report.unsettled).toEqual([{ taskId: "alive", reason: "pid-alive" }, { taskId: "nolease", reason: "lease-missing" }]);
    expect(ledger.latest("settled")).toMatchObject({ state: "interrupted", reason: "daemon-restart" });
    expect(ledger.latest("queued")).toMatchObject({ state: "interrupted", reason: "daemon-restart" });
    expect(ledger.latest("alive")).toMatchObject({ state: "ownership-unsettled", reason: "pid-alive" });
    expect(ledger.latest("nolease")).toMatchObject({ state: "ownership-unsettled", reason: "lease-missing" });
    expect(ledger.latest("done")?.state).toBe("completed");
    // the ledger and the log agree
    const replayed = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) replayed.apply(e);
    expect(replayed.toState()).toEqual(ledger.toState());
    log.close();
  });

  test("settled leases are removed; unsettled leases are kept", () => {
    const { log, ledger, os, leaseFile } = setup();
    recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(existsSync(leaseFile("settled"))).toBe(false);
    expect(existsSync(leaseFile("alive"))).toBe(true);
    log.close();
  });

  test("pending approvals are denied and the session is marked recovered", () => {
    const { log, ledger, os, leaseFile } = setup();
    const report = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(report.approvalsDenied).toEqual(["a1"]);
    expect(ledger.pendingApprovals()).toEqual([]);
    expect(ledger.session.state).toBe("recovered");
    const tail = [...log.readAfter(0)].slice(-3).map((e) => e.kind);
    expect(tail[2]).toBe("session.recovered");
    const resolved = [...log.readAfter(0)].find((e) => e.kind === "approval.resolved")!;
    expect(resolved.data).toMatchObject({ approvalId: "a1", decision: "deny", by: "daemon-restart" });
    log.close();
  });

  test("is idempotent: a second run with nothing new appends no events", () => {
    const { log, ledger, os, leaseFile } = setup();
    recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    const before = log.lastSeq;
    const again = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(again.eventsAppended).toBe(0);
    expect(log.lastSeq).toBe(before);
    log.close();
  });

  test("an unsettled task settles to interrupted once its processes are provably gone", () => {
    const { log, ledger, os, leaseFile } = setup();
    recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    os.procs.delete(600);
    const second = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(second.interrupted).toEqual(["alive"]);
    expect(ledger.latest("alive")).toMatchObject({ state: "interrupted", reason: "daemon-restart" });
    expect(existsSync(leaseFile("alive"))).toBe(false);
    log.close();
  });

  test("a leased task that never reached running is verified, not assumed absent", () => {
    const os = fakeOs("linux");
    const dir = tempDir();
    const log = EventLog.open({ dir: join(dir, "events"), sessionId: "s-1" });
    log.appendMany([created("c"), { kind: "session.state", data: { state: "running" } }]);
    const ledger = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) ledger.apply(e);
    const file = join(dir, "c.lease.json");
    writeLease(file, lease("c", { state: "claiming", anchor: undefined, worker: undefined, group: undefined }));
    const report = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: () => file });
    expect(report.unsettled).toEqual([{ taskId: "c", reason: "lease-claiming" }]);
    log.close();
  });

  test("an unsafe lease file (loose permissions) is treated as unsettled, never trusted", () => {
    const { log, ledger, os, leaseFile } = setup();
    chmodSync(leaseFile("settled"), 0o644);
    const report = recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(report.unsettled.find((u) => u.taskId === "settled")?.reason).toBe("lease-invalid");
    log.close();
  });

  test("an ended session is left alone", () => {
    const dir = tempDir();
    const log = EventLog.open({ dir: join(dir, "events"), sessionId: "s-1" });
    log.appendMany([{ kind: "session.created", data: { projectRoot: "/p" } }, { kind: "session.ended" }]);
    const ledger = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) ledger.apply(e);
    const report = recoverSession({ log, ledger, probe: fakeOs("linux").probe, leaseFileFor: () => join(dir, "x") });
    expect(report.eventsAppended).toBe(0);
    expect(ledger.session.state).toBe("ended");
    log.close();
  });

  test("no signal other than 0 is ever sent during recovery", () => {
    const { log, ledger, os, leaseFile } = setup();
    recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(os.kills.length).toBeGreaterThan(0);
    expect(os.kills.every(([, sig]) => sig === 0)).toBe(true);
    log.close();
  });

  test("lease files left for unknown names are untouched", () => {
    const { log, ledger, os, leaseFile, dir } = setup();
    writeFileSync(join(dir, "other.txt"), "x");
    recoverSession({ log, ledger, probe: os.probe, leaseFileFor: leaseFile });
    expect(readdirSync(dir)).toContain("other.txt");
    log.close();
  });
});

describe("continuationBlock (XR-3.7)", () => {
  test("refuses continuation while running or ownership-unsettled; allows terminal tasks", () => {
    const l = Ledger.empty("s-1");
    const apply = (seq: number, kind: EventDraft["kind"], data: Record<string, unknown>) =>
      l.apply({ v: 1, sessionId: "s-1", seq, ts: "2026-01-01T00:00:00.000Z", kind, source: {}, data });
    let n = 0;
    for (const t of ["r", "u", "i", "c", "f"]) apply(++n, "task.created", { taskId: t, memberId: "m", runnerId: "claude", modelId: "x" });
    apply(++n, "task.state", { taskId: "r", state: "running" });
    apply(++n, "task.state", { taskId: "u", state: "running" });
    apply(++n, "task.state", { taskId: "u", state: "ownership-unsettled" });
    apply(++n, "task.state", { taskId: "i", state: "interrupted" });
    apply(++n, "task.state", { taskId: "c", state: "running" });
    apply(++n, "task.state", { taskId: "c", state: "completed" });
    apply(++n, "task.state", { taskId: "f", state: "failed" });
    expect(continuationBlock(l, "r")).toEqual({ code: "task-running" });
    expect(continuationBlock(l, "u")).toEqual({ code: "ownership-unsettled" });
    expect(continuationBlock(l, "i")).toBeUndefined();
    expect(continuationBlock(l, "c")).toBeUndefined();
    expect(continuationBlock(l, "f")).toBeUndefined();
    expect(continuationBlock(l, "nope")).toEqual({ code: "task-unknown" });
  });
});
