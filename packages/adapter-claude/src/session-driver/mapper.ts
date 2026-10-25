import {claudeRequestInput} from "@deck/core/session/request-input";
/**
 * Claude Code stream-json mapper (XR-1.4, XR-4.5): one stdout JSON message in, normalized
 * driver events out. Tracks the current streamed message id and one-shot diagnostics; unknown shapes
 * become `runner.unmapped` with raw, never an exception.
 *
 * Shapes verified against 2.1.296 recordings in `__fixtures__/2.1.296` (tool_use/tool_result
 * and permission_denials per the documented format; see the fixture README).
 */
import { boundRaw, sanitizeContextObservation, contextTokenSum, type ContextObservation } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import type { DriverEvent, NativeMemoryDescriptor } from "@deck/core/session/driver";
import type { TurnFailure } from "@deck/core/session/failure";
import { classifyClaudeFailure } from "./failure";

export const CLAUDE_PROTOCOL = "claude-stream-json";
const TOOL_INPUT_LIMIT = 8192;
const TOOL_OUTPUT_LIMIT = 8192;
const DIAGNOSTIC_TEXT_LIMIT = 500;
// Finite serialized capacity, including JSON escaping; not a heap bound. Keep
// downstream output limits. A record may carry terminal/control data: never skip it.
export const CLAUDE_MAX_LINE_BYTES = 16 * 1024 * 1024;
export class ClaudeLineError extends Error {
  readonly code = 'claude-line-too-long';
  constructor(readonly size: { frameBytes: number; frameBytesKind: 'exact' | 'lower-bound'; maxFrameBytes: number }) { super('claude-line-too-long'); }
}

export type ClaudeInit = {
  sessionId: string; model?: string; version?: string;
  mcpServers: Array<{ name: string; status?: string }>; tools: string[];
};
export type ClaudeResult = {
  subtype: string; isError: boolean; text?: string; sessionId?: string;
  permissionDenials: Array<{ tool: string; toolUseId?: string }>; terminalReason?: string; errors: string[];
  failure?: TurnFailure;
};
export type MapOutput = { events: DriverEvent[]; init?: ClaudeInit; result?: ClaudeResult; hookSeen?: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const INIT_RAW_KEYS = ["type", "subtype", "session_id", "cwd", "tools", "mcp_servers", "model", "permissionMode", "apiKeySource", "claude_code_version"];
/** System subtypes that carry no session-relevant information. */
const IGNORED_SYSTEM = new Set(["thinking_tokens", "informational"]);
const HOOK_SYSTEM = new Set(["hook_started", "hook_response", "hook_progress"]);

export function parseClaudeLine(line: string): { ok: true; message: Record<string, unknown> } | { ok: false } {
  try {
    const value = JSON.parse(line) as unknown;
    return isObj(value) ? { ok: true, message: value } : { ok: false };
  } catch { return { ok: false }; }
}

/** Reassembles bounded UTF-8 records. Overflow poisons this process's stream. */
export class ClaudeLineSplitter {
  private buffer = "";
  private bytes = 0;
  private highSurrogate = false;
  private failed = false;
  constructor(private readonly maxBytes = CLAUDE_MAX_LINE_BYTES) {}

  /** Dispatch completed lines before inspecting a potentially rejected successor. */
  push(chunk: string, dispatch?: (line: string) => void): string[] {
    if (this.failed) return [];
    const lines: string[] = [];
    let start = 0;
    while (start < chunk.length) {
      const at = chunk.indexOf('\n', start);
      const fragment = chunk.slice(start, at < 0 ? undefined : at);
      // Host stdout is decoded text; a surrogate pair split across callbacks
      // still represents one four-byte UTF-8 character.
      const paired = this.highSurrogate && /^[\uDC00-\uDFFF]/.test(fragment);
      const bytes = this.bytes + Buffer.byteLength(fragment, 'utf8') - (paired ? 2 : 0);
      if (bytes > this.maxBytes) {
        this.failed = true; this.buffer = ''; this.bytes = 0; this.highSurrogate = false;
        throw new ClaudeLineError({ frameBytes: bytes, frameBytesKind: at < 0 ? 'lower-bound' : 'exact', maxFrameBytes: this.maxBytes });
      }
      this.buffer += fragment; this.bytes = bytes;
      if (fragment.length) this.highSurrogate = /[\uD800-\uDBFF]$/.test(fragment);
      if (at < 0) break;
      const line = this.buffer; this.buffer = ''; this.bytes = 0; this.highSurrogate = false;
      if (line.trim().length > 0) { if (dispatch) dispatch(line); else lines.push(line); }
      start = at + 1;
    }
    return lines;
  }

  flush(): string[] {
    const rest = this.failed ? "" : this.buffer;
    this.buffer = ""; this.bytes = 0; this.highSurrogate = false;
    return rest.trim().length > 0 ? [rest] : [];
  }
}

function toolText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (isObj(b) && b.type === "text" && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
  }
  return "";
}

export class ClaudeStreamMapper {
  // One mapper per process/turn. Only correlated messages reach it from the driver.
  private readonly policyRequests=new Map<string,number>();
  private policyRequestOrder=0;
  private policyOrderingOverflow=false;
  private observePolicyRequest(id:string|undefined):boolean {
    if(!id){this.policyRequestOrder++;return false;}
    let order=this.policyRequests.get(id);
    if(order===undefined){order=++this.policyRequestOrder;if(this.policyRequests.size>=256){this.policyOrderingOverflow=true;return false;}this.policyRequests.set(id,order);}
    return !this.policyOrderingOverflow && order===this.policyRequestOrder;
  }
  private policyInput?:ReturnType<typeof claudeRequestInput>;
  private readonly editTools=new Map<string,{path:string;op:string;requestId?:string}>();
  private apiFailure?: TurnFailure;
  private hookReported = false;
  private streamingMessageId?: string;
  private contextCompacted = false;
  private contextObservation?: ContextObservation;
  constructor(private readonly nativeMemory?: NativeMemoryDescriptor, private readonly sessionId?: string, private readonly contextTurnId?: string) {}

  map(message: unknown): MapOutput {
    if (!isObj(message)) return { events: [] };
    switch (message.type) {
      case "system": return this.system(message);
      case "assistant": return this.assistant(message);
      case "stream_event": return this.streamEvent(message);
      case "user": return this.user(message);
      case "rate_limit_event": return this.rateLimit(message);
      case "result": return this.result(message);
      default: return { events: [this.unmapped(str(message.type) ?? "unknown", message)] };
    }
  }

  /** A stdout line that is not JSON: keep a bounded, redacted diagnostic. */
  unparsable(line: string): DriverEvent[] {
    return [{ kind: "diagnostic", data: { code: "claude-nonjson-output", text: redactText(line, DIAGNOSTIC_TEXT_LIMIT) } }];
  }

  private unmapped(type: string, raw: unknown): DriverEvent {
    return { kind: "runner.unmapped", data: { type }, raw };
  }

  private system(m: Record<string, unknown>): MapOutput {
    const subtype = str(m.subtype) ?? "";
    if (subtype === 'compact_boundary' || subtype === 'status' && m.status === 'compacting') {
      if (m.session_id !== undefined && m.session_id !== this.sessionId) return { events: [] };
      this.policyInput=undefined;
      this.contextCompacted = true;
      this.contextObservation = undefined;
      return { events: [{ kind: 'diagnostic', data: { code: 'context.invalidated', reason: 'compaction', nativeThreadId: this.sessionId, nativeTurnId: this.contextTurnId } }] };
    }
    if (subtype === "init") return this.init(m);
    if (HOOK_SYSTEM.has(subtype)) {
      const events: DriverEvent[] = [];
      const hookId = redactText(str(m.hook_id) ?? "", 256);
      const nativeEvent = str(m.hook_event) ?? "";
      const hookEvent = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(nativeEvent) ? nativeEvent : "unknown";
      if (!this.hookReported) {
        this.hookReported = true;
        events.push({ kind: "diagnostic", data: { code: "claude-hook-executed", hookEvent, hookName: hookEvent } });
      }
      if (hookId) {
        const completed = subtype === "hook_response";
        const exitCode = num(m.exit_code);
        const status = !completed ? "running" : exitCode !== undefined ? (exitCode === 0 ? "completed" : "failed") : m.outcome === "success" ? "completed" : ["error", "failed"].includes(String(m.outcome)) ? "failed" : "unknown";
        const attributed = this.nativeMemory?.status === "ready" && this.nativeMemory.plugin?.exclusiveHookEvents?.includes(nativeEvent);
        events.push({ kind: completed ? "hook.completed" : "hook.started", data: {
          hookId, hookEvent, hookName: hookEvent, status, provenance: CLAUDE_PROTOCOL,
          ...(exitCode !== undefined ? { exitCode } : {}),
          ...(attributed ? { provider: "supermemory", integration: "runner-plugin" } : {}),
        } });
      }
      return { events, hookSeen: true };
    }
    if (subtype.startsWith("hook_")) return { events: [{ kind: "runner.unmapped", data: { type: redactText(`system/${subtype}`, 128) } }], hookSeen: true };
    if (IGNORED_SYSTEM.has(subtype)) return { events: [] };
    return { events: [this.unmapped(`system/${subtype || "unknown"}`, m)] };
  }

  private init(m: Record<string, unknown>): MapOutput {
    const mcpServers = (Array.isArray(m.mcp_servers) ? m.mcp_servers : [])
      .filter(isObj).map((s) => ({ name: String(s.name ?? ""), ...(str(s.status) ? { status: str(s.status) } : {}) }));
    const tools = (Array.isArray(m.tools) ? m.tools : []).filter((t): t is string => typeof t === "string");
    const init: ClaudeInit = { sessionId: str(m.session_id) ?? "", ...(str(m.model) ? { model: str(m.model) } : {}), ...(str(m.claude_code_version) ? { version: str(m.claude_code_version) } : {}), mcpServers, tools };
    const raw: Record<string, unknown> = {};
    for (const key of INIT_RAW_KEYS) if (key in m) raw[key] = m[key];
    return {
      init,
      events: [{
        kind: "turn.started",
        data: { nativeSessionId: init.sessionId, ...(init.model ? { model: init.model } : {}), ...(init.version ? { claudeCodeVersion: init.version } : {}), mcpServers: mcpServers.map((s) => s.name) },
        raw,
      }],
    };
  }

  private streamEvent(m: Record<string, unknown>): MapOutput {
    const event = isObj(m.event) ? m.event : {};
    const type = str(event.type) ?? "unknown";
    if (type === "message_start") {
      this.streamingMessageId = isObj(event.message) ? str(event.message.id) : undefined;
      if(this.sessionId!==undefined && m.parent_tool_use_id==null && m.session_id===this.sessionId
        && (!this.streamingMessageId || this.streamingMessageId!==this.policyInput?.nativeRequestId)) {
        this.observePolicyRequest(this.streamingMessageId);this.policyInput=undefined;
        return {events:[{kind:'diagnostic',data:{code:'request.input-invalidated',reason:'new-main-message',nativeRequestId:this.streamingMessageId??null,nativeThreadId:this.sessionId,nativeTurnId:this.contextTurnId}}]};
      }
      return { events: [] };
    }
    if (type === "content_block_delta") {
      const delta = isObj(event.delta) ? event.delta : {};
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return { events: delta.text.length ? [{ kind: "message.delta", data: { ...(this.streamingMessageId ? { messageId: this.streamingMessageId } : {}), text: delta.text } }] : [] };
      }
      // Thinking and tool input are emitted from the authoritative assistant blocks,
      // keeping partial JSON and reasoning out of visible assistant text.
      if (["thinking_delta", "signature_delta", "input_json_delta"].includes(String(delta.type))) return { events: [] };
      return { events: [this.unmapped(`stream_event/content_block_delta/${str(delta.type) ?? "unknown"}`, m)] };
    }
    if (type === "message_stop") {
      this.streamingMessageId = undefined;
      return { events: [] };
    }
    if (["content_block_start", "content_block_stop", "message_delta"].includes(type)) return { events: [] };
    return { events: [this.unmapped(`stream_event/${type}`, m)] };
  }

  private assistant(m: Record<string, unknown>): MapOutput {
    if (m.parent_tool_use_id == null && (this.sessionId === undefined || m.session_id === this.sessionId)) this.apiFailure = classifyClaudeFailure(m);
    const message = isObj(m.message) ? m.message : {};
    const messageId = str(message.id);
    const events: DriverEvent[] = [];
    for (const [blockIndex, block] of (Array.isArray(message.content) ? message.content : []).entries()) {
      if (!isObj(block)) continue;
      if (block.type === "text") {
        if (typeof block.text === "string" && block.text.length > 0) events.push({ kind: "message.completed", data: { ...(messageId ? { messageId } : {}), text: block.text } });
      } else if (block.type === "thinking") {
        if (typeof block.thinking === "string" && block.thinking.length > 0) events.push({ kind: "reasoning.delta", data: { ...(messageId ? { messageId } : {}), blockIndex, partId: String(blockIndex), reasoningKind: "text", format: "snapshot", text: redactText(block.thinking, TOOL_OUTPUT_LIMIT) } });
      } else if (block.type === "tool_use") {
        const input = boundRaw({ runnerId: "claude", protocol: CLAUDE_PROTOCOL, payload: block.input ?? {} }, TOOL_INPUT_LIMIT).payload;
        if(this.sessionId!==undefined && m.parent_tool_use_id==null && m.session_id===this.sessionId && str(block.id) && isObj(block.input) && ['Edit','Write','NotebookEdit'].includes(String(block.name))){
          const path=block.name==='NotebookEdit'?block.input.notebook_path:block.input.file_path;
          if(typeof path==='string' && path.length<=4096){this.editTools.set(String(block.id),{path,op:'update',requestId:messageId});if(this.editTools.size>256)this.editTools.delete(this.editTools.keys().next().value!);}
        }
        events.push({ kind: "tool.started", data: { toolUseId: str(block.id), name: typeof block.name === "string" ? redactText(block.name, 500) : undefined, input, status: "running" } });
      } else {
        events.push(this.unmapped(`assistant/${str(block.type) ?? "unknown"}`, block));
      }
    }
    // Synthetic API failures carry zero-filled assistant envelopes, not a new
    // API usage reading. Keep their visible text and structured failure handling
    // above; preserve the last valid observation. Genuine zero usage is valid.
    const usageError = m.is_api_error_message === true || message.model === '<synthetic>'
      || typeof m.error === 'string' || classifyClaudeFailure(m) !== undefined;
    if(this.sessionId!==undefined && m.parent_tool_use_id==null && m.session_id===this.sessionId){
      this.policyInput=this.observePolicyRequest(messageId)&&!usageError&&!this.contextCompacted?claudeRequestInput(message.usage,this.sessionId,this.contextTurnId,messageId,message.model):undefined;
      if(usageError||this.contextCompacted)events.push({kind:'diagnostic',data:{code:'request.input-invalidated',reason:'usage-unreliable'}});
    }
    if (!usageError && !this.contextCompacted && m.parent_tool_use_id == null && m.session_id === this.sessionId) {
      // Coverage is independent of usable usage and of latest-request policy proof.
      // A delayed snapshot can reconcile an earlier request without making it current.
      if(this.sessionId!==undefined)events.push({kind:'diagnostic',data:{code:'request.observed',nativeRequestId:messageId??null,nativeThreadId:this.sessionId,nativeTurnId:this.contextTurnId}});
      const observedInput=claudeRequestInput(message.usage,this.sessionId,this.contextTurnId,messageId,message.model);
      const usage = isObj(message.usage) ? message.usage : {};
      const context = sanitizeContextObservation({ basis: 'claude-last-request-input',
        tokens: contextTokenSum(usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens),
        capacity: null, nativeThreadId: this.sessionId, nativeTurnId: this.contextTurnId, modelId: message.model });
      // Replace, never accumulate across assistant calls or models.
      this.contextObservation = context;
      if (context) events.push({ kind: 'usage', data: { context, requestInput:this.policyInput??null, ...(observedInput?{requestUsage:{requestId:messageId,inputTokens:observedInput.tokens,cachedReadTokens:observedInput.cachedReadTokens,cacheWriteTokens:observedInput.cacheWriteTokens,outputTokens:null,reasoningTokens:null,basis:'claude-message-snapshot'}}:{}) } });
    }
    // keep the whole message once, on its first event, so detail the mapping drops stays inspectable
    if (events.length > 0 && events[0]!.raw === undefined) events[0] = { ...events[0]!, raw: m };
    return { events };
  }

  private user(m: Record<string, unknown>): MapOutput {
    const message = isObj(m.message) ? m.message : {};
    const events: DriverEvent[] = [];
    if (!Array.isArray(message.content)) return { events };
    for (const block of message.content) {
      if (!isObj(block)) continue;
      if (block.type === "tool_result") {
        const edit=this.sessionId!==undefined && m.parent_tool_use_id==null && m.session_id===this.sessionId?this.editTools.get(String(block.tool_use_id)):undefined;
        this.editTools.delete(String(block.tool_use_id));
        if(this.sessionId!==undefined && m.parent_tool_use_id==null && m.session_id===this.sessionId){this.policyInput=undefined;events.push({kind:'diagnostic',data:{code:'request.input-invalidated',reason:'later-request-may-follow-tool'}});}
        events.push({ kind: "tool.completed", data: { ...(edit && block.is_error!==true?{edits:[{path:edit.path,op:edit.op}],requestId:edit.requestId}:{}), toolUseId: str(block.tool_use_id), isError: block.is_error === true, status: block.is_error === true ? "failed" : "completed", output: redactText(toolText(block.content), TOOL_OUTPUT_LIMIT) } });
      } else if (block.type !== "text") {
        events.push(this.unmapped(`user/${str(block.type) ?? "unknown"}`, block));
      }
    }
    return { events };
  }

  private rateLimit(m: Record<string, unknown>): MapOutput {
    const info = isObj(m.rate_limit_info) ? m.rate_limit_info : {};
    return {
      events: [{
        kind: "rate-limit",
        data: { status: str(info.status), rateLimitType: str(info.rateLimitType), utilization: num(info.utilization), resetsAt: num(info.resetsAt) },
        raw: m,
      }],
    };
  }

  private result(m: Record<string, unknown>): MapOutput {
    const correlated = m.parent_tool_use_id == null && (this.sessionId === undefined || m.session_id === this.sessionId);
    const reported = correlated ? classifyClaudeFailure(m) : undefined;
    const previous = correlated && m.terminal_reason === "api_error" ? this.apiFailure : undefined;
    this.apiFailure = undefined;
    // A result wins; a matching assistant may contribute only its structured reset time.
    const failure = reported ? { ...reported, ...(!reported.resetAt && previous?.resetAt && previous.category === reported.category
      && previous.origin === reported.origin && previous.code === reported.code ? { resetAt: previous.resetAt } : {}) } : previous;
    const denials = (Array.isArray(m.permission_denials) ? m.permission_denials : []).filter(isObj)
      .map((d) => ({ tool: str(d.tool_name) ?? "unknown", ...(str(d.tool_use_id) ? { toolUseId: str(d.tool_use_id) } : {}) }));
    const result: ClaudeResult = {
      subtype: str(m.subtype) ?? "unknown",
      isError: m.is_error === true,
      ...((m.is_error === true || m.subtype !== "success") && failure ? { failure } : {}),
      ...(typeof m.result === "string" ? { text: m.result } : {}),
      ...(str(m.session_id) ? { sessionId: str(m.session_id) } : {}),
      permissionDenials: denials,
      ...(str(m.terminal_reason) ? { terminalReason: str(m.terminal_reason) } : {}),
      errors: (Array.isArray(m.errors) ? m.errors : []).filter((e): e is string => typeof e === "string").map((e) => redactText(e, 500)),
    };
    const events: DriverEvent[] = [];
    if (isObj(m.usage)) {
      // Capacity may arrive at result time. Join only the exact native model
      // of the latest main assistant response, even in multi-model accounting.
      const latest = this.contextObservation;
      const modelUsage = latest?.modelId && isObj(m.modelUsage) && Object.hasOwn(m.modelUsage, latest.modelId) ? m.modelUsage[latest.modelId] : undefined;
      const context = !this.contextCompacted && correlated && m.session_id === this.sessionId && latest
        ? sanitizeContextObservation({ ...latest, capacity: isObj(modelUsage) ? modelUsage.contextWindow : null }) : undefined;
      events.push({
        kind: "usage",
        data: {
          inputTokens: num(m.usage.input_tokens), outputTokens: num(m.usage.output_tokens),
          cacheReadTokens: num(m.usage.cache_read_input_tokens), cacheCreationTokens: num(m.usage.cache_creation_input_tokens),
          costUsd: num(m.total_cost_usd), durationMs: num(m.duration_ms), numTurns: num(m.num_turns),
          ...(context ? { context } : {}),
        },
        raw: m,
      });
    }
    if(correlated && m.session_id===this.sessionId){
      if(!result.isError && result.subtype==='success' && this.policyInput && !this.contextCompacted)events.push({kind:'diagnostic',data:{code:'request.input-finalized',nativeThreadId:this.policyInput.nativeThreadId,nativeTurnId:this.policyInput.nativeTurnId,nativeRequestId:this.policyInput.nativeRequestId}});
      else events.push({kind:'diagnostic',data:{code:'request.input-invalidated',reason:'final-request-unproven'}});
    }
    if (denials.length > 0) events.push({ kind: "diagnostic", data: { code: "claude-permission-denied", tools: denials.map((d) => d.tool) } });
    return { events, result };
  }
}
