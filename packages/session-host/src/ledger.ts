/**
 * Ledger projection over the session event log (XR-3.3, D-12, D-15).
 *
 * The event log is the only durable truth. The ledger is a deterministic fold over it; a
 * snapshot is an optimisation that is verified (digest + log cross-check) and rebuilt on
 * any mismatch.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SessionEvent } from "@deck/core/session/events";
import type { EventLog } from "./event-log";
import { writePrivateFile } from "./paths";

export const LEDGER_SNAPSHOT_VERSION = 1 as const;
const RESULT_LIMIT = 8192;

export const TASK_STATES = ["created", "queued", "running", "completed", "failed", "cancelled", "interrupted", "ownership-unsettled"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "failed", "cancelled", "interrupted"];

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  created: ["queued", "running", "cancelled", "failed", "interrupted"],
  queued: ["running", "cancelled", "failed", "interrupted"],
  running: ["completed", "failed", "cancelled", "interrupted", "ownership-unsettled"],
  "ownership-unsettled": ["interrupted"],
  completed: [], failed: [], cancelled: [], interrupted: [],
};

export type SessionLifecycleState = "created" | "running" | "idle" | "stopping" | "ended" | "recovered";
export type TaskAttempt = {
  attempt: number; runnerId: string; modelId: string; thinking?: string; nativeSessionId?: string;
  state: TaskState; reason?: string; continuity?: "native" | "reseeded"; startedSeq: number; endedSeq?: number; result?: string;
};
/** Native session confirmed by the runner (a `turn.started` was seen): only then may a later turn resume it. */
export type LedgerTask = { taskId: string; memberId: string; attempts: TaskAttempt[]; nativeConfirmed?: boolean };
/** Durable idempotency receipt (XR-1.5): the command's type and its original outcome. */
export type LedgerCommandReceipt = { type: string; outcome: { ok: boolean; [key: string]: unknown } };
export type LedgerPendingApproval = { approvalId: string; taskId?: string; seq: number };
export type LedgerAnomaly = { code: string; seq: number; detail?: string };
export type LedgerSession = { projectRoot?: string; changeId?: string; state: SessionLifecycleState };
export type LedgerState = {
  sessionId: string; seq: number; session: LedgerSession;
  tasks: Record<string, LedgerTask>; approvals: Record<string, LedgerPendingApproval>; anomalies: LedgerAnomaly[];
  /** Accepted commands by commandId, oldest first, bounded by MAX_RECEIPTS. Absent in snapshots written before receipts existed. */
  commands?: Record<string, LedgerCommandReceipt>;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const isTaskState = (v: unknown): v is TaskState => typeof v === "string" && (TASK_STATES as readonly string[]).includes(v);
const MAX_ANOMALIES = 100;
export const MAX_RECEIPTS = 1000;

export class Ledger {
  private constructor(private state: LedgerState) {}

  static empty(sessionId: string): Ledger {
    return new Ledger({ sessionId, seq: 0, session: { state: "created" }, tasks: {}, approvals: {}, anomalies: [], commands: {} });
  }

  static fromState(state: LedgerState): Ledger {
    const copy = structuredClone(state);
    copy.commands ??= {};
    return new Ledger(copy);
  }

  get seq(): number { return this.state.seq; }
  get sessionId(): string { return this.state.sessionId; }
  get session(): Readonly<LedgerSession> { return this.state.session; }
  get anomalies(): readonly LedgerAnomaly[] { return this.state.anomalies; }
  tasks(): LedgerTask[] { return Object.values(this.state.tasks); }
  task(taskId: string): LedgerTask | undefined { return this.state.tasks[taskId]; }
  latest(taskId: string): TaskAttempt | undefined { return this.state.tasks[taskId]?.attempts.at(-1); }
  pendingApprovals(): LedgerPendingApproval[] { return Object.values(this.state.approvals); }
  receipt(commandId: string): LedgerCommandReceipt | undefined { return this.state.commands?.[commandId]; }
  nativeConfirmed(taskId: string): boolean { return this.state.tasks[taskId]?.nativeConfirmed === true; }
  toState(): LedgerState { return structuredClone(this.state); }

  private anomaly(code: string, seq: number, detail?: string): void {
    if (this.state.anomalies.length < MAX_ANOMALIES) this.state.anomalies.push({ code, seq, ...(detail ? { detail } : {}) });
  }

  apply(event: SessionEvent): void {
    if (event.sessionId !== this.state.sessionId) throw new Error(`Ledger session mismatch: ${event.sessionId}`);
    if (event.seq !== this.state.seq + 1) throw new Error(`Ledger sequence violation: expected ${this.state.seq + 1}, got ${event.seq}`);
    this.state.seq = event.seq;
    const d = event.data;
    switch (event.kind) {
      case "session.created":
        this.state.session.projectRoot = str(d.projectRoot) ?? this.state.session.projectRoot;
        if (str(d.changeId) && !this.state.session.changeId) this.state.session.changeId = str(d.changeId);
        break;
      case "session.bound": {
        const changeId = str(d.changeId);
        if (!changeId) return this.anomaly("session-bound-invalid", event.seq);
        if (this.state.session.changeId && this.state.session.changeId !== changeId) return this.anomaly("session-binding-immutable", event.seq, changeId);
        this.state.session.changeId = changeId;
        break;
      }
      case "session.state": {
        const st = str(d.state) as SessionLifecycleState | undefined;
        if (st) this.state.session.state = st;
        break;
      }
      case "session.ended": this.state.session.state = "ended"; break;
      case "session.recovered": this.state.session.state = "recovered"; break;
      case "command.accepted": return this.onCommandAccepted(event);
      case "turn.started": {
        const task = (str(d.taskId) ?? event.source.taskId) ? this.state.tasks[(str(d.taskId) ?? event.source.taskId)!] : undefined;
        if (task) task.nativeConfirmed = true;
        break;
      }
      case "task.created": return this.onTaskCreated(event);
      case "task.state": return this.onTaskState(event);
      case "task.continued": return this.onTaskContinued(event);
      case "task.result": return this.onTaskResult(event);
      case "approval.requested": {
        const id = str(d.approvalId);
        if (id) this.state.approvals[id] = { approvalId: id, ...(str(d.taskId) ? { taskId: str(d.taskId) } : {}), seq: event.seq };
        break;
      }
      case "approval.resolved": {
        const id = str(d.approvalId);
        if (id) delete this.state.approvals[id];
        break;
      }
      default: break;
    }
  }

  private onCommandAccepted(event: SessionEvent): void {
    const d = event.data;
    const commandId = str(d.commandId);
    const outcome = d.outcome;
    if (!commandId || typeof d.type !== "string" || typeof outcome !== "object" || outcome === null || typeof (outcome as { ok?: unknown }).ok !== "boolean") {
      return this.anomaly("command-receipt-invalid", event.seq);
    }
    const commands = (this.state.commands ??= {});
    if (commands[commandId]) return; // first acceptance is the original outcome
    commands[commandId] = { type: d.type, outcome: outcome as LedgerCommandReceipt["outcome"] };
    const ids = Object.keys(commands);
    for (let i = 0; i < ids.length - MAX_RECEIPTS; i++) delete commands[ids[i]!];
  }

  private onTaskCreated(event: SessionEvent): void {
    const d = event.data;
    const taskId = str(d.taskId)!;
    if (this.state.tasks[taskId]) return this.anomaly("task-duplicate", event.seq, taskId);
    const runnerId = str(d.runnerId) ?? event.source.runnerId;
    const modelId = str(d.modelId);
    const memberId = str(d.memberId) ?? event.source.memberId;
    if (!runnerId || !modelId || !memberId) return this.anomaly("task-created-incomplete", event.seq, taskId);
    const initial = isTaskState(d.state) ? d.state : "created";
    this.state.tasks[taskId] = {
      taskId, memberId,
      attempts: [{
        attempt: 1, runnerId, modelId, ...(str(d.thinking) ? { thinking: str(d.thinking) } : {}),
        ...(str(d.nativeSessionId) ? { nativeSessionId: str(d.nativeSessionId) } : {}),
        state: initial, startedSeq: event.seq,
      }],
    };
  }

  private onTaskState(event: SessionEvent): void {
    const d = event.data;
    const taskId = str(d.taskId) ?? event.source.taskId;
    const task = taskId ? this.state.tasks[taskId] : undefined;
    if (!task) return this.anomaly("task-unknown", event.seq, taskId);
    const wanted = d.state;
    if (!isTaskState(wanted)) return this.anomaly("task-state-invalid", event.seq, String(wanted));
    const attempt = task.attempts.at(-1)!;
    if (wanted !== attempt.state && !TRANSITIONS[attempt.state].includes(wanted)) return this.anomaly("task-transition-illegal", event.seq, `${attempt.state}->${wanted}`);
    if (wanted === attempt.state && TERMINAL_TASK_STATES.includes(wanted)) return;
    // a native id may be learned while the attempt is live, including a same-state update
    const native = str(d.nativeSessionId) ?? event.source.nativeSessionId;
    if (native) attempt.nativeSessionId = native;
    if (wanted !== attempt.state) {
      attempt.state = wanted;
      if (str(d.reason)) attempt.reason = str(d.reason); else delete attempt.reason;
      if (TERMINAL_TASK_STATES.includes(wanted)) attempt.endedSeq = event.seq;
    }
  }

  private onTaskContinued(event: SessionEvent): void {
    const d = event.data;
    const taskId = str(d.taskId) ?? event.source.taskId;
    const task = taskId ? this.state.tasks[taskId] : undefined;
    if (!task) return this.anomaly("task-unknown", event.seq, taskId);
    const previous = task.attempts.at(-1)!;
    if (!TERMINAL_TASK_STATES.includes(previous.state)) return this.anomaly("task-continue-not-terminal", event.seq, taskId);
    const attemptNo = Number.isInteger(d.attempt) ? (d.attempt as number) : previous.attempt + 1;
    if (attemptNo !== previous.attempt + 1) return this.anomaly("task-attempt-out-of-order", event.seq, String(attemptNo));
    const continuity = d.continuity === "reseeded" ? "reseeded" : "native";
    if (continuity === "reseeded") task.nativeConfirmed = false;
    // D-12: runner/model/thinking come from the recorded attempt, never from current config.
    task.attempts.push({
      attempt: attemptNo, runnerId: previous.runnerId, modelId: previous.modelId,
      ...(previous.thinking ? { thinking: previous.thinking } : {}),
      ...(str(d.nativeSessionId) ? { nativeSessionId: str(d.nativeSessionId) } : {}),
      state: "created", continuity, startedSeq: event.seq,
    });
  }

  private onTaskResult(event: SessionEvent): void {
    const d = event.data;
    const taskId = str(d.taskId) ?? event.source.taskId;
    const attempt = taskId ? this.state.tasks[taskId]?.attempts.at(-1) : undefined;
    if (!attempt) return this.anomaly("task-unknown", event.seq, taskId);
    const summary = typeof d.summary === "string" ? d.summary : undefined;
    if (summary !== undefined) attempt.result = summary.slice(0, RESULT_LIMIT);
  }
}

// ---- snapshots ----------------------------------------------------------------------------

type SnapshotFile = { v: 1; seq: number; eventDigest: string; digest: string; state: LedgerState };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const eventDigest = (event: SessionEvent) => sha256(JSON.stringify(event));
const stateDigest = (seq: number, eventHash: string, state: LedgerState) => sha256(JSON.stringify({ seq, eventHash, state }));

export type RebuildReason = "missing" | "corrupt" | "ahead-of-log" | "log-mismatch";
export type LoadedLedger = { ledger: Ledger; source: "snapshot" | "rebuilt"; rebuildReason?: RebuildReason; replayed: number };

function readSnapshot(file: string): SnapshotFile | "missing" | "corrupt" {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt"; }
  try {
    const v = JSON.parse(text) as Partial<SnapshotFile>;
    const ok = v && v.v === LEDGER_SNAPSHOT_VERSION && Number.isInteger(v.seq) && typeof v.eventDigest === "string"
      && typeof v.digest === "string" && v.state && typeof v.state === "object" && v.state.seq === v.seq
      && typeof v.state.tasks === "object" && typeof v.state.session === "object";
    if (!ok) return "corrupt";
    if (stateDigest(v.seq!, v.eventDigest!, v.state!) !== v.digest) return "corrupt";
    return v as SnapshotFile;
  } catch { return "corrupt"; }
}

/** Load the ledger from a verified snapshot plus the log tail, or rebuild it from the whole log. */
export function loadLedger(log: EventLog, snapshotFile: string): LoadedLedger {
  const rebuild = (reason: RebuildReason): LoadedLedger => {
    const ledger = Ledger.empty(log.sessionId);
    let replayed = 0;
    for (const event of log.readAfter(0)) { ledger.apply(event); replayed++; }
    return { ledger, source: "rebuilt", rebuildReason: reason, replayed };
  };
  const snap = readSnapshot(snapshotFile);
  if (snap === "missing" || snap === "corrupt") return rebuild(snap);
  if (snap.state.sessionId !== log.sessionId) return rebuild("log-mismatch");
  if (snap.seq > log.lastSeq) return rebuild("ahead-of-log");
  if (snap.seq > 0) {
    const at = log.readAfter(snap.seq - 1).next().value;
    if (!at || at.seq !== snap.seq || eventDigest(at) !== snap.eventDigest) return rebuild("log-mismatch");
  }
  const ledger = Ledger.fromState(snap.state);
  let replayed = 0;
  for (const event of log.readAfter(snap.seq)) { ledger.apply(event); replayed++; }
  return { ledger, source: "snapshot", replayed };
}

/** Atomically checkpoint the ledger (must be current with the log head or a prefix of it). */
export function saveLedgerSnapshot(ledger: Ledger, log: EventLog, snapshotFile: string): void {
  const seq = ledger.seq;
  let hash = sha256("");
  if (seq > 0) {
    const at = log.readAfter(seq - 1).next().value;
    if (!at || at.seq !== seq) throw new Error(`Cannot snapshot ledger at seq ${seq}: event missing from log`);
    hash = eventDigest(at);
  }
  const state = ledger.toState();
  const file: SnapshotFile = { v: LEDGER_SNAPSHOT_VERSION, seq, eventDigest: hash, digest: stateDigest(seq, hash, state), state };
  writePrivateFile(snapshotFile, JSON.stringify(file));
}
