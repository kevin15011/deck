import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { FakeDriver } from '../testing/fake-driver';
import { cleanupTempDirs, tempDir, waitFor } from './test-helpers';
afterEach(cleanupTempDirs);

// Protects: a startup failure caused by static configuration must not be redispatched forever.
// Fails if: the failed Lead prompt is requeued while the prompt queue stays unpaused.
test.each([
  ['codex-hook-isolation-violation', true],
  ['codex-process-exited', false],
])('failed Lead startup %s pauses the queue=%s and keeps the prompt', async (error, paused) => {
  const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const lead = new FakeDriver('codex'); (lead as any).supportsInputClaim = true;
  const manager = new SessionManager({ paths, broker: new ApprovalBroker({ sink: { emit() {} } }), credentials,
    supervisor: { spawn() { throw Error('fake process boundary'); } } as unknown as Supervisor, homeDir: home,
    childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, }),
    drivers: { get: id => id === 'codex' ? lead : undefined, list: () => [lead] }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, maxConcurrentTasks: 2, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } }) });
  try {
    const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
    const sessionId = (created as any).data.sessionId;
    await manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: 'prompt', type: 'prompt.send', text: 'hello' } });
    await waitFor(() => lead.turns.length === 1);
    lead.turns[0]!.finish({ status: 'failed', error });
    const dir = join(paths.sessionsDir, sessionId, 'events');
    const events = () => readdirSync(dir).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    await waitFor(() => events().some(e => e.kind === 'turn.completed' && e.data.status === 'failed'));
    await waitFor(() => events().some(e => e.kind === 'prompt.queue' || e.kind === 'prompt.requeued' || e.kind === 'prompt.state'));
    const queue = events().filter(e => e.kind === 'prompt.queue' && e.data.paused === true);
    expect(queue.some(e => e.data.reason === error)).toBe(paused);
    expect(events().some(e => e.kind === 'prompt.requeued' && e.data.text === 'hello')).toBe(true);
  } finally { await manager.close?.(); }
});
