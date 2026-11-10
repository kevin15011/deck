import { expect, test } from 'bun:test';
import type { DriverTaskInput } from '@deck/core/session/driver';
import { createCodexSessionDriver } from './driver';
import { ISOLATION_FEATURES } from './launch';
import { harness } from './test-support';

// Protects the production request shape and all-page admission. The version
// oracle is the isolated native 0.166.0 A/B contract experiment, not a snapshot.
async function admission(version: string | undefined, review = false, last: Record<string, unknown> = { name: 'personal', runtimeStatus: 'connected', tools: {} }, forceFull = false, rpcError = false) {
  const statuses: Record<string, unknown>[] = [];
  const h = harness((child, _, message) => {
    let result: unknown = {};
    if (message.method === 'config/read') result = { config: { features: Object.fromEntries(ISOLATION_FEATURES.map(id => [id, false])) } };
    if (message.method === 'thread/start') result = { thread: { id: 'thread' } };
    if (message.method === 'mcpServerStatus/list') {
      const params = message.params as Record<string, unknown>; statuses.push(params);
      if (rpcError) { child.stdout({ id: message.id, error: { code: -32602, message: 'authentication or isolation error' } }); return; }
      result = params.cursor ? { data: [last] } : { data: [{ name: 'deck-session-t-context7', runtimeStatus: 'connected', tools: { 'query-docs': {} }, authStatus: 'unsupported' }], nextCursor: 'page2' };
    }
    if (message.id !== undefined) child.stdout({ id: message.id, result });
  });
  h.io.claimInput = () => false;
  const input: DriverTaskInput = { taskId: 't', memberId: review ? 'quality' : 'lead', cwd: '/work', runnerVersion: version,
    assignment: { runnerId: 'codex', modelId: 'fake' }, rolePrompt: '', prompt: '', credentialFile: '/private/credential',
    mcp: { servers: ['context7'], sessionTools: [] }, mcpServerSpecs: { context7: { command: 'fixture', args: [], env: {} } },
    suppressedMcpServers: ['suppressed'], approvals: 'relay', disableNativeDelegation: true };
  const task = await createCodexSessionDriver(forceFull ? { mcpStatusDetail: 'full' } : {}).startTask(input, h.io);
  const outcome = await task.done; await task.close();
  expect(h.children.flatMap(c => c.writes).some(m => m.method === 'turn/start')).toBe(false);
  return { outcome, statuses };
}

test('only the verified native version uses reduced detail on every page', async () => {
  for (const version of ['0.166.0', '0.162.1', '0.165.0', '0.167.0', undefined]) {
    const { outcome, statuses } = await admission(version);
    expect(outcome.status).toBe('interrupted');
    expect(statuses).toHaveLength(2);
    expect(statuses.every(p => p.detail === (version === '0.166.0' ? 'toolsAndAuthOnly' : 'full') && p.threadId === 'thread')).toBe(true);
    expect(statuses[1]!.cursor).toBe('page2');
  }
});

test('full experiment control remains full; native errors are never retried as compatibility failures', async () => {
  const full = await admission('0.166.0', false, undefined, true);
  expect(full.outcome.status).toBe('interrupted');
  expect(full.statuses.every(p => p.detail === 'full')).toBe(true);
  const failed = await admission('0.166.0', false, undefined, false, true);
  expect(failed.outcome.status).toBe('failed');
  expect(failed.statuses).toHaveLength(1);
});

// Protects isolation decisions when an offending server arrives after page one.
// Full and reduced requests must enforce the same suppression/read-only checks.
test('reduced and full detail preserve personal suppression and read-only admission', async () => {
  for (const version of ['0.166.0', '0.162.1']) {
    expect((await admission(version, false, { name: 'suppressed', runtimeStatus: 'connected', tools: {} })).outcome).toMatchObject({ status: 'failed', error: 'codex-runtime-mcp-isolation-violation' });
    expect((await admission(version, true)).outcome.status).toBe('failed');
    expect((await admission(version, true, { name: 'suppressed', runtimeStatus: 'disabled' })).outcome.status).toBe('interrupted');
    expect((await admission(version, true, { name: 'deck-session-t-context7', runtimeStatus: 'connected', tools: { exec: {} } })).outcome).toMatchObject({ status: 'failed', error: 'codex-runtime-mcp-isolation-violation' });
    expect((await admission(version, true, { name: 'deck-session-t-context7', runtimeStatus: 'connected', toolsError: 'private', tools: {} })).outcome.status).toBe('failed');
    expect((await admission(version, false, { name: 'deck-session-t-context7', runtimeStatus: 'authenticationRequired', tools: {} })).outcome.status).toBe('failed');
  }
});
