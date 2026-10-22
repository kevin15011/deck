import { contextCapacity, contextIdentity, sanitizeContextObservation } from "@deck/core/session/events";
import { openCodeProjectConfigDisabled, pendingOpenCodeProjectSources } from "../personal-mcp";
import { prepareImages, redactImagePayload } from "./images";
import { execFile } from "node:child_process";
import type { DriverDecision, DriverHostIo, DriverImageInput, DriverProbe, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver, SupervisedChild, TurnOutcome } from "@deck/core/session/driver";
import { validateQuestions, validateQuestionAnswers, type DriverQuestionAnswer, type Question } from "@deck/core/session/question";
import { redactText } from "@deck/core/session/redaction";
import { conflictingOpenCodeMcp, buildOpenCodeLaunch, type OpenCodeLaunchOptions } from "./launch";
import { OpenCodeEventMapper, OpenCodeSseParser, OPENCODE_PROTOCOL, record } from "./mapper";
import { classifyOpenCodeFailure } from "./failure";

export const OPENCODE_TESTED_VERSIONS = { min: "1.18.31", maxTested: "1.18.31" } as const;
export type OpenCodeSessionDriverOptions = OpenCodeLaunchOptions & {
  readinessMs?: number; escalationMs?: number; killGraceMs?: number;
  exec?: (command: string, args: readonly string[], options: { cwd: string; timeoutMs: number }) => Promise<{ code: number | null; stdout: string }>;
};
const nativeExec: NonNullable<OpenCodeSessionDriverOptions["exec"]> = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, [...args], { cwd: opts.cwd, timeout: opts.timeoutMs, encoding: "utf8" }, (err, stdout) => { if (err && (err as NodeJS.ErrnoException).code === "ENOENT") reject(err); else resolve({ code: err ? 1 : 0, stdout }); });
});
const compare = (a: string, b: string) => { const aa = a.split(".").map(Number), bb = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i]! - bb[i]!; return 0; };

type Turn = { settle: (outcome: TurnOutcome) => void; interrupted: boolean; contextCompacted?: boolean; forced?: boolean; timer?: ReturnType<typeof setTimeout>; controller: AbortController };

class OpenCodeTask {
  private base = "";
  private nativeId = "";
  private child!: SupervisedChild;
  private current?: Turn;
  private readonly lifetime = new AbortController();
  private closed = false;
  private serverDead = false;
  private termination?: Promise<void>;
  private readonly seenPermissions = new Set<string>();
  private readonly seenQuestions = new Set<string>();
  private stream?: Promise<void>;
  private authorization = "";
  // This task owns one native server. Keep only validated limits, keyed by the
  // exact provider/model tuple; no cross-server or growing global cache.
  private readonly contextLimits = new Map<string, number>();
  private readonly mapper = new OpenCodeEventMapper();
  constructor(private readonly input: DriverTaskInput, private readonly io: DriverHostIo, private readonly options: OpenCodeSessionDriverOptions) {}

  private emit(event: Parameters<DriverHostIo["emit"]>[0]) { try { this.io.emit(event); } catch { /* A consumer cannot own the server lifetime. */ } }
  private terminate(): Promise<void> { return this.termination ??= this.child.terminateGroup(this.options.killGraceMs ?? 2000); }
  private finish(outcome: TurnOutcome) {
    const turn = this.current; if (!turn) return;
    this.current = undefined; if (turn.timer) clearTimeout(turn.timer); turn.controller.abort(); turn.settle(outcome);
  }

  async initialize(): Promise<void> {
    const launch = buildOpenCodeLaunch(this.input, this.io, this.options);
    this.authorization = `Basic ${Buffer.from(`opencode:${launch.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
    this.child = await this.io.spawn(launch.command, launch.args, { cwd: this.input.cwd, env: launch.env });
    let endpointResolve!: (url: string) => void, endpointReject!: (e: Error) => void;
    const endpoint = new Promise<string>((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
    let output = "";
    const onOutput = (chunk: string) => {
      output = (output + chunk).slice(-8192);
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) endpointResolve(`http://127.0.0.1:${match[1]}`);
    };
    this.child.onStdout(onOutput); this.child.onStderr(onOutput); this.child.endStdin();
    void this.child.exited.then(exit => { this.serverDead = true; endpointReject(new Error("OpenCode server exited before readiness")); this.lifetime.abort(); if (!this.current?.forced) this.finish({ status: "failed", error: "OpenCode server exited", failure: exit.anchorLost ? { category: "unknown", origin: "unknown", certainty: "inferred" } : { category: "runner-process", origin: "runner", certainty: "reported" } }); }, () => { this.serverDead = true; endpointReject(new Error("OpenCode anchor lost")); this.lifetime.abort(); if (!this.current?.forced) this.finish({ status: "failed", error: "OpenCode anchor lost", failure: { category: "unknown", origin: "unknown", certainty: "inferred" } }); });
    const startup = new AbortController();
    const startupSignal = AbortSignal.any([this.lifetime.signal, startup.signal]);
    const startupFailure = new Promise<never>((_resolve, reject) => {
      startupSignal.addEventListener("abort", () => reject(startupSignal.reason ?? new Error("OpenCode startup aborted")), { once: true });
    });
    const timeout = setTimeout(() => startup.abort(new Error("OpenCode readiness timed out")), this.options.readinessMs ?? 10_000);
    const setup = async () => {
      const [url] = await Promise.all([endpoint, this.child.ready]);
      startupSignal.throwIfAborted();
      this.base = url;
      void this.loadContextLimits();
      const config = await this.request("/config", undefined, startupSignal);
      if (!record(config) || !record(config.mcp)) throw new Error("opencode-native-config-unavailable");
      const conflicts = conflictingOpenCodeMcp(config, launch, this.input.suppressedMcpServers);
      if (conflicts.length) {
        this.emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", conflicting: conflicts } });
        throw new Error("opencode-mcp-spec-conflict");
      }
      const nativeDeclarations = Object.entries(config.mcp).filter(([id]) => !launch.expectedMcpServers.includes(id) && !(this.input.suppressedMcpServers ?? []).includes(id)).map(([id, value]) => ({id,source:"native",status:record(value) && value.enabled === false ? "unavailable" : "configured",...(record(value) && value.enabled === false ? {reason:"disabled"} : {})}));
      if (nativeDeclarations.length) this.emit({kind:"diagnostic",data:{code:"personal-mcp.sources",servers:nativeDeclarations}});
      const actual = await this.request("/mcp", undefined, startupSignal);
      if (!record(actual) || launch.expectedMcpServers.some(id => !record(actual[id]) || actual[id].status !== "connected")) throw new Error("opencode-managed-mcp-unavailable");
      const personal = Object.keys(actual).filter(id => !launch.expectedMcpServers.includes(id) && !(this.input.suppressedMcpServers ?? []).includes(id) && config.mcp[id]?.enabled !== false);
      this.emit({ kind: "diagnostic", data: { code: "personal-mcp.runtime", active: personal.filter(id => record(actual[id]) && actual[id].status === "connected"), unavailable: personal.filter(id => !record(actual[id]) || actual[id].status !== "connected") } });
      const pendingProject = openCodeProjectConfigDisabled(launch.env) ? pendingOpenCodeProjectSources(this.input.cwd,this.input.projectConfigTrusted ? "disabled" : "project-untrusted") : [];
      if (pendingProject.length) this.emit({ kind: "diagnostic", data: { code: "personal-mcp.sources", servers: pendingProject } });
      if (launch.expectedPlugins.length && (!Array.isArray(config.plugin) || launch.expectedPlugins.some(plugin => !config.plugin.includes(plugin)))) throw new Error("opencode-plugin-isolation-violation");
      if (launch.expectedGlobalSkillPaths.some(path => !Array.isArray(config.skills?.paths) || !config.skills.paths.includes(path))) throw new Error("opencode-global-skills-unavailable");
      if (this.input.nativeMemory?.status === "ready") {
        const tools = await this.request("/experimental/tool/ids", undefined, startupSignal);
        if (!Array.isArray(tools) || !tools.includes("supermemory")) throw new Error("opencode-native-memory-tool-unavailable");
        this.emit({ kind: "diagnostic", data: { code: "native-memory-capture-unverified", provider: "supermemory", runnerId: "opencode", message: "Native Supermemory recall and explicit tools are enabled. Automatic capture completion is not acknowledged by this managed server lifecycle." } });
      }
      const agents = await this.request("/agent", undefined, startupSignal);
      const nativeAgent = Array.isArray(agents) ? agents.find(agent => record(agent) && agent.name === (config.default_agent ?? "build")) : undefined;
      if (!record(nativeAgent) || !Array.isArray(nativeAgent.permission)) throw new Error("opencode-native-permission-policy-unavailable");
      const permission = [{permission:"*",pattern:"*",action:this.input.approvals === "relay" ? "ask" : "allow"}];
      // Native compilation owns defaults, precedence, agent overrides and ~/ expansion.
      // The relay may require approval for an allow; it never promotes a native deny.
      for (const rule of nativeAgent.permission) {
        if (!record(rule) || typeof rule.permission !== "string" || typeof rule.pattern !== "string" || !["ask","allow","deny"].includes(rule.action)) throw new Error("opencode-native-permission-policy-invalid");
        permission.push({permission:rule.permission,pattern:rule.pattern,action:rule.action === "allow" && this.input.approvals === "relay" ? "ask" : rule.action});
      }
      if (this.input.disableNativeDelegation) permission.push({permission:"task",pattern:"*",action:"deny"});
      if (!this.input.disableNativeDelegation) this.emit({ kind: "diagnostic", data: { code: "native-delegation-not-disabled" } });
      const resumePath = this.input.resume ? `/session/${encodeURIComponent(this.input.resume.nativeSessionId)}` : undefined;
      const session = resumePath ? await this.request(resumePath, undefined, startupSignal).catch((error: unknown) => {
        // Scope this classification to the resume lookup, never an MCP/SSE/auth failure.
        if (error instanceof Error && error.message === `OpenCode HTTP 404 for ${resumePath}`) Object.assign(error, { reasonCode: "native-session-not-found" });
        throw error;
      }) : await this.request("/session", { title: `Deck ${this.input.memberId}`, permission }, startupSignal);
      if (!record(session) || typeof session.id !== "string" || !session.id || (this.input.resume && session.id !== this.input.resume.nativeSessionId)) throw new Error("opencode-native-session-unavailable");
      if (resumePath) await this.request(resumePath, { permission }, startupSignal, "PATCH");
      this.nativeId = session.id;
      const response = await fetch(this.base + "/event", { headers: { authorization: this.authorization }, signal: startupSignal });
      if (!response.ok || !response.body) throw new Error("OpenCode SSE unavailable");
      this.stream = this.readStream(response.body);
      const pending = await this.request("/permission", undefined, startupSignal);
      for (const permission of Array.isArray(pending) ? pending : []) this.permission(permission);
      const questions = await this.request("/question", undefined, startupSignal);
      for (const question of Array.isArray(questions) ? questions : []) this.question(question);
    };
    try { await Promise.race([setup(), startupFailure]);
    } catch (error) { await this.close(); throw error; } finally { clearTimeout(timeout); }
  }

  /** One bounded local metadata request, independent of readiness/turn latency.
   * The inventory CLI does not retain model limits, so it cannot supply them.
   * If this has not completed by a prompt response, publish used tokens alone. */
  private async loadContextLimits(): Promise<void> {
    try {
      const response = await fetch(this.base + '/provider', { redirect: 'error', headers: { authorization: this.authorization }, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(1500)]) });
      if (!response.ok || !response.body) { await response.body?.cancel(); return; }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4 * 1024 * 1024) { await reader.cancel(); return; }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const catalog: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (this.closed || this.lifetime.signal.aborted || !record(catalog) || !Array.isArray(catalog.all)) return;
      for (const provider of catalog.all) {
        if (!record(provider) || !contextIdentity(provider.id) || !record(provider.models)) continue;
        for (const [modelId, model] of Object.entries(provider.models)) {
          if (this.contextLimits.size >= 10000) return;
          const capacity = record(model) && record(model.limit) ? contextCapacity(model.limit.context) : null;
          if (contextIdentity(modelId) && capacity !== null) this.contextLimits.set(JSON.stringify([provider.id, modelId]), capacity);
        }
      }
    } catch { /* Optional metadata never delays or fails a turn. */ }
  }

  private async request(path: string, body?: unknown, signal?: AbortSignal, method?: "PATCH"): Promise<unknown> {
    const response = await fetch(this.base + path, {
      method: method ?? (body === undefined ? "GET" : "POST"), headers: { authorization: this.authorization, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ?? AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status} for ${path}`);
    const text = await response.text(); if (!text) return undefined;
    try { return JSON.parse(text); } catch { throw new Error(`OpenCode invalid JSON for ${path}`); }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader(), decoder = new TextDecoder(), parser = new OpenCodeSseParser();
    try {
      while (!this.closed) {
        const chunk = await reader.read(); if (chunk.done) throw new Error("OpenCode SSE ended");
        for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) this.event(event);
      }
    } catch (error) {
      if (!this.closed && !this.serverDead) { this.serverDead = true; this.finish({ status: "failed", error: redactText((error as Error).message, 400), failure: { category: "network", origin: "unknown", certainty: "inferred" } }); void this.terminate().catch(() => {}); }
    } finally { reader.releaseLock(); }
  }

  private event(raw: unknown) {
    raw = redactImagePayload(raw);
    const p = record(raw) && record(raw.properties) ? raw.properties : {};
    const sid = p.sessionID ?? (record(p.part) ? p.part.sessionID : undefined) ?? (record(p.info) ? p.info.sessionID : undefined);
    if (sid && sid !== this.nativeId) return;
    // SSE assistant updates carry a parent id but this request does not yet
    // know its native user-message id. Use the existing correlated HTTP result
    // below instead of assigning a late same-session update to a new request.
    for (const event of this.mapper.map(raw)) if (event.kind !== 'usage') this.emit(event);
    if (!record(raw)) return;
    if (raw.type === 'session.compacted' && sid === this.nativeId) {
      if (this.current) this.current.contextCompacted = true;
      this.emit({ kind: 'diagnostic', data: { code: 'context.invalidated', reason: 'compaction', nativeThreadId: this.nativeId } });
    }
    if (raw.type === "permission.asked") this.permission(p);
    if (raw.type === "question.asked") this.question(p);
    if (raw.type === "session.error") {
      const aborted = this.current?.interrupted && record(p.error) && p.error.name === "MessageAbortedError";
      // This event has only session identity, no request/turn identity. Preserve its terminal
      // behavior without assigning an uncorrelated provider cause to a newer request.
      this.finish(aborted ? { status: "interrupted" } : { status: "failed", error: "OpenCode session error", failure: { category: "unknown", origin: "unknown", certainty: "inferred" } });
    }
    if ((raw.type === "session.idle" || (raw.type === "session.status" && record(p.status) && p.status.type === "idle")) && this.current?.interrupted) this.finish({ status: "interrupted" });
  }

  private permission(raw: unknown) {
    if (!record(raw) || raw.sessionID !== this.nativeId || typeof raw.id !== "string" || this.seenPermissions.has(raw.id)) return;
    this.seenPermissions.add(raw.id);
    const turn = this.current;
    void (async () => {
      let decision: DriverDecision = { decision: "deny" };
      const permission = String(raw.permission ?? "unknown");
      const patterns = Array.isArray(raw.patterns) ? raw.patterns : [];
      const exactKey = redactText(patterns.join(" "), 4096);
      // Keep full-fidelity matching separate from the redacted display key.
      const identity = patterns.length ? JSON.stringify({ permission, patterns }) : undefined;
      const boundedIdentity = identity && Buffer.byteLength(identity, "utf8") <= 16 * 1024 ? identity : undefined;
      const supportsAlways = Array.isArray(raw.always) && raw.always.length > 0;
      if (turn && !turn.interrupted && this.input.approvals === "relay") {
        try {
          decision = await this.io.approval({
            approvalId: raw.id, tool: permission, toolKey: `opencode:${permission}`,
            ...(exactKey ? { exactKey } : {}),
            ...(boundedIdentity ? { identity: boundedIdentity } : {}),
            risk: ["read", "glob", "grep", "list"].includes(permission) ? "normal" : "high",
            ...(supportsAlways ? {
              nativeScopes: ["always"],
              alwaysNote: `OpenCode stores this permission for this project on this machine (outside Deck); it applies to future sessions and Deck cannot revoke it
Patterns: ${raw.always.join("\n")}`,
            } : {}),
            summary: Array.isArray(raw.patterns) ? raw.patterns.join(", ") : undefined, input: raw.metadata,
          });
        } catch { /* Broker failure denies. */ }
      }
      if (this.closed) return;
      if (!turn || this.current !== turn || turn.interrupted || turn.controller.signal.aborted) decision = { decision: "deny" };
      const reply = decision.decision === "allow" ? (decision.scope === "always" && supportsAlways ? "always" : "once") : "reject";
      await this.request(`/permission/${encodeURIComponent(raw.id)}/reply`, { reply });
    })().catch(error => { this.emit({ kind: "diagnostic", data: { code: "opencode-permission-reply-failed", message: redactText((error as Error).message, 300) } }); if (turn && this.current === turn) this.finish({ status: "failed", error: "OpenCode permission reply failed" }); });
  }

  private question(raw: unknown) {
    if (!record(raw) || raw.sessionID !== this.nativeId || typeof raw.id !== "string" || this.seenQuestions.has(raw.id)) return;
    this.seenQuestions.add(raw.id);
    const turn = this.current;
    void (async () => {
      let answer: DriverQuestionAnswer = { outcome: "dismissed" };
      let questions: Question[] = [];
      try {
        questions = raw.questions.map((q: Record<string, any>, index: number) => ({
          id: `q${index + 1}`, prompt: q.question, header: q.header,
          options: q.options.map((option: Record<string, any>) => ({ label: option.label, description: option.description })),
          multiple: !!q.multiple, allowOther: q.custom !== false, secret: false,
        }));
        if (turn && !turn.interrupted && this.io.question && validateQuestions(questions)) {
          answer = await this.io.question({ questionId: raw.id, questions });
          if (answer.outcome === "answered" && !validateQuestionAnswers(questions, answer.answers).ok) answer = { outcome: "dismissed" };
        }
      } catch { answer = { outcome: "dismissed" }; }
      if (this.closed) return;
      if (!turn || this.current !== turn || turn.interrupted || turn.controller.signal.aborted) answer = { outcome: "cancelled" };
      const path = `/question/${encodeURIComponent(raw.id)}`;
      if (answer.outcome === "answered") {
        try {
          const answers = answer.answers;
          await this.request(path + "/reply", { answers: questions.map(q => answers[q.id]) });
          return;
        } catch (error) {
          // Reject the pending native request as well when delivering answers fails.
          await this.request(path + "/reject", {}).catch(() => {});
          throw error;
        }
      }
      await this.request(path + "/reject", {});
    })().catch(error => { this.emit({ kind: "diagnostic", data: { code: "opencode-question-reply-failed", message: redactText((error as Error).message, 300) } }); if (turn && this.current === turn) this.finish({ status: "failed", error: "OpenCode question reply failed" }); });
  }

  send(prompt: string, images?: readonly DriverImageInput[]): Promise<TurnOutcome> {
    if (this.closed || this.serverDead) return Promise.resolve({ status: "failed", error: "OpenCode task is closed" });
    if (this.current) return Promise.reject(new Error("An OpenCode turn is already running"));
    let nativeImages: ReturnType<typeof prepareImages>;
    try { nativeImages = prepareImages(images); }
    catch { return Promise.resolve({ status: "failed", error: "image-input-invalid" }); }
    const split = this.input.assignment.modelId.replace(/^opencode\/(.+\/.+)$/, "$1").indexOf("/");
    const modelId = this.input.assignment.modelId.replace(/^opencode\/(.+\/.+)$/, "$1");
    if (split <= 0) return Promise.resolve({ status: "failed", error: "OpenCode model must be provider/model" });
    const done = new Promise<TurnOutcome>(settle => { this.current = { settle, interrupted: false, controller: new AbortController() }; });
    const turn = this.current!;
    this.emit({ kind: "turn.started", data: { nativeSessionId: this.nativeId, nativeThreadId: this.nativeId, model: this.input.assignment.modelId } });
    void this.request(`/session/${encodeURIComponent(this.nativeId)}/message`, {
      system: this.input.rolePrompt, model: { providerID: modelId.slice(0, split), modelID: modelId.slice(split + 1) },
      ...(this.input.assignment.thinking && this.input.assignment.thinking !== "off" ? { variant: this.input.assignment.thinking } : {}), parts: [...(prompt || !nativeImages.length ? [{ type: "text", text: prompt }] : []), ...nativeImages.map(image => ({ type: "file", mime: image.mimeType, filename: image.name, url: `data:${image.mimeType};base64,${image.data}` }))],
    }, AbortSignal.any([turn.controller.signal, this.lifetime.signal])).then(result => {
      if (this.current !== turn) return;
      if (turn.interrupted && record(result) && record(result.info) && record(result.info.error) && result.info.error.name === "MessageAbortedError") return this.finish({ status: "interrupted" });
      if (!record(result) || !record(result.info) || result.info.error) return this.finish({ status: "failed", error: "OpenCode message failed", failure: classifyOpenCodeFailure(record(result) && record(result.info) ? result.info.error : undefined) });
      if (result.info.sessionID === this.nativeId && !turn.interrupted) {
        for (const event of this.mapper.map({ type: 'message.updated', properties: { info: result.info } })) {
          if (event.kind === 'usage') {
            const { context: reported, ...native } = event.data;
            const capacity = this.contextLimits.get(JSON.stringify([result.info.providerID, result.info.modelID])) ?? null;
            const context = record(reported) ? sanitizeContextObservation({ ...reported, capacity }) : undefined;
            this.emit({ ...event, data: { ...native, ...(!turn.contextCompacted && context ? { context } : {}) } });
          }
        }
      }
      for (const part of Array.isArray(result.parts) ? result.parts : []) if (record(part) && part.type === "text" && typeof part.text === "string") this.emit({ kind: "message.completed", data: { text: part.text, messageId: result.info.id }, raw: part });
      this.finish({ status: turn.interrupted ? "interrupted" : "completed" });
    }, error => { if (this.current === turn && !turn.interrupted) this.finish({ status: "failed", error: redactText((error as Error).message, 400) }); });
    return done;
  }

  async interrupt(): Promise<void> {
    const turn = this.current; if (!turn || turn.interrupted) return;
    turn.interrupted = true;
    turn.timer = setTimeout(() => {
      if (this.current !== turn) return;
      turn.forced = true;
      void this.terminate().then(() => this.finish({ status: "interrupted-forced" }), () => this.finish({ status: "failed", error: "OpenCode forced interruption cleanup failed" }));
    }, this.options.escalationMs ?? 10_000);
    try { await this.request(`/session/${encodeURIComponent(this.nativeId)}/abort`, {}); } catch { /* Wait for native terminal event or escalation. */ }
  }

  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.finish({ status: "interrupted-forced" }); this.lifetime.abort();
    if (this.child) await this.terminate().catch(() => {});
    await this.stream;
  }
  get id() { return this.nativeId; }
}

export function createOpenCodeSessionDriver(options: OpenCodeSessionDriverOptions = {}): RunnerSessionDriver {
  return {
    runnerId: "opencode", protocol: OPENCODE_PROTOCOL, testedVersions: { ...OPENCODE_TESTED_VERSIONS },
    async probe(ctx): Promise<DriverProbe> {
      let text: string;
      try { const result = await (options.exec ?? nativeExec)(ctx.executablePath ?? options.executable ?? "opencode", ["--version"], { cwd: ctx.cwd, timeoutMs: 5000 }); if (result.code !== 0) throw Error("probe failed"); text = result.stdout; } catch { return { status: "blocked", reasonCode: "opencode-not-installed", capabilities: [] }; }
      const version = /(\d+\.\d+\.\d+)/.exec(text)?.[1];
      if (!version) return { status: "blocked", reasonCode: "opencode-version-unparsable", capabilities: [] };
      if (compare(version, OPENCODE_TESTED_VERSIONS.min) < 0) return { version, status: "blocked", reasonCode: "opencode-version-unsupported", capabilities: [] };
      const untested = compare(version, OPENCODE_TESTED_VERSIONS.maxTested) > 0;
      return { version, status: untested ? "degraded" : "ready", ...(untested ? { reasonCode: "opencode-version-untested" } : {}), capabilities: ["native-session-resume", "approval-relay", "interrupt-abort", "native-config-inheritance", "server-basic-auth"], mcpIsolationVerified: false };
    },
    async startTask(input, io): Promise<DriverTaskHandle> {
      const task = new OpenCodeTask(input, io, options); await task.initialize();
      return { nativeSessionId: Promise.resolve(task.id), done: task.send(input.prompt, input.images), send: (prompt, images) => task.send(prompt, images), interrupt: () => task.interrupt(), close: () => task.close() };
    },
  };
}
