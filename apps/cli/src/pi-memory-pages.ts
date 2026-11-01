import { randomBytes } from "node:crypto";

/** Session-bound pages of an exact provider response, never a relevance/top-K filter. */
export function createPiMemoryPages(now = Date.now) {
  const records = new Map<string, { session: string; text: string; created: number }>();
  const prune = () => {
    for (const [key, value] of records) if (now() - value.created > 5 * 60_000) records.delete(key);
    while (records.size > 64) records.delete(records.keys().next().value!);
  };
  const page = (token: string, offset: number) => {
    const value = records.get(token)!;
    const render = (end: number) => JSON.stringify({ source: "Supermemory", trust: "untrusted-advisory", format: "provider-response-fragment", offset, totalCharacters: value.text.length, content: value.text.slice(offset, end), ...(end < value.text.length ? { continuation: `${token}:${end}`, instruction: "Use memory_read with continuation to read the remaining exact response. Search is provider-ranked, not exhaustive." } : {}) }).replace(/[<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    // Preserve the host's 6000-byte advisory guard, including JSON/continuation
    // overhead. UTF-16 offsets are explicit and never split surrogate pairs.
    let low = offset, high = Math.min(value.text.length, offset + 6000);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(render(mid), "utf8") <= 6000) low = mid;
      else high = mid - 1;
    }
    if (low < value.text.length && /[\uD800-\uDBFF]/.test(value.text[low - 1]!)) low--;
    return { ok: true, advisoryText: render(low), diagnostics: [] };
  };
  return {
    deliver(session: string, text: string) {
      prune();
      const token = randomBytes(16).toString("hex");
      records.set(token, { session, text, created: now() }); prune();
      return page(token, 0);
    },
    read(session: string, cursor: string): Record<string, unknown> {
      prune();
      const match = /^([a-f0-9]{32}):(\d+)$/.exec(cursor);
      const value = match ? records.get(match[1]!) : undefined;
      const offset = Number(match?.[2]);
      if (!value || value.session !== session || !Number.isSafeInteger(offset) || offset < 0 || offset >= value.text.length) return { ok: false, diagnostics: ["page-unavailable: repeat the source/profile/search request; no claim of complete delivery"] };
      return page(match![1]!, offset);
    },
    clear(session?: string) { for (const [key, value] of records) if (!session || value.session === session) records.delete(key); },
  };
}
