import type { Question } from "@deck/core/session/question";
/**
 * Ledger projection over the session event log (XR-3.3, D-12, D-15).
 *
 * The event log is the only durable truth. The ledger is a deterministic fold over it; a
 * snapshot is an optimisation that is verified (digest + log cross-check) and rebuilt on
 * any mismatch.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ImageAttachment } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";
import type { CrossTeamAssignments } from "@deck/core/session/assignments";
import type { EventLog } from "./event-log";
import { writePrivateFile } from "./paths";

export const LEDGER_SNAPSHOT_VERSION = 4 as const;
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
export type LedgerPendingQuestion = { questionId: string; taskId?: string; tool?: string; questions: Question[]; seq: number };
export type LedgerPendingApproval = { approvalId: string; taskId?: string; seq: number };
export type LedgerAnomaly = { code: string; seq: number; detail?: string };
export type SessionHandoff = { text: string; sourceSessionId: string; sourceGeneration: number; sourceSeq: number; continuity: "reseeded" };
export type LedgerSession = { projectRoot?: string; changeId?: string; state: SessionLifecycleState; generation?: number; assignmentRevision?: number; memberOverrides?: CrossTeamAssignments; handoff?: SessionHandoff; stopRequested?: boolean; released?: boolean; releasePending?: boolean; releaseEpoch?: number; removalPending?: boolean; removed?: boolean; releaseFailure?: string; title?: string };
export type UserPrompt = {
  promptId: string; state: "queued" | "dispatched" | "completed" | "failed" | "interrupted" | "cancelled" | "ownership-unsettled";
  text?: string; textHash: string; by: string; generation: number; createdAt: string; seq: number;
  position: number; taskId?: string; attempt?: number; reason?: string;
  dispatchedSeq?: number;
  /** Retained after cancellation/dispatch for history and managed-file ownership. */
  attachments?: ImageAttachment[];
};
export type LedgerState = {
  sessionId: string; seq: number; session: LedgerSession;
  questions?: Record<string, LedgerPendingQuestion>;
  tasks: Record<string, LedgerTask>; approvals: Record<string, LedgerPendingApproval>; anomalies: LedgerAnomaly[];
  /** Accepted commands by commandId, oldest first, bounded by MAX_RECEIPTS. Absent in snapshots written before receipts existed. */
  commands?: Record<string, LedgerCommandReceipt>;
  lifecycleCommands?: Record<string, LedgerCommandReceipt & {fingerprint: string}>;
  /** Latest finalized public assistant response from any actual Lead generation. */
  lastLeadReplySeq?: number;
  lastEventTs?: string;
  prompts?: Record<string, UserPrompt>;
  promptQueue?: { paused: boolean; reason?: string; lastResumeSeq?: number };
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const isTaskState = (v: unknown): v is TaskState => typeof v === "string" && (TASK_STATES as readonly string[]).includes(v);
const MAX_ANOMALIES = 100;
export const MAX_RECEIPTS = 1000;

export class Ledger {
  private constructor(private state: LedgerState) {}

  static empty(sessionId: string): Ledger {
    return new Ledger({ sessionId, seq: 0, session: { state: "created" }, tasks: {}, approvals: {}, anomalies: [], commands: {}, lifecycleCommands: {}, lastLeadReplySeq: 0, prompts: {}, promptQueue: { paused: false } });
  }

  static fromState(state: LedgerState): Ledger {
    const copy = structuredClone(state);
    copy.commands ??= {}; copy.lifecycleCommands ??= {};
    copy.lastLeadReplySeq ??= 0;
    copy.prompts ??= {}; copy.promptQueue ??= { paused: false };
    return new Ledger(copy);
  }

  get seq(): number { return this.state.seq; }
  get sessionId(): string { return this.state.sessionId; }
  get session(): Readonly<LedgerSession> { return this.state.session; }
  get lastLeadReplySeq(): number { return this.state.lastLeadReplySeq ?? 0; }
  get lastEventTs(): string | undefined { return this.state.lastEventTs; }
  get promptQueue(): Readonly<{ paused: boolean; reason?: string; lastResumeSeq?: number }> { return this.state.promptQueue ?? { paused: false }; }
  prompts(): UserPrompt[] { return Object.values(this.state.prompts ?? {}).sort((a, b) => a.seq - b.seq); }
  prompt(promptId: string): UserPrompt | undefined { return this.state.prompts?.[promptId]; }
  get anomalies(): readonly LedgerAnomaly[] { return this.state.anomalies; }
  tasks(): LedgerTask[] { return Object.values(this.state.tasks); }
  task(taskId: string): LedgerTask | undefined { return this.state.tasks[taskId]; }
  latest(taskId: string): TaskAttempt | undefined { return this.state.tasks[taskId]?.attempts.at(-1); }
  pendingQuestions(): LedgerPendingQuestion[] { return Object.values(this.state.questions ?? {}); }
  pendingApprovals(): LedgerPendingApproval[] { return Object.values(this.state.approvals); }
  lifecycleReceipt(commandId: string) { return this.state.lifecycleCommands?.[commandId]; }
  receipt(commandId: string): LedgerCommandReceipt | undefined { return this.state.commands?.[commandId]; }
  nativeConfirmed(taskId: string): boolean { return this.state.tasks[taskId]?.nativeConfirmed === true; }
  toState(): LedgerState { return structuredClone(this.state); }

  private onLifecycle(event: SessionEvent, type: string, fingerprint: string): void {
    const d=event.data; if(!str(d.commandId) || !d.outcome || typeof d.outcome!=="object") return;
    const commands=this.state.lifecycleCommands??={};
    commands[String(d.commandId)]??={type,fingerprint,outcome:structuredClone(d.outcome) as LedgerCommandReceipt["outcome"]};
  }

  private anomaly(code: string, seq: number, detail?: string): void {
    if (this.state.anomalies.length < MAX_ANOMALIES) this.state.anomalies.push({ code, seq, ...(detail ? { detail } : {}) });
  }

  apply(event: SessionEvent): void {
    if (event.sessionId !== this.state.sessionId) throw new Error(`Ledger session mismatch: ${event.sessionId}`);
    if (event.seq !== this.state.seq + 1) throw new Error(`Ledger sequence violation: expected ${this.state.seq + 1}, got ${event.seq}`);
    this.state.seq = event.seq;
    this.state.lastEventTs = event.ts;
    const d = event.data;
    if(event.kind==="diagnostic" && d.code==="session.preparation" && d.commandId && d.outcome) this.onLifecycle(event,"session.prepare","");
    switch (event.kind) {
      case "prompt.queued": {
        const promptId = str(d.promptId);
        if (!promptId || typeof d.text !== "string" || typeof d.textHash !== "string") return this.anomaly("prompt-queued-invalid", event.seq);
        const prompts = this.state.prompts ??= {};
        prompts[promptId] ??= { promptId, state: "queued", text: d.text, textHash: d.textHash, by: str(d.by) ?? "unknown", generation: Number(d.generation) || 0, position: Number(d.position) || 1, createdAt: event.ts, seq: event.seq, ...(Array.isArray(d.attachments) ? { attachments: structuredClone(d.attachments) as ImageAttachment[] } : {}) };
        break;
      }
      case "prompt.dispatched": {
        const prompt = this.state.prompts?.[String(d.promptId)];
        if (prompt && (prompt.state === "queued" || d.reseeded === true)) { prompt.state = "dispatched"; prompt.taskId = str(d.taskId); prompt.attempt = Number(d.attempt); prompt.dispatchedSeq = event.seq; delete prompt.text; }
        break;
      }
      case "prompt.state": {
        const prompt = this.state.prompts?.[String(d.promptId)];
        if (prompt && ["completed", "failed", "interrupted", "cancelled", "ownership-unsettled"].includes(d.state as string)) {
          prompt.state = d.state as UserPrompt["state"]; if (str(d.reason)) prompt.reason = str(d.reason); delete prompt.text;
        }
        break;
      }
      case "prompt.queue": {
        const resumed = this.state.promptQueue?.paused && d.paused === false;
        this.state.promptQueue = { paused: d.paused === true, ...(str(d.reason) ? { reason: str(d.reason) } : {}), ...(resumed ? { lastResumeSeq: event.seq } : this.state.promptQueue?.lastResumeSeq ? { lastResumeSeq: this.state.promptQueue.lastResumeSeq } : {}) };
        if (str(d.commandId)) this.onCommandAccepted({ ...event, data: { commandId: d.commandId, type: "prompt.resume", outcome: { ok: true } } });
        break;
      }
      case "session.created":
        this.state.session.projectRoot = str(d.projectRoot) ?? this.state.session.projectRoot;
        if (str(d.changeId) && !this.state.session.changeId) this.state.session.changeId = str(d.changeId);
        if (d.memberOverrides && typeof d.memberOverrides === "object") this.state.session.memberOverrides = structuredClone(d.memberOverrides) as CrossTeamAssignments;
        if (d.handoff && typeof d.handoff === "object") this.state.session.handoff = structuredClone(d.handoff) as SessionHandoff;
        break;
      case "session.assignment":
        this.state.session.generation = d.generation as number;
        this.state.session.assignmentRevision = d.revision as number;
        this.state.session.memberOverrides = structuredClone(d.memberOverrides) as CrossTeamAssignments;
        if (d.handoff && typeof d.handoff === "object") this.state.session.handoff = structuredClone(d.handoff) as SessionHandoff;
        break;
      case "session.released": {
        const epoch=Number(d.epoch); if(!Number.isSafeInteger(epoch) || epoch<0) break;
        if(epoch < (this.state.session.releaseEpoch??0)) break;
        this.state.session.releaseEpoch=epoch; this.state.session.released=true;
        this.state.session.releasePending=d.phase!=="released";
        if(str(d.reasonCode)) this.state.session.releaseFailure=String(d.reasonCode); else delete this.state.session.releaseFailure;
        this.state.promptQueue={paused:true,reason:"session-released",...(this.state.promptQueue?.lastResumeSeq ? {lastResumeSeq:this.state.promptQueue.lastResumeSeq} : {})};
        if(str(d.commandId) && d.outcome) this.onLifecycle(event,"session.release","");
        break;
      }
      case "session.reopened": {
        if(Number(d.epoch)!==(this.state.session.releaseEpoch??0)) break;
        this.state.session.state="idle"; this.state.session.stopRequested=false;
        this.state.session.released=d.prepared!==true; this.state.session.releasePending=false;
        if(d.prepared===true && !Object.values(this.state.prompts??{}).some(prompt=>prompt.state==="queued")) this.state.promptQueue={paused:false}; delete this.state.session.releaseFailure;
        break;
      }
      case "session.renamed": {
        if(typeof d.title!=="string") break;
        this.state.session.title=d.title; this.onLifecycle(event,"session.rename",JSON.stringify(d.title)); break;
      }
      case "session.removed": {
        this.state.session.removalPending=d.phase!=="removed"; this.state.session.removed=d.phase==="removed";
        if(d.phase==="removing") {
          this.state.session.released=true;this.state.session.releasePending=true;this.state.session.releaseEpoch=Number(d.epoch)||((this.state.session.releaseEpoch??0)+1);
          this.state.promptQueue={paused:true,reason:"session-released"};
          this.onLifecycle(event,"session.remove","");
        }
        break;
      }
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
        if (d.cancelPrompts === true) {
          this.state.session.stopRequested = true;
          for (const prompt of Object.values(this.state.prompts ?? {})) if (prompt.state === "queued") { prompt.state = "cancelled"; prompt.reason = "session-stopped"; delete prompt.text; }
          if (str(d.commandId) && d.outcome) { this.onLifecycle(event,"session.stop",""); this.onCommandAccepted({ ...event, data: { commandId: d.commandId, type: "session.stop", outcome: d.outcome } }); }
        }
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
      case "message.completed": {
        const task = event.source.taskId ? this.state.tasks[event.source.taskId] : undefined;
        if (task?.memberId === "lead" && /^lead(?:-g[1-9]\d*)?$/.test(task.taskId) && (event.source.memberId === undefined || event.source.memberId === "lead") && event.data.role === "assistant" && !event.data.internal && typeof event.data.text === "string" && event.data.text.trim()) this.state.lastLeadReplySeq = event.seq;
        break;
      }
      case "question.requested": {
        const id = str(d.questionId);
        if (id) Object.defineProperty(this.state.questions ??= {}, id, { enumerable: true, configurable: true, writable: true, value: { questionId: id, ...(str(d.taskId) ? { taskId: str(d.taskId) } : {}), ...(str(d.tool) ? { tool: str(d.tool) } : {}), questions: structuredClone(d.questions as Question[]), seq: event.seq } });
        break;
      }
      case "question.resolved": {
        const id = str(d.questionId);
        if (id && this.state.questions) delete this.state.questions[id];
        break;
      }
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
    const queuedPrompt = str(d.promptId) ? this.state.prompts?.[d.promptId as string] : undefined;
    if (queuedPrompt?.state === "queued") { queuedPrompt.taskId = taskId; queuedPrompt.attempt = 1; }
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
    for (const prompt of Object.values(this.state.prompts ?? {})) {
      if (prompt.state !== "dispatched" || prompt.taskId !== taskId || prompt.attempt !== attempt.attempt) continue;
      if (wanted === "failed" && d.reason === "native-session-not-found") continue;
      if (TERMINAL_TASK_STATES.includes(wanted) || wanted === "ownership-unsettled") {
        prompt.state = wanted as UserPrompt["state"];
        if (["failed", "interrupted", "ownership-unsettled"].includes(wanted) && !(wanted === "interrupted" && (this.state.promptQueue?.lastResumeSeq ?? 0) > (prompt.dispatchedSeq ?? 0))) this.state.promptQueue = { paused: true, reason: wanted, lastResumeSeq: this.state.promptQueue?.lastResumeSeq };
      }
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
    const queuedPrompt = str(d.promptId) ? this.state.prompts?.[d.promptId as string] : undefined;
    if (queuedPrompt?.state === "queued") { queuedPrompt.taskId = taskId; queuedPrompt.attempt = attemptNo; }
    if (continuity === "reseeded") for (const prompt of Object.values(this.state.prompts ?? {})) if (prompt.state === "dispatched" && prompt.taskId === taskId && prompt.attempt === previous.attempt) prompt.attempt = attemptNo;
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

type SnapshotFile = { v: 4; seq: number; eventDigest: string; digest: string; state: LedgerState };
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
      && typeof v.state.tasks === "object" && typeof v.state.session === "object"
      && v.state.lifecycleCommands && typeof v.state.lifecycleCommands === "object"
      && v.state.prompts && typeof v.state.prompts === "object" && typeof v.state.promptQueue?.paused === "boolean"
      && Number.isSafeInteger(v.state.lastLeadReplySeq) && v.state.lastLeadReplySeq! >= 0 && v.state.lastLeadReplySeq! <= v.seq!
      && (v.seq === 0 || typeof v.state.lastEventTs === "string");
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
