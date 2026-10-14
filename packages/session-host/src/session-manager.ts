/**
 * SessionManager implements the `SessionService` port for cross-runner team sessions.
 * It owns per-task scheduling and lifecycle, the event
 * log + ledger of each session, and the coupling of a runner driver, the ApprovalBroker and
 * task credentials, Lead wakeups, owner continuity and the shared memory writer.
 *
 * Invariants kept here:
 *  - the event log is the only durable truth; the ledger is applied live from it;
 *  - the native session id is persisted (task.created / task.continued) BEFORE the driver starts;
 *  - every accepted command writes a `command.accepted` receipt in the same atomic batch as its
 *    first effect, so a duplicate commandId after a daemon restart never re-executes (XR-1.5);
 *  - drivers can only emit content-class events; ledger-affecting events are written by the host.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import type { SessionCommand } from "@deck/core/session/commands";
import type { CrossTeamAssignments, RunnerQualifiedAssignment } from "@deck/core/session/assignments";
import type {
  ChildMcpServerSpec, DriverEvent, DriverHostIo, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver, TurnOutcome,
} from "@deck/core/session/driver";
import { boundRaw, SESSION_EVENT_KINDS, type SessionEvent, type SessionEventKind } from "@deck/core/session/events";
import { computeChildMcpSet } from "@deck/core/session/mcp";
import { redactText } from "@deck/core/session/redaction";
import type { ApprovalBroker } from "./approval-broker";
import { SESSION_MCP_SERVER_ID, sessionMcpServerSpec } from "./bridge-config";
import { systemClock, type Clock } from "./clock";
import type { CredentialGrant, CredentialRegistry } from "./credentials";
import { createDriverSpawn } from "./driver-spawn";
import { EventLog, type EventDraft } from "./event-log";
import { Ledger, loadLedger, saveLedgerSnapshot, TERMINAL_TASK_STATES } from "./ledger";
import type { DaemonLogger } from "./daemon-logger";
import { assertOutsideProject, assertSafeSegment, ensurePrivateDir, sessionPaths, writePrivateFile, type SessionPaths, type StatePaths } from "./paths";
import { MemoryBroker, type SessionMemoryPort } from "./memory-broker";
import { listOpenSpecArtifacts, readOpenSpecArtifact } from "./openspec-artifacts";
import { continuationBlock } from "./recovery";
import type { CommandOutcome, ExecuteOutcome } from "./protocol";
import type { SessionService } from "./service";
import type { Supervisor } from "./supervisor";

export const LEAD_TASK_ID = "lead";
const LEAD_MEMBER_ID = "lead";
const MAX_PROMPT_CHARS = 256 * 1024;
const REASON_LIMIT = 300;
const CLOSE_WAIT_MS = 5000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_RETENTION_COUNT = 50;
const CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Kinds a driver may emit. Everything that drives ledger/session state is written by the host only. */
const DRIVER_KINDS = new Set<string>([
  "turn.started", "message.delta", "message.completed", "reasoning.delta", "tool.started", "tool.completed",
  "usage", "rate-limit", "diagnostic", "runner.unmapped",
]);
const ALL_KINDS = new Set<string>(SESSION_EVENT_KINDS);

export type DriverLookup = { get(runnerId: string): RunnerSessionDriver | undefined; list(): readonly RunnerSessionDriver[] };

export type ChildMcpResolver = {
  /** Server ids Deck configured for the runner, before the memory/web/session adjustments of `computeChildMcpSet`. */
  runnerPackages(runnerId: string): readonly string[];
  memoryProviderIds?: readonly string[];
  webSearch?: { enabled: boolean; serverId?: string };
  /** Launch spec for a non-session server id; undefined means it cannot be launched (skipped with a diagnostic). */
  envOverlay?: Readonly<Record<string, string>>;
  resolveServer(id: string): ChildMcpServerSpec | undefined;
  /** Release a managed backend binding only after its native task handle has drained. */
  release?(): Promise<void>;
};

export type ChildMcpContext = { projectRoot: string; sessionId: string; taskId: string; signal: AbortSignal };

export type SessionManagerOptions = {
  paths: StatePaths;
  broker: ApprovalBroker;
  credentials: CredentialRegistry;
  supervisor: Supervisor;
  drivers: DriverLookup;
  /** Current cross-runner configuration; undefined means "not configured". */
  config: () => CrossRunnerConfig | undefined;
  /** Command prefix that starts the session MCP bridge inside a child, e.g. [deck, "internal", "session-mcp"]. */
  sessionMcpCommand: readonly string[];
  rolePrompt?: (memberId: string, context: { changeId?: string; projectRoot: string }) => string;
  childMcp?: ChildMcpResolver | ((runnerId: string, context: ChildMcpContext) => Promise<ChildMcpResolver>);
  closeChildMcp?: () => Promise<void>;
  memory?: (context: { sessionId: string; projectRoot: string; leadRunnerId: string }) => Promise<SessionMemoryPort | undefined>;
  clock?: Clock;
  logger?: DaemonLogger;
  newSessionId?: () => string;
};

type SessionMeta = {
  v: 1; sessionId: string; projectRoot: string; changeId?: string; createdAt: string; createCommandId: string;
  createFingerprint?: string;
  members: CrossTeamAssignments;
};

type Turn = {
  taskId: string; memberId: string; assignment: RunnerQualifiedAssignment; prompt: string; resume?: { nativeSessionId: string }; reseeded?: boolean;
  attempt: number;
  nativeSessionId?: string;
  handle?: DriverTaskHandle;
  closeHandle?: Promise<void>;
  kind?: "interrupt" | "cancel" | "stop";
  controller: AbortController;
  ownershipUnsettled?: boolean;
  lastText?: string;
  done: Promise<void>;
  resolveDone: () => void;
};

type Live = {
  sessionId: string;
  paths: SessionPaths;
  meta: SessionMeta;
  log: EventLog;
  ledger: Ledger;
  unsubscribe: () => void;
  turns: Map<string, Turn>;
  queue: Turn[];
  notices: Map<string, string>;
  acknowledgedAttempts: Map<string, number>;
  wakeTimer?: ReturnType<Clock["setTimeout"]>;
  memory?: MemoryBroker;
  stopping: boolean;
  broken: boolean;
};

export type SessionSummary = {
  sessionId: string; projectRoot: string; changeId?: string; state: string; createdAt: string; updatedAt: string; lastSeq: number;
  lead?: RunnerQualifiedAssignment; running: boolean; tasks: number;
  /** Tasks whose latest attempt is not terminal (running, or ownership-unsettled after a crash). */
  activeTasks: number;
};

const fail = (code: string, message?: string): ExecuteOutcome => ({ ok: false, code, ...(message ? { message } : {}) });
const ok = (data?: unknown): ExecuteOutcome => ({ ok: true, ...(data === undefined ? {} : { data }) });
const bounded = (text: string, cap = REASON_LIMIT) => redactText(text, cap);

export class SessionManager implements SessionService {
  private readonly sessions = new Map<string, Live>();
  private readonly creating = new Map<string, { fingerprint: string; result: Promise<ExecuteOutcome> }>();
  private readonly clock: Clock;
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(private readonly options: SessionManagerOptions) {
    this.clock = options.clock ?? systemClock;
  }

  // ---- SessionService --------------------------------------------------------------------

  async execute(input: { sessionId?: string; command: SessionCommand; clientId: string }): Promise<ExecuteOutcome> {
    const { command, clientId } = input;
    if (this.closing) return fail("daemon-stopping");
    if (command.type === "session.create") return this.create(command, clientId);
    if (command.type === "session.attach") return fail("unsupported", "session.attach is handled by the control server");
    if (!input.sessionId) return fail("session-required");
    const live = this.load(input.sessionId);
    if (!live) return fail("unknown-session");

    const receipt = live.ledger.receipt(command.commandId);
    if (receipt) {
      if (receipt.type !== command.type) return fail("command-id-reused", `commandId was used for ${receipt.type}`);
      return { ...(receipt.outcome as CommandOutcome), duplicate: true };
    }
    switch (command.type) {
      case "prompt.send": return this.promptSend(live, command, clientId);
      case "turn.interrupt": return this.interrupt(live, command, "interrupt");
      case "task.cancel": return this.interrupt(live, { ...command, type: "turn.interrupt" }, "cancel", command.type);
      case "approval.respond": return this.approvalRespond(live, command, clientId);
      case "session.bindChange": return this.bindChange(live, command);
      case "session.stop": return this.stop(live, command);
      default: return fail("unsupported", "Unsupported command");
    }
  }

  openLog(sessionId: string): EventLog | undefined {
    return this.load(sessionId)?.log;
  }

  hasRunningWork(): boolean {
    for (const live of this.sessions.values()) if (live.turns.size || live.queue.length || live.wakeTimer !== undefined) return true;
    return false;
  }

  taskStatus(grant: CredentialGrant): unknown {
    const live = this.sessions.get(grant.sessionId);
    const attempt = live?.ledger.latest(grant.taskId);
    return {
      sessionId: grant.sessionId, taskId: grant.taskId, memberId: grant.memberId,
      ...(attempt ? { state: attempt.state, attempt: attempt.attempt, runnerId: attempt.runnerId, modelId: attempt.modelId } : {}),
      ...(live ? { sessionState: live.ledger.session.state, ...(live.ledger.session.changeId ? { changeId: live.ledger.session.changeId } : {}) } : {}),
    };
  }

  async query(name: string, args: unknown): Promise<CommandOutcome> {
    switch (name) {
      case "sessions.list": return { ok: true, data: { sessions: this.listSessions() } };
      case "sessions.prune": return { ok: true, data: this.prune((args ?? {}) as { maxAgeDays?: number; keep?: number; dryRun?: boolean }) };
      case "drivers.status": return { ok: true, data: await this.driversStatus() };
      case "openspec.list":
      case "openspec.read": {
        const input = args as { sessionId?: unknown; changeId?: unknown; path?: unknown } | null;
        if (!input || typeof input.sessionId !== "string") return fail("openspec-invalid", "Invalid OpenSpec session selection.");
        const live = this.load(input.sessionId);
        if (!live) return fail("session-unknown");
        const scope = { projectRoot: live.ledger.session.projectRoot ?? live.meta.projectRoot, changeId: live.ledger.session.changeId ?? live.meta.changeId };
        return name === "openspec.list" ? listOpenSpecArtifacts(scope) : readOpenSpecArtifact(scope, input.changeId, input.path);
      }
      default: return { ok: false, code: "query-unknown", message: name };
    }
  }

  /** Daemon shutdown: finish running turns (their processes are ended by the supervisor first), checkpoint, close logs. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.closeSessions();
    return this.closePromise;
  }

  private async closeSessions(): Promise<void> {
    for (const live of this.sessions.values()) {
      if (live.wakeTimer !== undefined) this.clock.clearTimeout(live.wakeTimer);
      live.wakeTimer = undefined; live.notices.clear(); this.cancelQueued(live);
    }
    const turns = [...this.sessions.values()].flatMap((l) => [...l.turns.values()]);
    for (const turn of turns) {
      turn.kind ??= "stop";
      turn.controller.abort();
      void turn.handle?.interrupt().catch(() => {});
    }
    let timeout: ReturnType<Clock["setTimeout"]> | undefined;
    try {
      await Promise.race([Promise.all(turns.map((t) => t.done)), new Promise<void>((resolve) => { timeout = this.clock.setTimeout(resolve, CLOSE_WAIT_MS); })]);
    } finally { if (timeout !== undefined) this.clock.clearTimeout(timeout); }
    // A native turn outcome does not end a persistent server. Retain ownership and the log
    // until close has drained it; launchTurn also closes handles returned during shutdown.
    await Promise.all(turns.map((turn) => this.closeTurnHandle(turn).catch(() => {})));
    await Promise.all(turns.map((turn) => turn.done));
    await this.options.closeChildMcp?.();
    for (const live of this.sessions.values()) { await live.memory?.close().catch(() => {}); this.release(live); }
    this.sessions.clear();
  }

  /** Called only after bridge authentication. Revalidate live ownership rather than trusting claimed role. */
  async callTaskTool(grant: CredentialGrant, name: string, args: unknown, context: { signal?: AbortSignal } = {}): Promise<CommandOutcome> {
    const delegation = ["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel"].includes(name);
    if (delegation && (grant.memberId !== LEAD_MEMBER_ID || grant.taskId !== LEAD_TASK_ID)) return fail("tool-not-allowed");
    const live = this.sessions.get(grant.sessionId);
    const caller = live?.turns.get(grant.taskId);
    if (!live || !caller || caller.memberId !== grant.memberId || (grant.runnerId && caller.assignment.runnerId !== grant.runnerId) || caller.kind || live.stopping || this.closing) return fail("credential-revoked");
    if (!args || typeof args !== "object" || Array.isArray(args)) return fail("invalid-arguments");
    if (context.signal?.aborted) return fail("aborted");
    const d = args as Record<string, unknown>;
    try {
      switch (name) {
        case "deck_delegate": return this.delegate(live, d);
        case "deck_task_result": return typeof d.taskId === "string" ? this.leadResult(live, d.taskId) : fail("invalid-arguments");
        case "deck_task_wait": return this.waitTasks(live, d, context.signal);
        case "deck_task_cancel": {
          if (typeof d.taskId !== "string" || d.taskId === LEAD_TASK_ID) return fail("invalid-arguments");
          return this.interrupt(live, { v: 1, type: "turn.interrupt", commandId: randomUUID(), taskId: d.taskId }, "cancel");
        }
        case "deck_memory_recall": case "deck_memory_propose": {
          const content = name === "deck_memory_recall" ? d.query : d.content;
          if (typeof content !== "string" || !content.trim() || content.length > 32_768) return fail("invalid-arguments");
          live.memory ??= new MemoryBroker(Promise.resolve().then(() => this.options.memory?.({ sessionId: live.sessionId, projectRoot: live.meta.projectRoot, leadRunnerId: live.meta.members.lead!.runnerId })), [...live.log.readAfter(0)].filter((event) => event.kind === "memory.written" && typeof event.data.proposalId === "string").map((event) => event.data.proposalId as string));
          const source = { taskId: grant.taskId, memberId: grant.memberId, runnerId: grant.runnerId };
          if (name === "deck_memory_recall") {
            const outcome = await live.memory.recall(content);
            this.append(live, { kind: "memory.recalled", source, data: { ok: outcome.ok } });
            return outcome.ok ? ok({ advisoryText: bounded(outcome.advisoryText ?? "", 16_384) }) : fail("memory-unavailable");
          }
          this.append(live, { kind: "memory.proposed", source, data: { chars: content.length } });
          const outcome = await live.memory.propose(content);
          if (outcome.ok && !outcome.duplicate) this.append(live, { kind: "memory.written", source, data: { ok: true, proposalId: MemoryBroker.proposalId(content) } });
          return outcome.ok ? ok({ duplicate: outcome.duplicate === true }) : fail("memory-unavailable");
        }
        default: return fail("tool-unknown");
      }
    } catch (error) { return fail("task-tool-failed", bounded((error as Error).message)); }
  }

  private delegate(live: Live, d: Record<string, unknown>): ExecuteOutcome {
    if (typeof d.agent !== "string" || d.agent === LEAD_MEMBER_ID || typeof d.task !== "string" || !d.task.trim() || d.task.length > MAX_PROMPT_CHARS || (d.continueTaskId !== undefined && typeof d.continueTaskId !== "string")) return fail("invalid-arguments");
    const priorId = d.continueTaskId as string | undefined;
    const priorTask = priorId ? live.ledger.task(priorId) : undefined;
    if (priorId && !priorTask) return fail("task-unknown");
    if (priorTask && priorTask.memberId !== d.agent) return fail("task-owner-mismatch");
    if (priorId && (live.turns.has(priorId) || live.queue.some((turn) => turn.taskId === priorId))) return fail("task-running");
    const block = priorId ? continuationBlock(live.ledger, priorId) : undefined;
    if (block) return fail(block.code);
    const prior = priorId ? live.ledger.latest(priorId) : undefined;
    const assignment = prior ? { runnerId: prior.runnerId, modelId: prior.modelId, ...(prior.thinking ? { thinking: prior.thinking } : {}) } : this.options.config()?.members[d.agent];
    if (!assignment) return fail("member-not-assigned");
    const driver = this.options.drivers.get(assignment.runnerId);
    if (!driver) return fail("runner-driver-unavailable");
    const taskId = priorId ?? `task-${randomUUID()}`;
    const attempt = (prior?.attempt ?? 0) + 1;
    const native = prior?.nativeSessionId ?? driver.newNativeSessionId?.();
    const resume = prior && native && live.ledger.nativeConfirmed(taskId) ? { nativeSessionId: native } : undefined;
    const source = { taskId, memberId: d.agent, runnerId: assignment.runnerId };
    this.append(live, [
      prior ? { kind: "task.continued", source, data: { taskId, attempt, continuity: "native", ...(native ? { nativeSessionId: native } : {}) } }
        : { kind: "task.created", source, data: { taskId, memberId: d.agent, ...assignment, state: "created", ...(native ? { nativeSessionId: native } : {}) } },
      { kind: "message.completed", source, data: { role: "user", text: d.task } },
      { kind: "task.state", source, data: { taskId, state: "queued" } },
    ]);
    live.queue.push(this.newTurn(taskId, d.agent, { ...assignment }, attempt, d.task, native, resume));
    this.schedule(live);
    return ok({ taskId });
  }

  private schedule(live: Live): void {
    if (this.closing || live.stopping || live.broken) return;
    const configured = this.options.config()?.maxConcurrentTasks ?? 4;
    const cap = Number.isInteger(configured) && configured > 0 ? configured : 4;
    let running = [...live.turns.values()].filter((t) => t.taskId !== LEAD_TASK_ID).length;
    while (running < cap && live.queue.length) {
      const turn = live.queue.shift()!;
      const driver = this.options.drivers.get(turn.assignment.runnerId);
      if (!driver) { this.append(live, { kind: "task.state", source: { taskId: turn.taskId }, data: { taskId: turn.taskId, state: "failed", reason: "runner-driver-unavailable" } }); turn.resolveDone(); continue; }
      this.append(live, [{ kind: "task.state", source: { taskId: turn.taskId }, data: { taskId: turn.taskId, state: "running" } }, { kind: "session.state", data: { state: "running" } }]);
      live.turns.set(turn.taskId, turn); running++;
      void this.launchTurn(live, turn, driver, turn.assignment, turn.prompt, turn.nativeSessionId, turn.resume);
    }
  }

  private scheduleWake(live: Live): void {
    if (this.closing || live.stopping || live.broken || !live.notices.size || live.turns.has(LEAD_TASK_ID) || live.wakeTimer !== undefined) return;
    live.wakeTimer = this.clock.setTimeout(() => {
      live.wakeTimer = undefined;
      if (this.closing || live.stopping || live.turns.has(LEAD_TASK_ID) || !live.notices.size) return;
      const prompt = bounded(`Delegated task completion notice:\n${[...live.notices.values()].join("\n")}\nUse deck_task_result for details.`, 8192);
      const outcome = this.promptSend(live, { v: 1, type: "prompt.send", commandId: randomUUID(), text: prompt }, "daemon");
      if (!outcome.ok) this.options.logger?.warn("lead.wake-refused", { sessionId: live.sessionId, code: outcome.code });
    }, 20);
  }

  private cancelQueued(live: Live, taskId?: string): void {
    for (const turn of [...live.queue]) {
      if (taskId && turn.taskId !== taskId) continue;
      live.queue.splice(live.queue.indexOf(turn), 1);
      turn.controller.abort();
      this.append(live, { kind: "task.state", source: { taskId: turn.taskId }, data: { taskId: turn.taskId, state: "cancelled" } });
      this.queueNotice(live, turn, "cancelled");
      turn.resolveDone();
    }
    this.scheduleWake(live);
  }

  private queueNotice(live: Live, turn: Turn, state: string): void {
    // Waiters can receive the terminal ledger event before finishTurn queues its notice.
    // Remember the delivered attempt so a later enqueue cannot wake Lead a second time.
    if (!this.closing && !live.stopping && live.acknowledgedAttempts.get(turn.taskId) !== turn.attempt) live.notices.set(turn.taskId, `${turn.taskId} ${state}`);
  }

  /** Only authenticated Lead tools acknowledge results; observer log/ledger reads stay inert. */
  private leadResult(live: Live, taskId: string): ExecuteOutcome {
    const task = live.ledger.task(taskId); const latest = live.ledger.latest(taskId);
    if (!task || !latest) return fail("task-unknown");
    if (TERMINAL_TASK_STATES.includes(latest.state)) {
      live.acknowledgedAttempts.set(taskId, latest.attempt);
      live.notices.delete(taskId);
    }
    return ok({ taskId, memberId: task.memberId, ...latest });
  }

  private waitTasks(live: Live, d: Record<string, unknown>, signal?: AbortSignal): Promise<ExecuteOutcome> {
    if (!Array.isArray(d.taskIds) || !d.taskIds.length || d.taskIds.length > 100 || !d.taskIds.every((id) => typeof id === "string" && live.ledger.task(id)) || (d.timeoutSec !== undefined && (typeof d.timeoutSec !== "number" || !Number.isFinite(d.timeoutSec) || d.timeoutSec < 0 || d.timeoutSec > 50))) return Promise.resolve(fail("invalid-arguments"));
    const ids = [...new Set(d.taskIds as string[])];
    return new Promise((resolve) => {
      let finished = false; let timer: ReturnType<Clock["setTimeout"]> | undefined;
      let unsubscribe = () => {};
      const finish = (aborted = false) => { if (finished) return; finished = true; unsubscribe(); if (timer !== undefined) this.clock.clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(aborted || signal?.aborted ? fail("aborted") : ok({ tasks: ids.map((id) => (this.leadResult(live, id) as { data: unknown }).data) })); };
      const check = () => { if (ids.every((id) => TERMINAL_TASK_STATES.includes(live.ledger.latest(id)!.state))) finish(); };
      const abort = () => finish(true);
      unsubscribe = live.log.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      timer = this.clock.setTimeout(() => finish(), ((d.timeoutSec as number | undefined) ?? 50) * 1000);
      if (signal?.aborted) abort(); else check();
    });
  }

  private taskSummary(live: Live, taskId: string): string {
    const parts: string[] = [];
    for (const event of live.log.readAfter(0)) {
      if (event.source.taskId !== taskId) continue;
      if (event.kind === "message.completed" && typeof event.data.text === "string") parts.push(`${String(event.data.role ?? "assistant")}: ${bounded(event.data.text, 2048)}`);
      if (parts.length > 8) parts.shift();
    }
    return bounded(parts.join("\n"), 8192);
  }

  // ---- loading ---------------------------------------------------------------------------

  private load(sessionId: string): Live | undefined {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    let paths: SessionPaths;
    try { paths = sessionPaths(this.options.paths, sessionId); } catch { return undefined; }
    const meta = this.readMeta(paths);
    if (!meta) return undefined;
    try {
      const live = this.open(paths, meta);
      this.sessions.set(sessionId, live);
      return live;
    } catch (error) {
      this.options.logger?.warn("session.load-failed", { sessionId, error: (error as Error).message });
      return undefined;
    }
  }

  private open(paths: SessionPaths, meta: SessionMeta): Live {
    const log = EventLog.open({
      dir: paths.eventsDir, sessionId: meta.sessionId, clock: this.clock,
      onDiagnostic: (d) => this.options.logger?.warn(`event-log.${d.code}`, { sessionId: meta.sessionId, file: d.file }),
    });
    const { ledger } = loadLedger(log, paths.ledgerSnapshotFile);
    const live: Live = { sessionId: meta.sessionId, paths, meta, log, ledger, unsubscribe: () => {}, turns: new Map(), queue: [], notices: new Map(), acknowledgedAttempts: new Map(), stopping: false, broken: false };
    live.unsubscribe = log.subscribe((event) => {
      try { ledger.apply(event); } catch (error) {
        live.broken = true;
        this.options.logger?.error("ledger.apply-failed", { sessionId: meta.sessionId, seq: event.seq, error: (error as Error).message });
      }
    });
    if (ledger.session.state === "stopping") live.stopping = true;
    return live;
  }

  private readMeta(paths: SessionPaths): SessionMeta | undefined {
    try {
      const meta = JSON.parse(readFileSync(paths.sessionFile, "utf8")) as SessionMeta;
      return meta && meta.v === 1 && typeof meta.sessionId === "string" && typeof meta.projectRoot === "string" ? meta : undefined;
    } catch { return undefined; }
  }

  private release(live: Live): void {
    try { saveLedgerSnapshot(live.ledger, live.log, live.paths.ledgerSnapshotFile); } catch (error) {
      this.options.logger?.warn("ledger.snapshot-failed", { sessionId: live.sessionId, error: (error as Error).message });
    }
    live.unsubscribe();
    try { live.log.close(); } catch { /* best effort */ }
  }

  private append(live: Live, drafts: EventDraft | readonly EventDraft[]): SessionEvent[] {
    try {
      return live.log.appendMany(Array.isArray(drafts) ? drafts : [drafts as EventDraft]);
    } catch (error) {
      live.broken = true;
      this.options.logger?.error("event-log.append-failed", { sessionId: live.sessionId, error: (error as Error).message });
      throw error;
    }
  }

  // ---- session.create --------------------------------------------------------------------

  private findCreatedBy(commandId: string): string | undefined {
    let names: string[];
    try { names = readdirSync(this.options.paths.sessionsDir); } catch { return undefined; }
    for (const name of names) {
      try {
        const paths = sessionPaths(this.options.paths, name);
        const meta = this.readMeta(paths);
        if (meta?.createCommandId === commandId) return name;
      } catch { /* not a session dir */ }
    }
    return undefined;
  }

  private create(command: Extract<SessionCommand, { type: "session.create" }>, clientId: string): Promise<ExecuteOutcome> {
    const fingerprint = JSON.stringify([command.projectRoot, command.changeId ?? null]);
    const pending = this.creating.get(command.commandId);
    if (pending) return pending.fingerprint !== fingerprint ? Promise.resolve(fail("command-id-reused")) : pending.result.then((outcome) => outcome.ok ? { ...outcome, duplicate: true } : outcome);
    const result = Promise.resolve().then(() => this.performCreate(command, clientId, fingerprint));
    this.creating.set(command.commandId, { fingerprint, result });
    void result.finally(() => { this.creating.delete(command.commandId); }).catch(() => {});
    return result;
  }

  private async performCreate(command: Extract<SessionCommand, { type: "session.create" }>, clientId: string, fingerprint: string): Promise<ExecuteOutcome> {
    if (this.closing) return fail("daemon-stopping");
    const existing = this.findCreatedBy(command.commandId);
    if (existing) {
      const live = this.load(existing);
      if (live?.meta.createFingerprint && live.meta.createFingerprint !== fingerprint) return fail("command-id-reused");
      if (live && !live.meta.createFingerprint) {
        try { if (live.meta.projectRoot !== realpathSync(command.projectRoot) || live.meta.changeId !== command.changeId) return fail("command-id-reused"); }
        catch { return fail("command-id-reused"); }
      }
      return { ok: true, data: { sessionId: existing, lastSeq: live?.log.lastSeq ?? 0 }, duplicate: true };
    }
    const cfg = this.options.config();
    if (!cfg || !cfg.enabled) return fail("cross-runner-not-configured", "crossRunner is not configured or not enabled");
    const lead = cfg.members[LEAD_MEMBER_ID];
    if (!lead) return fail("lead-not-assigned", "crossRunner.members.lead is required");
    const driver = this.options.drivers.get(lead.runnerId);
    if (!driver) return fail("runner-driver-unavailable", `Runner "${lead.runnerId}" has no session driver`);

    if (!isAbsolute(command.projectRoot)) return fail("invalid-project-root", "projectRoot must be an absolute path");
    let projectRoot: string;
    try {
      projectRoot = realpathSync(command.projectRoot);
      if (!statSync(projectRoot).isDirectory()) throw new Error("not a directory");
      assertOutsideProject(this.options.paths.root, projectRoot);
    } catch (error) { return fail("invalid-project-root", bounded((error as Error).message)); }
    if (command.changeId !== undefined && !this.validChangeId(command.changeId)) return fail("invalid-change-id");

    const probe = await driver.probe({ cwd: projectRoot });
    if (this.closing) return fail("daemon-stopping");
    if (probe.status === "blocked") return fail(probe.reasonCode ?? "driver-blocked", `${lead.runnerId} driver is blocked`);

    const sessionId = (this.options.newSessionId ?? defaultSessionId)(this.clock.now());
    const paths = sessionPaths(this.options.paths, sessionId);
    ensurePrivateDir(paths.dir.replace(/[/\\][^/\\]+$/, ""));
    ensurePrivateDir(paths.dir);
    const meta: SessionMeta = {
      v: 1, sessionId, projectRoot, createdAt: new Date(this.clock.now()).toISOString(), createCommandId: command.commandId, createFingerprint: fingerprint,
      members: structuredClone(cfg.members), ...(command.changeId ? { changeId: command.changeId } : {}),
    };
    writePrivateFile(paths.sessionFile, JSON.stringify(meta));
    const live = this.open(paths, meta);
    this.sessions.set(sessionId, live);
    const drafts: EventDraft[] = [{
      kind: "session.created",
      data: { projectRoot, commandId: command.commandId, createdBy: clientId, members: structuredClone(cfg.members), ...(command.changeId ? { changeId: command.changeId } : {}) },
    }];
    if (probe.status === "degraded") drafts.push({ kind: "diagnostic", data: { code: probe.reasonCode ?? "driver-degraded", runnerId: lead.runnerId, ...(probe.version ? { version: probe.version } : {}) } });
    if (command.changeId) drafts.push({ kind: "session.bound", data: { changeId: command.changeId } });
    this.append(live, drafts);
    return ok({ sessionId, lastSeq: live.log.lastSeq });
  }

  private validChangeId(changeId: string): boolean {
    return CHANGE_ID.test(changeId) && !changeId.includes("..");
  }

  // ---- prompt.send and the turn lifecycle ---------------------------------------------------

  private receiptDraft(command: SessionCommand, outcome: { ok: true; data?: unknown }): EventDraft {
    return { kind: "command.accepted", data: { commandId: command.commandId, type: command.type, outcome } };
  }

  private promptSend(live: Live, command: Extract<SessionCommand, { type: "prompt.send" }>, clientId: string): ExecuteOutcome {
    const state = live.ledger.session.state;
    if (state === "ended") return fail("session-ended");
    if (live.stopping || state === "stopping") return fail("session-stopping");
    if (live.broken) return fail("log-write-failed", "The session log is not writable");
    if (live.turns.has(LEAD_TASK_ID)) return fail("turn-in-progress");
    if (command.text.length > MAX_PROMPT_CHARS) return fail("prompt-too-large");
    const block = live.ledger.task(LEAD_TASK_ID) ? continuationBlock(live.ledger, LEAD_TASK_ID) : undefined;
    if (block) return fail(block.code, block.code === "ownership-unsettled" ? "The previous turn's process ownership is not settled" : undefined);

    const recorded = live.ledger.latest(LEAD_TASK_ID);
    const assignment: RunnerQualifiedAssignment = recorded
      ? { runnerId: recorded.runnerId, modelId: recorded.modelId, ...(recorded.thinking ? { thinking: recorded.thinking } : {}) }
      : live.meta.members[LEAD_MEMBER_ID]!;
    const driver = this.options.drivers.get(assignment.runnerId);
    if (!driver) return fail("runner-driver-unavailable", `Runner "${assignment.runnerId}" has no session driver`);

    const attempt = (recorded?.attempt ?? 0) + 1;
    const nativeSessionId = recorded?.nativeSessionId ?? driver.newNativeSessionId?.();
    const resume = recorded && nativeSessionId && live.ledger.nativeConfirmed(LEAD_TASK_ID) ? { nativeSessionId } : undefined;
    const source = { taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId: assignment.runnerId };

    const drafts: EventDraft[] = [this.receiptDraft(command, { ok: true, data: { taskId: LEAD_TASK_ID, attempt } })];
    if (state !== "running") drafts.push({ kind: "session.state", data: { state: "running" } });
    drafts.push({ kind: "message.completed", source: { memberId: LEAD_MEMBER_ID, taskId: LEAD_TASK_ID }, data: { role: clientId === "daemon" ? "system" : "user", text: command.text, by: clientId, ...(clientId === "daemon" ? { internal: true } : {}) } });
    drafts.push(recorded
      ? { kind: "task.continued", source, data: { taskId: LEAD_TASK_ID, attempt, ...(nativeSessionId ? { nativeSessionId } : {}), continuity: "native" } }
      : {
        kind: "task.created", source,
        data: {
          taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId: assignment.runnerId, modelId: assignment.modelId,
          ...(assignment.thinking ? { thinking: assignment.thinking } : {}), ...(nativeSessionId ? { nativeSessionId } : {}), state: "created",
        },
      });
    drafts.push({ kind: "task.state", source, data: { taskId: LEAD_TASK_ID, state: "running" } });
    try { this.append(live, drafts); } catch { return fail("log-write-failed", "The session log is not writable"); }

    const turn = this.newTurn(LEAD_TASK_ID, LEAD_MEMBER_ID, assignment, attempt, command.text, nativeSessionId, resume);
    if (clientId === "daemon") live.notices.clear();
    live.turns.set(turn.taskId, turn);
    void this.launchTurn(live, turn, driver, assignment, command.text, nativeSessionId, resume);
    return ok({ taskId: LEAD_TASK_ID, attempt });
  }

  private newTurn(taskId: string, memberId: string, assignment: RunnerQualifiedAssignment, attempt: number, prompt: string, nativeSessionId?: string, resume?: { nativeSessionId: string }): Turn {
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    return { taskId, memberId, assignment, attempt, prompt, nativeSessionId, resume, done, resolveDone, controller: new AbortController() };
  }

  private childMcp(runnerId: string, credentialFile: string, resolver: ChildMcpResolver | undefined, role: "lead" | "member"): { mcp: DriverTaskInput["mcp"]; specs: Record<string, ChildMcpServerSpec>; skipped: string[] } {
    const set = computeChildMcpSet({
      runnerPackages: resolver?.runnerPackages(runnerId) ?? [],
      memoryProviderIds: resolver?.memoryProviderIds ?? [],
      webSearch: resolver?.webSearch ?? { enabled: false },
      sessionMcp: { id: SESSION_MCP_SERVER_ID },
      role,
    });
    const specs: Record<string, ChildMcpServerSpec> = {};
    const servers: string[] = [];
    const skipped: string[] = [];
    for (const id of set.servers) {
      if (id === SESSION_MCP_SERVER_ID) { specs[id] = sessionMcpServerSpec({ command: this.options.sessionMcpCommand, credentialFile }); servers.push(id); continue; }
      const spec = resolver?.resolveServer(id);
      if (spec) { specs[id] = spec; servers.push(id); } else skipped.push(id);
    }
    // The role-specific advertised list is also the daemon's credential grant.
    return { mcp: { servers, sessionTools: [...set.sessionTools, "deck_status"] }, specs, skipped };
  }

  private async launchTurn(
    live: Live, turn: Turn, driver: RunnerSessionDriver, assignment: RunnerQualifiedAssignment, prompt: string,
    nativeSessionId: string | undefined, resume: { nativeSessionId: string } | undefined,
  ): Promise<void> {
    let outcome: TurnOutcome;
    let resolver: ChildMcpResolver | undefined;
    try {
      const probe = await driver.probe({ cwd: live.meta.projectRoot });
      if (probe.status === "blocked") throw new Error(probe.reasonCode ?? "driver-blocked");
      if (probe.status === "degraded") this.driverEvent(live, turn, assignment.runnerId, { kind: "diagnostic", data: { code: probe.reasonCode ?? "driver-degraded" } });
      const taskDir = live.paths.taskDir(turn.taskId);
      ensurePrivateDir(live.paths.tasksDir);
      ensurePrivateDir(taskDir);
      const credentialFile = live.paths.taskCredentialFile(turn.taskId);
      this.options.credentials.revokeTask(live.sessionId, turn.taskId);
      if (turn.controller.signal.aborted) throw new Error("turn-cancelled");
      resolver = typeof this.options.childMcp === "function" ? await this.options.childMcp(assignment.runnerId, { projectRoot: live.meta.projectRoot, sessionId: live.sessionId, taskId: turn.taskId, signal: turn.controller.signal }) : this.options.childMcp;
      if (turn.controller.signal.aborted) throw new Error("turn-cancelled");
      const child = this.childMcp(assignment.runnerId, credentialFile, resolver, turn.memberId === LEAD_MEMBER_ID ? "lead" : "member");
      this.options.credentials.issue({ sessionId: live.sessionId, taskId: turn.taskId, memberId: turn.memberId, runnerId: assignment.runnerId, allowedTools: child.mcp.sessionTools }, credentialFile);
      for (const id of child.skipped) this.driverEvent(live, turn, assignment.runnerId, { kind: "diagnostic", data: { code: "child-mcp-server-unresolved", server: id } });
      const approvals = this.options.config()?.approvals[assignment.runnerId] ?? "relay";
      const input: DriverTaskInput = {
        taskId: turn.taskId, memberId: turn.memberId, cwd: live.meta.projectRoot, assignment,
        rolePrompt: [this.options.rolePrompt?.(turn.memberId, { changeId: live.ledger.session.changeId, projectRoot: live.meta.projectRoot }) ?? defaultRolePrompt(live.ledger.session.changeId), live.ledger.session.changeId ? `Bound OpenSpec path: ${join(live.meta.projectRoot, "openspec", "changes", live.ledger.session.changeId)}. Keep this binding immutable.` : ""].filter(Boolean).join("\n"),
        prompt, ...(resume ? { resume } : {}), ...(!resume && nativeSessionId ? { nativeSessionId } : {}),
        mcp: child.mcp, mcpServerSpecs: child.specs, approvals, credentialFile, disableNativeDelegation: true,
      };
      const spawn = createDriverSpawn(this.options.supervisor, { lease: { file: live.paths.taskLeaseFile(turn.taskId), taskId: turn.taskId } });
      const io: DriverHostIo = {
        spawn: (command, args, options) => spawn(command, args, { ...options, env: { ...options?.env, ...resolver?.envOverlay } }),
        emit: (event) => this.driverEvent(live, turn, assignment.runnerId, event),
        approval: async (req) => {
          const pending = this.options.broker.request({ sessionId: live.sessionId, taskId: turn.taskId, memberId: turn.memberId, runnerId: assignment.runnerId, tool: req.tool, summary: req.summary, input: req.input });
          const resolution = await pending.resolution;
          return { decision: resolution.decision === "allow-once" ? "allow" : "deny" };
        },
        writePrivateFile: (name, content) => {
          const file = join(taskDir, assertSafeSegment(name, "file name"));
          writePrivateFile(file, content);
          return file;
        },
      };
      if (turn.controller.signal.aborted) throw new Error("turn-cancelled");
      const handle = await driver.startTask(input, io);
      turn.handle = handle;
      if (turn.kind) void handle.interrupt().catch(() => {});
      if (this.closing) void this.closeTurnHandle(turn).catch(() => {});
      if (!driver.newNativeSessionId) {
        void handle.nativeSessionId.then((id) => {
          if (id !== turn.nativeSessionId && live.turns.get(turn.taskId) === turn) {
            turn.nativeSessionId = id;
            try { this.append(live, { kind: "task.state", source: { taskId: turn.taskId, nativeSessionId: id }, data: { taskId: turn.taskId, state: "running", nativeSessionId: id } }); } catch { /* surfaced by append */ }
          }
        }, () => {});
      }
      outcome = await handle.done.catch((error: Error) => ({ status: "failed", error: bounded(error.message) }) as TurnOutcome);
    } catch (error) {
      outcome = turn.controller.signal.aborted ? { status: "interrupted" } : { status: "failed", error: `Unable to start the turn: ${bounded((error as Error).message)}`, ...((error as {reasonCode?: string}).reasonCode === "native-session-not-found" ? { reasonCode: "native-session-not-found" as const } : {}) };
    }
    let drained = true;
    try { await this.closeTurnHandle(turn); }
    catch (error) {
      drained = false;
      turn.ownershipUnsettled = true;
      outcome = { status: "failed", error: `Unable to close the turn: ${bounded((error as Error).message)}` };
      this.options.logger?.warn("session.mcp-binding-retained", { sessionId: live.sessionId, taskId: turn.taskId, reason: "native-close-failed" });
    }
    try { if (drained) await resolver?.release?.(); }
    catch { outcome = { status: "failed", error: "Unable to release the managed MCP binding" }; }
    if (outcome.reasonCode === "native-session-not-found" && resume && !turn.reseeded && !turn.kind && !this.closing && !live.stopping) {
      this.options.broker.cancelTask(live.sessionId, turn.taskId, "task-ended");
      this.options.credentials.revokeTask(live.sessionId, turn.taskId);
      const summary = this.taskSummary(live, turn.taskId);
      const source = { taskId: turn.taskId, memberId: turn.memberId, runnerId: assignment.runnerId };
      turn.attempt++; turn.reseeded = true; turn.nativeSessionId = driver.newNativeSessionId?.();
      turn.handle = undefined; turn.closeHandle = undefined; turn.lastText = undefined;
      this.append(live, [
        { kind: "task.state", source, data: { taskId: turn.taskId, state: "failed", reason: "native-session-not-found" } },
        { kind: "task.continued", source, data: { taskId: turn.taskId, attempt: turn.attempt, continuity: "reseeded", ...(turn.nativeSessionId ? { nativeSessionId: turn.nativeSessionId } : {}) } },
        { kind: "task.state", source, data: { taskId: turn.taskId, state: "running" } },
      ]);
      return this.launchTurn(live, turn, driver, assignment, `Native context was unavailable. Prior Deck task context (advisory):\n${summary}\nCurrent instruction:\n${prompt}`, turn.nativeSessionId, undefined);
    }
    this.finishTurn(live, turn, assignment.runnerId, outcome);
  }

  private closeTurnHandle(turn: Turn): Promise<void> {
    if (!turn.handle) return Promise.resolve();
    // Shutdown and natural completion may race. Share the actual drain promise even when
    // a driver's own close method returns early on a repeated call.
    return turn.closeHandle ??= Promise.resolve().then(() => turn.handle!.close());
  }

  private driverEvent(live: Live, turn: Turn, runnerId: string, event: DriverEvent): void {
    const driver = this.options.drivers.get(runnerId);
    const protocol = driver?.protocol ?? "unknown";
    const known = DRIVER_KINDS.has(event.kind);
    const kind: SessionEventKind = known ? (event.kind as SessionEventKind) : "runner.unmapped";
    const data: Record<string, unknown> = known ? { ...event.data } : { type: event.kind, ...(ALL_KINDS.has(event.kind) ? { reason: "kind-reserved-for-host" } : {}) };
    if (kind === "message.completed") {
      data.role ??= "assistant";
      if (data.role === "assistant" && typeof data.text === "string") turn.lastText = data.text;
    }
    const draft: EventDraft = {
      kind, data,
      source: { taskId: turn.taskId, memberId: turn.memberId, runnerId, ...(turn.nativeSessionId ? { nativeSessionId: turn.nativeSessionId } : {}) },
      ...(event.raw !== undefined ? { raw: boundRaw({ runnerId, protocol, payload: event.raw }) } : {}),
    };
    try { this.append(live, draft); } catch { /* live.broken is set; the turn winds down on its own */ }
  }

  private finishTurn(live: Live, turn: Turn, runnerId: string, outcome: TurnOutcome): void {
    try {
      let status = outcome.status;
      let reason: string | undefined;
      if (this.closing && status !== "completed") { status = "interrupted"; reason = "daemon-stopped"; }
      const stateFor = (): { state: "completed" | "failed" | "interrupted" | "cancelled" | "ownership-unsettled"; reason?: string } => {
        if (turn.ownershipUnsettled) return { state: "ownership-unsettled", reason: "native-close-failed" };
        if (status === "completed") return { state: "completed" };
        if (status === "failed") return { state: "failed", reason: bounded(outcome.error ?? "failed") };
        if (turn.kind === "cancel") return { state: "cancelled" };
        const why = reason ?? (status === "interrupted-forced" ? "interrupted-forced" : turn.kind === "stop" ? "session-stopped" : undefined);
        return { state: "interrupted", ...(why ? { reason: why } : {}) };
      };
      const task = stateFor();
      this.options.broker.cancelTask(live.sessionId, turn.taskId, "task-ended");
      const source = { taskId: turn.taskId, memberId: turn.memberId, runnerId, ...(turn.nativeSessionId ? { nativeSessionId: turn.nativeSessionId } : {}) };
      const drafts: EventDraft[] = [
        { kind: "turn.completed", source, data: { status, ...(outcome.error ? { error: bounded(outcome.error) } : {}) } },
      ];
      if (turn.lastText) drafts.push({ kind: "task.result", source, data: { taskId: turn.taskId, summary: turn.lastText } });
      drafts.push({ kind: "task.state", source, data: { taskId: turn.taskId, state: task.state, ...(task.reason ? { reason: task.reason } : {}) } });
      if (!live.stopping && live.turns.size === 1) drafts.push({ kind: "session.state", data: { state: "idle" } });
      this.append(live, drafts);
    } catch (error) {
      this.options.logger?.error("turn.finish-failed", { sessionId: live.sessionId, error: (error as Error).message });
    } finally {
      this.options.credentials.revokeTask(live.sessionId, turn.taskId);
      live.turns.delete(turn.taskId);
      if (turn.taskId !== LEAD_TASK_ID) this.queueNotice(live, turn, live.ledger.latest(turn.taskId)?.state ?? outcome.status);
      try { saveLedgerSnapshot(live.ledger, live.log, live.paths.ledgerSnapshotFile); } catch { /* optimisation only */ }
      if (live.stopping && live.turns.size === 0 && live.ledger.session.state !== "ended" && !live.ledger.tasks().some((task) => task.attempts.at(-1)?.state === "ownership-unsettled")) {
        try { this.append(live, { kind: "session.ended", data: { reason: "stopped" } }); } catch { /* surfaced by append */ }
      }
      turn.resolveDone();
      this.schedule(live);
      this.scheduleWake(live);
    }
  }

  // ---- interrupt / cancel / approvals / bind / stop ---------------------------------------

  private interrupt(live: Live, command: Extract<SessionCommand, { type: "turn.interrupt" }>, kind: "interrupt" | "cancel", receiptType?: string): ExecuteOutcome {
    if (!live.ledger.task(command.taskId)) return fail("task-unknown");
    const turn = live.turns.get(command.taskId);
    if (!turn) {
      const queued = live.queue.find((t) => t.taskId === command.taskId);
      if (!queued || kind !== "cancel") return fail("turn-not-running");
      this.append(live, this.receiptDraft({ ...command, type: (receiptType ?? command.type) as never }, { ok: true }));
      this.cancelQueued(live, command.taskId); return ok();
    }
    const receipt: SessionCommand = { ...command, type: (receiptType ?? command.type) as never } as SessionCommand;
    try { this.append(live, this.receiptDraft(receipt, { ok: true })); } catch { return fail("log-write-failed"); }
    turn.kind ??= kind;
    turn.controller.abort();
    void turn.handle?.interrupt().catch((error: Error) => this.options.logger?.warn("turn.interrupt-failed", { sessionId: live.sessionId, error: error.message }));
    return ok();
  }

  private approvalRespond(live: Live, command: Extract<SessionCommand, { type: "approval.respond" }>, clientId: string): ExecuteOutcome {
    const pending = this.options.broker.pending().find((p) => p.approvalId === command.approvalId);
    if (pending && pending.sessionId !== live.sessionId) return fail("unknown-approval");
    const result = this.options.broker.respond({ approvalId: command.approvalId, decision: command.decision, by: clientId });
    if (!result.ok) return fail(result.code);
    try { this.append(live, this.receiptDraft(command, { ok: true })); } catch { /* the decision already took effect */ }
    return ok();
  }

  private bindChange(live: Live, command: Extract<SessionCommand, { type: "session.bindChange" }>): ExecuteOutcome {
    if (!this.validChangeId(command.changeId)) return fail("invalid-change-id");
    const current = live.ledger.session.changeId;
    if (current && current !== command.changeId) return fail("change-already-bound", `Bound to ${current}`);
    const drafts: EventDraft[] = [this.receiptDraft(command, { ok: true })];
    if (!current) drafts.push({ kind: "session.bound", data: { changeId: command.changeId } });
    try { this.append(live, drafts); } catch { return fail("log-write-failed"); }
    return ok();
  }

  private stop(live: Live, command: Extract<SessionCommand, { type: "session.stop" }>): ExecuteOutcome {
    const state = live.ledger.session.state;
    if (state === "ended") return ok({ state: "ended" });
    const running = [...live.turns.values()];
    const unsettled = live.ledger.tasks().some((task) => task.attempts.at(-1)?.state === "ownership-unsettled");
    const outcome = { ok: true as const, data: { state: running.length || unsettled ? "stopping" : "ended" } };
    const drafts: EventDraft[] = [this.receiptDraft(command, outcome)];
    if (state !== "stopping") drafts.push({ kind: "session.state", data: { state: "stopping" } });
    if (!running.length && !unsettled) drafts.push({ kind: "session.ended", data: { reason: "stopped" } });
    try { this.append(live, drafts); } catch { return fail("log-write-failed"); }
    live.stopping = true;
    this.cancelQueued(live);
    if (live.wakeTimer !== undefined) this.clock.clearTimeout(live.wakeTimer);
    live.wakeTimer = undefined; live.notices.clear();
    if (running.length) {
      for (const turn of running) { turn.kind = "stop"; turn.controller.abort(); void turn.handle?.interrupt().catch(() => {}); }
    } else {
      try { saveLedgerSnapshot(live.ledger, live.log, live.paths.ledgerSnapshotFile); } catch { /* optimisation only */ }
    }
    return outcome;
  }

  // ---- queries ----------------------------------------------------------------------------

  private sessionIds(): string[] {
    try { return readdirSync(this.options.paths.sessionsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  }

  private summarize(sessionId: string): SessionSummary | undefined {
    const cached = this.sessions.get(sessionId);
    let paths: SessionPaths;
    try { paths = sessionPaths(this.options.paths, sessionId); } catch { return undefined; }
    const meta = cached?.meta ?? this.readMeta(paths);
    if (!meta) return undefined;
    let log = cached?.log;
    let ledger = cached?.ledger;
    let temporary: EventLog | undefined;
    try {
      if (!log || !ledger) {
        temporary = EventLog.open({ dir: paths.eventsDir, sessionId, clock: this.clock });
        log = temporary;
        ledger = loadLedger(temporary, paths.ledgerSnapshotFile).ledger;
      }
      const lastEvent = log.lastSeq > 0 ? log.readAfter(log.lastSeq - 1).next().value : undefined;
      const lead = meta.members[LEAD_MEMBER_ID];
      return {
        sessionId, projectRoot: meta.projectRoot, ...(ledger.session.changeId ? { changeId: ledger.session.changeId } : {}),
        state: ledger.session.state, createdAt: meta.createdAt, updatedAt: lastEvent?.ts ?? meta.createdAt, lastSeq: log.lastSeq,
        ...(lead ? { lead } : {}), running: !!cached && (cached.turns.size > 0 || cached.queue.length > 0), tasks: ledger.tasks().length,
        activeTasks: ledger.tasks().filter((t) => !TERMINAL_TASK_STATES.includes(t.attempts.at(-1)!.state)).length,
      };
    } catch (error) {
      this.options.logger?.warn("session.summary-failed", { sessionId, error: (error as Error).message });
      return undefined;
    } finally {
      temporary?.close();
    }
  }

  private listSessions(): SessionSummary[] {
    return this.sessionIds().map((id) => this.summarize(id)).filter((s): s is SessionSummary => s !== undefined)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Retention: remove idle, finished-looking sessions that are older than `maxAgeDays` or beyond the newest `keep`. */
  private prune(args: { maxAgeDays?: number; keep?: number; dryRun?: boolean }): { removed: string[]; kept: number; dryRun: boolean } {
    const maxAgeMs = (Number.isFinite(args.maxAgeDays) && args.maxAgeDays! >= 0 ? args.maxAgeDays! : DEFAULT_RETENTION_DAYS) * 86_400_000;
    const keep = Number.isInteger(args.keep) && args.keep! >= 0 ? args.keep! : DEFAULT_RETENTION_COUNT;
    const dryRun = args.dryRun === true;
    const summaries = this.listSessions().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const removed: string[] = [];
    summaries.forEach((s, index) => {
      if (s.running || s.activeTasks > 0) return;
      const live = this.sessions.get(s.sessionId);
      const age = this.clock.now() - Date.parse(s.updatedAt);
      if (!(age > maxAgeMs || index >= keep)) return;
      removed.push(s.sessionId);
      if (dryRun) return;
      if (live) { this.release(live); this.sessions.delete(s.sessionId); }
      try { rmSync(sessionPaths(this.options.paths, s.sessionId).dir, { recursive: true, force: true }); } catch (error) {
        this.options.logger?.warn("session.prune-failed", { sessionId: s.sessionId, error: (error as Error).message });
      }
    });
    return { removed, kept: summaries.length - removed.length, dryRun };
  }

  private async driversStatus(): Promise<unknown> {
    const cfg = this.options.config();
    const probes = new Map<string, Awaited<ReturnType<RunnerSessionDriver["probe"]>>>();
    const probeOf = async (driver: RunnerSessionDriver) => {
      if (!probes.has(driver.runnerId)) {
        try { probes.set(driver.runnerId, await driver.probe({ cwd: process.cwd() })); } catch (error) {
          probes.set(driver.runnerId, { status: "blocked", reasonCode: "probe-failed", capabilities: [], ...(error ? {} : {}) });
        }
      }
      return probes.get(driver.runnerId)!;
    };
    const drivers = await Promise.all(this.options.drivers.list().map(async (d) => ({
      runnerId: d.runnerId, protocol: d.protocol, testedVersions: d.testedVersions, probe: await probeOf(d),
    })));
    const members: Record<string, unknown> = {};
    for (const [memberId, a] of Object.entries(cfg?.members ?? {})) {
      const driver = this.options.drivers.get(a.runnerId);
      const probe = driver ? await probeOf(driver) : undefined;
      members[memberId] = { ...a, blocked: !driver ? "runner-driver-unavailable" : probe!.status === "blocked" ? (probe!.reasonCode ?? "driver-blocked") : null };
    }
    return { enabled: cfg?.enabled === true, drivers, members };
  }
}

function defaultSessionId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function defaultRolePrompt(changeId: string | undefined): string {
  return [
    "You are the Lead of a Deck Developer Team session running in a Deck-supervised cross-runner session.",
    changeId ? `This session is bound to the OpenSpec change "${changeId}".` : "",
  ].filter(Boolean).join("\n");
}

