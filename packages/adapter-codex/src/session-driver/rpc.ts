/** Codex app-server uses newline-delimited JSON, without LSP Content-Length headers. */
export type RpcMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// 0.162.1 command completions contain aggregatedOutput; native notification opt-out
// suppresses the entire completion, not its output. Allow finite headroom for the
// observed >1 MiB output, JSON escaping and resume replies. This is a wire-byte
// capacity, not arbitrary-size support or a heap bound: JSON.parse and downstream
// redaction/serialization temporarily allocate additional copies. Output remains
// bounded by the mapper. Never skip a frame: it may carry a reply or permission.
export const CODEX_MAX_FRAME_BYTES = 16 * 1024 * 1024;
type FrameSize = { frameBytes: number; frameBytesKind: "exact" | "lower-bound"; maxFrameBytes: number; pendingCalls: number };

/** Only these internal framing codes may cross the driver diagnostic boundary. */
export class CodexRpcFrameError extends Error {
  constructor(readonly code: "codex-rpc-invalid-frame" | "codex-rpc-frame-too-large", readonly size?: FrameSize) { super(code); }
}

export class CodexRpcError extends Error {
  constructor(readonly code: number | undefined, readonly diagnostic: string | undefined) { super(`codex-rpc-error: ${code ?? "unknown"}`); }
}
export class CodexRpc {
  private buffer = "";
  private bufferBytes = 0;
  private bufferEndsHighSurrogate = false;
  private serial = 0;
  private closed?: Error;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; missingThreadMessages?: string[] }>();
  constructor(private readonly write: (text: string) => void, private readonly message: (message: RpcMessage) => void,
    private readonly options: { maxFrameBytes?: number; timeoutMs?: number } = {}) {}

  call(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`codex-rpc-timeout: ${method}`)); }, this.options.timeoutMs ?? 30_000);
      const threadId = method === "thread/resume" ? object(params).threadId : undefined;
      this.pending.set(id, { resolve, reject, timer, ...(typeof threadId === "string" ? { missingThreadMessages: [`thread not found: ${threadId}`, `no rollout found for thread id ${threadId}`, `no rollout found for thread id: ${threadId}`] } : {}) });
      try { this.write(`${JSON.stringify({ id, method, params })}\n`); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  notify(method: string, params?: unknown): void { this.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`); }
  reply(id: string | number, result: unknown): void { if (!this.closed) this.write(`${JSON.stringify({ id, result })}\n`); }
  reject(id: string | number, code: number, message: string): void { if (!this.closed) this.write(`${JSON.stringify({ id, error: { code, message } })}\n`); }
  push(chunk: string): void {
    if (this.closed) return;
    try {
      let start = 0;
      while (start < chunk.length) {
        if (this.closed) return;
        const end = chunk.indexOf("\n", start);
        const fragment = chunk.slice(start, end < 0 ? undefined : end);
        // Host IO supplies decoded strings. Count a surrogate pair split across
        // pushes as one UTF-8 code point, not two replacement characters.
        const paired = this.bufferEndsHighSurrogate && /^[\uDC00-\uDFFF]/.test(fragment);
        const bytes = this.bufferBytes + Buffer.byteLength(fragment, "utf8") - (paired ? 2 : 0);
        const maxFrameBytes = this.options.maxFrameBytes ?? CODEX_MAX_FRAME_BYTES;
        if (bytes > maxFrameBytes) throw new CodexRpcFrameError("codex-rpc-frame-too-large", {
          frameBytes: bytes, frameBytesKind: end < 0 ? "lower-bound" : "exact", maxFrameBytes, pendingCalls: this.pending.size,
        });
        this.buffer += fragment; this.bufferBytes = bytes;
        if (fragment.length) this.bufferEndsHighSurrogate = /[\uD800-\uDBFF]$/.test(fragment);
        if (end < 0) break;
        start = end + 1;
        const line = this.buffer; this.buffer = ""; this.bufferBytes = 0; this.bufferEndsHighSurrogate = false;
        if (!line.trim()) continue;
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CodexRpcFrameError("codex-rpc-invalid-frame");
        const m = parsed as RpcMessage;
        if (m.id !== undefined && !m.method) {
          const p = typeof m.id === "number" ? this.pending.get(m.id) : undefined;
          if (p) {
            this.pending.delete(m.id as number); clearTimeout(p.timer);
            if (m.error) p.reject(p.missingThreadMessages?.includes(m.error.message ?? "") ? new Error("codex-native-session-not-found") : new CodexRpcError(m.error.code, m.error.message)); else p.resolve(m.result);
          } else this.message(m);
        } else this.message(m);
      }
    } catch (error) { const e = error instanceof CodexRpcFrameError ? error : new CodexRpcFrameError("codex-rpc-invalid-frame"); this.close(e); throw e; }
  }
  close(error = new Error("codex-rpc-closed")): void {
    if (this.closed) return;
    this.closed = error; this.buffer = ""; this.bufferBytes = 0; this.bufferEndsHighSurrogate = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
}
