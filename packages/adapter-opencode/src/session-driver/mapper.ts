import type { DriverEvent } from "@deck/core/session/driver";
export const OPENCODE_PROTOCOL = "opencode-serve-sse";
export const record = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

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

export function mapOpenCodeEvent(raw: unknown): DriverEvent[] {
  if (!record(raw)) return [{ kind: "runner.unmapped", data: { type: "unknown" }, raw }];
  const p = record(raw.properties) ? raw.properties : {};
  const part = record(p.part) ? p.part : {};
  if (raw.type === "message.part.delta" && p.field === "text" && typeof p.delta === "string") return [{ kind: "message.delta", data: { text: p.delta, messageId: p.messageID }, raw }];
  if (raw.type === "message.part.updated") {
    if (part.type === "text" && typeof part.text === "string") return [{ kind: "message.completed", data: { text: part.text, messageId: part.messageID }, raw }];
    if (part.type === "reasoning" && typeof part.text === "string") return [{ kind: "reasoning.delta", data: { text: part.text }, raw }];
    if (part.type === "tool" && record(part.state)) {
      const state = part.state;
      if (state.status === "running") return [{ kind: "tool.started", data: { toolUseId: part.callID, name: part.tool, input: state.input }, raw }];
      if (state.status === "completed" || state.status === "error") return [{ kind: "tool.completed", data: { toolUseId: part.callID, name: part.tool, output: state.output ?? state.error ?? "", isError: state.status === "error" }, raw }];
    }
  }
  return [{ kind: "runner.unmapped", data: { type: typeof raw.type === "string" ? raw.type : "unknown" }, raw }];
}
