import {codexRequestInput} from "@deck/core/session/request-input";
import { validateQuestions, type Question } from "@deck/core/session/question";
import { CODEX_STEERING_CAPABILITY, type SteeringInput, type SteeringOutcome } from "@deck/core/session/steering";
import { steeringFailure, reconcileHistory } from "./steering";
import { prepareImages, redactImagePayload } from "./images";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { DriverHostIo, DriverImageInput, DriverProbe, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver, SupervisedChild, TurnOutcome } from "@deck/core/session/driver";
import { redactText } from "@deck/core/session/redaction";
import type { TurnFailure } from "@deck/core/session/failure";
import { runnerTransportFailure } from '@deck/core/session/failure';
import { classifyCodexFailure, codexNotificationFailure } from "./failure";
import { CODEX_PROTOCOL, codexTurnStatus, mapCodexNotification } from "./mapper";
import { buildCodexLaunch, matchesCodexMemoryGroups, codexThreadMcpConfig, isAdmittedCodexMemoryHook, nativeCodexMcpId, verifyCodexConfig, type CodexHookMetadata, type CodexLaunchOptions } from "./launch";
import { CodexRpc, CodexRpcFrameError, object, type RpcMessage } from "./rpc";

export const CODEX_TESTED_VERSIONS = { min: "0.162.1", maxTested: "0.162.1" } as const;
type ProbeExec = (command: string, args: readonly string[], options: { cwd?: string; timeoutMs: number }) => Promise<{ code: number | null; stdout: string }>;
export type CodexSessionDriverOptions = CodexLaunchOptions & {
  exec?: ProbeExec; escalationMs?: number; killGraceMs?: number; rpcTimeoutMs?: number;
};
const defaultExec: ProbeExec = (command, args, options) => new Promise((resolve) => {
  execFile(command, [...args], { cwd: options.cwd, timeout: options.timeoutMs, encoding: "utf8", windowsHide: true }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: String(stdout ?? "") }));
});
function compare(a: string, b: string): number {
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i]! - bb[i]!;
  return 0;
}
function nativeModel(modelId: string): { model: string; modelProvider?: string } {
  const slash = modelId.indexOf("/");
  return slash < 0 ? { model: modelId } : { model: modelId.slice(slash + 1), ...(modelId.slice(0, slash) === "openai-codex" ? {} : { modelProvider: modelId.slice(0, slash) }) };
}
type Turn = { policyInput?:ReturnType<typeof codexRequestInput>; policyInputAfterTool?:boolean; id?: string; confirmedId?: string; contextCompacted?: boolean; resolve(outcome: TurnOutcome): void; interrupted: boolean; escalation?: ReturnType<typeof setTimeout>; nativeFailure?: { turnId: string; failure: TurnFailure } };
const isHookNotification = (message: RpcMessage) => message.method?.startsWith("hook/") === true;

// Canonical action data is passed only to the in-memory approval broker, never emitted.
function canonicalApprovalJson(value: unknown): string | undefined {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)]))
      : item;
  return JSON.stringify(sorted(value));
}

// Exact internal codes only: neither native messages nor arbitrary codex-prefixed errors are safe.
const STARTUP_ERROR_CODES = new Set([
  "codex-invalid-assignment", "codex-task-closed", "codex-process-exited", "codex-process-exited-before-ready",
  "codex-process-ready-timeout", "codex-rpc-closed", "codex-native-session-not-found", "codex-native-session-id-mismatch",
  "codex-native-memory-unavailable", "codex-native-memory-invalid", "codex-hooks-inventory-invalid", "codex-hook-isolation-violation",
  "codex-mcp-spec-missing", "codex-http-mcp-url-invalid", "codex-http-mcp-env-header-invalid",
  "codex-feature-isolation-violation", "codex-mcp-isolation-violation", "codex-mcp-spec-isolation-violation",
  "codex-mcp-status-invalid", "codex-mcp-server-not-connected", "codex-mcp-status-pagination-cycle", "codex-runtime-mcp-isolation-violation",
]);
function startupErrorCode(error: unknown): string {
  if (error instanceof CodexRpcFrameError) return error.code;
  return error instanceof Error && STARTUP_ERROR_CODES.has(error.message) ? error.message : "codex-startup-failed";
}

class CodexTask {
  private readonly nativeInput: DriverTaskInput;
  private attestedMemory?: DriverTaskInput["nativeMemory"];
  private child?: SupervisedChild;
  private spawning?: Promise<SupervisedChild>;
  private rpc?: CodexRpc;
  private transportFailure?: TurnFailure;
  private threadId?: string;
  private readonly admittedNativeMcp = new Set<string>();
  private steeringHistoryVerified=false;
  private turn?: Turn;
  private closed = false;
  private failed = false;
  private startupInterrupted = false;
  private drain?: Promise<void>;
  private failure?: Promise<void>;
  private closing?: Promise<void>;
  private readonly questions = new Set<string | number>();
  private readonly approvals = new Set<string | number>();
  private resolveId!: (id: string) => void;
  private rejectId!: (error: Error) => void;
  readonly nativeSessionId = new Promise<string>((resolve, reject) => { this.resolveId = resolve; this.rejectId = reject; });
  constructor(private readonly input: DriverTaskInput, private readonly io: DriverHostIo, private readonly options: CodexSessionDriverOptions) {
    const aliases = Object.fromEntries(input.mcp.servers.map((id) => [id, nativeCodexMcpId(input.taskId, id)]));
    this.nativeInput = { ...input, suppressedMcpServers: [...new Set([...(input.suppressedMcpServers ?? []), ...input.mcp.servers])], mcp: { ...input.mcp, servers: input.mcp.servers.map((id) => aliases[id]!) }, mcpServerSpecs: Object.fromEntries(input.mcp.servers.map((id) => [aliases[id]!, input.mcpServerSpecs[id]!])) };
    this.emit({ kind: "diagnostic", data: { code: "codex-mcp-aliases", aliases } });
    // The host may await done before nativeSessionId; failed startup must not become an unhandled rejection.
    void this.nativeSessionId.catch(() => {});
  }
  private emit(event: Parameters<DriverHostIo["emit"]>[0]): void { try { this.io.emit(event); } catch { /* sink failure does not break containment */ } }
  private finish(outcome: TurnOutcome, nativeEvent = false): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    if (turn.escalation) clearTimeout(turn.escalation);
    if (!nativeEvent) this.emit({ kind: "turn.completed", data: { status: outcome.status } });
    turn.resolve(outcome);
  }
  private stopChild(): Promise<void> {
    const child = this.child;
    if (!child) {
      if (this.spawning) {
        const spawning = this.spawning;
        this.spawning = undefined;
        this.drain = spawning.then((spawned) => { this.child = spawned; return this.stopChild(); }, () => {});
      }
      return this.drain ?? Promise.resolve();
    }
    this.child = undefined;
    // Publish the containment barrier before closing RPC rejects its pending startup calls.
    this.drain = Promise.resolve().then(() => child.terminateGroup(this.options.killGraceMs ?? 2000));
    this.rpc?.close(); this.rpc = undefined;
    return this.drain;
  }
  private async connect(inheritedHooks?: readonly CodexHookMetadata[]): Promise<CodexRpc> {
    const launch = buildCodexLaunch(this.nativeInput, this.options, inheritedHooks);
    const spawning = this.io.spawn(launch.command, launch.args, { cwd: this.input.cwd, env: launch.env });
    this.spawning = spawning;
    const child = await spawning;
    if (this.spawning === spawning) this.spawning = undefined;
    if (this.closed) { await this.stopChild(); throw new Error("codex-task-closed"); }
    this.child = child;
    const rpc = new CodexRpc((text) => child.writeStdin(text), (message) => this.onMessage(message), { timeoutMs: this.options.rpcTimeoutMs });
    this.rpc = rpc;
    child.onStdout((chunk) => { try { rpc.push(chunk); } catch (error) { void this.fail(error instanceof CodexRpcFrameError ? error.code : "codex-rpc-invalid-frame", error instanceof CodexRpcFrameError ? error.size : undefined); } });
    child.onStderr(() => {}); // Native diagnostics can contain credential-bearing config: never persist stderr.
    void child.exited.then(() => {
      rpc.close(new Error("codex-process-exited"));
      if (this.child === child && !this.closed) void this.fail("codex-process-exited");
    }, () => { rpc.close(); if (this.child === child) void this.fail("codex-anchor-lost"); });
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        child.ready,
        child.exited.then(() => { throw new Error("codex-process-exited-before-ready"); }),
        new Promise<never>((_, reject) => { readyTimer = setTimeout(() => reject(new Error("codex-process-ready-timeout")), this.options.rpcTimeoutMs ?? 30_000); }),
      ]);
    } finally { if (readyTimer) clearTimeout(readyTimer); }
    await rpc.call("initialize", { clientInfo: { name: "deck-session", title: "Deck session", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    rpc.notify("initialized");
    return rpc;
  }
  private fail(code: string, frameSize?: CodexRpcFrameError["size"]): Promise<void> {
    if (this.failure) return this.failure;
    this.failed = true;
    if (this.turn?.escalation) clearTimeout(this.turn.escalation);
    const failure = runnerTransportFailure(code);
    this.transportFailure ??= failure;
    this.rejectId(Object.assign(new Error(code), {failure}));
    this.emit({ kind: "diagnostic", data: { code, ...frameSize } });
    // Do not settle before the process group is drained: the host can relinquish ownership on done.
    this.failure = (async () => {
      try { await this.stopChild(); } finally { this.finish({ status: "failed", error: code, ...(failure ? {failure} : {}) }); }
    })();
    void this.failure.catch(() => {});
    return this.failure;
  }
  async initialize(): Promise<void> {
    try {
      if (this.input.assignment.runnerId !== "codex" || !this.input.assignment.modelId.trim()) throw new Error("codex-invalid-assignment");
      const inventory = await this.connect();
      const inventoryConfig = object(await inventory.call("config/read", { cwd: this.input.cwd, includeLayers: this.input.nativeMemory?.status === "ready" }));
      const config = object(inventoryConfig.config);
      if (this.input.nativeMemory?.status === "ready" && Array.isArray(inventoryConfig.layers)) {
        for (const layer of inventoryConfig.layers) {
          const source = object(layer);
          if (source.disabledReason || object(source.name).type === "sessionFlags") continue;
          const hooks = object(object(source.config).hooks);
          if (["UserPromptSubmit", "Stop"].some(event => Array.isArray(hooks[event]) && (hooks[event] as unknown[]).length > 0 && !matchesCodexMemoryGroups(hooks[event], event, this.input))) {
            this.emit({kind:"diagnostic",data:{code:"personal-mcp.runtime",conflicting:["native-memory-hooks"]}});
            throw new Error("codex-hook-isolation-violation");
          }
        }
      }
      verifyCodexConfig(config, this.nativeInput);
      const inherited = Object.keys(object(config.mcp_servers));
      const collisions = inherited.filter(id => id === "deck");
      if (collisions.length) this.emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", conflicting: collisions } });
      let rpc = inventory;
      let runtimeConfig = config;
      if (this.input.nativeMemory?.status === "ready") {
        // Only managed hook-hash attestation needs a second process. Personal MCPs,
        // skills and plugins use this process's fresh native configuration directly.
        const inheritedHooks = await this.readHooks(inventory);
        await this.stopChild();
        rpc = await this.connect(inheritedHooks);
        runtimeConfig = object(object(await rpc.call("config/read", { cwd: this.input.cwd, includeLayers: false })).config);
      }
      verifyCodexConfig(runtimeConfig, this.nativeInput);
      const nativeDeclarations = Object.entries(object(runtimeConfig.mcp_servers)).filter(([id]) => !this.nativeInput.mcp.servers.includes(id) && !(this.nativeInput.suppressedMcpServers ?? []).includes(id)).map(([id, value]) => ({ id, source: "native", status: object(value).enabled === false ? "unavailable" : "configured", ...(object(value).enabled === false ? {reason:"disabled"} : {}) }));
      if (nativeDeclarations.length) this.emit({kind:"diagnostic",data:{code:"personal-mcp.sources",servers:nativeDeclarations}});
      if (this.input.nativeMemory?.status === "ready") {
        const activeHooks = (await this.readHooks(rpc)).filter(hook => hook.enabled !== false);
        const memoryHooks = activeHooks.filter(hook => ["stop", "userPromptSubmit"].includes(hook.eventName));
        if (memoryHooks.length !== 2 || !["stop", "userPromptSubmit"].every(event => memoryHooks.some(hook => hook.eventName === event))
          || memoryHooks.some(hook => !isAdmittedCodexMemoryHook(hook, this.input) || hook.trustStatus !== "trusted")) throw new Error("codex-hook-isolation-violation");
        this.attestedMemory = { ...this.input.nativeMemory, plugin: { ...this.input.nativeMemory.plugin!, exclusiveHookEvents: ["userPromptSubmit", "stop"] } };
      }
      const thread = object(object(await rpc.call(this.input.resume ? "thread/resume" : "thread/start", {
        ...nativeModel(this.input.assignment.modelId), cwd: this.input.cwd,
        developerInstructions: this.input.rolePrompt,
        config: codexThreadMcpConfig(this.nativeInput, Object.keys(object(runtimeConfig.mcp_servers))),
        approvalPolicy: this.input.approvals === "relay" ? "on-request" : "never",
        approvalsReviewer: "user", sandbox: this.input.approvals === "relay" ? "read-only" : "danger-full-access",
        // Only thread.id is consumed; full resume history can exceed the RPC frame bound.
        ...(this.input.resume ? { threadId: this.input.resume.nativeSessionId, excludeTurns: true } : { ephemeral: false, historyMode: "legacy" }),
      })).thread);
      if (typeof thread.id !== "string" || !thread.id || this.input.resume && thread.id !== this.input.resume.nativeSessionId) throw new Error("codex-native-session-id-mismatch");
      this.threadId = thread.id;this.steeringHistoryVerified=thread.historyMode === "legacy";
      await this.verifyRuntimeMcp(rpc, Date.now() + (this.options.rpcTimeoutMs ?? 30_000));
    } catch (error) { await this.fail(startupErrorCode(error)); throw error; }
  }
  private async readHooks(rpc: CodexRpc): Promise<CodexHookMetadata[]> {
    const response = object(await rpc.call("hooks/list", { cwds: [this.input.cwd] }));
    if (!Array.isArray(response.data) || response.data.length !== 1) throw new Error("codex-hooks-inventory-invalid");
    const entry = object(response.data[0]);
    if (!Array.isArray(entry.hooks) || !Array.isArray(entry.errors) || entry.errors.length || entry.cwd !== this.input.cwd) throw new Error("codex-hooks-inventory-invalid");
    return entry.hooks.map(value => {
      const hook = object(value);
      if (typeof hook.key !== "string" || !hook.key || typeof hook.currentHash !== "string" || !hook.currentHash || typeof hook.eventName !== "string") throw new Error("codex-hooks-inventory-invalid");
      return hook as CodexHookMetadata;
    });
  }
  async start(): Promise<TurnOutcome> {
    try {
      await this.initialize();
      const done = this.send(this.input.prompt, this.input.images);
      this.resolveId(this.threadId!);
      return await done;
    } catch (error) {
      return this.startupInterrupted && !this.transportFailure ? { status: "interrupted-forced" } : { status: "failed", error: this.transportFailure?.code ?? startupErrorCode(error), ...(this.transportFailure ? {failure:this.transportFailure} : {}), ...(error instanceof Error && error.message === "codex-native-session-not-found" ? { reasonCode: "native-session-not-found" as const } : {}) };
    }
  }
  private async verifyRuntimeMcp(rpc: CodexRpc, deadline: number): Promise<void> {
    for (;;) {
      const names: string[] = [], seen = new Set<string>();
      const personal: string[] = [];
      const unavailable: string[] = [];
      const active: string[] = [];
      let page = object(await rpc.call("mcpServerStatus/list", { threadId: this.threadId, detail: "full" }));
      let starting = false;
      for (;;) {
        if (!Array.isArray(page.data)) throw new Error("codex-mcp-status-invalid");
        for (const item of page.data) {
          const server = object(item);
          if (typeof server.name !== "string") throw new Error("codex-mcp-status-invalid");
          if (server.runtimeStatus === "disabled") continue;
          if (!this.nativeInput.mcp.servers.includes(server.name)) {
            if ((this.nativeInput.suppressedMcpServers ?? []).includes(server.name)) { this.emit({kind:"diagnostic",data:{code:"personal-mcp.runtime",conflicting:[server.name]}}); throw new Error("codex-runtime-mcp-isolation-violation"); }
            personal.push(server.name);
            this.admittedNativeMcp.add(server.name);
            if (!server.toolsError && server.runtimeStatus === "connected") active.push(server.name); else unavailable.push(server.name);
            continue;
          }
          if (server.runtimeStatus === "starting" || server.runtimeStatus === "notStarted") starting = true;
          else if (server.toolsError || server.runtimeStatus && server.runtimeStatus !== "connected") throw new Error("codex-mcp-server-not-connected");
          names.push(server.name);
        }
        const cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : undefined;
        if (!cursor) break;
        if (seen.has(cursor) || seen.size > 100) throw new Error("codex-mcp-status-pagination-cycle");
        seen.add(cursor);
        page = object(await rpc.call("mcpServerStatus/list", { threadId: this.threadId, detail: "full", cursor }));
      }
      if (this.nativeInput.mcp.servers.some(id => !names.includes(id))) throw new Error("codex-runtime-mcp-isolation-violation");
      if (!starting) {
        if (personal.length) this.emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", active, unavailable } });
        return;
      }
      if (Date.now() >= deadline) throw new Error("codex-mcp-server-not-connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.closed) throw new Error("codex-task-closed");
    }
  }
  private onMessage(message: RpcMessage): void {
    message = redactImagePayload(message);
    if (message.id !== undefined && message.method) {
      if (message.method === "item/tool/requestUserInput") void this.question(message);
      else void this.approve(message);
      return;
    }
    const p = object(message.params);
    if (p.threadId !== undefined && this.threadId !== undefined && p.threadId !== this.threadId) {
      this.emit({ kind: "runner.unmapped", data: { nativeType: isHookNotification(message) ? redactText(message.method!, 128) : message.method, reason: "foreign-thread" }, ...(isHookNotification(message) ? {} : { raw: message }) }); return;
    }
    if ((message.method === "item/started" || message.method === "item/completed") && object(p.item).type === "contextCompaction") {
      // Like native requests, compaction requires a known, live turn. Do not infer
      // its identity from an item that could have arrived late from a prior turn.
      const active = this.turn;
      if (this.closed || this.failed || !active || active.interrupted || !active.id
        || p.threadId !== this.threadId || p.turnId !== (active.confirmedId ?? active.id)) {
        this.emit({ kind: "runner.unmapped", data: { nativeType: message.method, reason: "stale-turn" } }); return;
      }
      if (message.method === 'item/started') active.contextCompacted = true;
    }
    if ((message.method==='item/started'||message.method==='item/completed')
      && ['commandExecution','fileChange','mcpToolCall','webSearch','dynamicToolCall'].includes(String(object(p.item).type))) {
      const active=this.turn,turnId=active?.confirmedId;
      // A turn/start-confirmed identity is required before attributing tools or mutating policy.
      if(this.closed||this.failed||!active||active.interrupted||!this.threadId||!turnId
        ||p.threadId!==this.threadId||p.turnId!==turnId){
        this.emit({kind:'runner.unmapped',data:{nativeType:message.method,reason:'stale-turn'}});return;
      }
    }
    if (message.method === 'thread/tokenUsage/updated') {
      const active = this.turn;
      if (this.closed || this.failed || !active || active.interrupted || !active.id || p.threadId !== this.threadId || p.turnId !== (active.confirmedId ?? active.id)) {
        this.emit({ kind: 'runner.unmapped', data: { nativeType: message.method, reason: 'stale-turn' } }); return;
      }
      const policyInput=active.contextCompacted?undefined:codexRequestInput(p.tokenUsage,p.threadId,p.turnId,this.input.assignment.modelId);
      active.policyInput=policyInput;active.policyInputAfterTool=!!policyInput;
      // Preserve raw/native usage compatibility, but no delayed pre-compaction
      // counter may become a new context observation in this native turn.
      for (const event of mapCodexNotification(message, this.attestedMemory)) {
        if (active.contextCompacted) { const { context: _context, ...data } = event.data; this.emit({ ...event, data:{...data,requestInput:null} }); }
        else this.emit({...event,data:{...event.data,requestInput:policyInput??null}});
      }
      return;
    }
    if (message.method === "turn/started" && this.turn) {
      if(this.turn.confirmedId && object(p.turn).id!==this.turn.confirmedId){this.emit({kind:"runner.unmapped",data:{nativeType:message.method,reason:"stale-turn"}});return;}
      this.turn.id = typeof object(p.turn).id === "string" ? object(p.turn).id as string : this.turn.id;
    }
    if (message.method === "error") {
      const active = this.turn, turnId = active?.confirmedId ?? active?.id;
      // Notifications are fallback evidence, never terminal signals. A later retry
      // supersedes the error; neither a missing identity nor a stale turn can seed it.
      if (!this.closed && !this.failed && active && !active.interrupted && turnId
        && p.threadId === this.threadId && p.turnId === turnId) {
        if (p.willRetry === true) active.nativeFailure = undefined;
        else if (p.willRetry === false) {
          const failure = codexNotificationFailure(p, { threadId: this.threadId, turnId });
          active.nativeFailure = failure ? { turnId, failure } : undefined;
        }
      }
    }
    if (message.method === "turn/completed") {
      const id = object(p.turn).id;
      if (!this.turn || this.turn.id && id !== this.turn.id) { this.emit({ kind: "runner.unmapped", data: { nativeType: message.method, reason: "stale-turn" }, raw: message }); return; }
      const active = this.turn, turnId = active.confirmedId ?? active.id;
      const status = codexTurnStatus(object(p.turn).status);
      const correlated = !!turnId && p.threadId === this.threadId && id === turnId;
      const failure: TurnFailure | undefined = status !== "failed" || active.interrupted ? undefined
        : (correlated ? classifyCodexFailure(object(p.turn).error)
          ?? (active.nativeFailure?.turnId === turnId ? active.nativeFailure.failure : undefined) : undefined)
          ?? { category: "unknown", origin: "unknown", certainty: "inferred" };
      if(correlated && status==='completed' && !active.contextCompacted && active.policyInputAfterTool && active.policyInput)this.emit({kind:'diagnostic',data:{code:'request.input-finalized',nativeThreadId:p.threadId,nativeTurnId:turnId}});
      else this.emit({kind:'diagnostic',data:{code:'request.input-invalidated',reason:'final-request-unproven'}});
      for (const event of mapCodexNotification(message, this.attestedMemory)) this.emit(event);
      this.finish({ status, ...(failure ? { failure } : {}) }, true);
      return;
    }
    if(message.method==='item/completed' && ['commandExecution','fileChange','mcpToolCall','webSearch','dynamicToolCall'].includes(String(object(p.item).type)) && this.turn){
      this.turn.policyInputAfterTool=false;
      this.emit({kind:'diagnostic',data:{code:'request.input-invalidated',reason:'later-request-may-follow-tool',nativeThreadId:p.threadId,nativeTurnId:p.turnId}});
    }
    for (const event of mapCodexNotification(message, this.attestedMemory)) this.emit(event);
  }
  private async question(message: RpcMessage): Promise<void> {
    const rpc = this.rpc, id = message.id!, p = object(message.params), activeTurn = this.turn;
    // Keep only request IDs, never answers, for deduplication across the task lifetime.
    if (this.questions.has(id)) return;
    this.questions.add(id);
    const questions: Question[] = (Array.isArray(p.questions) ? p.questions : []).map(value => {
      const q = object(value);
      return { id: q.id as string, header: q.header as string, prompt: q.question as string,
        options: (q.options ?? []) as Question["options"], multiple: false, allowOther: !!q.isOther, secret: !!q.isSecret };
    });
    const valid = validateQuestions(questions);
    // Empty arrays are allowed by ToolRequestUserInputResponse and express no answer.
    let answers = Object.fromEntries(questions.filter(q => typeof q.id === "string").map(q => [q.id, { answers: [] as string[] }]));
    try {
      if (valid && activeTurn && !activeTurn.interrupted && !this.closed && activeTurn.id
        && p.threadId === this.threadId && p.turnId === activeTurn.id) {
        const result = await this.io.question?.({ questionId: `codex:${this.input.taskId}:${String(id)}:${randomUUID()}`, questions });
        if (result?.outcome === "answered" && !this.closed && this.turn === activeTurn
          && !activeTurn.interrupted && activeTurn.id === p.turnId) {
          answers = Object.fromEntries(questions.map(q => [q.id, { answers: result.answers[q.id] ?? [] }]));
        }
      }
    } catch {
      // Broker errors may contain secret answers: emit only a fixed diagnostic code.
      this.emit({ kind: "diagnostic", data: { code: "codex-question-broker-failed" } });
    }
    try { rpc?.reply(id, { answers }); }
    catch { void this.fail("codex-question-reply-failed"); }
  }
  private async approve(message: RpcMessage): Promise<void> {
    const rpc = this.rpc, id = message.id!, p = object(message.params);
    const schema = object(p.requestedSchema), meta = object(p._meta);
    const prefix = `Allow the ${String(p.serverName)} MCP server to run tool "`;
    const messageTool = typeof p.message === "string" && p.message.startsWith(prefix) && p.message.endsWith('"?') ? p.message.slice(prefix.length, -2) : undefined;
    const nativeTool = [p.toolName, p.tool_name, meta.tool_name, meta.toolName, messageTool]
      .find((value): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value));
    // Codex wraps tool approval in an empty form; a general MCP elicitation can request
    // arbitrary user data and must never be treated as permission to run a tool.
    const mcpApproval = message.method === "mcpServer/elicitation/request" && p.mode === "form"
      && meta.codex_approval_kind === "mcp_tool_call" && typeof p.serverName === "string" && (this.nativeInput.mcp.servers.includes(p.serverName) || this.admittedNativeMcp.has(p.serverName))
      && schema.type === "object" && typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)
      && Object.keys(object(schema.properties)).length === 0 && Object.keys(schema).every((key) => key === "type" || key === "properties");
    const commandApproval = message.method === "item/commandExecution/requestApproval";
    const fileApproval = message.method === "item/fileChange/requestApproval";
    const permissionsApproval = message.method === "item/permissions/requestApproval";
    const known = mcpApproval || commandApproval || fileApproval || permissionsApproval;
    const activeTurn = this.turn;
    if (!known || !activeTurn || activeTurn.interrupted || this.closed || typeof activeTurn.id !== "string" || activeTurn.id.length === 0
      || p.threadId !== this.threadId || p.turnId !== activeTurn.id) {
      this.emit({ kind: "runner.unmapped", data: { nativeType: isHookNotification(message) ? redactText(message.method!, 128) : message.method }, ...(isHookNotification(message) ? {} : { raw: message }) });
      rpc?.reject(id, -32601, "Unsupported or stale server request"); return;
    }
    if (this.approvals.has(id)) return;
    this.approvals.add(id);
    const amendment = commandApproval && Array.isArray(p.proposedExecpolicyAmendment)
      && p.proposedExecpolicyAmendment.length > 0
      && p.proposedExecpolicyAmendment.every(part => typeof part === "string" && part.trim().length > 0)
      ? p.proposedExecpolicyAmendment as string[] : undefined;
    const fileSummary = [p.grantRoot, p.reason].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
    const cwd = resolve(this.input.cwd, typeof p.cwd === "string" ? p.cwd : this.input.cwd);
    const paths = Array.isArray(p.paths) ? p.paths : Array.isArray(p.changes) ? p.changes.map(change => object(change).path) : undefined;
    const fileIdentity = paths?.length && paths.every(path => typeof path === "string" && path.length > 0)
      ? { paths: [...new Set((paths as string[]).map(path => resolve(cwd, path)))].sort(),
        ...(typeof p.grantRoot === "string" && p.grantRoot ? { grantRoot: resolve(cwd, p.grantRoot) } : {}) } : undefined;
    const action = commandApproval && typeof p.command === "string" ? { command: p.command, cwd }
      : fileApproval ? fileIdentity : permissionsApproval ? { cwd, permissions: p.permissions }
      : mcpApproval && nativeTool ? meta.tool_params : undefined;
    const canonical = canonicalApprovalJson(action);
    // Never truncate match identity: an oversized action cannot receive an exact grant.
    const identity = canonical !== undefined && Buffer.byteLength(canonical, "utf8") <= 16 * 1024 ? canonical : undefined;
    const display = canonical ?? (fileApproval ? fileSummary : undefined);
    const exactKey = display ? redactText(display, 4096) : undefined;
    // Missing names must never share tool grants across otherwise unidentified tools.
    const mcpToolKey = nativeTool ?? `unknown:${randomUUID()}`;
    const summary = mcpApproval ? p.message as string : commandApproval ? typeof p.command === "string" ? p.command : "Codex command execution"
      : permissionsApproval ? `Codex permissions: ${exactKey}` : fileSummary || "Codex file changes";
    let decision: "accept" | "decline" | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } } = "decline";
    try {
      if (this.input.approvals === "relay") {
        const result = await this.io.approval({ approvalId: `codex:${String(id)}`,
          tool: mcpApproval ? `mcp__${p.serverName}__${nativeTool ?? "unknown"}` : message.method!,
          summary,
          toolKey: mcpApproval ? `codex:mcp:${p.serverName}:${mcpToolKey}` : commandApproval ? "codex:commandExecution" : fileApproval ? "codex:fileChange" : "codex:permissions",
          ...(exactKey ? { exactKey } : {}),
          ...(identity !== undefined ? { identity } : {}),
          risk: !mcpApproval || !nativeTool || /(?:exec|shell|command|write|edit|patch|delete|remove|fetch|network)/i.test(nativeTool!) ? "high" : "normal",
          ...(amendment ? { nativeScopes: ["always"] as "always"[],
            alwaysNote: `Codex adds this command prefix to its exec-policy rules on this machine: ${amendment.join(" ")}; it applies to future sessions and Deck cannot revoke it` } : {}),
          input: mcpApproval ? meta.tool_params : p });
        decision = result.decision !== "allow" ? "decline" : result.scope === "always" && amendment
          ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } } : "accept";
      } else if (mcpApproval) decision = "accept"; // The approved runner-default bypass covers isolated MCP tools too.
    } catch { /* broker failure denies */ }
    finally { this.approvals.delete(id); }
    // Never approve work after a close, interrupt, or turn completion.
    if (this.closed || this.turn !== activeTurn || activeTurn.interrupted || activeTurn.id !== p.turnId) decision = "decline";
    try { rpc?.reply(id, mcpApproval ? { action: decision, content: decision === "accept" ? {} : null, _meta: null } : permissionsApproval
      ? decision === "accept" ? { permissions: object(p.permissions), scope: "turn" } : { permissions: {} }
      : { decision }); }
    catch { void this.fail("codex-approval-reply-failed"); }
  }
  async send(prompt: string, images?: readonly DriverImageInput[]): Promise<TurnOutcome> {
    if (this.closed || this.failed) throw new Error("codex-task-closed");
    if (this.turn) throw new Error("codex-turn-already-running");
    let nativeImages: ReturnType<typeof prepareImages>;
    try { nativeImages = prepareImages(images); }
    catch { return { status: "failed", error: "image-input-invalid" }; }
    let resolve!: (outcome: TurnOutcome) => void;
    const done = new Promise<TurnOutcome>((r) => { resolve = r; });
    const state: Turn = { resolve, interrupted: false }; this.turn = state;
    void (async () => {
      try {
        if (this.startupInterrupted || this.io.claimInput?.() === false) { this.finish({ status: "interrupted" }); return; }
        const result = object(await this.rpc!.call("turn/start", { threadId: this.threadId, input: [...(prompt || !nativeImages.length ? [{ type: "text", text: prompt }] : []), ...nativeImages], ...(this.input.assignment.thinking ? { effort: this.input.assignment.thinking } : {}) }));
        if (typeof object(result.turn).id !== "string") throw new Error("codex-turn-id-missing");
        state.id = object(result.turn).id as string;state.confirmedId=state.id;
        this.emit({kind:"diagnostic",data:{code:"input.delivered",evidence:"codex-turn-start-reply"}});
        if(this.input.steeringVersion)this.emit({kind:"diagnostic",data:{code:"codex-steering-ready"}});
        if (state.interrupted && this.turn === state) this.deliverInterrupt(state);
      } catch { await this.fail("codex-turn-start-failed"); }
    })();
    return done;
  }
  steeringTarget() {
    if(!this.steeringHistoryVerified || this.input.steeringVersion !== "0.162.1" || nativeModel(this.input.assignment.modelId).modelProvider || this.closed || this.failed || this.turn?.interrupted || !this.turn?.confirmedId || this.turn.id!==this.turn.confirmedId || !this.threadId) return undefined;
    return {nativeThreadId:this.threadId,nativeTurnId:this.turn.id};
  }
  async steer(input: SteeringInput): Promise<SteeringOutcome> {
    const target=this.steeringTarget();
    // Missing readiness is not a proven native refusal and cannot justify a duplicate route.
    if(!target || target.nativeThreadId!==input.nativeThreadId || target.nativeTurnId!==input.nativeTurnId || !input.clientUserMessageId || !input.text)return {state:"unknown",reason:"native-target-unavailable"};
    try {
      const result=object(await this.rpc!.call("turn/steer",{threadId:input.nativeThreadId,expectedTurnId:input.nativeTurnId,clientUserMessageId:input.clientUserMessageId,input:[{type:"text",text:input.text}]}));
      return result.turnId===input.nativeTurnId ? {state:"accepted",...input,via:"receipt"} : {state:"unknown",reason:"native-target-mismatch"};
    }catch(error){return steeringFailure(error,input);}
  }
  async reconcileSteering(input: SteeringInput): Promise<SteeringOutcome> {
    if(this.closed || !this.rpc || this.threadId!==input.nativeThreadId)return {state:"unknown",reason:"native-history-unavailable"};
    try{return reconcileHistory(input,await this.rpc.call("thread/read",{threadId:input.nativeThreadId,includeTurns:true}));}
    catch{return {state:"unknown",reason:"native-history-unavailable"};}
  }
  private deliverInterrupt(state: Turn): void {
    if (state.id) void this.rpc?.call("turn/interrupt", { threadId: this.threadId, turnId: state.id }).catch(() => {});
  }
  async interrupt(): Promise<void> {
    const state = this.turn;
    if (!state && !this.closed) {
      this.startupInterrupted = true;
      await this.close();
      return;
    }
    if (!state || state.interrupted) return;
    state.interrupted = true;
    state.nativeFailure = undefined;
    state.escalation = setTimeout(() => {
      if (this.failed || this.turn !== state) return;
      this.closed = true;
      const escalation = (async () => {
        try { await this.stopChild(); }
        finally { if (!this.failed && this.turn === state) this.finish({ status: "interrupted-forced" }); }
      })();
      // Observe this callback's promise independently; close() retains the rejecting drain barrier.
      void escalation.catch(() => {});
    }, this.options.escalationMs ?? 10_000);
    this.deliverInterrupt(state);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.rejectId(new Error("codex-task-closed"));
    this.closing = (async () => {
      try { await this.stopChild(); } finally { this.finish({ status: "interrupted-forced" }); }
    })();
    return this.closing;
  }
}

export function createCodexSessionDriver(options: CodexSessionDriverOptions = {}): RunnerSessionDriver {
  return {
    runnerId: "codex", supportsInputClaim: true, protocol: CODEX_PROTOCOL, testedVersions: CODEX_TESTED_VERSIONS,
    async probe(ctx): Promise<DriverProbe> {
      const capabilities = ["native-resume", "approval-relay", "interrupt-rpc", "native-mcp-additions", "native-customizations"];
      try {
        const result = await (options.exec ?? defaultExec)(ctx.executablePath ?? options.executable ?? "codex", ["--version"], { cwd: ctx.cwd, timeoutMs: 5000 });
        const version = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
        if (result.code !== 0 || !version) return { status: "blocked", reasonCode: "codex-version-unavailable", capabilities };
        if (compare(version, CODEX_TESTED_VERSIONS.min) < 0) return { version, status: "blocked", reasonCode: "codex-version-too-old", capabilities };
        if (compare(version, CODEX_TESTED_VERSIONS.maxTested) > 0) return { version, status: "degraded", reasonCode: "codex-version-untested", capabilities, mcpIsolationVerified: false };
        return { version, status: "ready", capabilities: [...capabilities, ...(result.stdout.trim() === "codex-cli 0.162.1" ? [CODEX_STEERING_CAPABILITY] : [])], mcpIsolationVerified: false };
      } catch { return { status: "blocked", reasonCode: "codex-executable-unavailable", capabilities }; }
    },
    async startTask(input, io): Promise<DriverTaskHandle> {
      const task = new CodexTask(input, io, options);
      const done = task.start();
      return { nativeSessionId: task.nativeSessionId, done, send: (prompt, images) => task.send(prompt, images), ...(input.steeringVersion === "0.162.1" ? {steeringTarget:()=>task.steeringTarget(),steer:(message:SteeringInput)=>task.steer(message),reconcileSteering:(message:SteeringInput)=>task.reconcileSteering(message)} : {}), interrupt: () => task.interrupt(), close: () => task.close() };
    },
  };
}
