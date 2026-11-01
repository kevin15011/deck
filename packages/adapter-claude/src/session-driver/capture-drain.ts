import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { NativeCaptureOutcome } from '@deck/core/session/driver';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readMarker(home: string, path: string): Record<string, unknown> | undefined {
  let fd: number | undefined;
  try {
    for (let directory = dirname(path); ; directory = dirname(directory)) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || (stat.mode & 0o022) || stat.uid !== process.getuid?.()) return;
      if (directory === resolve(home)) break;
      if (dirname(directory) === directory) return;
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) return;
    const buffer = Buffer.alloc(4097);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > 4096) return;
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } catch { return; }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function claudeCaptureUuid(home: string | undefined, sessionId: string): string | undefined {
  if (!home || !isAbsolute(home) || !UUID.test(sessionId)) return;
  const value = readMarker(home, join(home, '.supermemory-claude', 'trackers', `${sessionId}.json`));
  return typeof value?.lastUuid === 'string' && UUID.test(value.lastUuid) ? value.lastUuid : undefined;
}

/** The pinned plugin writes its tracker after addMemory, then its saved status.
 * This is exact-message progress, not proof that the hook process exited or that
 * the remote service accepted/processed anything. Never replay the hook.
 */
export async function drainClaudeCapture(home: string | undefined, sessionId: string, assistantUuid: string | undefined, previousUuid: string | undefined, signal: AbortSignal, timeoutMs = 30_000): Promise<NativeCaptureOutcome> {
  const outcome = (lifecycle: NativeCaptureOutcome['lifecycle'], reason: string): NativeCaptureOutcome => ({ lifecycle, acceptance: 'unknown', reason });
  if (!home || !isAbsolute(home) || !UUID.test(sessionId) || !assistantUuid || !UUID.test(assistantUuid) || assistantUuid === previousUuid) return outcome('unknown', 'capture-message-unconfirmed');
  const path = join(home, '.supermemory-claude', 'statusline', 'statusline-state', createHash('sha256').update(sessionId).digest('hex'), 'capture.json');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (signal.aborted) return outcome('unknown', 'capture-interrupted');
    // Read tracker first: an old saved status cannot precede a new tracker read.
    if (claudeCaptureUuid(home, sessionId) === assistantUuid) {
      const state = readMarker(home, path);
      if (state?.version === 1 && state.event === 'capture' && state.status === 'saved') return outcome('unknown', 'official-capture-marker-observed');
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return outcome('pending', 'capture-drain-timeout');
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.min(25, remaining));
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
}
