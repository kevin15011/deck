/**
 * Claude Code stream-json mapper (XR-1.4, XR-4.5): one stdout JSON message in, normalized
 * driver events out. Tracks the current streamed message id and one-shot diagnostics; unknown shapes
 * become `runner.unmapped` with raw, never an exception.
 *
 * Shapes verified against 2.1.296 recordings in `__fixtures__/2.1.296` (tool_use/tool_result
 * and permission_denials per the documented format; see the fixture README).
 */
import { boundRaw } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import type { DriverEvent } from "@deck/core/session/driver";

export const CLAUDE_PROTOCOL = "claude-stream-json";
const TOOL_INPUT_LIMIT = 8192;
const TOOL_OUTPUT_LIMIT = 8192;
const DIAGNOSTIC_TEXT_LIMIT = 500;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

export type ClaudeInit = {
  sessionId: string; model?: string; version?: string;
  mcpServers: Array<{ name: string; status?: string }>; tools: string[];
};
export type ClaudeResult = {
  subtype: string; isError: boolean; text?: string; sessionId?: string;
  permissionDenials: Array<{ tool: string; toolUseId?: string }>; terminalReason?: string; errors: string[];
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

/** Reassembles stdout chunks into lines; a runaway line is dropped (flagged) instead of exhausting memory. */
export class ClaudeLineSplitter {
  private buffer = "";
  private discarding = false;
  overflowed = false;
  constructor(private readonly maxBytes = MAX_LINE_BYTES) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let at: number;
    while ((at = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (this.discarding) { this.discarding = false; continue; }
      if (line.length > this.maxBytes) { this.overflowed = true; continue; }
      if (line.trim().length > 0) lines.push(line);
    }
    if (this.buffer.length > this.maxBytes) { this.overflowed = true; this.discarding = true; this.buffer = ""; }
    return lines;
  }

  flush(): string[] {
    const rest = this.discarding ? "" : this.buffer;
    this.buffer = "";
    this.discarding = false;
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
  private hookReported = false;
  private streamingMessageId?: string;

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
    if (subtype === "init") return this.init(m);
    if (HOOK_SYSTEM.has(subtype)) {
      const events: DriverEvent[] = [];
      if (!this.hookReported) {
        this.hookReported = true;
        events.push({ kind: "diagnostic", data: { code: "claude-hook-executed", hookEvent: str(m.hook_event), hookName: str(m.hook_name) } });
      }
      return { events, hookSeen: true };
    }
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
    const message = isObj(m.message) ? m.message : {};
    const messageId = str(message.id);
    const events: DriverEvent[] = [];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!isObj(block)) continue;
      if (block.type === "text") {
        if (typeof block.text === "string" && block.text.length > 0) events.push({ kind: "message.completed", data: { ...(messageId ? { messageId } : {}), text: block.text } });
      } else if (block.type === "thinking") {
        if (typeof block.thinking === "string" && block.thinking.length > 0) events.push({ kind: "reasoning.delta", data: { text: block.thinking } });
      } else if (block.type === "tool_use") {
        const input = boundRaw({ runnerId: "claude", protocol: CLAUDE_PROTOCOL, payload: block.input ?? {} }, TOOL_INPUT_LIMIT).payload;
        events.push({ kind: "tool.started", data: { toolUseId: str(block.id), name: str(block.name), input } });
      } else {
        events.push(this.unmapped(`assistant/${str(block.type) ?? "unknown"}`, block));
      }
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
        events.push({ kind: "tool.completed", data: { toolUseId: str(block.tool_use_id), isError: block.is_error === true, output: redactText(toolText(block.content), TOOL_OUTPUT_LIMIT) } });
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
    const denials = (Array.isArray(m.permission_denials) ? m.permission_denials : []).filter(isObj)
      .map((d) => ({ tool: str(d.tool_name) ?? "unknown", ...(str(d.tool_use_id) ? { toolUseId: str(d.tool_use_id) } : {}) }));
    const result: ClaudeResult = {
      subtype: str(m.subtype) ?? "unknown",
      isError: m.is_error === true,
      ...(typeof m.result === "string" ? { text: m.result } : {}),
      ...(str(m.session_id) ? { sessionId: str(m.session_id) } : {}),
      permissionDenials: denials,
      ...(str(m.terminal_reason) ? { terminalReason: str(m.terminal_reason) } : {}),
      errors: (Array.isArray(m.errors) ? m.errors : []).filter((e): e is string => typeof e === "string").map((e) => redactText(e, 500)),
    };
    const events: DriverEvent[] = [];
    if (isObj(m.usage)) {
      events.push({
        kind: "usage",
        data: {
          inputTokens: num(m.usage.input_tokens), outputTokens: num(m.usage.output_tokens),
          cacheReadTokens: num(m.usage.cache_read_input_tokens), cacheCreationTokens: num(m.usage.cache_creation_input_tokens),
          costUsd: num(m.total_cost_usd), durationMs: num(m.duration_ms), numTurns: num(m.num_turns),
        },
        raw: m,
      });
    }
    if (denials.length > 0) events.push({ kind: "diagnostic", data: { code: "claude-permission-denied", tools: denials.map((d) => d.tool) } });
    return { events, result };
  }
}
