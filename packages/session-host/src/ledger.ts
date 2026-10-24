import { byteExcerpt } from "./task-handoff";
import { projectTaskEvidence, type TaskContinuityState, type AttemptContinuityState } from "./task-evidence";
import { isSessionGrantKind, isApprovalToolKey, isApprovalRisk, type SessionGrant } from "@deck/core/session/approval";
import { isApprovalMode, type ApprovalMode } from "@deck/core/session/commands";
import type { Question } from "@deck/core/session/question";
import type {SteeringFence} from "@deck/core/session/steering";
import { decisionFingerprint } from "./mutation-identity";
import type { Decision, DecisionReply, DecisionTarget, DecisionDependencies, DurableDecisionCommand } from "@deck/core/session/decisions";
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
import type { TaskIntegrationState } from "@deck/core/session/mcp";
import type { SessionEvent } from "@deck/core/session/events";
import type { CrossTeamAssignments } from "@deck/core/session/assignments";
import type { EventLog, EventDraft } from "./event-log";
import { writePrivateFile } from "./paths";

export const LEDGER_SNAPSHOT_VERSION = 16 as const;
const RESULT_LIMIT = 8192;
const isRestartPause = (reason?: string): boolean => reason === "daemon-stopped" || reason === "daemon-restart" || reason?.startsWith("web-restart-forced:") === true;

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
export type AttemptAccounting = { seq: number; leadTaskId: string; leadAttempt: number; promptId?: string };
export type TaskIntegration = AttemptAccounting & { commandId: string; state: TaskIntegrationState; note: string; evidenceSeqs: number[]; findingResolutions?: import("@deck/core/session/task-handoff").FindingResolution[] };
export type ContinuityBlock = { promptId: string; taskId: string; attempt: number; startedSeq: number; answer?: string; answerTruncated?: boolean; answerSeq?: number };
export type TaskAttempt = AttemptContinuityState & {
  attempt: number; runnerId: string; modelId: string; thinking?: string; nativeSessionId?: string;
  state: TaskState; reason?: string; continuity?: "native" | "reseeded"; startedSeq: number; endedSeq?: number; unsettledSeq?: number; result?: string; resultSeq?: number; resultTruncated?: boolean;
  delivery?: AttemptAccounting; retrieval?: AttemptAccounting; integration?: TaskIntegration; integrations?: TaskIntegration[];
};
/** Native session confirmed by the runner (a `turn.started` was seen): only then may a later turn resume it. */
export type LeadRecoveryMessage = {role:"user"|"assistant";text:string;seq:number;truncated:boolean};
export type LedgerTask = DecisionDependencies & TaskContinuityState & { leadRecovery?:{original?:LeadRecoveryMessage;recent:LeadRecoveryMessage[]}; taskId: string; memberId: string; attempts: TaskAttempt[]; nativeConfirmed?: boolean };
/** Durable idempotency receipt (XR-1.5): the command's type and its original outcome. */
export type LedgerCommandReceipt = { type: string; outcome: { ok: boolean; [key: string]: unknown } };
export type LedgerPendingQuestion = { questionId: string; taskId?: string; tool?: string; questions: Question[]; seq: number };
export type LedgerPendingApproval = { approvalId: string; taskId?: string; seq: number };
export type LedgerAnomaly = { code: string; seq: number; detail?: string };
export type SessionHandoff = { text: string; sourceSessionId: string; sourceGeneration: number; sourceSeq: number; continuity: "reseeded" };
export type LedgerSession = { approvals?: ApprovalMode; projectRoot?: string; changeId?: string; state: SessionLifecycleState; generation?: number; assignmentRevision?: number; memberOverrides?: CrossTeamAssignments; handoff?: SessionHandoff; stopRequested?: boolean; released?: boolean; releasePending?: boolean; releaseEpoch?: number; removalPending?: boolean; removed?: boolean; releaseFailure?: string; releaseFailureSeq?: number; title?: string };
export type UserPrompt = {
  promptId: string; state: "queued" | "steering" | "unknown" | "accepted" | "dispatched" | "completed" | "failed" | "interrupted" | "cancelled" | "ownership-unsettled";
  text?: string; textHash: string; by: string; generation: number; createdAt: string; seq: number;
  position: number; taskId?: string; attempt?: number; reason?: string;
  /** First genuine admission is authority age; retries never refresh it. Absent means unproven. */
  firstAdmissionSeq?: number;
  /** Latest execution dispatch, with taskId/attempt tracking a possible native reseed. */
  dispatchedSeq?: number;
  handoff?: {state:"pending"|"sending"|"delivered"|"unknown";seq:number;evidence?:string};
  requeuedSeq?: number;
  gated?: boolean;
  delivery?: "current-turn";
  requestedSteering?: {taskId:string;attempt:number;nativeThreadId:string;nativeTurnId:string};
  steering?: SteeringFence & {seq:number;state:"pending"|"accepted"|"unknown"|"not-accepted";eligible:boolean;stale:boolean;reason?:string;queueFallback?:boolean};
  /** Retained after cancellation/dispatch for history and managed-file ownership. */
  decisionTarget?: DecisionTarget; targetQuestionRevision?: number;
  attachments?: ImageAttachment[];
};
export type LedgerState = {
  sessionId: string; seq: number; session: LedgerSession;
  grants?: SessionGrant[];
  questions?: Record<string, LedgerPendingQuestion>;
  tasks: Record<string, LedgerTask>; approvals: Record<string, LedgerPendingApproval>; anomalies: LedgerAnomaly[];
  /** Accepted commands by commandId, oldest first, bounded by MAX_RECEIPTS. Absent in snapshots written before receipts existed. */
  commands?: Record<string, LedgerCommandReceipt>;
  lifecycleCommands?: Record<string, LedgerCommandReceipt & {fingerprint: string}>;
  decisions?: Record<string, Decision>;
  mutationIdentities?: Record<string, { type: string; fingerprint?: string }>;
  decisionCommands?: Record<string, DurableDecisionCommand>;
  decisionVersions?: Record<string, Record<number, number>>;
  continuityBlock?: ContinuityBlock;
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

  /** Return a durable repair event; replay itself never invents queue transitions. */
  restartQueueRepair(reason: string): EventDraft | undefined {
    if (!this.promptQueue.paused || !isRestartPause(this.promptQueue.reason)) return;
    const resumed = this.promptQueue.lastResumeSeq ?? 0;
    if (this.prompts().some(prompt => prompt.state === "queued" || ["failed", "interrupted", "ownership-unsettled", "dispatched", "steering", "unknown"].includes(prompt.state) || prompt.state === "cancelled" && isRestartPause(prompt.reason) && prompt.seq > resumed)) return;
    if (this.tasks().some(task => {
      const attempt = task.attempts.at(-1);
      return attempt && (["created", "queued", "running", "ownership-unsettled"].includes(attempt.state) || task.memberId === "lead" && ["failed", "interrupted"].includes(attempt.state) && (attempt.endedSeq ?? attempt.startedSeq) > resumed);
    })) return;
    return { kind: "prompt.queue", data: { paused: false, reason } };
  }

  get seq(): number { return this.state.seq; }
  get sessionId(): string { return this.state.sessionId; }
  get session(): Readonly<LedgerSession> { return this.state.session; }
  decisions(): Decision[] { return Object.values(this.state.decisions ?? {}); }
  decision(id: string): Decision | undefined { return this.state.decisions?.[id]; }
  mutationIdentity(id: string): {type: string; fingerprint?: string} | undefined {
    return this.state.mutationIdentities?.[id] ?? (this.prompt(id) ? {type:"prompt.send"} : undefined) ?? (this.lifecycleReceipt(id) ? {type:this.lifecycleReceipt(id)!.type} : undefined);
  }
  decisionCommand(id: string): DurableDecisionCommand | undefined { return this.state.decisionCommands?.[id]; }
  questionVersion(id: string, version: number): number | undefined { return this.state.decisionVersions?.[id]?.[version]; }
  get continuityBlock(): Readonly<ContinuityBlock> | undefined { return this.state.continuityBlock; }
  get lastLeadReplySeq(): number { return this.state.lastLeadReplySeq ?? 0; }
  get lastEventTs(): string | undefined { return this.state.lastEventTs; }
  get promptQueue(): Readonly<{ paused: boolean; reason?: string; lastResumeSeq?: number }> { return this.state.promptQueue ?? { paused: false }; }
  prompts(): UserPrompt[] { return Object.values(this.state.prompts ?? {}).sort((a, b) => (a.state === "queued" && a.requeuedSeq ? -a.requeuedSeq : a.seq) - (b.state === "queued" && b.requeuedSeq ? -b.requeuedSeq : b.seq)); }
  prompt(promptId: string): UserPrompt | undefined { return this.state.prompts?.[promptId]; }
  get anomalies(): readonly LedgerAnomaly[] { return this.state.anomalies; }
  tasks(): LedgerTask[] { return Object.values(this.state.tasks); }
  task(taskId: string): LedgerTask | undefined { return this.state.tasks[taskId]; }
  latest(taskId: string): TaskAttempt | undefined { return this.state.tasks[taskId]?.attempts.at(-1); }
  pendingQuestions(): LedgerPendingQuestion[] { return Object.values(this.state.questions ?? {}); }
  grants(): SessionGrant[] { return structuredClone(this.state.grants ?? []); }
  pendingApprovals(): LedgerPendingApproval[] { return Object.values(this.state.approvals); }
  lifecycleReceipt(commandId: string) { return this.state.lifecycleCommands?.[commandId]; }
  receipt(commandId: string): LedgerCommandReceipt | undefined { return this.state.commands?.[commandId]; }
  nativeConfirmed(taskId: string): boolean { return this.state.tasks[taskId]?.nativeConfirmed === true; }
  toState(): LedgerState { return structuredClone(this.state); }

  private recordDecisionCommand(value: unknown): void {
    const command = value as DurableDecisionCommand | undefined;
    if (command?.commandId) {
      (this.state.decisionCommands ??= {})[command.commandId] ??= structuredClone(command);
      (this.state.mutationIdentities ??= {})[command.commandId] ??= {type:command.type,fingerprint:command.fingerprint};
    }
  }
  private onDecisionReply(data: Record<string, unknown>): void {
    const reply = data as unknown as DecisionReply;
    const decision = this.decision(reply.decisionId), prompt = this.prompt(reply.promptId);
    if (prompt?.handoff && prompt.handoff.state !== "delivered") return;
    if (!decision || !prompt?.dispatchedSeq || prompt.taskId !== reply.taskId || prompt.attempt !== reply.attempt || prompt.decisionTarget?.decisionId !== decision.decisionId) return;
    if (!decision.replies.some(r => r.promptId === reply.promptId)) decision.replies.push({ ...structuredClone(reply), admittedSeq: prompt.handoff?.state === "delivered" ? prompt.handoff.seq : prompt.dispatchedSeq });
  }

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
    const evidenceTask = this.task(String(d.taskId ?? event.source.taskId ?? ''));
    if(evidenceTask && event.kind !== 'task.continued') projectTaskEvidence(evidenceTask,event);
    switch (event.kind) {
      case "decision.command": this.recordDecisionCommand(d.command); break;
      case "decision.opened": case "decision.revised": case "decision.state": {
        const decision = structuredClone(d.decision) as Decision;
        const prior = this.decision(decision.decisionId);
        if (prior ? decision.revision !== prior.revision + 1 : decision.revision !== 1) return this.anomaly("decision-revision-invalid", event.seq);
        decision.replies = prior?.replies ?? [];
        if (event.kind === "decision.opened") for (const taskId of decision.relatedTaskIds) {
          const task = this.task(taskId);
          if (task && task.memberId !== "lead") task.dependsOn = [...new Set([...(task.dependsOn ?? []), decision.decisionId])];
        }
        (this.state.decisions ??= {})[decision.decisionId] = decision;
        ((this.state.decisionVersions ??= {})[decision.decisionId] ??= {})[decision.revision] = decision.questionRevision;
        this.recordDecisionCommand(d.command); break;
      }
      case "decision.reply": this.onDecisionReply(d); break;
      case "task.delivery": case "task.retrieval": case "task.integration": {
        const task = this.task(String(d.taskId));
        const attempt = task?.attempts.find(a => a.attempt === d.attempt);
        if (!attempt || task?.memberId === "lead" || !TERMINAL_TASK_STATES.includes(attempt.state)) return this.anomaly("task-accounting-invalid", event.seq);
        const accounting: AttemptAccounting = { seq: event.seq, leadTaskId: String(d.leadTaskId), leadAttempt: Number(d.leadAttempt), ...(str(d.promptId) ? { promptId: String(d.promptId) } : {}) };
        if (event.kind === "task.delivery") attempt.delivery ??= accounting;
        else if (event.kind === "task.retrieval") attempt.retrieval ??= accounting;
        else {
          const integration: TaskIntegration = { ...accounting, commandId: String(d.commandId), state: d.state as TaskIntegration["state"], note: String(d.note), evidenceSeqs: [...d.evidenceSeqs as number[]] };
          if(d.structuredUpdates && typeof d.structuredUpdates==='object') for(const [id,update] of Object.entries(d.structuredUpdates)) {
            const target=this.task(id);if(!target)continue;
            Object.assign(target,structuredClone(update));target.structuredSeq=event.seq;target.structuredActor={taskId:accounting.leadTaskId,attempt:accounting.leadAttempt};
            for(const value of Object.values(target.findingStates??{}))if(value.seq===0)value.seq=event.seq;
          }
          if(d.findingResolutions) Object.assign(integration,{findingResolutions:structuredClone(d.findingResolutions)});
          (this.state.mutationIdentities ??= {})[integration.commandId] ??= {type:"deck_task_integrate",fingerprint:decisionFingerprint("deck_task_integrate",Object.fromEntries(["commandId","taskId","attempt","state","note","evidenceSeqs", ...(d.findingResolutions === undefined ? [] : ["findingResolutions"])].map(k=>[k,d[k]])))};
          const records = attempt.integrations ??= [];
          if (!records.some(r => r.commandId === integration.commandId)) { records.push(integration); attempt.integration = integration; }
        }
        break;
      }
      case "diagnostic": {
        // Old host delivery fences must still suppress known deliveries after upgrading.
        if (d.code === "lead.notices-delivered" && event.source.memberId === undefined && event.source.runnerId === undefined && Array.isArray(d.notices)) for (const notice of d.notices) {
          const attempt = this.task(notice.taskId)?.attempts.find(a => a.attempt === notice.attempt);
          if (attempt) attempt.delivery ??= { seq: event.seq, leadTaskId: event.source.taskId ?? "lead", leadAttempt: Number(d.leadAttempt) || 0, ...(str(d.promptId) ? { promptId: String(d.promptId) } : {}) };
        }
        break;
      }
      case "prompt.queued": {
        const promptId = str(d.promptId);
        if (!promptId || typeof d.text !== "string" || typeof d.textHash !== "string") return this.anomaly("prompt-queued-invalid", event.seq);
        const prompts = this.state.prompts ??= {};
        prompts[promptId] ??= { promptId, state: "queued", ...(d.gated===true ? {gated:true} : {}), text: d.text, textHash: d.textHash, ...(d.requestedSteering ? {requestedSteering:structuredClone(d.requestedSteering) as UserPrompt["requestedSteering"]} : {}), ...(d.delivery === "current-turn" ? {delivery:"current-turn" as const} : {}), by: str(d.by) ?? "unknown", generation: Number(d.generation) || 0, ...(d.decisionTarget ? { decisionTarget: structuredClone(d.decisionTarget) as DecisionTarget, ...(Number.isSafeInteger(d.targetQuestionRevision) ? { targetQuestionRevision: Number(d.targetQuestionRevision) } : {}) } : {}), position: Number(d.position) || 1, createdAt: event.ts, seq: event.seq, ...(Array.isArray(d.attachments) ? { attachments: structuredClone(d.attachments) as ImageAttachment[] } : {}) };
        break;
      }
      case "prompt.steering": {
        const prompt=this.prompt(String(d.promptId));
        if(!prompt || prompt.state!=="queued" || prompt.by==="daemon" || prompt.attachments?.length) return this.anomaly("steering-fence-invalid",event.seq);
        prompt.state="steering";prompt.taskId=String(d.taskId);prompt.attempt=Number(d.attempt);
        prompt.steering={...structuredClone(d) as SteeringFence,seq:event.seq,state:"pending",eligible:false,stale:false};break;
      }
      case "prompt.steered": {
        const prompt=this.prompt(String(d.promptId)),fence=prompt?.steering;
        if(!prompt || !fence || fence.seq!==d.steeringSeq || fence.state==="accepted" || fence.state==="not-accepted") break;
        if(d.state==="not-accepted") {
          // Refusal alone cannot restore FIFO after the pending barrier was released.
          // Older results without explicit permission are historical non-delivery.
          fence.queueFallback=d.queueFallback===true && fence.state==="pending";
          fence.state="not-accepted";fence.reason=String(d.reason??"native-refused");
          prompt.state=fence.queueFallback?"queued":"failed";
          if(fence.queueFallback)delete prompt.delivery;else prompt.reason="native-refused-after-barrier";
          break;
        }
        if(d.state!=="accepted"){fence.state="unknown";fence.reason=String(d.reason??"unconfirmed");prompt.state="unknown";break;}
        const current=this.latest(fence.taskId),task=this.task(fence.taskId);
        fence.state="accepted";fence.stale=d.stale===true;
        fence.eligible=d.eligible===true && !fence.stale && current?.attempt===fence.attempt && current.state==="running" && task?.memberId==="lead";
        prompt.firstAdmissionSeq ??= fence.seq;prompt.dispatchedSeq=fence.seq;
        const ended=task?.attempts.find(a=>a.attempt===fence.attempt);
        prompt.state=ended && TERMINAL_TASK_STATES.includes(ended.state)?ended.state as UserPrompt["state"]:"accepted";
        if(fence.eligible && (!this.state.continuityBlock || this.state.continuityBlock.startedSeq<fence.seq))this.state.continuityBlock={promptId:prompt.promptId,taskId:fence.taskId,attempt:fence.attempt,startedSeq:fence.seq};
        if(prompt.decisionTarget)this.onDecisionReply({...prompt.decisionTarget,promptId:prompt.promptId,taskId:fence.taskId,attempt:fence.attempt,admittedSeq:fence.seq,questionRevision:fence.targetQuestionRevision,stale:fence.stale});
        break;
      }
      case "prompt.dispatched": {
        const prompt = this.state.prompts?.[String(d.promptId)];
        if (prompt && (prompt.state === "queued" || d.reseeded === true)) { prompt.state = "dispatched"; prompt.taskId = str(d.taskId); prompt.attempt = Number(d.attempt); prompt.dispatchedSeq = event.seq;
          if (d.handoff !== "gated" && prompt.by !== "daemon" && d.reseeded !== true) prompt.firstAdmissionSeq ??= prompt.steering?.seq ?? event.seq;
          if (d.handoff !== "gated" && prompt.by !== "daemon" && d.reseeded !== true) this.state.continuityBlock = { promptId: prompt.promptId, taskId: prompt.taskId!, attempt: prompt.attempt!, startedSeq: event.seq };
          if (d.handoff === "gated") prompt.handoff = {state:"pending",seq:event.seq};
          if (d.handoff !== "gated" && d.decisionReply) this.onDecisionReply(d.decisionReply as Record<string, unknown>); }
        break;
      }
      case "prompt.handoff": {
        const prompt = this.prompt(String(d.promptId));
        if (!prompt?.handoff || prompt.taskId !== d.taskId || prompt.attempt !== d.attempt) break;
        const before = prompt.handoff.state, next = String(d.state);
        if (!(before === "pending" && next === "sending" || before === "sending" && ["delivered","unknown"].includes(next))) break;
        prompt.handoff = {state:next as NonNullable<UserPrompt["handoff"]>["state"],seq:event.seq,...(str(d.evidence)?{evidence:str(d.evidence)}:{})};
        if (next === "delivered" && prompt.by !== "daemon") {
          const task = this.task(prompt.taskId!);
          if (task?.memberId === 'lead' && prompt.text?.trim()) {
            const recovery = task.leadRecovery ??= {recent:[]}, text = byteExcerpt(prompt.text,1024);
            const message: LeadRecoveryMessage = {role:'user',text,seq:event.seq,truncated:text!==prompt.text};
            recovery.original ??= message; recovery.recent.push(message); if(recovery.recent.length>8)recovery.recent.shift();
          }
          prompt.firstAdmissionSeq ??= event.seq;
          this.state.continuityBlock = {promptId:prompt.promptId,taskId:prompt.taskId!,attempt:prompt.attempt!,startedSeq:event.seq};
        }
        break;
      }
      case "prompt.requeued": {
        const prompt = this.prompt(String(d.promptId));
        if (!prompt || !(prompt.state === "queued" || prompt.handoff?.state === "pending")) break;
        if (d.taskId !== undefined && (prompt.taskId !== d.taskId || prompt.attempt !== d.attempt)) break;
        prompt.state = "queued"; prompt.requeuedSeq = event.seq; prompt.reason = str(d.reason);
        delete prompt.taskId; delete prompt.attempt; delete prompt.dispatchedSeq; delete prompt.handoff;
        this.state.promptQueue = {paused:true,reason:prompt.reason,lastResumeSeq:this.state.promptQueue?.lastResumeSeq};
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
        if (isApprovalMode(d.approvals)) this.state.session.approvals = d.approvals;
        this.state.session.projectRoot = str(d.projectRoot) ?? this.state.session.projectRoot;
        if (str(d.changeId) && !this.state.session.changeId) this.state.session.changeId = str(d.changeId);
        if (d.memberOverrides && typeof d.memberOverrides === "object") this.state.session.memberOverrides = structuredClone(d.memberOverrides) as CrossTeamAssignments;
        if (d.handoff && typeof d.handoff === "object") this.state.session.handoff = structuredClone(d.handoff) as SessionHandoff;
        break;
      case "session.approvals":
        if (isApprovalMode(d.mode)) this.state.session.approvals = d.mode;
        break;
      case "session.grant": {
        if (!str(d.grantId)) break;
        const grants = this.state.grants ??= [];
        this.state.grants = grants.filter(grant => grant.grantId !== d.grantId);
        if (d.action === "added" && !this.state.session.released && !this.state.session.removalPending && !this.state.session.removed && this.state.session.state !== "ended" && isSessionGrantKind(d.kind) && isApprovalToolKey(d.toolKey) && isApprovalRisk(d.risk)) {
          this.state.grants.push({ grantId: String(d.grantId), kind: d.kind, toolKey: d.toolKey, risk: d.risk, createdAt: event.ts, ...(str(d.exactKey) ? { exactKey: str(d.exactKey) } : {}), ...(typeof d.matchKey === "string" && /^[a-f0-9]{64}$/.test(d.matchKey) ? { matchKey: d.matchKey } : {}) });
          this.state.grants = this.state.grants.slice(-100);
        }
        break;
      }
      case "session.assignment":
        this.state.session.generation = d.generation as number;
        this.state.session.assignmentRevision = d.revision as number;
        this.state.session.memberOverrides = structuredClone(d.memberOverrides) as CrossTeamAssignments;
        if (d.handoff && typeof d.handoff === "object") this.state.session.handoff = structuredClone(d.handoff) as SessionHandoff;
        break;
      case "session.released": {
        const epoch=Number(d.epoch); if(!Number.isSafeInteger(epoch) || epoch<0) break;
        if(epoch < (this.state.session.releaseEpoch??0)) break;
        this.state.grants = [];
        this.state.session.releaseEpoch=epoch; this.state.session.released=true;
        this.state.session.releasePending=d.phase!=="released";
        if(str(d.reasonCode)) { this.state.session.releaseFailure=String(d.reasonCode); this.state.session.releaseFailureSeq=event.seq; } else { delete this.state.session.releaseFailure; delete this.state.session.releaseFailureSeq; }
        this.state.promptQueue={paused:true,reason:"session-released",...(this.state.promptQueue?.lastResumeSeq ? {lastResumeSeq:this.state.promptQueue.lastResumeSeq} : {})};
        if(str(d.commandId) && d.outcome) this.onLifecycle(event,"session.release","");
        break;
      }
      case "session.reopened": {
        if(Number(d.epoch)!==(this.state.session.releaseEpoch??0)) break;
        this.state.session.state="idle"; this.state.session.stopRequested=false;
        this.state.session.released=d.prepared!==true; this.state.session.releasePending=false;
        if(d.prepared===true && !isRestartPause(this.promptQueue.reason) && !Object.values(this.state.prompts??{}).some(prompt=>prompt.state==="queued")) this.state.promptQueue={paused:false}; delete this.state.session.releaseFailure; delete this.state.session.releaseFailureSeq;
        break;
      }
      case "session.renamed": {
        if(typeof d.title!=="string") break;
        this.state.session.title=d.title; this.onLifecycle(event,"session.rename",JSON.stringify(d.title)); break;
      }
      case "session.removed": {
        this.state.grants = [];
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
        if (st === "ended" || d.cancelPrompts === true) this.state.grants = [];
        if (d.cancelPrompts === true) {
          this.state.session.stopRequested = true;
          for (const prompt of Object.values(this.state.prompts ?? {})) if (prompt.state === "queued") { prompt.state = "cancelled"; prompt.reason = "session-stopped"; delete prompt.text; }
          if (str(d.commandId) && d.outcome) { this.onLifecycle(event,"session.stop",""); this.onCommandAccepted({ ...event, data: { commandId: d.commandId, type: "session.stop", outcome: d.outcome } }); }
        }
        break;
      }
      case "session.ended": this.state.session.state = "ended"; this.state.grants = []; break;
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
        // Bounded append/replay projection for Lead's protected missing-native recovery.
        // Keep the original request even after the rolling eight messages expire.
        const active=task?.attempts.at(-1);
        if(task?.memberId==="lead" && /^lead(?:-g[1-9]\d*)?$/.test(task.taskId)
          && (event.source.memberId===undefined||event.source.memberId==="lead")
          && (d.attempt===undefined||d.attempt===active?.attempt)
          && (!event.source.nativeSessionId||event.source.nativeSessionId===active?.nativeSessionId)
          && (d.role==="user" && !d.handoff||d.role==="assistant"&&active?.state==="running") && !d.internal && d.by!=="daemon"
          && typeof d.text==="string" && d.text.trim()) {
          const recovery=task.leadRecovery??={recent:[]};
          const text=byteExcerpt(d.text,1024);
          const message:LeadRecoveryMessage={role:d.role,text,seq:event.seq,truncated:text!==d.text};
          if(d.role==="user")recovery.original??=message;
          recovery.recent.push(message);if(recovery.recent.length>8)recovery.recent.shift();
        }
        if (task?.memberId === "lead" && /^lead(?:-g[1-9]\d*)?$/.test(task.taskId) && (event.source.memberId === undefined || event.source.memberId === "lead") && d.role === "assistant" && !d.internal && typeof d.text === "string" && d.text.trim()) {
          this.state.lastLeadReplySeq = event.seq;
          const block = this.state.continuityBlock;
          if (block && block.taskId === task.taskId && block.attempt === task.attempts.at(-1)?.attempt) {
            block.answer = d.text.slice(0, 1024); block.answerTruncated = d.text.length > 1024; block.answerSeq = event.seq;
          }
        }
        break;
      }
      case "question.requested": {
        const id = str(d.questionId);
        if (id) Object.defineProperty(this.state.questions ??= {}, id, { enumerable: true, configurable: true, writable: true, value: { questionId: id, ...(str(d.taskId) ? { taskId: str(d.taskId) } : {}), ...(str(d.tool) ? { tool: str(d.tool) } : {}), questions: structuredClone(d.questions as Question[]), seq: event.seq } });
        break;
      }
      case "question.resolved": {
        // Public answers stay in the replayable event log; this projection tracks pending requests only.
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
    (this.state.mutationIdentities ??= {})[commandId] ??= {type:d.type,...(typeof d.fingerprint === "string" ? {fingerprint:d.fingerprint} : {})};
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
      taskId, memberId, ...(Array.isArray(d.dependsOn) ? { dependsOn: [...d.dependsOn] as string[], ...(typeof d.action === "string" ? { action: d.action } : {}) } : {}),
      attempts: [{
        attempt: 1, runnerId, modelId, ...(str(d.thinking) ? { thinking: str(d.thinking) } : {}),
        ...(str(d.nativeSessionId) ? { nativeSessionId: str(d.nativeSessionId) } : {}),
        state: initial, startedSeq: event.seq,
      }],
    };
    projectTaskEvidence(this.state.tasks[taskId]!,event);
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
      if (wanted === "ownership-unsettled") attempt.unsettledSeq = event.seq; else delete attempt.unsettledSeq;
      if (str(d.reason)) attempt.reason = str(d.reason); else delete attempt.reason;
      if (TERMINAL_TASK_STATES.includes(wanted)) { attempt.endedSeq = event.seq; attempt.endedAt = Date.parse(event.ts); }
    }
    for (const prompt of Object.values(this.state.prompts ?? {})) {
      if (prompt.handoff && prompt.handoff.state !== "delivered") continue;
      if ((prompt.state !== "dispatched" && prompt.state !== "accepted") || prompt.taskId !== taskId || prompt.attempt !== attempt.attempt) continue;
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
    if (Array.isArray(d.dependsOn)) { task.dependsOn = [...d.dependsOn] as string[]; task.action = typeof d.action === "string" ? d.action : undefined; if (d.replan) task.replan = structuredClone(d.replan) as LedgerTask["replan"]; }
    if (d.decisionCommand) this.recordDecisionCommand(d.decisionCommand);
    const previous = task.attempts.at(-1)!;
    if (!TERMINAL_TASK_STATES.includes(previous.state)) return this.anomaly("task-continue-not-terminal", event.seq, taskId);
    const attemptNo = Number.isInteger(d.attempt) ? (d.attempt as number) : previous.attempt + 1;
    if (attemptNo !== previous.attempt + 1) return this.anomaly("task-attempt-out-of-order", event.seq, String(attemptNo));
    const continuity = d.continuityPending === true ? undefined : d.continuity === "reseeded" ? "reseeded" : "native";
    if (continuity === "reseeded") {
      task.nativeConfirmed = false;
      const block = this.state.continuityBlock;
      if (block && block.taskId === taskId && block.attempt === previous.attempt) {
        block.attempt = attemptNo; delete block.answer; delete block.answerSeq; delete block.answerTruncated;
      }
    }
    // D-12: runner/model/thinking come from the recorded attempt, never from current config.
    task.attempts.push({
      attempt: attemptNo, runnerId: previous.runnerId, modelId: previous.modelId,
      ...(previous.thinking ? { thinking: previous.thinking } : {}),
      ...(str(d.nativeSessionId) ? { nativeSessionId: str(d.nativeSessionId) } : {}),
      state: "created", continuity, startedSeq: event.seq,
    });
    projectTaskEvidence(task,event);
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
    if(typeof d.reportArtifactUnavailable==='string')attempt.reportArtifactUnavailable=d.reportArtifactUnavailable;
    if(d.reportArtifact)attempt.reportArtifact=structuredClone(d.reportArtifact) as TaskAttempt["reportArtifact"];
    if (summary !== undefined) {
      attempt.result = summary.slice(0, RESULT_LIMIT); attempt.resultSeq = event.seq; attempt.resultTruncated = summary.length > RESULT_LIMIT;
    }
  }
}

// ---- snapshots ----------------------------------------------------------------------------

type SnapshotFile = { v: typeof LEDGER_SNAPSHOT_VERSION; seq: number; eventDigest: string; digest: string; state: LedgerState };
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
    const at = log.readEvent(seq);
    if (!at || at.seq !== seq) throw new Error(`Cannot snapshot ledger at seq ${seq}: event missing from log`);
    hash = eventDigest(at);
  }
  const state = ledger.toState();
  const file: SnapshotFile = { v: LEDGER_SNAPSHOT_VERSION, seq, eventDigest: hash, digest: stateDigest(seq, hash, state), state };
  writePrivateFile(snapshotFile, JSON.stringify(file));
}


export function promptEndDrafts(prompt: UserPrompt, state: string, reason?: string): EventDraft[] {
  if (prompt.state === 'cancelled') return [];
  const identity = {promptId:prompt.promptId,...(prompt.taskId?{taskId:prompt.taskId,attempt:prompt.attempt}:{})};
  if (prompt.handoff?.state === 'pending' || prompt.state === 'queued') return [{kind:'prompt.requeued',data:{...identity,text:prompt.text??'',attachments:prompt.attachments??[],createdAt:prompt.createdAt,reason:reason??state}}];
  return [
    ...(prompt.handoff?.state === 'sending' ? [{kind:'prompt.handoff' as const,data:{...identity,state:'unknown',reason:reason??state}}] : []),
    {kind:'prompt.state',data:{...identity,state,...(reason?{reason}:{})}},
  ];
}
