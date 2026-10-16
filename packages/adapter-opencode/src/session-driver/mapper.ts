import type { DriverEvent } from "@deck/core/session/driver";
import { boundRaw } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
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
  constructor(private readonly maxBytes = 1024 * 1024) {}
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const events: unknown[] = [];
    let at: number;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).replace(/\r$/, ""); this.buffer = this.buffer.slice(at + 1);
      this.size += Buffer.byteLength(line);
      if (this.size > this.maxBytes) throw new Error("OpenCode SSE frame too large");
      if (line === "") {
        if (this.data.length) { try { events.push(JSON.parse(this.data.join("\n"))); } catch { events.push({ type: "invalid-sse-json", data: this.data.join("\n") }); } }
        this.data = []; this.size = 0;
      } else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
    }
    if (this.size + Buffer.byteLength(this.buffer) > this.maxBytes) throw new Error("OpenCode SSE frame too large");
    return events;
  }
}

export function mapOpenCodeEvent(raw: unknown, partTypes = new Map<string, string>()): DriverEvent[] {
  if (!record(raw)) return [{ kind: "runner.unmapped", data: { type: "unknown" }, raw }];
  if (typeof raw.type === "string" && (raw.type === "question.asked" || raw.type === "question.replied" || raw.type === "question.rejected" || raw.type.startsWith("question.v2."))) return [];
  const p = record(raw.properties) ? raw.properties : {};
  const part = record(p.part) ? p.part : {};
  if (raw.type === "message.part.delta" && p.field === "text" && typeof p.delta === "string") {
    const key = partKey(p.messageID, p.partID);
    const type = key ? partTypes.get(key) : undefined;
    if (type === "text" || type === "reasoning") return [{ kind: type === "reasoning" ? "reasoning.delta" : "message.delta", data: { text: redactText(p.delta, 8192), messageId: p.messageID, partId: p.partID, ...(type === "reasoning" ? { reasoningKind: "text", format: "delta" } : {}) }, raw }];
  }
  if (raw.type === "message.part.updated") {
    const key = partKey(part.messageID, part.id);
    if (key && typeof part.type === "string") {
      partTypes.set(key, part.type);
      if (partTypes.size > 1024) partTypes.delete(partTypes.keys().next().value!);
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
