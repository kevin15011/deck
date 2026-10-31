import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeStreamMapper } from './session-driver/mapper';

/** No Deck session, project instructions, user customizations, tools or persistent transcript. */
export function claudeQuotaArgs(): string[] {
  return ['-p', 'Reply OK.', '--model', 'haiku', '--output-format', 'stream-json', '--verbose',
    '--safe-mode', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false,"enabledPlugins":{}}',
    '--no-session-persistence', '--disable-slash-commands', '--no-chrome', '--max-turns', '1',
    '--max-budget-usd', '0.03', '--system-prompt', 'Reply OK.', '--prompt-suggestions', 'false'];
}
export async function refreshClaudeQuota(signal: AbortSignal, options: { executable?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<unknown> {
  const cwd = await mkdtemp(join(tmpdir(), 'deck-quota-'));
  const env = { ...(options.env ?? process.env) };
  for (const key of Object.keys(env)) if (/^(DECK_|MCP_|SUPERMEMORY_|CLAUDE_)/.test(key) && key !== 'CLAUDE_CODE_OAUTH_TOKEN') delete env[key];
  delete env.CLAUDECODE; delete env.NODE_OPTIONS; delete env.BUN_OPTIONS;
  try {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = spawn(options.executable ?? 'claude', claudeQuotaArgs(), { cwd, env, stdio: ['ignore', 'pipe', 'ignore'] });
      const mapper = new ClaudeStreamMapper();
      let buffer = '', bytes = 0, snapshot: unknown, failed = false;
      const stop = () => { failed = true; child.kill('SIGKILL'); };
      const timer = setTimeout(stop, options.timeoutMs ?? 45_000);
      signal.addEventListener('abort', stop, { once: true });
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
      child.on('error', () => { finish(); reject(Error('quota-runner-unavailable')); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > 1024 * 1024) { stop(); return; }
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const value = JSON.parse(line);
            if (value.type === 'rate_limit_event') snapshot = mapper.map(value).events.find(e => e.kind === 'rate-limit')?.data;
          } catch { /* Version drift must not expose subprocess output. */ }
        }
      });
      child.on('close', code => { finish(); if (failed || code !== 0 && snapshot === undefined) reject(Error('quota-refresh-failed')); else resolve(snapshot); });
      if (signal.aborted) stop();
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
