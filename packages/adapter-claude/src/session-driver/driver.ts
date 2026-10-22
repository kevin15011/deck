import { PersonalMcpPreparationError } from "@deck/core/session/personal-mcp";
/**
 * Claude session driver (D-22, XR-4.x, XR-5.4): one `claude -p` process per turn behind the
 * host's process-group anchor, stream-json in and out. The driver never spawns directly
 * (XR-4.2): the host's supervised spawn is the only way a process starts.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { redactText } from "@deck/core/session/redaction";
import {CLAUDE_STEERING_CAPABILITY,matchesSteering,type SteeringInput,type SteeringOutcome} from '@deck/core/session/steering';
import type {
  DriverEvent, DriverHostIo, DriverImageInput, DriverProbe, DriverProbeContext, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver,
  SupervisedChild, SupervisedChildExit, TurnOutcome,
} from "@deck/core/session/driver";
import { prepareImages, redactImagePayload } from "./images";
import { buildClaudeTurnLaunch, ClaudeLaunchError, encodeUserMessage, type ClaudeTurnLaunch } from "./launch";
import { CLAUDE_PROTOCOL, ClaudeLineSplitter, ClaudeStreamMapper, parseClaudeLine, type ClaudeInit, type ClaudeResult } from "./mapper";
import {claudeTranscriptPath,readClaudeTranscript,reconcileClaudeHistory} from './steering';

export const CLAUDE_TESTED_VERSIONS = { min: "2.1.296", maxTested: "2.1.296" } as const;
export const INTERRUPT_ESCALATION_MS = 10_000;
export const KILL_GRACE_MS = 2_000;
const STDERR_TAIL = 2048;
const PROBE_TIMEOUT_MS = 5_000;
const CAPABILITIES = ["caller-assigned-session-id", "approval-relay", "interrupt-sigint", "native-mcp-additions", "native-customizations"] as const;

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
  /** Legacy compatibility callback; no longer used to gate session readiness. */
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

type PendingSteering = {input:SteeringInput;promise:Promise<SteeringOutcome>;resolve:(result:SteeringOutcome)=>void;settled:boolean};
type TurnState = {
  executionId: string;
  guarded: boolean;
  originalObserved: boolean;
  historyVerified: boolean;
  originalText: string;
  stdinEnded: boolean;
  historyReads: number;
  historyTimer?: unknown;
  steering: Map<string,PendingSteering>;
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
  private historyPath?: string;

  constructor(
    private readonly input: DriverTaskInput,
    private readonly io: DriverHostIo,
    private readonly nativeId: string,
    private readonly options: Required<Pick<ClaudeSessionDriverOptions, "escalationMs" | "killGraceMs">> & { clock: TimerApi; executable?: string; baseEnv?: ClaudeSessionDriverOptions["baseEnv"]; extraArgs?: readonly string[] },
  ) {}

  get id(): string { return this.nativeId; }

  /** Whether the next turn must resume: the first turn of a fresh native session assigns the id instead. */
  private firstTurnPending = true;

  async runTurn(prompt: string, images?: readonly DriverImageInput[]): Promise<TurnOutcome> {
    if (this.closed) throw new Error("Claude task is closed");
    if (this.current) throw new Error("A Claude turn is already running");
    let userMessage: string;
    const executionId=randomUUID(),guarded=this.input.steeringVersion==='2.1.296'&&!images?.length;
    try { userMessage = encodeUserMessage(prompt, prepareImages(images),guarded?{uuid:executionId,session_id:this.nativeId,origin:{kind:this.input.inputOrigin==='user'?'human':'coordinator'}}:undefined); }
    catch { return { status: "failed", error: "image-input-invalid" }; }
    const resume = this.input.resume !== undefined || !this.firstTurnPending;
    this.firstTurnPending = false;
    const emit = (event: DriverEvent) => { try { this.io.emit(event.kind === 'turn.started' ? { ...event, data: { ...event.data, nativeThreadId: this.nativeId, nativeTurnId: executionId } } : event); } catch { /* a sink failure must not break the turn */ } };

    let launch: ClaudeTurnLaunch;
    try {
      launch = buildClaudeTurnLaunch(
        { ...this.input, prompt, ...(resume ? { resume: { nativeSessionId: this.nativeId }, nativeSessionId: undefined } : { resume: undefined, nativeSessionId: this.nativeId }) },
        this.io,
        { executable: this.options.executable, baseEnv: this.options.baseEnv, extraArgs: this.options.extraArgs },
      );
    } catch (error) {
      const code = error instanceof ClaudeLaunchError ? error.code : error instanceof PersonalMcpPreparationError ? error.reasonCode : "claude-launch-failed";
      if (error instanceof PersonalMcpPreparationError) emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", conflicting: error.availability.map(item => item.id) } });
      emit({ kind: "diagnostic", data: { code } });
      return { status: "failed", error: `${code}: ${(error as Error).message}` };
    }
    if (launch.nativeMcpAvailability.length) emit({kind:"diagnostic",data:{code:"personal-mcp.sources",servers:launch.nativeMcpAvailability}});
    for (const d of launch.diagnostics) emit({ kind: "diagnostic", data: { ...d } });

    this.historyPath=claudeTranscriptPath(this.input.cwd,this.nativeId,launch.env);
    const state: TurnState = {executionId,guarded,originalObserved:false,historyVerified:false,originalText:prompt,stdinEnded:false,historyReads:0,steering:new Map(), interruptRequested: false, interruptDelivered: false, forced: false, closing: false, finished: false, stderr: "" };
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
    // Native personal hooks can share events. Event names alone no longer prove provider provenance.
    const memory = this.input.nativeMemory;
    const mapper = new ClaudeStreamMapper(memory?.plugin ? { ...memory, plugin: { ...memory.plugin, exclusiveHookEvents: [] } } : memory, this.nativeId, executionId);
    const onLine = (line: string) => this.onLine(line, mapper, state, launch, emit, Boolean(images?.length));
    child.onStdout((chunk) => { for (const line of splitter.push(chunk)) onLine(line); });
    child.onStderr((chunk) => { state.stderr = (state.stderr + chunk).slice(-STDERR_TAIL); });
    if (state.interruptRequested) this.deliverInterrupt(state);
    child.writeStdin(userMessage);
    if(!guarded)this.endStdin(state);

    let exit: SupervisedChildExit;
    try { exit = await child.exited; } catch (error) {
      exit = { ok: false, code: null, signal: null, drained: false, anchorLost: true, error: (error as Error).message };
    }
    for (const line of splitter.flush()) onLine(line);
    if (splitter.overflowed) emit({ kind: "diagnostic", data: { code: "claude-line-too-long" } });
    state.finished = true;
    if(state.historyTimer!==undefined)this.options.clock.clearTimeout(state.historyTimer);
    this.refreshSteering(state,true);
    if (state.escalation !== undefined) this.options.clock.clearTimeout(state.escalation);
    this.current = undefined;
    return this.outcome(state, exit);
  }

  private onLine(line: string, mapper: ClaudeStreamMapper, state: TurnState, launch: ClaudeTurnLaunch, emit: (e: DriverEvent) => void, imageTurn = false): void {
    if (state.fatal || state.finished || this.current !== state) return;
    const parsed = parseClaudeLine(line);
    const events = parsed.ok ? undefined : mapper.unparsable(imageTurn ? "Image turn native diagnostic omitted" : redactImagePayload(line));
    if (events) { for (const e of events) emit(e); return; }
    if (!parsed.ok) return;
    const message=parsed.message;
    // Each process belongs to one turn. A foreign session must not seed its failure/reset fallback.
    if ((message.type === "assistant" || message.type === "result" || message.type === "rate_limit_event")
      && typeof message.session_id === "string" && message.session_id !== this.nativeId && !(state.guarded && message.type === "result")) return;
    if(state.guarded&&message.type==='result'){
      if(message.session_id!==this.nativeId){this.fail(state,'claude-result-session-mismatch');return;}
      const ids=message.user_message_uuids;
      if(message.num_turns===0&&typeof message.user_message_uuid==='string'&&state.steering.has(message.user_message_uuid)){
        if(message.subtype!=='success'||message.is_error===true||!Array.isArray(ids)||ids.length!==1||ids[0]!==message.user_message_uuid){this.fail(state,'claude-result-correlation-mismatch');return;}
        this.resolveSteering(state.steering.get(message.user_message_uuid)!,{state:'unknown',reason:'claude-transcript-only'});
        return; // A no-query receipt cannot overwrite or complete the original execution.
      }
      if(message.user_message_uuid!==state.executionId||!Array.isArray(ids)||!ids.includes(state.executionId)){this.fail(state,'claude-result-correlation-mismatch');return;}
    }
    const out = mapper.map(redactImagePayload(parsed.message));
    for (const e of out.events) emit(e);
    if (out.result) {
      if(state.guarded&&out.result.sessionId!==this.nativeId){this.fail(state,'claude-result-session-mismatch');return;}
      if(state.guarded)state.result ??= out.result;else state.result=out.result;
      if(state.guarded){this.endStdin(state);emit({kind:'diagnostic',data:{code:'claude-steering-ended'}});this.refreshSteering(state);}
    }
    if (out.init) { state.init = out.init; this.checkInit(out.init, state, launch, emit); }
    if(state.guarded&&message.type==='user'&&message.session_id===this.nativeId){
      const content=message.message as {role?:unknown;content?:unknown}|undefined;
      if(message.uuid===state.executionId&&content?.role==='user'&&content.content===state.originalText)state.originalObserved=true;
      if(typeof message.uuid==='string'&&state.steering.has(message.uuid))this.refreshSteering(state);
    }
    if(state.guarded&&state.originalObserved&&!state.historyVerified&&!state.result&&state.historyReads<32){
      const roots=readClaudeTranscript(this.historyPath).filter((v:any)=>v?.uuid===state.executionId);state.historyReads++;
      const root=roots[0] as {type?:unknown;sessionId?:unknown;version?:unknown;queueTranscriptOnly?:unknown;message?:{role?:unknown;content?:unknown}}|undefined;
      if(roots.length===1&&root?.type==='user'&&root.sessionId===this.nativeId&&root.version==='2.1.296'&&root.queueTranscriptOnly!==true&&root.message?.role==='user'&&root.message.content===state.originalText){state.historyVerified=true;emit({kind:'diagnostic',data:{code:'claude-steering-ready'}});}
    }
  }

  /** Fail closed when the native CLI does not run the isolated configuration Deck asked for. */
  private checkInit(init: ClaudeInit, state: TurnState, launch: ClaudeTurnLaunch, emit: (e: DriverEvent) => void): void {
    if(state.guarded&&init.version!=='2.1.296'){state.guarded=false;this.endStdin(state);}
    const expected = launch.expectedMcpServers;
    const actual = init.mcpServers.map((s) => s.name);
    const missing = expected.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !expected.includes(n));
    const personal = actual.filter(id => !expected.includes(id));
    if (missing.length > 0 || extra.some(id => (this.input.suppressedMcpServers ?? []).includes(id))) {
      emit({ kind: "diagnostic", data: { code: "claude-isolation-violation", expected, actual, missing, extra } });
      this.fail(state, "claude-isolation-violation: the native CLI did not load exactly the Deck-computed MCP set");
      return;
    }
    for (const server of init.mcpServers) {
      if (server.status !== "connected" && expected.includes(server.name) ) {
        emit({ kind: "diagnostic", data: { code: "claude-mcp-server-not-connected", server: server.name, status: server.status ?? "missing" } });
        this.fail(state, "claude-mcp-server-not-connected: an expected MCP server is not connected");
        return;
      }
    }
    if (personal.length) emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", active: personal.filter(id => init.mcpServers.some(s => s.name === id && s.status === "connected")), unavailable: personal.filter(id => !init.mcpServers.some(s => s.name === id && s.status === "connected")) } });
    if (init.sessionId !== this.nativeId) {
      emit({ kind: "diagnostic", data: { code: "claude-session-id-mismatch", expected: this.nativeId, actual: init.sessionId } });
      this.fail(state, "claude-session-id-mismatch: the native CLI reported a different session id than the one assigned");
    }
  }

  private endStdin(state:TurnState):void {
    if(!state.stdinEnded&&state.child){state.stdinEnded=true;state.child.endStdin();}
  }

  steeringTarget() {
    const state=this.current;
    if(this.closed||this.input.steeringVersion!=='2.1.296'||!this.historyPath||!state?.guarded||!state.originalObserved||!state.historyVerified||state.init?.version!=='2.1.296'||state.init.sessionId!==this.nativeId||state.result||state.finished||state.fatal||state.closing||state.interruptRequested||state.steering.size>=32)return undefined;
    return {nativeThreadId:this.nativeId,nativeTurnId:state.executionId};
  }

  steer(input:SteeringInput):Promise<SteeringOutcome> {
    const state=this.current,previous=state?.steering.get(input.clientUserMessageId);
    if(previous)return matchesSteering(previous.input,input)?previous.promise:Promise.resolve({state:'unknown',reason:'client-id-reused'});
    const target=this.steeringTarget();
    if(!state||!target||target.nativeThreadId!==input.nativeThreadId||target.nativeTurnId!==input.nativeTurnId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.clientUserMessageId)||input.clientUserMessageId===state.executionId||!input.text||input.text.length>263168)return Promise.resolve({state:'unknown',reason:'native-target-unavailable'});
    let resolve!:(value:SteeringOutcome)=>void;const promise=new Promise<SteeringOutcome>(r=>{resolve=r;});
    const pending={input:{...input},promise,resolve,settled:false};state.steering.set(input.clientUserMessageId,pending);
    try{
      // False is essential: crossing native completion may retain context but cannot start another query.
      state.child!.writeStdin(JSON.stringify({type:'user',uuid:input.clientUserMessageId,session_id:this.nativeId,origin:{kind:'human'},priority:'next',shouldQuery:false,client_composed:true,message:{role:'user',content:input.text}})+'\n');
      this.refreshSteering(state);
    }catch{this.resolveSteering(pending,{state:'unknown',reason:'native-write-unconfirmed'});}
    return promise;
  }

  async reconcileSteering(input:SteeringInput):Promise<SteeringOutcome> {
    if(this.input.steeringVersion!=='2.1.296'||input.nativeThreadId!==this.nativeId)return {state:'unknown',reason:'native-history-unavailable'};
    return reconcileClaudeHistory(input,readClaudeTranscript(this.historyPath));
  }

  private resolveSteering(pending:PendingSteering,result:SteeringOutcome):void {
    if(!pending.settled){pending.settled=true;pending.resolve(result);}
  }

  private refreshSteering(state:TurnState,final=false,retry=0):void {
    const pending=[...state.steering.values()].filter(p=>!p.settled);if(!pending.length)return;
    const rows=readClaudeTranscript(this.historyPath);state.historyReads++;
    for(const item of pending){
      const result=reconcileClaudeHistory(item.input,rows);
      if(final||result.state==='accepted'||result.state==='unknown'&&result.reason==='claude-transcript-only')this.resolveSteering(item,result);
    }
    // Native history flush can follow its replay echo. Bounded reads never write/resend or wake a turn.
    if(!final&&!state.finished&&retry<4&&state.historyReads<32&&state.historyTimer===undefined&&[...state.steering.values()].some(p=>!p.settled)){
      state.historyTimer=this.options.clock.setTimeout(()=>{state.historyTimer=undefined;this.refreshSteering(state,false,retry+1);},50);
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
    // Do not retry authentication, transport or execution failures. This pre-init native
    // diagnostic identifies exactly the requested missing conversation.
    if (this.input.resume && !state.init && !exit.ok && state.stderr.split(/\r?\n/).some((line) => line.trim() === `No conversation found with session ID: ${this.nativeId}`)) {
      return { status: "failed", error: "Claude native session was not found", reasonCode: "native-session-not-found" };
    }
    const result = state.result;
    if (result) {
      if (result.subtype === "success" && !result.isError) {
        return exit.ok ? { status: "completed" } : { status: "failed", error: `Claude output did not drain cleanly before exit${exit.error ? `: ${exit.error}` : ""}` };
      }
      if (result.subtype === "error_during_execution" && state.interruptRequested) return { status: "interrupted" };
      const detail = result.errors[0] ?? result.terminalReason ?? "no error detail";
      return { status: "failed", error: `Claude turn failed (${result.subtype}): ${detail}`, failure: result.failure ?? { category: "unknown", origin: "unknown", certainty: "inferred" } };
    }
    if (state.interruptRequested && exit.ok) return { status: "interrupted" };
    const how = exit.anchorLost ? (exit.error ?? "Anchor ended before reporting the child's exit")
      : exit.ok ? "claude ended without a result" : `claude exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`}`;
    // Native configuration/parser errors may contain literal personal credentials.
    const tail = state.init ? redactText(state.stderr, 400).trim() : "";
    return { status: "failed", error: tail ? `${how}: ${tail}` : how,
      failure: exit.anchorLost ? { category: "unknown", origin: "unknown", certainty: "inferred" }
        : { category: "runner-process", origin: "runner", certainty: "reported" } };
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
      return { version, status: "ready", capabilities: [...CAPABILITIES,CLAUDE_STEERING_CAPABILITY], mcpIsolationVerified: false };
    },

    async startTask(input: DriverTaskInput, io: DriverHostIo): Promise<DriverTaskHandle> {
      const nativeId = input.resume?.nativeSessionId ?? input.nativeSessionId ?? randomUUID();
      const task = new ClaudeTask(input, io, nativeId, resolved);
      const done = task.runTurn(input.prompt, input.images);
      return {
        nativeSessionId: Promise.resolve(task.id),
        ...(input.steeringVersion==='2.1.296'?{steeringTarget:()=>task.steeringTarget(),steer:(message:SteeringInput)=>task.steer(message),reconcileSteering:(message:SteeringInput)=>task.reconcileSteering(message)}:{}),
        send: (prompt, images) => task.runTurn(prompt, images),
        interrupt: () => task.interrupt(),
        done,
        close: () => task.close(),
      };
    },
  };
}
