/**
 * SessionManager (task 1.16, XR-3.x, XR-5.x, XR-6.1 for a single member): implements the
 * `SessionService` port for single-member Lead sessions. It owns session lifecycle, the event
 * log + ledger of each session, and the coupling of a runner driver, the ApprovalBroker and
 * task credentials. Delegation, shared services and other members arrive in later stages.
 *
 * Invariants kept here:
 *  - the event log is the only durable truth; the ledger is applied live from it;
 *  - the native session id is persisted (task.created / task.continued) BEFORE the driver starts;
 *  - every accepted command writes a `command.accepted` receipt in the same atomic batch as its
 *    first effect, so a duplicate commandId after a daemon restart never re-executes (XR-1.5);
 *  - drivers can only emit content-class events; ledger-affecting events are written by the host.
 */
import { randomBytes } from "node:crypto";
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
import { DEFAULT_ALLOWED_TOOLS, SESSION_MCP_SERVER_ID, sessionMcpServerSpec } from "./bridge-config";
import { systemClock, type Clock } from "./clock";
import type { CredentialGrant, CredentialRegistry } from "./credentials";
import { createDriverSpawn } from "./driver-spawn";
import { EventLog, type EventDraft } from "./event-log";
import { Ledger, loadLedger, saveLedgerSnapshot, TERMINAL_TASK_STATES } from "./ledger";
import type { DaemonLogger } from "./daemon-logger";
import { assertOutsideProject, assertSafeSegment, ensurePrivateDir, sessionPaths, writePrivateFile, type SessionPaths, type StatePaths } from "./paths";
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
  "usage", "rate-limit", "diagnostic", "runner.unmapped", "memory.recalled", "memory.proposed", "memory.written",
]);
const ALL_KINDS = new Set<string>(SESSION_EVENT_KINDS);

export type DriverLookup = { get(runnerId: string): RunnerSessionDriver | undefined; list(): readonly RunnerSessionDriver[] };

export type ChildMcpResolver = {
  /** Server ids Deck configured for the runner, before the memory/web/session adjustments of `computeChildMcpSet`. */
  runnerPackages(runnerId: string): readonly string[];
  memoryProviderIds?: readonly string[];
  webSearch?: { enabled: boolean; serverId?: string };
  /** Launch spec for a non-session server id; undefined means it cannot be launched (skipped with a diagnostic). */
  resolveServer(id: string): ChildMcpServerSpec | undefined;
};

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
  rolePrompt?: (memberId: string, context: { changeId?: string }) => string;
  childMcp?: ChildMcpResolver;
  clock?: Clock;
  logger?: DaemonLogger;
  newSessionId?: () => string;
};

type SessionMeta = {
  v: 1; sessionId: string; projectRoot: string; changeId?: string; createdAt: string; createCommandId: string;
  members: CrossTeamAssignments;
};

type Turn = {
  attempt: number;
  nativeSessionId?: string;
  handle?: DriverTaskHandle;
  kind?: "interrupt" | "cancel" | "stop";
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
  turn?: Turn;
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
  private readonly clock: Clock;
  private closing = false;

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
    for (const live of this.sessions.values()) if (live.turn) return true;
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
      default: return { ok: false, code: "query-unknown", message: name };
    }
  }

  /** Daemon shutdown: finish running turns (their processes are ended by the supervisor first), checkpoint, close logs. */
  async close(): Promise<void> {
    this.closing = true;
    const turns = [...this.sessions.values()].flatMap((l) => (l.turn ? [l.turn] : []));
    for (const turn of turns) void turn.handle?.interrupt().catch(() => {});
    await Promise.race([Promise.all(turns.map((t) => t.done)), new Promise<void>((resolve) => { this.clock.setTimeout(resolve, CLOSE_WAIT_MS); })]);
    for (const live of this.sessions.values()) this.release(live);
    this.sessions.clear();
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
    const live: Live = { sessionId: meta.sessionId, paths, meta, log, ledger, unsubscribe: () => {}, stopping: false, broken: false };
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

  private async create(command: Extract<SessionCommand, { type: "session.create" }>, clientId: string): Promise<ExecuteOutcome> {
    const existing = this.findCreatedBy(command.commandId);
    if (existing) {
      const live = this.load(existing);
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
    if (probe.status === "blocked") return fail(probe.reasonCode ?? "driver-blocked", `${lead.runnerId} driver is blocked`);

    const sessionId = (this.options.newSessionId ?? defaultSessionId)(this.clock.now());
    const paths = sessionPaths(this.options.paths, sessionId);
    ensurePrivateDir(paths.dir.replace(/[/\\][^/\\]+$/, ""));
    ensurePrivateDir(paths.dir);
    const meta: SessionMeta = {
      v: 1, sessionId, projectRoot, createdAt: new Date(this.clock.now()).toISOString(), createCommandId: command.commandId,
      members: { [LEAD_MEMBER_ID]: lead }, ...(command.changeId ? { changeId: command.changeId } : {}),
    };
    writePrivateFile(paths.sessionFile, JSON.stringify(meta));
    const live = this.open(paths, meta);
    this.sessions.set(sessionId, live);
    const drafts: EventDraft[] = [{
      kind: "session.created",
      data: { projectRoot, commandId: command.commandId, createdBy: clientId, members: { [LEAD_MEMBER_ID]: lead }, ...(command.changeId ? { changeId: command.changeId } : {}) },
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
    if (live.turn) return fail("turn-in-progress");
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
    drafts.push({ kind: "message.completed", source: { memberId: LEAD_MEMBER_ID, taskId: LEAD_TASK_ID }, data: { role: "user", text: command.text, by: clientId } });
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

    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const turn: Turn = { attempt, ...(nativeSessionId ? { nativeSessionId } : {}), done, resolveDone };
    live.turn = turn;
    void this.launchTurn(live, turn, driver, assignment, command.text, nativeSessionId, resume);
    return ok({ taskId: LEAD_TASK_ID, attempt });
  }

  private childMcp(runnerId: string, credentialFile: string): { mcp: DriverTaskInput["mcp"]; specs: Record<string, ChildMcpServerSpec>; skipped: string[] } {
    const resolver = this.options.childMcp;
    const set = computeChildMcpSet({
      runnerPackages: resolver?.runnerPackages(runnerId) ?? [],
      memoryProviderIds: resolver?.memoryProviderIds ?? [],
      webSearch: resolver?.webSearch ?? { enabled: false },
      sessionMcp: { id: SESSION_MCP_SERVER_ID },
      role: "lead",
    });
    const specs: Record<string, ChildMcpServerSpec> = {};
    const servers: string[] = [];
    const skipped: string[] = [];
    for (const id of set.servers) {
      if (id === SESSION_MCP_SERVER_ID) { specs[id] = sessionMcpServerSpec({ command: this.options.sessionMcpCommand, credentialFile }); servers.push(id); continue; }
      const spec = resolver?.resolveServer(id);
      if (spec) { specs[id] = spec; servers.push(id); } else skipped.push(id);
    }
    // Only the tools the bridge actually serves in this stage are advertised/granted.
    return { mcp: { servers, sessionTools: [...DEFAULT_ALLOWED_TOOLS] }, specs, skipped };
  }

  private async launchTurn(
    live: Live, turn: Turn, driver: RunnerSessionDriver, assignment: RunnerQualifiedAssignment, prompt: string,
    nativeSessionId: string | undefined, resume: { nativeSessionId: string } | undefined,
  ): Promise<void> {
    let outcome: TurnOutcome;
    try {
      const taskDir = live.paths.taskDir(LEAD_TASK_ID);
      ensurePrivateDir(live.paths.tasksDir);
      ensurePrivateDir(taskDir);
      const grant: CredentialGrant = { sessionId: live.sessionId, taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId: assignment.runnerId, allowedTools: [...DEFAULT_ALLOWED_TOOLS] };
      const credentialFile = live.paths.taskCredentialFile(LEAD_TASK_ID);
      this.options.credentials.revokeTask(LEAD_TASK_ID);
      this.options.credentials.issue(grant, credentialFile);
      const child = this.childMcp(assignment.runnerId, credentialFile);
      for (const id of child.skipped) this.driverEvent(live, turn, assignment.runnerId, { kind: "diagnostic", data: { code: "child-mcp-server-unresolved", server: id } });
      const approvals = this.options.config()?.approvals[assignment.runnerId] ?? "relay";
      const input: DriverTaskInput = {
        taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, cwd: live.meta.projectRoot, assignment,
        rolePrompt: this.options.rolePrompt?.(LEAD_MEMBER_ID, { changeId: live.ledger.session.changeId }) ?? defaultRolePrompt(live.ledger.session.changeId),
        prompt, ...(resume ? { resume } : {}), ...(!resume && nativeSessionId ? { nativeSessionId } : {}),
        mcp: child.mcp, mcpServerSpecs: child.specs, approvals, credentialFile, disableNativeDelegation: true,
      };
      const io: DriverHostIo = {
        spawn: createDriverSpawn(this.options.supervisor, { lease: { file: live.paths.taskLeaseFile(LEAD_TASK_ID), taskId: LEAD_TASK_ID } }),
        emit: (event) => this.driverEvent(live, turn, assignment.runnerId, event),
        approval: async (req) => {
          const pending = this.options.broker.request({ sessionId: live.sessionId, taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId: assignment.runnerId, tool: req.tool, summary: req.summary, input: req.input });
          const resolution = await pending.resolution;
          return { decision: resolution.decision === "allow-once" ? "allow" : "deny" };
        },
        writePrivateFile: (name, content) => {
          const file = join(taskDir, assertSafeSegment(name, "file name"));
          writePrivateFile(file, content);
          return file;
        },
      };
      const handle = await driver.startTask(input, io);
      turn.handle = handle;
      if (turn.kind) void handle.interrupt().catch(() => {});
      if (!driver.newNativeSessionId) {
        void handle.nativeSessionId.then((id) => {
          if (id !== turn.nativeSessionId && live.turn === turn) {
            turn.nativeSessionId = id;
            try { this.append(live, { kind: "task.state", source: { taskId: LEAD_TASK_ID, nativeSessionId: id }, data: { taskId: LEAD_TASK_ID, state: "running", nativeSessionId: id } }); } catch { /* surfaced by append */ }
          }
        }, () => {});
      }
      outcome = await handle.done.catch((error: Error) => ({ status: "failed", error: bounded(error.message) }) as TurnOutcome);
    } catch (error) {
      outcome = { status: "failed", error: `Unable to start the turn: ${bounded((error as Error).message)}` };
    }
    this.finishTurn(live, turn, assignment.runnerId, outcome);
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
      source: { taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId, ...(turn.nativeSessionId ? { nativeSessionId: turn.nativeSessionId } : {}) },
      ...(event.raw !== undefined ? { raw: boundRaw({ runnerId, protocol, payload: event.raw }) } : {}),
    };
    try { this.append(live, draft); } catch { /* live.broken is set; the turn winds down on its own */ }
  }

  private finishTurn(live: Live, turn: Turn, runnerId: string, outcome: TurnOutcome): void {
    try {
      let status = outcome.status;
      let reason: string | undefined;
      if (this.closing && status !== "completed") { status = "interrupted"; reason = "daemon-stopped"; }
      const stateFor = (): { state: "completed" | "failed" | "interrupted" | "cancelled"; reason?: string } => {
        if (status === "completed") return { state: "completed" };
        if (status === "failed") return { state: "failed", reason: bounded(outcome.error ?? "failed") };
        if (turn.kind === "cancel") return { state: "cancelled" };
        const why = reason ?? (status === "interrupted-forced" ? "interrupted-forced" : turn.kind === "stop" ? "session-stopped" : undefined);
        return { state: "interrupted", ...(why ? { reason: why } : {}) };
      };
      const task = stateFor();
      this.options.broker.cancelTask(LEAD_TASK_ID, "task-ended");
      const source = { taskId: LEAD_TASK_ID, memberId: LEAD_MEMBER_ID, runnerId, ...(turn.nativeSessionId ? { nativeSessionId: turn.nativeSessionId } : {}) };
      const drafts: EventDraft[] = [
        { kind: "turn.completed", source, data: { status, ...(outcome.error ? { error: bounded(outcome.error) } : {}) } },
      ];
      if (turn.lastText) drafts.push({ kind: "task.result", source, data: { taskId: LEAD_TASK_ID, summary: turn.lastText } });
      drafts.push({ kind: "task.state", source, data: { taskId: LEAD_TASK_ID, state: task.state, ...(task.reason ? { reason: task.reason } : {}) } });
      if (!live.stopping) drafts.push({ kind: "session.state", data: { state: "idle" } });
      this.append(live, drafts);
    } catch (error) {
      this.options.logger?.error("turn.finish-failed", { sessionId: live.sessionId, error: (error as Error).message });
    } finally {
      this.options.credentials.revokeTask(LEAD_TASK_ID);
      live.turn = undefined;
      try { saveLedgerSnapshot(live.ledger, live.log, live.paths.ledgerSnapshotFile); } catch { /* optimisation only */ }
      if (live.stopping && live.ledger.session.state !== "ended") {
        try { this.append(live, { kind: "session.ended", data: { reason: "stopped" } }); } catch { /* surfaced by append */ }
      }
      turn.resolveDone();
    }
  }

  // ---- interrupt / cancel / approvals / bind / stop ---------------------------------------

  private interrupt(live: Live, command: Extract<SessionCommand, { type: "turn.interrupt" }>, kind: "interrupt" | "cancel", receiptType?: string): ExecuteOutcome {
    if (command.taskId !== LEAD_TASK_ID || !live.ledger.task(LEAD_TASK_ID)) return fail("task-unknown");
    const turn = live.turn;
    if (!turn) return fail("turn-not-running");
    const receipt: SessionCommand = { ...command, type: (receiptType ?? command.type) as never } as SessionCommand;
    try { this.append(live, this.receiptDraft(receipt, { ok: true })); } catch { return fail("log-write-failed"); }
    turn.kind ??= kind;
    void turn.handle?.interrupt().catch((error: Error) => this.options.logger?.warn("turn.interrupt-failed", { sessionId: live.sessionId, error: error.message }));
    return ok();
  }

  private approvalRespond(live: Live, command: Extract<SessionCommand, { type: "approval.respond" }>, clientId: string): ExecuteOutcome {
    const known = this.options.broker.pending().some((p) => p.approvalId === command.approvalId && p.sessionId === live.sessionId);
    const result = this.options.broker.respond({ approvalId: command.approvalId, decision: command.decision, by: clientId });
    if (!known && result.ok) return fail("unknown-approval"); // defensive: never reachable, respond() only settles pending ids
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
    const running = live.turn;
    const outcome = { ok: true as const, data: { state: running ? "stopping" : "ended" } };
    const drafts: EventDraft[] = [this.receiptDraft(command, outcome)];
    if (state !== "stopping") drafts.push({ kind: "session.state", data: { state: "stopping" } });
    if (!running) drafts.push({ kind: "session.ended", data: { reason: "stopped" } });
    try { this.append(live, drafts); } catch { return fail("log-write-failed"); }
    live.stopping = true;
    if (running) {
      running.kind = "stop";
      void running.handle?.interrupt().catch(() => {});
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
        ...(lead ? { lead } : {}), running: cached?.turn !== undefined, tasks: ledger.tasks().length,
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

