import { admitPublicMemoryCapture } from "@deck/core/memory/capture-eligibility";
import { createHash } from "node:crypto";

/** Host limit for captured content (`apps/cli` loopback bridge): strictly below 64 KiB. */
export const MAX_CAPTURE_BYTES = 60 * 1024;
const TRUNCATION_MARKER = "\n[truncated by Deck memory]";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Truncates to the capture limit on a UTF-8 boundary and marks the cut. */
export function truncateForCapture(content: string, maxBytes = MAX_CAPTURE_BYTES): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  const budget = maxBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const sliced = Buffer.from(content, "utf8").subarray(0, budget).toString("utf8").replace(/�+$/u, "");
  return `${sliced}${TRUNCATION_MARKER}`;
}

/** Lossless UTF-8 transport pieces; the host retains its existing per-message guard. */
export function captureSegments(content: string): string[] {
  const parts: string[] = [];
  let part = "", bytes = 0;
  for (const char of content) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > MAX_CAPTURE_BYTES) { parts.push(part); part = ""; bytes = 0; }
    part += char; bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

export async function sendPublicCapture(client: LoopbackClient, event: Record<string, unknown>, content: string): Promise<LoopbackResponse> {
  // Inspect before splitting so credentials cannot straddle transport boundaries.
  const admission = admitPublicMemoryCapture({ source: String(event.source ?? "explicit-remember"), content });
  if (!admission.eligible) return { ok: false, diagnostics: admission.diagnostics.slice() };
  const parts = captureSegments(content);
  for (let index = 0; index < parts.length; index++) {
    const result = await client.send({ ...event, eventId: `${event.eventId}:part${index}`, content: parts[index], part: index, parts: parts.length });
    if (!result.ok) return { ...result, diagnostics: [...result.diagnostics, `Capture part ${index + 1}/${parts.length} was not confirmed; ${parts.slice(index + 1).reduce((bytes, part) => bytes + Buffer.byteLength(part, "utf8"), 0)} trailing bytes were not sent. Recover the original text from native history/output before deciding whether to retry. No automatic replay.`] };
  }
  return { ok: true, diagnostics: [] };
}

/** Loopback endpoints only: the host listens on 127.0.0.1 and nothing else may receive the bearer token. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export type LoopbackResponse = { ok: boolean; advisoryText?: string; resultCount?: number; diagnostics: string[] };

export type LoopbackClient = {
  /** Never throws. Transport failures and `ok: false` are reported through the result. */
  send(event: Record<string, unknown>, options?: { retries?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<LoopbackResponse>;
};

export function createLoopbackClient(input: {
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  now?: () => number;
}): LoopbackClient {
  const doFetch = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const attempt = async (body: string, timeoutMs: number, signal?: AbortSignal): Promise<{ response?: LoopbackResponse; transient: boolean; error?: string }> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (signal?.aborted) return { transient: false, response: { ok: false, diagnostics: ["cancelled"] } };
      // Race the entire response (including JSON), even when a transport ignores AbortSignal.
      const parsed = await Promise.race([
        (async () => {
          const response = await doFetch(input.endpoint, { method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" }, body, signal: controller.signal });
          if (response.status >= 500) throw new Error(`host-error-${response.status}`);
          return await response.json() as { ok?: unknown; advisoryText?: unknown; resultCount?: unknown; diagnostics?: unknown };
        })(),
        new Promise<never>((_resolve, reject) => { onAbort = () => { controller.abort(); reject(new Error("cancelled")); }; signal?.addEventListener("abort", onAbort, { once: true }); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs); }),
      ]);
      return {
        transient: false,
        response: {
          ok: parsed.ok === true,
          ...(typeof parsed.advisoryText === "string" && parsed.advisoryText.length > 0 ? { advisoryText: parsed.advisoryText } : {}),
          ...(typeof parsed.resultCount === "number" ? { resultCount: parsed.resultCount } : {}),
          diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics.filter((entry): entry is string => typeof entry === "string") : [],
        },
      };
    } catch (error) {
      if (signal?.aborted) return { transient: false, response: { ok: false, diagnostics: ["cancelled"] } };
      return { transient: true, error: controller.signal.aborted ? "timeout" : (error instanceof Error ? error.message : String(error)) };
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    async send(event, options = {}) {
      const body = JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "pi", timestamp: now(), ...event });
      const timeoutMs = options.timeoutMs ?? input.timeoutMs;
      let last: { response?: LoopbackResponse; transient: boolean; error?: string } = { transient: true, error: "not-attempted" };
      const retries = ["capture", "save", "explicit_remember"].includes(String(event.event)) ? 0 : options.retries ?? 0;
      for (let tries = 0; tries <= retries; tries++) {
        last = await attempt(body, timeoutMs, options.signal);
        if (!last.transient) break;
      }
      return last.response ?? { ok: false, diagnostics: [last.error ?? "unavailable"] };
    },
  };
}
