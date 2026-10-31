import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRpc, object } from './session-driver/rpc';

/** A short-lived app-server account query; never creates a thread or starts a turn. */
export async function refreshCodexQuota(signal: AbortSignal, options: { executable?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<unknown> {
  const cwd = await mkdtemp(join(tmpdir(), 'deck-quota-'));
  try {
    signal.throwIfAborted();
    const env = { ...(options.env ?? process.env) }; delete env.NODE_OPTIONS; delete env.BUN_OPTIONS;
    const child = spawn(options.executable ?? 'codex', ['app-server', '--stdio'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const rpc = new CodexRpc(text => child.stdin.write(text), () => {}, { timeoutMs: options.timeoutMs ?? 20_000, maxFrameBytes: 1024 * 1024 });
    const closed = new Promise<void>(resolve => child.on('close', () => { rpc.close(); resolve(); }));
    child.on('error', () => rpc.close(Error('quota-runner-unavailable')));
    child.stdin.on('error', () => rpc.close(Error('quota-runner-unavailable')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { try { rpc.push(chunk); } catch { child.kill('SIGKILL'); } });
    const stop = () => { rpc.close(Error('quota-refresh-aborted')); child.kill('SIGKILL'); };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      await rpc.call('initialize', { clientInfo: { name: 'deck-quota', version: '1.0.0' }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized');
      const result = object(await rpc.call('account/rateLimits/read', {}));
      return result.rateLimits ?? undefined;
    } finally { signal.removeEventListener('abort', stop); rpc.close(); child.kill('SIGKILL'); await closed; }
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
