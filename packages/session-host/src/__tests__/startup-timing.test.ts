import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import type { RunnerSessionDriver } from '@deck/core/session/driver';
import type { SessionEvent } from '@deck/core/session/events';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { FakeDriver } from '../testing/fake-driver';
import { tempDir, cleanupTempDirs, waitFor, FakeClock } from './test-helpers';

// Protects host production composition: the previously invisible native-role
// preparation interval is measured, even when it rejects; first output is a
// separate observation and does not repeat on later chunks.
for (const failure of [false, true]) test(`host startup summary and first output (failure=${failure})`, async () => {
  const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const clock = new FakeClock(), events: SessionEvent[] = [];
  const driver: RunnerSessionDriver = { runnerId: 'codex', protocol: 'codex-app-server', testedVersions: { min: '0.162.1', maxTested: '0.162.1' },
    probe: async () => ({ status: 'ready', version: '0.162.1', capabilities: [] }),
    startTask: async (input, io) => {
      expect(input.runnerVersion).toBe('0.162.1');
      clock.advance(7);
      io.emit({ kind: 'turn.started', data: {} });
      for (let i = 0; i < 2; i++) io.emit({ kind: 'message.delta', data: { text: 'TIMING_SECRET', role: 'assistant' } });
      return { nativeSessionId: Promise.resolve('native'), done: Promise.resolve({ status: 'completed' as const }), send: async () => ({ status: 'completed' }), interrupt: async () => {}, close: async () => {} };
    },
  };
  const manager = new SessionManager({ paths, credentials, clock, broker: new ApprovalBroker({ sink: { emit() {} } }), supervisor: {} as Supervisor, homeDir: home,
    drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } }),
    assignedRoleId: () => 'deck-lead',
    childMcp: async () => {
      clock.advance(13);
      return { runnerPackages: () => [], resolveServer: () => undefined, prepareNativeRole: async roleId => {
        clock.advance(17);
        if (failure) throw new Error('NATIVE_SECRET');
        return { runnerId: 'codex', roleId, roleRef: roleId, generation: 'g', source: { root: home, files: {} }, instructions: 'ROLE_SECRET', hooks: [] };
      } };
    },
  });
  manager.subscribeEvents(e => { if (e.kind === 'diagnostic' && ['turn.startup-timing', 'turn.first-output-timing'].includes(String(e.data.code))) events.push(e); });
  try {
    const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
    expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
    await manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: 'send', type: 'prompt.send', text: 'PROMPT_SECRET' } });
    await waitFor(() => events.length === (failure ? 1 : 2));
    const summary = events.find(e => e.data.code === 'turn.startup-timing')!;
    expect(summary.data).toMatchObject({ scope: 'host', version: '0.162.1', continuity: 'new', outcome: failure ? 'failed' : 'completed' });
    expect(summary.data.steps).toContainEqual({ step: 'native-role', durationMs: 17 });
    expect(summary.data.steps).toContainEqual({ step: 'resolver', durationMs: 13 });
    if (!failure) expect(events.find(e => e.data.code === 'turn.first-output-timing')!.data).toMatchObject({ sinceDriverStartMs: 7, evidence: 'message.delta' });
    expect(JSON.stringify(events.map(e => e.data))).not.toContain('SECRET');
    expect(JSON.stringify(events.map(e => e.data))).not.toContain(home);
  } finally { await manager.close(); cleanupTempDirs(); }
});

// Protects Q1: timing must describe the actual delegated driver input after
// continuity selection, for both native continuation and an explicit reseed.
// Oracle: requested continuity with confirmed native ownership and bounded input.
for (const continuity of ['native', 'fresh'] as const) test(`delegated startup continuity matches driver input (${continuity})`, async () => {
  const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const lead = new FakeDriver('claude'), worker = new FakeDriver('codex');
  const drivers = [lead, worker], events: SessionEvent[] = [];
  const manager = new SessionManager({ paths, credentials, broker: new ApprovalBroker({ sink: { emit() {} } }), supervisor: {} as Supervisor, homeDir: home,
    drivers: { get: id => drivers.find(d => d.runnerId === id), list: () => drivers }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'claude', modelId: 'fixture' }, 'apply-deep': { runnerId: 'codex', modelId: 'fixture' } } }),
    childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined }),
    compactionBound: ({ assignment, version }) => ({ runnerId: assignment.runnerId, modelId: assignment.modelId, version: version!, configKey: 'fixture', inputSafeExclusiveCap: 100000, triggerTokens: 120000, basis: 'input', evidenceRef: 'fixture' }),
  });
  manager.subscribeEvents(event => { if (event.kind === 'diagnostic' && event.data.code === 'turn.startup-timing' && event.source.memberId === 'apply-deep') events.push(event); });
  try {
    const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
    expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
    await manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: 'send', type: 'prompt.send', text: 'Fixture' } });
    await waitFor(() => lead.turns.length === 1); lead.turns[0]!.init();
    const token = JSON.parse(readFileSync(lead.turns[0]!.input.credentialFile, 'utf8')).token;
    const delegate = (args: object) => manager.callTaskTool(credentials.lookup(token)!, 'deck_delegate', { agent: 'apply-deep', task: 'Fixture work', ...args });
    expect((await delegate({})).ok).toBe(true);
    await waitFor(() => worker.turns.length === 1);
    const first = worker.turns[0]!;
    expect(first.input.resume).toBeUndefined();
    expect(events[0]!.data).toMatchObject({ continuity: 'new', outcome: 'completed' });
    first.init();
    first.emit('usage', { requestInput: { tokens: 100, basis: 'codex-last-input', nativeThreadId: first.nativeSessionId, nativeTurnId: 'turn-1', modelId: 'fixture', final: true } });
    first.finish(); await waitFor(() => first.closed);
    expect((await delegate({ continueTaskId: first.input.taskId, continuity, ...(continuity === 'native' ? { continuityJustification: 'Continue the bounded fixture context' } : {}) })).ok).toBe(true);
    await waitFor(() => worker.turns.length === 2);
    const second = worker.turns[1]!;
    expect(second.input.resume?.nativeSessionId).toBe(continuity === 'native' ? first.nativeSessionId : undefined);
    expect(events).toHaveLength(2);
    expect(events[1]!.data).toMatchObject({ continuity: second.input.resume ? 'resume' : 'new', outcome: 'completed', attempt: 2 });
    second.init(); second.finish();
  } finally { await manager.close(); cleanupTempDirs(); }
});
