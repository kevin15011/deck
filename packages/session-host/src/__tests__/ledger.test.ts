import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionEvent } from "@deck/core/session/events";
import { EventLog, type EventDraft } from "../event-log";
import { Ledger, loadLedger, saveLedgerSnapshot, type RebuildReason } from "../ledger";
import { cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);

const created = (taskId: string, extra: Record<string, unknown> = {}): EventDraft => ({
  kind: "task.created", source: { taskId }, data: { taskId, memberId: "architect", runnerId: "codex", modelId: "m1", thinking: "high", ...extra },
});
const state = (taskId: string, st: string, extra: Record<string, unknown> = {}): EventDraft => ({ kind: "task.state", source: { taskId }, data: { taskId, state: st, ...extra } });

function openLog(dir: string) { return EventLog.open({ dir: join(dir, "events"), sessionId: "s-1" }); }
function replay(drafts: EventDraft[]): Ledger {
  const dir = tempDir();
  const log = openLog(dir);
  log.appendMany(drafts);
  const ledger = Ledger.empty("s-1");
  for (const e of log.readAfter(0)) ledger.apply(e);
  log.close();
  return ledger;
}

describe("Ledger command receipts and native confirmation (S1b)", () => {
  test("reply cursor tracks only public finalized actual Lead replies across generations", () => {
    const ledger = replay([
      created("lead", { memberId: "lead" }), created("child"), created("lead-g1", { memberId: "lead" }),
      { kind: "message.completed", source: { taskId: "lead", memberId: "lead" }, data: { role: "assistant", text: "first reply" } },
      { kind: "message.completed", source: { taskId: "child", memberId: "lead" }, data: { role: "assistant", text: "child reply" } },
      { kind: "message.completed", source: { taskId: "unknown", memberId: "lead" }, data: { role: "assistant", text: "helper reply" } },
      { kind: "message.delta", source: { taskId: "lead" }, data: { text: "streaming" } },
      { kind: "message.completed", source: { taskId: "lead" }, data: { role: "system", text: "system" } },
      { kind: "message.completed", source: { taskId: "lead" }, data: { role: "assistant", text: "internal", internal: true } },
      { kind: "message.completed", source: { taskId: "lead" }, data: { role: "assistant", text: "   " } },
      created("helper", { memberId: "lead" }),
      { kind: "message.completed", source: { taskId: "helper", memberId: "lead" }, data: { role: "assistant", text: "helper completion" } },
    ]);
    expect(ledger.lastLeadReplySeq).toBe(4);
    ledger.apply({ v: 1, sessionId: "s-1", seq: 13, ts: "2026-10-15T00:00:00Z", kind: "message.completed", source: { taskId: "lead-g1", memberId: "lead" }, data: { role: "assistant", text: "current generation" } });
    expect(ledger.lastLeadReplySeq).toBe(13);
    expect(ledger.lastEventTs).toBe("2026-10-15T00:00:00Z");
  });

  test("old snapshot versions rebuild the reply cursor from the authoritative log", () => {
    const dir = tempDir(), log = openLog(dir), file = join(dir, "snapshot.json");
    log.appendMany([created("lead", { memberId: "lead" }), { kind: "message.completed", source: { taskId: "lead" }, data: { role: "assistant", text: "persisted reply" } }]);
    const initial = loadLedger(log, file).ledger;
    saveLedgerSnapshot(initial, log, file);
    const old = JSON.parse(readFileSync(file, "utf8")); old.v = 1; delete old.state.lastLeadReplySeq; delete old.state.lastEventTs;
    writeFileSync(file, JSON.stringify(old));
    const rebuilt = loadLedger(log, file);
    expect(rebuilt.source).toBe("rebuilt"); expect(rebuilt.ledger.lastLeadReplySeq).toBe(2);
    saveLedgerSnapshot(rebuilt.ledger, log, file);
    const restored = loadLedger(log, file);
    expect(restored.source).toBe("snapshot"); expect(restored.replayed).toBe(0); expect(restored.ledger.lastLeadReplySeq).toBe(2);
    log.close();
  });
  const accepted = (commandId: string, type = "prompt.send", outcome: Record<string, unknown> = { ok: true, data: { taskId: "lead" } }): EventDraft =>
    ({ kind: "command.accepted", data: { commandId, type, outcome } });

  test("command.accepted records the original outcome by commandId (durable idempotency, XR-1.5)", () => {
    const l = replay([accepted("c-1"), accepted("c-2", "session.stop", { ok: true })]);
    expect(l.receipt("c-1")).toEqual({ type: "prompt.send", outcome: { ok: true, data: { taskId: "lead" } } });
    expect(l.receipt("c-2")?.type).toBe("session.stop");
    expect(l.receipt("nope")).toBeUndefined();
  });

  test("receipts are bounded: the oldest are evicted, the newest stay", () => {
    const drafts = Array.from({ length: 1105 }, (_, i) => accepted(`c-${i}`));
    const l = replay(drafts);
    expect(l.receipt("c-0")).toBeUndefined();
    expect(l.receipt("c-104")).toBeUndefined();
    expect(l.receipt("c-105")).toBeDefined();
    expect(l.receipt("c-1104")).toBeDefined();
  });

  test("receipts survive a snapshot round trip and a rebuild from the log", () => {
    const dir = tempDir();
    const log = openLog(dir);
    log.appendMany([accepted("c-1"), created("t1")]);
    const ledger = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) ledger.apply(e);
    const file = join(dir, "snap.json");
    saveLedgerSnapshot(ledger, log, file);
    log.append(accepted("c-2"));
    const loaded = loadLedger(log, file);
    expect(loaded.source).toBe("snapshot");
    expect(loaded.ledger.receipt("c-1")).toBeDefined();
    expect(loaded.ledger.receipt("c-2")).toBeDefined();
    writeFileSync(file, "garbage");
    expect(loadLedger(log, file).ledger.receipt("c-1")).toBeDefined();
    log.close();
  });

  test("a snapshot written before receipts existed still loads (missing field defaults to none)", () => {
    const l = Ledger.fromState({ sessionId: "s-1", seq: 0, session: { state: "created" }, tasks: {}, approvals: {}, anomalies: [] } as never);
    expect(l.receipt("x")).toBeUndefined();
  });

  test("turn.started marks the task's native session as confirmed (so a later turn may --resume)", () => {
    const l = replay([created("t1", { nativeSessionId: "n-0" }), state("t1", "running")]);
    expect(l.nativeConfirmed("t1")).toBe(false);
    const l2 = replay([created("t1", { nativeSessionId: "n-0" }), state("t1", "running"), { kind: "turn.started", source: { taskId: "t1" }, data: { nativeSessionId: "n-0" } }, state("t1", "interrupted")]);
    expect(l2.nativeConfirmed("t1")).toBe(true);
    expect(l2.nativeConfirmed("unknown")).toBe(false);
  });
});

describe("Ledger projection (XR-3.3, D-12, D-15)", () => {
  test("projects session facts", () => {
    const l = replay([
      { kind: "session.created", data: { projectRoot: "/work/p" } },
      { kind: "session.state", data: { state: "running" } },
      { kind: "session.bound", data: { changeId: "c1" } },
    ]);
    expect(l.session).toMatchObject({ projectRoot: "/work/p", state: "running", changeId: "c1" });
    expect(l.seq).toBe(3);
  });

  test("a change binding is immutable once set (XR-7.1)", () => {
    const l = replay([{ kind: "session.bound", data: { changeId: "c1" } }, { kind: "session.bound", data: { changeId: "c2" } }]);
    expect(l.session.changeId).toBe("c1");
    expect(l.anomalies.map((a) => a.code)).toContain("session-binding-immutable");
  });

  test("task attempts record runner, model, thinking, native id and state", () => {
    const l = replay([
      created("t1", { nativeSessionId: "n-0" }),
      state("t1", "running"),
      state("t1", "completed", { nativeSessionId: "n-1" }),
    ]);
    const t = l.task("t1")!;
    expect(t.memberId).toBe("architect");
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]).toMatchObject({ attempt: 1, runnerId: "codex", modelId: "m1", thinking: "high", nativeSessionId: "n-1", state: "completed" });
    expect(l.latest("t1")?.state).toBe("completed");
  });

  test("continuation appends an attempt on the RECORDED runner/model, never the current assignment (D-12)", () => {
    const l = replay([
      created("t1"),
      state("t1", "running"),
      state("t1", "completed"),
      { kind: "task.continued", source: { taskId: "t1" }, data: { taskId: "t1", attempt: 2, continuity: "native", nativeSessionId: "n-1" } },
      state("t1", "running"),
      state("t1", "completed"),
      { kind: "task.continued", source: { taskId: "t1" }, data: { taskId: "t1", attempt: 3, continuity: "reseeded", nativeSessionId: "n-9" } },
    ]);
    const t = l.task("t1")!;
    expect(t.attempts.map((a) => [a.attempt, a.runnerId, a.modelId, a.continuity, a.nativeSessionId, a.state])).toEqual([
      [1, "codex", "m1", undefined, undefined, "completed"],
      [2, "codex", "m1", "native", "n-1", "completed"],
      [3, "codex", "m1", "reseeded", "n-9", "created"],
    ]);
  });

  test("continuing a task that is still running is refused (XR-6.5)", () => {
    const l = replay([
      created("t1"), state("t1", "running"),
      { kind: "task.continued", source: { taskId: "t1" }, data: { taskId: "t1", attempt: 2 } },
    ]);
    expect(l.task("t1")!.attempts).toHaveLength(1);
    expect(l.anomalies.map((a) => a.code)).toEqual(["task-continue-not-terminal"]);
  });

  test("task.state only transitions along legal edges; others become anomalies", () => {
    const l = replay([
      created("t1"), state("t1", "running"), state("t1", "completed"),
      state("t1", "running"),            // terminal -> running: illegal
      state("ghost", "running"),         // unknown task
    ]);
    expect(l.latest("t1")?.state).toBe("completed");
    expect(l.anomalies.map((a) => a.code).sort()).toEqual(["task-transition-illegal", "task-unknown"]);
  });

  test("ownership-unsettled can later settle to interrupted but not run", () => {
    const l = replay([created("t1"), state("t1", "running"), state("t1", "ownership-unsettled", { reason: "pid-alive" }), state("t1", "running"), state("t1", "interrupted", { reason: "daemon-restart" })]);
    expect(l.latest("t1")).toMatchObject({ state: "interrupted", reason: "daemon-restart" });
  });

  test("duplicate task.created is an anomaly and keeps the first record", () => {
    const l = replay([created("t1"), created("t1", { modelId: "other" })]);
    expect(l.task("t1")!.attempts[0]!.modelId).toBe("m1");
    expect(l.anomalies.map((a) => a.code)).toEqual(["task-duplicate"]);
  });

  test("task.result is stored on the attempt (bounded)", () => {
    const l = replay([created("t1"), state("t1", "running"), state("t1", "completed"), { kind: "task.result", source: { taskId: "t1" }, data: { taskId: "t1", summary: "s".repeat(50_000) } }]);
    expect(l.latest("t1")!.result!.length).toBeLessThanOrEqual(8192);
  });

  test("tracks pending approvals", () => {
    const l = replay([
      created("t1"), state("t1", "running"),
      { kind: "approval.requested", source: { taskId: "t1" }, data: { approvalId: "a1", taskId: "t1", tool: "Bash" } },
      { kind: "approval.requested", source: { taskId: "t1" }, data: { approvalId: "a2", taskId: "t1", tool: "Edit" } },
      { kind: "approval.resolved", source: { taskId: "t1" }, data: { approvalId: "a1", decision: "deny", by: "timeout" } },
    ]);
    expect(l.pendingApprovals().map((a) => a.approvalId)).toEqual(["a2"]);
  });

  test("ignores kinds it does not project", () => {
    const l = replay([{ kind: "message.delta", data: { text: "x" } }, { kind: "usage", data: {} }]);
    expect(l.seq).toBe(2);
    expect(l.anomalies).toEqual([]);
  });

  test("apply enforces contiguous sequence", () => {
    const l = Ledger.empty("s-1");
    const e = (seq: number): SessionEvent => ({ v: 1, sessionId: "s-1", seq, ts: "2026-01-01T00:00:00.000Z", kind: "usage", source: {}, data: {} });
    l.apply(e(1));
    expect(() => l.apply(e(3))).toThrow(/sequence/i);
    expect(() => l.apply({ ...e(2), sessionId: "other" })).toThrow(/session/i);
  });
});

describe("snapshot checkpointing (D-15)", () => {
  const script: EventDraft[] = [
    { kind: "session.created", data: { projectRoot: "/p" } },
    created("t1"), state("t1", "running"), state("t1", "completed"),
    created("t2", { runnerId: "claude", memberId: "lead" }), state("t2", "running"),
  ];
  function setup() {
    const dir = tempDir();
    const log = openLog(dir);
    log.appendMany(script);
    const snap = join(dir, "ledger.snapshot.json");
    return { dir, log, snap };
  }

  test("loads from a valid snapshot and replays only the tail", () => {
    const { log, snap } = setup();
    const full = loadLedger(log, snap);
    expect(full.source).toBe("rebuilt");
    expect(full.rebuildReason).toBe("missing");
    saveLedgerSnapshot(full.ledger, log, snap);
    expect(lstatSync(snap).mode & 0o777).toBe(0o600);
    log.appendMany([state("t2", "completed"), { kind: "message.delta", data: { text: "x" } }]);
    const resumed = loadLedger(log, snap);
    expect(resumed.source).toBe("snapshot");
    expect(resumed.replayed).toBe(2);
    expect(resumed.ledger.toState()).toEqual(loadLedger(log, join(tempDir(), "none.json")).ledger.toState());
    expect(resumed.ledger.latest("t2")?.state).toBe("completed");
    log.close();
  });

  test.each<[string, (s: string) => string, RebuildReason]>([
    ["garbage", (s: string) => "not json{{", "corrupt"],
    ["wrong shape", (s: string) => JSON.stringify({ v: 1 }), "corrupt"],
    ["tampered digest", (s: string) => s.replace(/"completed"/, '"failed"'), "corrupt"],
    ["unknown version", (s: string) => s.replace('"v":4', '"v":99'), "corrupt"],
  ])("snapshot %s triggers a rebuild from the log", (_name, mutate, reason) => {
    const { log, snap } = setup();
    saveLedgerSnapshot(loadLedger(log, snap).ledger, log, snap);
    writeFileSync(snap, mutate(readFileSync(snap, "utf8")));
    const r = loadLedger(log, snap);
    expect(r.source).toBe("rebuilt");
    expect(r.rebuildReason).toBe(reason);
    expect(r.ledger.latest("t1")?.state).toBe("completed");
    log.close();
  });

  test("a snapshot ahead of the log, or from a different log, is rejected", () => {
    const { log, snap } = setup();
    saveLedgerSnapshot(loadLedger(log, snap).ledger, log, snap);
    log.close();
    // different log with the same length but different content
    const dir2 = tempDir();
    const log2 = openLog(dir2);
    log2.appendMany(script.map((d, i) => (i === script.length - 1 ? state("t2", "failed") : d)));
    const mismatch = loadLedger(log2, snap);
    expect(mismatch.source).toBe("rebuilt");
    expect(mismatch.rebuildReason).toBe("log-mismatch");
    expect(mismatch.ledger.latest("t2")?.state).toBe("failed");
    // shorter log
    const dir3 = tempDir();
    const log3 = openLog(dir3);
    log3.appendMany(script.slice(0, 2));
    const ahead = loadLedger(log3, snap);
    expect(ahead.rebuildReason).toBe("ahead-of-log");
    expect(ahead.ledger.seq).toBe(2);
    log2.close(); log3.close();
  });

  test("a rebuilt ledger equals an incrementally applied one (determinism)", () => {
    const { log } = setup();
    const live = Ledger.empty("s-1");
    for (const e of log.readAfter(0)) live.apply(e);
    expect(loadLedger(log, join(tempDir(), "x.json")).ledger.toState()).toEqual(live.toState());
    log.close();
  });

  test("an empty log yields an empty ledger", () => {
    const dir = tempDir();
    const log = openLog(dir);
    const r = loadLedger(log, join(dir, "s.json"));
    expect(r.ledger.seq).toBe(0);
    saveLedgerSnapshot(r.ledger, log, join(dir, "s.json"));
    expect(loadLedger(log, join(dir, "s.json")).source).toBe("snapshot");
    log.close();
  });
});
