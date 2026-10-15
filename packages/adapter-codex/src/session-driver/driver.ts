import { prepareImages, redactImagePayload } from "./images";
import { execFile } from "node:child_process";
import type { DriverHostIo, DriverImageInput, DriverProbe, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver, SupervisedChild, TurnOutcome } from "@deck/core/session/driver";
import { redactText } from "@deck/core/session/redaction";
import { CODEX_PROTOCOL, codexTurnStatus, mapCodexNotification } from "./mapper";
import { buildCodexLaunch, isAdmittedCodexMemoryHook, nativeCodexMcpId, verifyCodexConfig, type CodexHookMetadata, type CodexLaunchOptions } from "./launch";
import { CodexRpc, object, type RpcMessage } from "./rpc";

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
type Turn = { id?: string; resolve(outcome: TurnOutcome): void; interrupted: boolean; escalation?: ReturnType<typeof setTimeout> };
const isHookNotification = (message: RpcMessage) => message.method?.startsWith("hook/") === true;

class CodexTask {
  private readonly nativeInput: DriverTaskInput;
  private attestedMemory?: DriverTaskInput["nativeMemory"];
  private child?: SupervisedChild;
  private spawning?: Promise<SupervisedChild>;
  private rpc?: CodexRpc;
  private threadId?: string;
  private turn?: Turn;
  private closed = false;
  private failed = false;
  private startupInterrupted = false;
  private drain?: Promise<void>;
  private failure?: Promise<void>;
  private closing?: Promise<void>;
  private readonly approvals = new Set<string | number>();
  private resolveId!: (id: string) => void;
  private rejectId!: (error: Error) => void;
  readonly nativeSessionId = new Promise<string>((resolve, reject) => { this.resolveId = resolve; this.rejectId = reject; });
  constructor(private readonly input: DriverTaskInput, private readonly io: DriverHostIo, private readonly options: CodexSessionDriverOptions) {
    const aliases = Object.fromEntries(input.mcp.servers.map((id) => [id, nativeCodexMcpId(input.taskId, id)]));
    this.nativeInput = { ...input, mcp: { ...input.mcp, servers: input.mcp.servers.map((id) => aliases[id]!) }, mcpServerSpecs: Object.fromEntries(input.mcp.servers.map((id) => [aliases[id]!, input.mcpServerSpecs[id]!])) };
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
  private async connect(inherited?: readonly string[], inheritedPlugins?: readonly string[], inheritedHooks?: readonly CodexHookMetadata[]): Promise<CodexRpc> {
    const launch = buildCodexLaunch(this.nativeInput, inherited, this.options, inheritedPlugins, inheritedHooks);
    const spawning = this.io.spawn(launch.command, launch.args, { cwd: this.input.cwd, env: launch.env });
    this.spawning = spawning;
    const child = await spawning;
    if (this.spawning === spawning) this.spawning = undefined;
    if (this.closed) { await this.stopChild(); throw new Error("codex-task-closed"); }
    this.child = child;
    const rpc = new CodexRpc((text) => child.writeStdin(text), (message) => this.onMessage(message), { timeoutMs: this.options.rpcTimeoutMs });
    this.rpc = rpc;
    child.onStdout((chunk) => { try { rpc.push(chunk); } catch { void this.fail("codex-rpc-invalid-frame"); } });
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
  private fail(code: string): Promise<void> {
    if (this.failure) return this.failure;
    this.failed = true;
    this.rejectId(new Error(code));
    this.emit({ kind: "diagnostic", data: { code } });
    // Do not settle before the process group is drained: the host can relinquish ownership on done.
    this.failure = (async () => {
      try { await this.stopChild(); } finally { this.finish({ status: "failed", error: code }); }
    })();
    return this.failure;
  }
  async initialize(): Promise<void> {
    try {
      if (this.input.assignment.runnerId !== "codex" || !this.input.assignment.modelId.trim()) throw new Error("codex-invalid-assignment");
      const inventory = await this.connect();
      const config = object(object(await inventory.call("config/read", { cwd: this.input.cwd, includeLayers: false })).config);
      const inherited = Object.keys(object(config.mcp_servers));
      const inheritedHooks = this.input.nativeMemory?.status === "ready" ? await this.readHooks(inventory) : [];
      await this.stopChild();
      const rpc = await this.connect(inherited, Object.keys(object(config.plugins)), inheritedHooks);
      verifyCodexConfig(object(object(await rpc.call("config/read", { cwd: this.input.cwd, includeLayers: false })).config), this.nativeInput);
      if (this.input.nativeMemory?.status === "ready") {
        const activeHooks = (await this.readHooks(rpc)).filter(hook => hook.enabled !== false);
        if (activeHooks.length !== 2 || !["stop", "userPromptSubmit"].every(event => activeHooks.some(hook => hook.eventName === event))
          || activeHooks.some(hook => !isAdmittedCodexMemoryHook(hook, this.input) || hook.trustStatus !== "trusted")) throw new Error("codex-hook-isolation-violation");
        this.attestedMemory = { ...this.input.nativeMemory, plugin: { ...this.input.nativeMemory.plugin!, exclusiveHookEvents: ["userPromptSubmit", "stop"] } };
      }
      const thread = object(object(await rpc.call(this.input.resume ? "thread/resume" : "thread/start", {
        ...nativeModel(this.input.assignment.modelId), cwd: this.input.cwd,
        developerInstructions: this.input.rolePrompt,
        approvalPolicy: this.input.approvals === "relay" ? "on-request" : "never",
        approvalsReviewer: "user", sandbox: this.input.approvals === "relay" ? "read-only" : "danger-full-access",
        ...(this.input.resume ? { threadId: this.input.resume.nativeSessionId } : { ephemeral: false }),
      })).thread);
      if (typeof thread.id !== "string" || !thread.id || this.input.resume && thread.id !== this.input.resume.nativeSessionId) throw new Error("codex-native-session-id-mismatch");
      this.threadId = thread.id;
      await this.verifyRuntimeMcp(rpc, Date.now() + (this.options.rpcTimeoutMs ?? 30_000));
    } catch (error) { await this.fail(error instanceof Error && /^codex-/.test(error.message) ? error.message : "codex-startup-failed"); throw error; }
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
      return this.startupInterrupted ? { status: "interrupted-forced" } : { status: "failed", error: "codex-startup-failed", ...(error instanceof Error && error.message === "codex-native-session-not-found" ? { reasonCode: "native-session-not-found" as const } : {}) };
    }
  }
  private async verifyRuntimeMcp(rpc: CodexRpc, deadline: number): Promise<void> {
    for (;;) {
      const names: string[] = [], seen = new Set<string>();
      let page = object(await rpc.call("mcpServerStatus/list", { threadId: this.threadId, detail: "full" }));
      let starting = false;
      for (;;) {
        if (!Array.isArray(page.data)) throw new Error("codex-mcp-status-invalid");
        for (const item of page.data) {
          const server = object(item);
          if (typeof server.name !== "string") throw new Error("codex-mcp-status-invalid");
          if (server.runtimeStatus === "disabled") continue;
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
      if (JSON.stringify(names.sort()) !== JSON.stringify([...this.nativeInput.mcp.servers].sort())) throw new Error("codex-runtime-mcp-isolation-violation");
      if (!starting) return;
      if (Date.now() >= deadline) throw new Error("codex-mcp-server-not-connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.closed) throw new Error("codex-task-closed");
    }
  }
  private onMessage(message: RpcMessage): void {
    message = redactImagePayload(message);
    if (message.id !== undefined && message.method) { void this.approve(message); return; }
    const p = object(message.params);
    if (p.threadId !== undefined && this.threadId !== undefined && p.threadId !== this.threadId) {
      this.emit({ kind: "runner.unmapped", data: { nativeType: isHookNotification(message) ? redactText(message.method!, 128) : message.method, reason: "foreign-thread" }, ...(isHookNotification(message) ? {} : { raw: message }) }); return;
    }
    if (message.method === "turn/started" && this.turn) this.turn.id = typeof object(p.turn).id === "string" ? object(p.turn).id as string : this.turn.id;
    if (message.method === "turn/completed") {
      const id = object(p.turn).id;
      if (!this.turn || this.turn.id && id !== this.turn.id) { this.emit({ kind: "runner.unmapped", data: { nativeType: message.method, reason: "stale-turn" }, raw: message }); return; }
      for (const event of mapCodexNotification(message, this.attestedMemory)) this.emit(event);
      this.finish({ status: codexTurnStatus(object(p.turn).status) }, true);
      return;
    }
    for (const event of mapCodexNotification(message, this.attestedMemory)) this.emit(event);
  }
  private async approve(message: RpcMessage): Promise<void> {
    const rpc = this.rpc, id = message.id!, p = object(message.params);
    const schema = object(p.requestedSchema), meta = object(p._meta);
    const prefix = `Allow the ${String(p.serverName)} MCP server to run tool "`;
    const nativeTool = typeof p.message === "string" && p.message.startsWith(prefix) && p.message.endsWith('"?') ? p.message.slice(prefix.length, -2) : undefined;
    // Codex wraps tool approval in an empty form; a general MCP elicitation can request
    // arbitrary user data and must never be treated as permission to run a tool.
    const mcpApproval = message.method === "mcpServer/elicitation/request" && p.mode === "form"
      && meta.codex_approval_kind === "mcp_tool_call" && typeof p.serverName === "string" && this.nativeInput.mcp.servers.includes(p.serverName)
      && schema.type === "object" && typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)
      && Object.keys(object(schema.properties)).length === 0 && Object.keys(schema).every((key) => key === "type" || key === "properties")
      && nativeTool !== undefined && /^[A-Za-z0-9_.-]{1,128}$/.test(nativeTool);
    const known = mcpApproval || ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method!);
    const activeTurn = this.turn;
    if (!known || !activeTurn || typeof activeTurn.id !== "string" || activeTurn.id.length === 0
      || p.threadId !== this.threadId || p.turnId !== activeTurn.id) {
      this.emit({ kind: "runner.unmapped", data: { nativeType: isHookNotification(message) ? redactText(message.method!, 128) : message.method }, ...(isHookNotification(message) ? {} : { raw: message }) });
      rpc?.reject(id, -32601, "Unsupported or stale server request"); return;
    }
    if (this.approvals.has(id)) return;
    this.approvals.add(id);
    let decision = "decline";
    try {
      if (this.input.approvals === "relay") {
        const result = await this.io.approval({ approvalId: `codex:${String(id)}`,
          tool: mcpApproval ? `mcp__${p.serverName}__${nativeTool}` : message.method!,
          summary: mcpApproval ? p.message as string : typeof p.command === "string" ? p.command : "Codex file changes",
          input: mcpApproval ? meta.tool_params : p });
        decision = result.decision === "allow" ? "accept" : "decline";
      } else if (mcpApproval) decision = "accept"; // The approved runner-default bypass covers isolated MCP tools too.
    } catch { /* broker failure denies */ }
    finally { this.approvals.delete(id); }
    // Never approve work after a close, interrupt, or turn completion.
    if (this.closed || this.turn !== activeTurn || activeTurn.interrupted || activeTurn.id !== p.turnId) decision = "decline";
    try { rpc?.reply(id, mcpApproval ? { action: decision, content: decision === "accept" ? {} : null, _meta: null } : { decision }); }
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
        const result = object(await this.rpc!.call("turn/start", { threadId: this.threadId, input: [...(prompt || !nativeImages.length ? [{ type: "text", text: prompt }] : []), ...nativeImages], ...(this.input.assignment.thinking ? { effort: this.input.assignment.thinking } : {}) }));
        if (typeof object(result.turn).id !== "string") throw new Error("codex-turn-id-missing");
        state.id = object(result.turn).id as string;
        if (state.interrupted && this.turn === state) this.deliverInterrupt(state);
      } catch { await this.fail("codex-turn-start-failed"); }
    })();
    return done;
  }
  private deliverInterrupt(state: Turn): void {
    if (state.id) void this.rpc?.call("turn/interrupt", { threadId: this.threadId, turnId: state.id }).catch(() => {});
  }
  async interrupt(): Promise<void> {
    const state = this.turn;
    if (!state && !this.threadId && !this.closed) {
      this.startupInterrupted = true;
      await this.close();
      return;
    }
    if (!state || state.interrupted) return;
    state.interrupted = true;
    state.escalation = setTimeout(() => {
      void (async () => { this.closed = true; try { await this.stopChild(); } finally { this.finish({ status: "interrupted-forced" }); } })();
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
    runnerId: "codex", protocol: CODEX_PROTOCOL, testedVersions: CODEX_TESTED_VERSIONS,
    async probe(ctx): Promise<DriverProbe> {
      const capabilities = ["native-resume", "approval-relay", "interrupt-rpc", "metadata-verified-mcp-isolation", "hooks-disabled"];
      try {
        const result = await (options.exec ?? defaultExec)(ctx.executablePath ?? options.executable ?? "codex", ["--version"], { cwd: ctx.cwd, timeoutMs: 5000 });
        const version = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
        if (result.code !== 0 || !version) return { status: "blocked", reasonCode: "codex-version-unavailable", capabilities };
        if (compare(version, CODEX_TESTED_VERSIONS.min) < 0) return { version, status: "blocked", reasonCode: "codex-version-too-old", capabilities };
        if (compare(version, CODEX_TESTED_VERSIONS.maxTested) > 0) return { version, status: "degraded", reasonCode: "codex-version-untested", capabilities, mcpIsolationVerified: false };
        return { version, status: "ready", capabilities, mcpIsolationVerified: true };
      } catch { return { status: "blocked", reasonCode: "codex-executable-unavailable", capabilities }; }
    },
    async startTask(input, io): Promise<DriverTaskHandle> {
      const task = new CodexTask(input, io, options);
      const done = task.start();
      return { nativeSessionId: task.nativeSessionId, done, send: (prompt, images) => task.send(prompt, images), interrupt: () => task.interrupt(), close: () => task.close() };
    },
  };
}
