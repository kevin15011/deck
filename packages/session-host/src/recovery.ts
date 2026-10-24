/**
 * Startup recovery (XR-3.7, design 6.1).
 *
 * A task that was running when the previous daemon died is `interrupted` ONLY when its
 * containment is proven settled (processes provably absent within the same boot, or a changed
 * boot session, which proves they are dead). Anything else (alive, reused, unreadable,
 * missing lease) is `ownership-unsettled` and continuation is refused. Recovery observes
 * with signal-0 probes only; it never signals a PID read from disk.
 */
import { readdirSync } from "node:fs";
import { EventLog, type EventDraft } from "./event-log";
import { LeaseInvalidError, readLease, removeLease, type Lease } from "./lease";
import { loadLedger, promptEndDrafts, saveLedgerSnapshot, TERMINAL_TASK_STATES, type Ledger, type TaskAttempt } from "./ledger";
import { assertSafeSegment, sessionPaths, type StatePaths } from "./paths";
import type { Presence, ProcessIdentity, ProcessProbe } from "./process-probe";

export type UnsettledReason =
  | "lease-missing" | "lease-claiming" | "lease-incomplete" | "lease-invalid"
  | "boot-unknown" | "platform-mismatch" | "platform-unsupported"
  | "pid-alive" | "pid-reused" | "group-alive" | "probe-unknown";
export type SettleVerdict = { settled: true } | { settled: false; reason: UnsettledReason };
const no = (reason: UnsettledReason): SettleVerdict => ({ settled: false, reason });

function identityGone(identity: ProcessIdentity, probe: ProcessProbe): UnsettledReason | undefined {
  if (probe.platform === "linux") {
    let stat;
    try { stat = probe.procStat(identity.pid); } catch { return "probe-unknown"; }
    if (!stat) return undefined;
    if (stat.starttime !== identity.starttime) return "pid-reused";
    return stat.state === "Z" || stat.state === "X" ? undefined : "pid-alive";
  }
  const presence: Presence = probe.presence(identity.pid);
  return presence === "absent" ? undefined : presence === "alive" ? "pid-alive" : "probe-unknown";
}

/** Decide whether a persisted lease's processes are provably gone. Pure observation. */
export function verifyLeaseSettled(lease: Lease | undefined, probe: ProcessProbe): SettleVerdict {
  if (!lease) return no("lease-missing");
  if (lease.state === "claiming") return no("lease-claiming");
  if (!lease.anchor || lease.group === undefined || lease.group !== lease.anchor.pid) return no("lease-incomplete");
  if (probe.platform !== "linux" && probe.platform !== "darwin") return no("platform-unsupported");
  const identities = [lease.anchor, ...(lease.worker ? [lease.worker] : [])];
  if (identities.some((i) => i.platform !== probe.platform)) return no("platform-mismatch");
  const boot = probe.bootId();
  if (!boot) return no("boot-unknown");
  // A different boot session proves every recorded process is dead (processes do not survive a reboot),
  // so ownership is settled without consulting PIDs, which may have been reused by unrelated processes.
  if (identities.some((i) => i.boot !== boot)) return { settled: true };
  for (const identity of identities) {
    const reason = identityGone(identity, probe);
    if (reason) return no(reason);
  }
  const group = probe.groupPresence(lease.group);
  if (group === "alive") return no("group-alive");
  if (group === "unknown") return no("probe-unknown");
  return { settled: true };
}

export type RecoveryReport = {
  interrupted: string[];
  unsettled: Array<{ taskId: string; reason: UnsettledReason }>;
  approvalsDenied: string[];
  questionsCancelled: string[];
  eventsAppended: number;
};

export type RecoverSessionOptions = {
  log: EventLog;
  ledger: Ledger;
  probe: ProcessProbe;
  leaseFileFor: (taskId: string) => string;
};

const LIVE_SESSION_STATES = ["running", "idle", "stopping"];

export function recoverSession(options: RecoverSessionOptions): RecoveryReport {
  const { log, ledger, probe } = options;
  const report: RecoveryReport = { interrupted: [], unsettled: [], approvalsDenied: [], questionsCancelled: [], eventsAppended: 0 };
  if (ledger.session.state === "ended") return report;

  const drafts: EventDraft[] = [];
  const settledLeases: string[] = [];
  const source = (taskId: string, attempt: TaskAttempt, memberId: string) => ({ taskId, memberId, runnerId: attempt.runnerId });

  for (const task of ledger.tasks()) {
    const attempt = task.attempts.at(-1)!;
    if (TERMINAL_TASK_STATES.includes(attempt.state)) continue;
    const file = options.leaseFileFor(task.taskId);
    let lease: Lease | undefined;
    let verdict: SettleVerdict;
    try {
      lease = readLease(file);
      // A task that never reached `running` and has no lease never owned a process.
      const neverDispatched = ledger.prompts().some(prompt => prompt.state === "queued" && prompt.taskId === task.taskId && prompt.attempt === attempt.attempt);
      verdict = !lease && (attempt.state === "created" || attempt.state === "queued" || neverDispatched) ? { settled: true } : verifyLeaseSettled(lease, probe);
    } catch (error) {
      verdict = error instanceof LeaseInvalidError ? no("lease-invalid") : no("probe-unknown");
    }
    if (verdict.settled) {
      drafts.push({ kind: "task.state", source: source(task.taskId, attempt, task.memberId), data: { taskId: task.taskId, state: "interrupted", reason: "daemon-restart" } });
      report.interrupted.push(task.taskId);
      if (lease) settledLeases.push(file);
    } else {
      report.unsettled.push({ taskId: task.taskId, reason: verdict.reason });
      if (attempt.state !== "ownership-unsettled") {
        drafts.push({ kind: "task.state", source: source(task.taskId, attempt, task.memberId), data: { taskId: task.taskId, state: "ownership-unsettled", reason: verdict.reason } });
      }
    }
  }

  for (const prompt of ledger.prompts()) {
    if ((!prompt.handoff && !(prompt.gated && prompt.state === "queued")) || !prompt.taskId) continue;
    const recovered = drafts.find(draft => draft.kind === 'task.state' && draft.data?.taskId === prompt.taskId);
    const attempt = ledger.task(prompt.taskId)?.attempts.find(a=>a.attempt===prompt.attempt);
    if (recovered || attempt && (TERMINAL_TASK_STATES.includes(attempt.state) || attempt.state === 'ownership-unsettled'))
      {
        drafts.push(...promptEndDrafts(prompt, String(recovered?.data?.state ?? attempt!.state), 'daemon-restart'));
        if (prompt.handoff && prompt.handoff.state !== 'pending' && ['failed','interrupted','ownership-unsettled'].includes(String(recovered?.data?.state ?? attempt!.state))) drafts.push({kind:'prompt.queue',data:{paused:true,reason:'daemon-restart'}});
      }
  }

  for (const question of ledger.pendingQuestions()) {
    drafts.push({ kind: "question.resolved", source: question.taskId ? { taskId: question.taskId } : {}, data: { questionId: question.questionId, outcome: "cancelled", by: "daemon-restart" } });
    report.questionsCancelled.push(question.questionId);
  }

  for (const approval of ledger.pendingApprovals()) {
    drafts.push({
      kind: "approval.resolved", source: approval.taskId ? { taskId: approval.taskId } : {},
      data: { approvalId: approval.approvalId, decision: "deny", by: "daemon-restart" },
    });
    report.approvalsDenied.push(approval.approvalId);
  }

  if (drafts.length > 0 || LIVE_SESSION_STATES.includes(ledger.session.state) || ledger.restartQueueRepair("restart-recovered")) {
    drafts.push({ kind: "session.recovered", data: { interrupted: report.interrupted, unsettled: report.unsettled } });
  }
  if (ledger.session.stopRequested && report.unsettled.length === 0) drafts.push({ kind: "session.ended", data: { reason: "stopped" } });
  if (drafts.length === 0) return report;

  for (const event of log.appendMany(drafts)) ledger.apply(event);
  if (report.interrupted.length === 0 && report.unsettled.length === 0) {
    const repair = ledger.restartQueueRepair("restart-recovered");
    if (repair) { for (const event of log.appendMany([repair])) ledger.apply(event); drafts.push(repair); }
  }
  report.eventsAppended = drafts.length;
  for (const file of settledLeases) { try { removeLease(file); } catch { /* an orphan lease is harmless once the task is terminal */ } }
  return report;
}

export type ContinuationBlock = { code: "task-unknown" | "task-running" | "ownership-unsettled" };

/** XR-3.7 / XR-6.5: why a task cannot be continued right now, if it cannot. */
export function continuationBlock(ledger: Ledger, taskId: string): ContinuationBlock | undefined {
  const attempt = ledger.latest(taskId);
  if (!attempt) return { code: "task-unknown" };
  if (attempt.state === "ownership-unsettled") return { code: "ownership-unsettled" };
  if (!TERMINAL_TASK_STATES.includes(attempt.state)) return { code: "task-running" };
  return undefined;
}

export type RecoverAllReport = {
  sessions: Array<{ sessionId: string } & RecoveryReport>;
  errors: Array<{ sessionId: string; error: string }>;
};

/** Daemon startup scan: recover every session under the state dir; one broken session never blocks the rest. */
export function recoverAllSessions(options: { paths: StatePaths; probe: ProcessProbe }): RecoverAllReport {
  const report: RecoverAllReport = { sessions: [], errors: [] };
  let names: string[];
  try { names = readdirSync(options.paths.sessionsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return report; }
  for (const name of names.sort()) {
    try { assertSafeSegment(name, "session id"); } catch { continue; }
    const sp = sessionPaths(options.paths, name);
    let log: EventLog | undefined;
    try {
      log = EventLog.open({ dir: sp.eventsDir, sessionId: name });
      const { ledger } = loadLedger(log, sp.ledgerSnapshotFile);
      const recovered = recoverSession({ log, ledger, probe: options.probe, leaseFileFor: sp.taskLeaseFile });
      saveLedgerSnapshot(ledger, log, sp.ledgerSnapshotFile);
      report.sessions.push({ sessionId: name, ...recovered });
    } catch (error) {
      report.errors.push({ sessionId: name, error: (error as Error).message });
    } finally {
      log?.close();
    }
  }
  return report;
}
