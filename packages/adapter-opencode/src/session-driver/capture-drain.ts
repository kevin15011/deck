import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DriverHostIo, NativeCaptureOutcome } from '@deck/core/session/driver';

export type CaptureTicket = { path: string; nonce: string; taskId: string };
export function createCaptureTicket(taskId: string, io: Pick<DriverHostIo, 'writePrivateFile'>): CaptureTicket {
  const nonce = randomUUID();
  const path = io.writePrivateFile(`native-capture-${nonce}.json`, JSON.stringify({ v: 1, nonce, taskId, lifecycle: 'pending' }));
  return { path, nonce, taskId };
}
function readReceipt(ticket: CaptureTicket, nativeSessionId: string): NativeCaptureOutcome | undefined {
  let fd: number | undefined;
  try {
    // Inspect special files without allowing a FIFO open to block close/cancellation.
    fd = openSync(ticket.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) || typeof process.getuid === 'function' && stat.uid !== process.getuid()) return;
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    if (value.v !== 1 || value.nonce !== ticket.nonce || value.taskId !== ticket.taskId || value.acceptance !== 'unknown'
      || !Array.isArray(value.nativeSessionIds) || value.nativeSessionIds.length !== 1 || value.nativeSessionIds[0] !== nativeSessionId
      || !['completed','error'].includes(value.lifecycle)) return;
    return { lifecycle: value.lifecycle, acceptance: 'unknown', reason: 'owned-plugin-disposal' };
  } catch { return; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Observe only the owned callback; it catches provider errors, so never infer acceptance. */
export async function drainNativeCapture(ticket: CaptureTicket, nativeSessionId: string, dispose: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, timeoutMs = 2000): Promise<NativeCaptureOutcome> {
  if (signal.aborted) return { lifecycle: 'unknown', acceptance: 'unknown', reason: 'close-interrupted' };
  const deadline = performance.now() + timeoutMs;
  const bound = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try { await dispose(bound); }
  catch { return { lifecycle: 'unknown', acceptance: 'unknown', reason: 'native-disposal-unconfirmed' }; }
  for (;;) {
    if (signal.aborted) return { lifecycle: 'unknown', acceptance: 'unknown', reason: 'close-interrupted' };
    const receipt = readReceipt(ticket, nativeSessionId); if (receipt) return receipt;
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { lifecycle: 'pending', acceptance: 'unknown', reason: 'capture-drain-timeout' };
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.min(25, remaining)); signal.addEventListener('abort', done, {once:true});
      if (signal.aborted) done();
    });
  }
}
