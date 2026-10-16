/** Codex app-server uses newline-delimited JSON, without LSP Content-Length headers. */
export type RpcMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only these internal framing codes may cross the driver diagnostic boundary. */
export class CodexRpcFrameError extends Error {
  constructor(readonly code: "codex-rpc-invalid-frame" | "codex-rpc-frame-too-large") { super(code); }
}

export class CodexRpc {
  private buffer = "";
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
    this.buffer += chunk;
    try {
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        this.bound(line);
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CodexRpcFrameError("codex-rpc-invalid-frame");
        const m = parsed as RpcMessage;
        if (m.id !== undefined && !m.method) {
          const p = typeof m.id === "number" ? this.pending.get(m.id) : undefined;
          if (p) {
            this.pending.delete(m.id as number); clearTimeout(p.timer);
            if (m.error) p.reject(new Error(p.missingThreadMessages?.includes(m.error.message ?? "") ? "codex-native-session-not-found" : `codex-rpc-error: ${m.error.code ?? "unknown"}`)); else p.resolve(m.result);
          } else this.message(m);
        } else this.message(m);
      }
      this.bound(this.buffer);
    } catch (error) { const e = error instanceof CodexRpcFrameError ? error : new CodexRpcFrameError("codex-rpc-invalid-frame"); this.close(e); throw e; }
  }
  private bound(text: string): void { if (Buffer.byteLength(text, "utf8") > (this.options.maxFrameBytes ?? 1024 * 1024)) throw new CodexRpcFrameError("codex-rpc-frame-too-large"); }
  close(error = new Error("codex-rpc-closed")): void {
    if (this.closed) return;
    this.closed = error; this.buffer = "";
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
}
