/**
 * Claude session driver (D-22, XR-4.x, XR-5.4): one `claude -p` process per turn behind the
 * host's process-group anchor, stream-json in and out. The driver never spawns directly
 * (XR-4.2): the host's supervised spawn is the only way a process starts.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { redactText } from "@deck/core/session/redaction";
import type {
  DriverEvent, DriverHostIo, DriverProbe, DriverProbeContext, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver,
  SupervisedChild, SupervisedChildExit, TurnOutcome,
} from "@deck/core/session/driver";
import { buildClaudeTurnLaunch, ClaudeLaunchError, encodeUserMessage, type ClaudeTurnLaunch } from "./launch";
import { CLAUDE_PROTOCOL, ClaudeLineSplitter, ClaudeStreamMapper, parseClaudeLine, type ClaudeInit, type ClaudeResult } from "./mapper";

export const CLAUDE_TESTED_VERSIONS = { min: "2.1.296", maxTested: "2.1.296" } as const;
export const INTERRUPT_ESCALATION_MS = 10_000;
export const KILL_GRACE_MS = 2_000;
const STDERR_TAIL = 2048;
const PROBE_TIMEOUT_MS = 5_000;
const CAPABILITIES = ["caller-assigned-session-id", "approval-relay", "interrupt-sigint", "strict-mcp-config", "hooks-disabled"] as const;

type TimerApi = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
export type ProbeExec = (command: string, args: readonly string[], options: { cwd?: string; timeoutMs: number }) => Promise<{ code: number | null; stdout: string }>;

export type ClaudeSessionDriverOptions = {
  executable?: string;
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Extra argv for the opt-in live contract script only (see launch.ts). */
  extraArgs?: readonly string[];
  clock?: TimerApi;
  escalationMs?: number;
  killGraceMs?: number;
  /** Short `--version` query for the probe. Not a task process; injected so tests never run the real CLI. */
  exec?: ProbeExec;
  /** XR-12.1: the Claude driver is blocked until the personal-use notice was acknowledged. */
  tosAcknowledged?: () => boolean;
};

const defaultExec: ProbeExec = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, [...args], { cwd: options.cwd, timeout: options.timeoutMs, encoding: "utf8", windowsHide: true }, (error, stdout) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return reject(error);
    resolve({ code: error ? 1 : 0, stdout: String(stdout ?? "") });
  });
});

const defaultClock: TimerApi = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

function parseVersion(text: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1];
}
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  return 0;
}

type TurnState = {
  child?: SupervisedChild;
  interruptRequested: boolean;
  interruptDelivered: boolean;
  forced: boolean;
  closing: boolean;
  finished: boolean;
  escalation?: unknown;
  fatal?: string;
  init?: ClaudeInit;
  result?: ClaudeResult;
  stderr: string;
};

class ClaudeTask {
  private current: TurnState | undefined;
  private closed = false;

  constructor(
    private readonly input: DriverTaskInput,
    private readonly io: DriverHostIo,
    private readonly nativeId: string,
    private readonly options: Required<Pick<ClaudeSessionDriverOptions, "escalationMs" | "killGraceMs">> & { clock: TimerApi; executable?: string; baseEnv?: ClaudeSessionDriverOptions["baseEnv"]; extraArgs?: readonly string[] },
  ) {}

  get id(): string { return this.nativeId; }

  /** Whether the next turn must resume: the first turn of a fresh native session assigns the id instead. */
  private firstTurnPending = true;

  async runTurn(prompt: string): Promise<TurnOutcome> {
    if (this.closed) throw new Error("Claude task is closed");
    if (this.current) throw new Error("A Claude turn is already running");
    const resume = this.input.resume !== undefined || !this.firstTurnPending;
    this.firstTurnPending = false;
    const emit = (event: DriverEvent) => { try { this.io.emit(event); } catch { /* a sink failure must not break the turn */ } };

    let launch: ClaudeTurnLaunch;
    try {
      launch = buildClaudeTurnLaunch(
        { ...this.input, prompt, ...(resume ? { resume: { nativeSessionId: this.nativeId }, nativeSessionId: undefined } : { resume: undefined, nativeSessionId: this.nativeId }) },
        this.io,
        { executable: this.options.executable, baseEnv: this.options.baseEnv, extraArgs: this.options.extraArgs },
      );
    } catch (error) {
      const code = error instanceof ClaudeLaunchError ? error.code : "claude-launch-failed";
      emit({ kind: "diagnostic", data: { code } });
      return { status: "failed", error: `${code}: ${(error as Error).message}` };
    }
    for (const d of launch.diagnostics) emit({ kind: "diagnostic", data: { ...d } });

    const state: TurnState = { interruptRequested: false, interruptDelivered: false, forced: false, closing: false, finished: false, stderr: "" };
    this.current = state;
    let child: SupervisedChild;
    try {
      child = await this.io.spawn(launch.command, launch.args, { cwd: this.input.cwd, env: launch.env });
    } catch (error) {
      this.current = undefined;
      return { status: "failed", error: `Unable to start claude: ${redactText((error as Error).message, 300)}` };
    }
    state.child = child;
    const splitter = new ClaudeLineSplitter();
    const mapper = new ClaudeStreamMapper();
    const onLine = (line: string) => this.onLine(line, mapper, state, launch, emit);
    child.onStdout((chunk) => { for (const line of splitter.push(chunk)) onLine(line); });
    child.onStderr((chunk) => { state.stderr = (state.stderr + chunk).slice(-STDERR_TAIL); });
    if (state.interruptRequested) this.deliverInterrupt(state);
    child.writeStdin(encodeUserMessage(prompt));
    child.endStdin();

    let exit: SupervisedChildExit;
    try { exit = await child.exited; } catch (error) {
      exit = { ok: false, code: null, signal: null, drained: false, anchorLost: true, error: (error as Error).message };
    }
    for (const line of splitter.flush()) onLine(line);
    if (splitter.overflowed) emit({ kind: "diagnostic", data: { code: "claude-line-too-long" } });
    state.finished = true;
    if (state.escalation !== undefined) this.options.clock.clearTimeout(state.escalation);
    this.current = undefined;
    return this.outcome(state, exit);
  }

  private onLine(line: string, mapper: ClaudeStreamMapper, state: TurnState, launch: ClaudeTurnLaunch, emit: (e: DriverEvent) => void): void {
    const parsed = parseClaudeLine(line);
    const events = parsed.ok ? undefined : mapper.unparsable(line);
    if (events) { for (const e of events) emit(e); return; }
    if (!parsed.ok) return;
    const out = mapper.map(parsed.message);
    for (const e of out.events) emit(e);
    if (out.result) state.result = out.result;
    if (out.init) { state.init = out.init; this.checkInit(out.init, state, launch, emit); }
  }

  /** Fail closed when the native CLI does not run the isolated configuration Deck asked for. */
  private checkInit(init: ClaudeInit, state: TurnState, launch: ClaudeTurnLaunch, emit: (e: DriverEvent) => void): void {
    const expected = launch.expectedMcpServers;
    const actual = init.mcpServers.map((s) => s.name);
    const missing = expected.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !expected.includes(n));
    for (const server of init.mcpServers) {
      if (server.status && server.status !== "connected" && expected.includes(server.name)) {
        emit({ kind: "diagnostic", data: { code: "claude-mcp-server-not-connected", server: server.name, status: server.status } });
      }
    }
    if (missing.length > 0 || extra.length > 0) {
      emit({ kind: "diagnostic", data: { code: "claude-isolation-violation", expected, actual, missing, extra } });
      this.fail(state, "claude-isolation-violation: the native CLI did not load exactly the Deck-computed MCP set");
      return;
    }
    if (init.sessionId !== this.nativeId) {
      emit({ kind: "diagnostic", data: { code: "claude-session-id-mismatch", expected: this.nativeId, actual: init.sessionId } });
      this.fail(state, "claude-session-id-mismatch: the native CLI reported a different session id than the one assigned");
    }
  }

  private fail(state: TurnState, reason: string): void {
    if (state.fatal) return;
    state.fatal = reason;
    if (state.child) void state.child.terminateGroup(this.options.killGraceMs).catch(() => {});
  }

  private outcome(state: TurnState, exit: SupervisedChildExit): TurnOutcome {
    if (state.fatal) return { status: "failed", error: state.fatal };
    if (state.forced || state.closing) return { status: "interrupted-forced" };
    const result = state.result;
    if (result) {
      if (result.subtype === "success" && !result.isError) {
        return exit.ok ? { status: "completed" } : { status: "failed", error: `Claude output did not drain cleanly before exit${exit.error ? `: ${exit.error}` : ""}` };
      }
      if (result.subtype === "error_during_execution" && state.interruptRequested) return { status: "interrupted" };
      const detail = result.errors[0] ?? result.terminalReason ?? "no error detail";
      return { status: "failed", error: `Claude turn failed (${result.subtype}): ${detail}` };
    }
    if (state.interruptRequested && exit.ok) return { status: "interrupted" };
    const how = exit.anchorLost ? (exit.error ?? "Anchor ended before reporting the child's exit")
      : exit.ok ? "claude ended without a result" : `claude exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`}`;
    const tail = redactText(state.stderr, 400).trim();
    return { status: "failed", error: tail ? `${how}: ${tail}` : how };
  }

  async interrupt(): Promise<void> {
    const state = this.current;
    if (!state || state.finished || state.interruptRequested) return;
    state.interruptRequested = true;
    if (state.child) this.deliverInterrupt(state);
  }

  /** SIGINT to the CLI only (Claude needs a clean `result`); escalate to the group when ignored. */
  private deliverInterrupt(state: TurnState): void {
    if (state.interruptDelivered || !state.child) return;
    state.interruptDelivered = true;
    const sent = state.child.interrupt();
    if (!sent) return this.escalate(state);
    state.escalation = this.options.clock.setTimeout(() => this.escalate(state), this.options.escalationMs);
  }

  private escalate(state: TurnState): void {
    if (state.finished || state.forced) return;
    state.forced = true;
    try { this.io.emit({ kind: "diagnostic", data: { code: "claude-interrupt-escalated" } }); } catch { /* best effort */ }
    void state.child?.terminateGroup(this.options.killGraceMs).catch(() => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    const state = this.current;
    if (!state) return;
    state.closing = true;
    if (state.escalation !== undefined) this.options.clock.clearTimeout(state.escalation);
    if (state.child) await state.child.terminateGroup(this.options.killGraceMs).catch(() => {});
  }
}

export function createClaudeSessionDriver(options: ClaudeSessionDriverOptions = {}): RunnerSessionDriver {
  const executable = options.executable ?? "claude";
  const exec = options.exec ?? defaultExec;
  const resolved = {
    escalationMs: options.escalationMs ?? INTERRUPT_ESCALATION_MS,
    killGraceMs: options.killGraceMs ?? KILL_GRACE_MS,
    clock: options.clock ?? defaultClock,
    executable: options.executable,
    baseEnv: options.baseEnv,
    extraArgs: options.extraArgs,
  };

  return {
    runnerId: "claude",
    protocol: CLAUDE_PROTOCOL,
    testedVersions: { ...CLAUDE_TESTED_VERSIONS },
    newNativeSessionId: () => randomUUID(),

    async probe(ctx: DriverProbeContext): Promise<DriverProbe> {
      if (options.tosAcknowledged && !options.tosAcknowledged()) {
        return { status: "blocked", reasonCode: "claude-session-tos-unacknowledged", capabilities: [] };
      }
      let text: string;
      try { text = (await exec(ctx.executablePath ?? executable, ["--version"], { cwd: ctx.cwd, timeoutMs: PROBE_TIMEOUT_MS })).stdout; } catch {
        return { status: "blocked", reasonCode: "claude-not-installed", capabilities: [] };
      }
      const version = parseVersion(text);
      if (!version) return { status: "blocked", reasonCode: "claude-version-unparsable", capabilities: [] };
      if (compareVersions(version, CLAUDE_TESTED_VERSIONS.min) < 0) return { version, status: "blocked", reasonCode: "claude-version-unsupported", capabilities: [] };
      if (compareVersions(version, CLAUDE_TESTED_VERSIONS.maxTested) > 0) {
        return { version, status: "degraded", reasonCode: "claude-version-untested", capabilities: [...CAPABILITIES], mcpIsolationVerified: false };
      }
      return { version, status: "ready", capabilities: [...CAPABILITIES], mcpIsolationVerified: true };
    },

    async startTask(input: DriverTaskInput, io: DriverHostIo): Promise<DriverTaskHandle> {
      const nativeId = input.resume?.nativeSessionId ?? input.nativeSessionId ?? randomUUID();
      const task = new ClaudeTask(input, io, nativeId, resolved);
      const done = task.runTurn(input.prompt);
      return {
        nativeSessionId: Promise.resolve(task.id),
        send: (prompt) => task.runTurn(prompt),
        interrupt: () => task.interrupt(),
        done,
        close: () => task.close(),
      };
    },
  };
}
