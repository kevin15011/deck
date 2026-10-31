// Finite serialized capacity for native aggregate output, JSON escaping and
// session responses. This is not a heap bound; parsing/mapping allocates copies.
// SSE and HTTP are bounded independently. Optional catalog metadata keeps its
// existing smaller bound. Never truncate control/terminal fields or replay calls.
import { runnerTransportFailure } from '@deck/core/session/failure';
export const OPENCODE_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const OPENCODE_MAX_BODY_BYTES = 16 * 1024 * 1024;
type TransportCode = 'opencode-sse-frame-too-large' | 'opencode-sse-invalid-frame' | 'opencode-http-body-too-large' | 'opencode-http-invalid-body';
export class OpenCodeTransportError extends Error {
  readonly failure;
  constructor(readonly code: TransportCode, readonly size?: { frameBytes: number; frameBytesKind: 'exact' | 'lower-bound'; maxFrameBytes: number }) { super(code); this.failure = runnerTransportFailure(code); }
}

/** Count received bytes before retaining or decoding them. Abort also cancels
 * custom readers, rather than relying on fetch alone to interrupt body reads. */
export async function readOpenCodeBody(response: Response, signal: AbortSignal, maxBytes = OPENCODE_MAX_BODY_BYTES): Promise<string> {
  if (!response.body) { signal.throwIfAborted(); return ''; }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let bytes = 0, cancellation: Promise<void> | undefined;
  const cancel = () => cancellation ??= reader.cancel().catch(() => {});
  const onAbort = () => { void cancel(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new OpenCodeTransportError('opencode-http-body-too-large', { frameBytes: bytes, frameBytesKind: 'lower-bound', maxFrameBytes: maxBytes });
      // Coalesce into finite storage rather than retaining one object per
      // network chunk (millions of tiny chunks must not defeat the byte bound).
      if (bytes > buffer.length) {
        const next = new Uint8Array(Math.min(maxBytes, Math.max(bytes, buffer.length * 2, 64 * 1024)));
        next.set(buffer); buffer = next;
      }
      buffer.set(chunk.value, bytes - chunk.value.byteLength);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)); }
    catch { throw new OpenCodeTransportError('opencode-http-invalid-body'); }
  } catch (error) { await cancel(); throw error; }
  finally { signal.removeEventListener('abort', onAbort); await cancellation; reader.releaseLock(); }
}
