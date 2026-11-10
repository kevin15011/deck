// Opt-in, model-free native protocol experiment. No inherited runner credentials,
// config, daemon or socket. Output contains only version, durations and assertions.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { isDeepStrictEqual } from 'node:util';
import { CodexRpc, object } from '../packages/adapter-codex/src/session-driver/rpc';

if (process.argv.includes('--fixture-server')) {
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.id === undefined) continue;
      void (async () => {
        let result: unknown = {};
        if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } };
        else if (message.method === 'tools/list') result = { tools: ['query-docs', 'exec'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
        else if (message.method === 'resources/list' || message.method === 'resources/templates/list') {
          await Bun.sleep(350);
          result = message.method === 'resources/list' ? { resources: [{ uri: 'fixture://resource', name: 'resource' }] } : { resourceTemplates: [{ uriTemplate: 'fixture://{id}', name: 'template' }] };
        }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
      })();
    }
  });
}

export async function runCodexMcpDetailExperiment(executable: string, version: string, options: { spawnProcess?: typeof spawn; cleanupTimeoutMs?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deck-codex-detail-'));
  const samples: { scenario: string; detail: string; durationMs: number }[] = [];
  try {
    for (const scenario of ['personal-and-suppressed', 'readonly']) {
      let expected: unknown;
      for (const [index, detail] of ['full', 'toolsAndAuthOnly', 'full', 'toolsAndAuthOnly'].entries()) {
        const work = join(root, scenario + index); mkdirSync(work, { mode: 0o700 });
        const config = ['managed', 'personal', 'suppressed'].map(name => `[mcp_servers.${name}]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([resolve(import.meta.path), '--fixture-server'])}\nenabled = ${name !== 'suppressed' && (scenario !== 'readonly' || name === 'managed')}\n${scenario === 'readonly' && name === 'managed' ? 'enabled_tools = ["query-docs"]' : ''}`).join('\n');
        writeFileSync(join(work, 'config.toml'), config, { mode: 0o600 });
        const env = { PATH: process.env.PATH!, HOME: work, CODEX_HOME: work, XDG_CONFIG_HOME: work, XDG_CACHE_HOME: work, TMPDIR: work };
        const child = (options.spawnProcess ?? spawn)(executable, ['app-server', '--stdio'], { cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        // Observe close before any protocol work: spawn failure emits no exit.
        const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
        let spawned = false;
        child.once('spawn', () => { spawned = true; });
        child.stderr.resume(); // Never export native diagnostics.
        const rpc = new CodexRpc(text => child.stdin.write(text), () => {}, { timeoutMs: 15000 });
        child.stdout.on('data', chunk => { try { rpc.push(chunk.toString()); } catch { rpc.close(new Error('Invalid experiment protocol frame')); } });
        child.on('error', error => rpc.close(new Error('Experiment process failed', { cause: error })));
        child.stdin.on('error', error => rpc.close(error));
        child.on('exit', () => rpc.close());
        let failure: unknown;
        let failed = false;
        try {
          await rpc.call('initialize', { clientInfo: { name: 'deck-detail-experiment', version: '1.0.0' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
          const threadId = object(object(await rpc.call('thread/start', { cwd: work, approvalPolicy: 'never', sandbox: 'read-only' })).thread).id;
          assert.equal(typeof threadId, 'string');
          const start = performance.now();
          const inventory: Record<string, unknown>[] = [];
          let cursor: unknown; const seen = new Set<string>();
          do {
            const page = object(await rpc.call('mcpServerStatus/list', { threadId, detail, limit: 1, ...(cursor ? { cursor } : {}) }));
            assert(Array.isArray(page.data)); inventory.push(...page.data);
            cursor = page.nextCursor;
            if (cursor) { assert.equal(typeof cursor, 'string'); assert(!seen.has(cursor as string)); seen.add(cursor as string); assert(seen.size < 10); }
          } while (cursor);
          samples.push({ scenario, detail, durationMs: performance.now() - start });
          const projected = inventory.map(server => {
            const { resources, resourceTemplates, resourcesError, resourceTemplatesError, ...retained } = server;
            if (detail === 'full' && server.runtimeStatus === 'connected') {
              assert(Array.isArray(resources) && resources.length > 0, 'Full must actually exercise slow resources');
              assert(Array.isArray(resourceTemplates) && resourceTemplates.length > 0);
            }
            return retained;
          }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
          assert(isDeepStrictEqual(projected.map(s => s.name), ['managed', 'personal', 'suppressed']), 'All servers must be enumerated');
          assert.equal(projected.find(s => s.name === 'managed')!.runtimeStatus, 'connected');
          assert.equal(projected.find(s => s.name === 'suppressed')!.runtimeStatus, 'disabled');
          if (scenario === 'readonly') {
            assert.equal(projected.find(s => s.name === 'personal')!.runtimeStatus, 'disabled');
            assert(isDeepStrictEqual(Object.keys(object(projected.find(s => s.name === 'managed')!.tools)), ['query-docs']), 'Read-only tool filtering must survive');
          }
          if (expected) assert(isDeepStrictEqual(projected, expected), 'All retained status/tool/auth/error fields must match'); else expected = projected;
        } catch (error) { failed = true; failure = error; throw error; }
        finally {
          rpc.close();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            child.stdin.end();
            // Only our successfully spawned detached child owns this process group.
            if (spawned && child.pid) {
              try { process.kill(-child.pid, 'SIGKILL'); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
            }
            await Promise.race([closed, new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Experiment process cleanup timed out')), options.cleanupTimeoutMs ?? 2000);
            })]);
          } catch (cleanupError) {
            if (failed) throw new AggregateError([failure, cleanupError], 'Experiment and process cleanup failed');
            throw cleanupError;
          } finally { clearTimeout(timer); }
        }
      }
    }
    console.log(JSON.stringify({ version, samples, equivalence: true, modelCalls: 0 }, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (import.meta.main && !process.argv.includes('--fixture-server')) {
  if (process.argv.includes('--run')) {
    const executable = Bun.which('codex'); assert(executable, 'Codex must be installed');
    const version = Bun.spawnSync([executable, '--version']).stdout.toString().trim();
    assert.equal(version, 'codex-cli 0.166.0', 'Experiment is pinned to the investigated version');
    await runCodexMcpDetailExperiment(executable, version);
  } else console.log('Opt-in: bun scripts/codex-mcp-detail-experiment.ts --run');
}
