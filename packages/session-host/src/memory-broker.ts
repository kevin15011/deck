import { createHash } from "node:crypto";

/** Session-scoped application port. Provider credentials and runtimes stay in the CLI. */
export interface SessionMemoryPort {
  recall(query: string): Promise<{ ok: boolean; advisoryText?: string }>;
  propose(content: string): Promise<{ ok: boolean }>;
  close?(): Promise<void> | void;
}

/** One serialized writer per session; failed writes remain retryable. */
export class MemoryBroker {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly written: Set<string>;
  constructor(private readonly port: Promise<SessionMemoryPort | undefined>, written: Iterable<string> = []) { this.written = new Set(written); }
  static proposalId(content: string): string { return createHash("sha256").update(content.trim()).digest("hex"); }
  async recall(query: string): Promise<{ ok: boolean; advisoryText?: string }> { return (await this.port)?.recall(query) ?? { ok: false }; }
  propose(content: string): Promise<{ ok: boolean; duplicate?: boolean }> {
    const hash = MemoryBroker.proposalId(content);
    const result = this.tail.then(async () => {
      if (this.written.has(hash)) return { ok: true, duplicate: true };
      const outcome = await (await this.port)?.propose(content) ?? { ok: false };
      if (outcome.ok) this.written.add(hash);
      return outcome;
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async close() { await this.tail; await (await this.port)?.close?.(); }
}
