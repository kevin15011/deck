import type { DriverEvent } from "@deck/core/session/driver";
import { boundRaw, sanitizeContextObservation, contextTokenSum, contextTokens } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import { OPENCODE_MAX_FRAME_BYTES, OpenCodeTransportError } from './transport';
export const OPENCODE_PROTOCOL = "opencode-serve-sse";
export const record = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const bounded = (value: unknown): unknown => value === undefined ? undefined : boundRaw({ runnerId: "opencode", protocol: OPENCODE_PROTOCOL, payload: value }, 8192).payload;
const partKey = (messageId: unknown, partId: unknown): string | undefined => typeof messageId === "string" && typeof partId === "string" ? JSON.stringify([messageId, partId]) : undefined;

/** Part deltas omit their type; classification belongs to one native session, never a global map. */
export class OpenCodeEventMapper {
  private readonly partTypes = new Map<string, string>();
  map(raw: unknown): DriverEvent[] { return mapOpenCodeEvent(raw, this.partTypes); }
}

/** SSE framing is independent of transport chunk boundaries and native JSON shapes. */
export class OpenCodeSseParser {
  private buffer = "";
  private data: string[] = [];
  private size = 0;
  private highSurrogate = false;
  private failed = false;
  constructor(private readonly maxBytes = OPENCODE_MAX_FRAME_BYTES) {}
  /** Production consumers dispatch immediately so a rejected successor cannot erase earlier frames. */
  push(chunk: string, dispatch?: (event: unknown) => void): unknown[] {
    if (this.failed) return [];
    const events: unknown[] = [];
    let start = 0;
    try { while (start < chunk.length) {
      const at = chunk.indexOf('\n', start);
      const fragment = chunk.slice(start, at < 0 ? undefined : at);
      const paired = this.highSurrogate && /^[\uDC00-\uDFFF]/.test(fragment);
      const terminal = at >= 0 && this.buffer.length + fragment.length <= 1 && /^\r?$/.test(this.buffer + fragment);
      // Include wire field names, comments, CRLF and the terminating separator.
      this.size += Buffer.byteLength(fragment, 'utf8') - (paired ? 2 : 0) + (at < 0 ? 0 : 1);
      if (this.size > this.maxBytes) throw new OpenCodeTransportError('opencode-sse-frame-too-large', { frameBytes: this.size, frameBytesKind: terminal ? 'exact' : 'lower-bound', maxFrameBytes: this.maxBytes });
      this.buffer += fragment;
      if (fragment.length) this.highSurrogate = /[\uD800-\uDBFF]$/.test(fragment);
      if (at < 0) break;
      const line = this.buffer.replace(/\r$/, ''); this.buffer = ''; this.highSurrogate = false;
      if (line === "") {
        if (this.data.length) {
          let event: unknown;
          try { event = JSON.parse(this.data.join("\n")); } catch { throw new OpenCodeTransportError('opencode-sse-invalid-frame'); }
          if (dispatch) dispatch(event); else events.push(event);
        }
        this.data = []; this.size = 0;
      } else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
      start = at + 1;
    } } catch (error) { this.failed = true; this.buffer = ''; this.data = []; this.size = 0; this.highSurrogate = false; throw error; }
    return events;
  }
}

export function mapOpenCodeEvent(raw: unknown, partTypes = new Map<string, string>()): DriverEvent[] {
  if (!record(raw)) return [{ kind: "runner.unmapped", data: { type: "unknown" }, raw }];
  if (typeof raw.type === "string" && (raw.type === "question.asked" || raw.type === "question.replied" || raw.type === "question.rejected" || raw.type.startsWith("question.v2."))) return [];
  const p = record(raw.properties) ? raw.properties : {};
  const part = record(p.part) ? p.part : {};
  if (raw.type === 'message.updated' && record(p.info) && p.info.role === 'assistant') {
    const info = p.info;
    const tokens = record(info.tokens) ? info.tokens : {};
    const context = sanitizeContextObservation({ basis: 'opencode-assistant-context', tokens: contextTokenSum(tokens.input, tokens.output, tokens.reasoning, record(tokens.cache) ? tokens.cache.read : undefined, record(tokens.cache) ? tokens.cache.write : undefined), capacity: null, nativeThreadId: info.sessionID, nativeTurnId: info.parentID, modelId: typeof info.providerID === 'string' && typeof info.modelID === 'string' ? `${info.providerID}/${info.modelID}` : undefined });
    // Native v1.19.1 sidebar selects the last positive-output assistant and
    // sums these five components. Capacity comes from its exact server catalog.
    return [{ kind: 'usage', data: { ...tokens, ...(context && info.summary !== true && (contextTokens(tokens.output) ?? 0) > 0 ? { context } : {}) }, raw }];
  }
  if (raw.type === "message.part.delta") {
    const key = partKey(p.messageID, p.partID);
    if (!key || !partTypes.has(key) || partTypes.get(key) === "question" || partTypes.get(key) === "tool") return [{ kind: "runner.unmapped", data: { type: raw.type } }];
  }
  if (raw.type === "message.part.delta" && p.field === "text" && typeof p.delta === "string") {
    const key = partKey(p.messageID, p.partID);
    const type = key ? partTypes.get(key) : undefined;
    if (type === "text" || type === "reasoning") return [{ kind: type === "reasoning" ? "reasoning.delta" : "message.delta", data: { text: redactText(p.delta, 8192), messageId: p.messageID, partId: p.partID, ...(type === "reasoning" ? { reasoningKind: "text", format: "delta" } : {}) }, raw }];
  }
  if (raw.type === "message.part.updated") {
    const key = partKey(part.messageID, part.id);
    const previous = key ? partTypes.get(key) : undefined;
    const toolName = typeof part.tool === "string" && part.tool.length > 0 ? part.tool : undefined;
    // Both tool decisions survive unnamed partial updates. Evicted/unknown parts
    // fail closed until a non-question tool name or non-tool type is supplied.
    const isQuestion = previous === "question" || toolName === "question";
    const classification = isQuestion ? "question"
      : part.type === "tool" ? (toolName ? `tool:${toolName}` : previous?.startsWith("tool:") ? previous : "tool")
      : typeof part.type === "string" ? part.type : previous;
    if (key && classification) {
      partTypes.set(key, classification);
      if (partTypes.size > 1024) partTypes.delete(partTypes.keys().next().value!);
    }
    // Answers can occur anywhere in state; retain only lifecycle identity/status
    // for question tools and parts whose tool name/classification is unknown.
    if (isQuestion || classification === "tool" || !classification) {
      const status = record(part.state) ? part.state.status : undefined;
      const identity = { toolUseId: typeof part.callID === "string" ? part.callID : undefined, name: isQuestion ? "question" : undefined };
      if (status === "running") return [{ kind: "tool.started", data: { ...identity, status: "running" } }];
      if (status === "completed" || status === "error") return [{ kind: "tool.completed", data: { ...identity, isError: status === "error", status: status === "error" ? "failed" : "completed" } }];
      return [{ kind: "runner.unmapped", data: { type: raw.type } }];
    }
    if (part.type === "text" && typeof part.text === "string") return [{ kind: "message.completed", data: { text: part.text, messageId: part.messageID }, raw }];
    if (part.type === "reasoning" && typeof part.text === "string") return [{ kind: "reasoning.delta", data: { text: redactText(part.text, 8192), messageId: part.messageID, partId: part.id, reasoningKind: "text", format: "snapshot" }, raw }];
    if (part.type === "tool" && record(part.state)) {
      const state = part.state;
      const name = typeof part.tool === "string" ? redactText(part.tool, 500) : undefined;
      if (state.status === "running") return [{ kind: "tool.started", data: { toolUseId: part.callID, name, input: bounded(state.input), status: "running" }, raw }];
      if (state.status === "completed" || state.status === "error") return [{ kind: "tool.completed", data: { toolUseId: part.callID, name, input: bounded(state.input), output: bounded(state.output ?? state.error ?? ""), isError: state.status === "error", status: state.status === "error" ? "failed" : "completed" }, raw }];
    }
  }
  return [{ kind: "runner.unmapped", data: { type: typeof raw.type === "string" ? raw.type : "unknown" }, raw }];
}

/** HTTP prompt response is fenced by the driver request. Never use an unfenced SSE patch for membership. */
export function correlatedOpenCodeEdits(result:unknown,nativeSessionId:string):DriverEvent[] {
 if(!record(result)||!record(result.info)||result.info.role!=='assistant'||result.info.sessionID!==nativeSessionId||typeof result.info.id!=='string'||!Array.isArray(result.parts))return [];
 const events:DriverEvent[]=[];
 for(const part of result.parts.slice(0,256)){
  if(!record(part)||part.type!=='tool'||part.sessionID!==nativeSessionId||part.messageID!==result.info.id||typeof part.callID!=='string'||!record(part.state)||part.state.status!=='completed'||!['edit','write'].includes(String(part.tool))||!record(part.state.input)||typeof part.state.input.filePath!=='string')continue;
  events.push({kind:'tool.completed',data:{toolUseId:part.callID,name:part.tool,status:'completed',isError:false,edits:[{path:part.state.input.filePath,op:'update'}],nativeThreadId:nativeSessionId,nativeRequestId:result.info.id}});
 }
 return events;
}
