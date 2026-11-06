// Protects truthful assessment and per-attempt delivery evidence. The oracle is
// the supplied readiness state and observed driver/file boundary, never model intent.
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import type { DriverTaskInput, RunnerSessionDriver, TurnOutcome } from '@deck/core/session/driver';
import type { PreparationPort, PreparationSnapshot } from '@deck/core/session/preparation';
import type { SessionEvent } from '@deck/core/session/events';
import { readPreparedSessionStartContext } from '@deck/core/session/start-context';
import { readinessContext } from '@deck/core/session/readiness-parity';
import { buildCodexLaunch } from '../../../adapter-codex/src/session-driver/launch';
import { SessionManager } from '../session-manager';
import { ProjectPreparationService } from '../../../sdd-runtime/src/execution/project-preparation';
import { composeSessionStartContextV1 } from '../../../sdd-runtime/src/execution/session-start-context';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { tempDir, cleanupTempDirs, waitFor } from './test-helpers';

test.each(['eligible', 'ready', 'report-only', 'indeterminate', 'unsupported', 'no-context'] as const)(
  'Setup audit records observable readiness and isolated adapter delivery: %s', async mode => {
    const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
    const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
    const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
    const events: SessionEvent[] = [], inputs: DriverTaskInput[] = [];
    const finishes: ((outcome: TurnOutcome) => void)[] = [];
    let assessments = 0;
    const driver: RunnerSessionDriver = { runnerId: 'codex', protocol: 'codex-app-server', testedVersions: { min: '1', maxTested: '1' },
      probe: async () => ({ status: 'ready', capabilities: [] }),
      startTask: async (input, io) => {
        inputs.push(input);
        // Real adapter serialization and the hook's authenticated reader, with
        // process/model effects replaced at the driver boundary.
        const launch = buildCodexLaunch(input, { baseEnv: {} }, [], io);
        expect(readPreparedSessionStartContext(project, launch.env)).toBe(input.sessionStartContext?.text);
        io.emit({ kind: 'turn.started', data: { nativeSessionId: 'native-lead' } });
        let finish!: (outcome: TurnOutcome) => void;
        const done = new Promise<TurnOutcome>(resolve => { finish = resolve; });
        finishes.push(finish);
        if (input.resume) finish({ status: 'failed', reasonCode: 'native-session-not-found' });
        return { nativeSessionId: Promise.resolve('native-lead'), done, send: async () => ({ status: 'completed' }), interrupt: async () => { finish({ status: 'interrupted' }); }, close: async () => { finish({ status: 'interrupted' }); } };
      },
    };
    const port: PreparationPort = {
      status: scope => ({ snapshotId: createHash('sha256').update(String(++assessments)).digest('hex'), scope,
        observations: [{ component: 'openspec', scope: 'project', evidenceDigest: 'e', requiredBy: ['lead'],
          status: mode === 'ready' ? 'ready' : mode === 'indeterminate' ? 'indeterminate' : 'degraded',
          reason: 'FAKE_SECRET_DO_NOT_LOG', repair: mode === 'eligible' || mode === 'no-context' ? 'project' : mode === 'report-only' ? 'report-only' : 'none' }],
      } satisfies PreparationSnapshot),
      reconcile: () => [], delegate: () => { throw new Error('unexpected-delegation'); }, repair: async () => { throw new Error('unexpected-repair'); },
    };
    const manager = new SessionManager({ paths, credentials, broker: new ApprovalBroker({ sink: { emit() {} } }), supervisor: {} as Supervisor, homeDir: home,
      drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ['fixture'],
      config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } }),
      assignedRoleId: () => 'deck-lead',
      childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, prepareNativeRole: async roleId => ({ runnerId: 'codex', roleId, roleRef: roleId, generation: 'g', source: { root: home, files: {} }, instructions: '', hooks: [] }) }),
      ...(mode === 'unsupported' ? {} : { projectPreparation: port }),
      sessionStartContext: mode === 'no-context' ? undefined : readinessContext,
      preparationScope: input => ({ ...input, policyDigest: 'p', members: [{ memberId: 'lead', runnerId: 'codex', bindingId: 'lead', capabilities: {} }] }),
    });
    manager.subscribeEvents(event => { if (event.kind === 'diagnostic' && event.data.code === 'preparation.activation') events.push(event); });
    try {
      const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
      expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
      const send = (id: string) => manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: id, type: 'prompt.send', text: 'FAKE_PROMPT_SECRET' } });
      await send('first'); await waitFor(() => finishes.length === 1);
      const expected = mode === 'ready' ? 'no-repair-needed' : mode === 'report-only' || mode === 'unsupported' ? 'unsupported' : mode === 'no-context' ? 'eligible' : mode;
      expect(events).toContainEqual(expect.objectContaining({ sessionId, source: expect.objectContaining({ taskId: 'lead', memberId: 'lead' }), data: expect.objectContaining({ stage: 'assessment', status: expected, attempt: 1 }) }));
      expect(inputs).toHaveLength(1); // Eligible state does not auto-launch Setup.
      finishes[0]!({ status: 'completed' });
      await waitFor(() => events.some(e => e.data.stage === 'turn-ended'));
      expect(events.find(e => e.data.stage === 'turn-ended')!.data.status).toBe(expected === 'eligible' ? 'eligible-but-not-delegated' : expected);
      if (mode === 'eligible') {
        await waitFor(async () => (await manager.query('task.result', { sessionId, taskId: 'lead' }) as any).data.attempts.at(-1).state === 'completed');
        await send('second'); await waitFor(() => finishes.length === 3);
        expect(inputs[1]!.resume?.nativeSessionId).toBe('native-lead');
        expect(inputs[2]!.resume).toBeUndefined();
        expect(events.filter(e => e.data.stage === 'handoff' && e.data.boundary === 'driver-input').map(e => [e.data.attempt, e.data.continuity])).toEqual([[1, 'fresh'], [2, 'native'], [3, 'reseeded']]);
        expect(new Set(events.filter(e => e.data.stage === 'assessment').map(e => e.data.snapshotId)).size).toBe(3);
        finishes[2]!({ status: 'completed' });
        await waitFor(() => events.filter(e => e.data.stage === 'turn-ended').length === 3);
      }
      const handoffs = events.filter(e => e.data.stage === 'handoff');
      const supplied = mode !== 'unsupported' && mode !== 'no-context';
      expect(handoffs.filter(e => e.data.boundary === 'adapter-context-file')).toHaveLength(supplied ? inputs.length : 0);
      expect(handoffs.filter(e => e.data.boundary === 'driver-input').every(e => e.data.status === (supplied ? 'supplied' : 'unavailable'))).toBe(true);
      for (const event of events) {
        const serialized = JSON.stringify(event.data);
        expect(serialized).not.toContain('FAKE_'); expect(serialized).not.toContain(project);
        expect(serialized.length).toBeLessThan(1024);
        expect(event.data).not.toHaveProperty('consumed');
      }
    } finally { await manager.close(); cleanupTempDirs(); }
  },
);

// Fault only the storage edge after a real host launch. Task settlement, credential
// revocation and shutdown must survive terminal audit failures, even if storage stays down.
for (const member of ['lead', 'setup'] as const) test.each(['none', 'append', 'flush', 'append-persistent', 'flush-persistent'] as const)(
  `terminal Setup audit storage failure still settles ${member}: %s`, async fault => {
    const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
    const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
    const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
    const inputs: DriverTaskInput[] = [];
    const finishes = new Map<string, (outcome: TurnOutcome) => void>();
    const driver: RunnerSessionDriver = { runnerId: 'codex', protocol: 'codex-app-server', testedVersions: { min: '1', maxTested: '1' },
      probe: async () => ({ status: 'ready', capabilities: [] }),
      startTask: async (input, io) => {
        inputs.push(input);
        const role = input.nativeRole ?? input.nativeRoleDescriptor!;
        expect(io.validatedLaunch?.({ roleId: role.roleId, generation: role.generation, nativeSessionId: input.taskId, launchId: input.taskId, current: () => true })).toBe(true);
        const done = new Promise<TurnOutcome>(resolve => finishes.set(input.taskId, resolve));
        return { nativeSessionId: Promise.resolve(input.taskId), done, send: async () => ({ status: 'completed' }), interrupt: async () => { finishes.get(input.taskId)!({ status: 'interrupted' }); }, close: async () => {} };
      },
    };
    const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId, resolveLocator: async () => ({ status: 'missing' }), listSources: async () => ({ outcome: 'complete', sources: [], diagnostics: [] }) }) });
    const manager = new SessionManager({ paths, credentials, broker: new ApprovalBroker({ sink: { emit() {} } }), supervisor: {} as Supervisor, homeDir: home,
      drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ['fixture'],
      config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'codex', modelId: 'fixture' }, setup: { runnerId: 'codex', modelId: 'fixture' } } }),
      assignedRoleId: id => `deck-${id}`,
      childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, prepareNativeRole: async roleId => ({ runnerId: 'codex', roleId, roleRef: roleId, generation: 'g', source: { root: home, files: {} }, instructions: '', hooks: [] }) }),
      projectPreparation: service, sessionStartContext: composeSessionStartContextV1,
      preparationScope: input => ({ ...input, policyDigest: 'p', members: Object.entries(input.members).map(([memberId, a]) => ({ memberId, runnerId: a.runnerId, bindingId: memberId, capabilities: {} })) }),
    });
    // Observe escaping launch rejections without letting an expected RED rejection
    // leak into other tests. All launch/finalization behavior remains production code.
    const host = manager as any, launch = host.launchTurn.bind(manager);
    let escaped: unknown, live: any, turn: any, restore = () => {};
    host.launchTurn = (...args: unknown[]) => launch(...args).catch((error: unknown) => { escaped = error; });
    try {
      const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
      expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
      await manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: 'send', type: 'prompt.send', text: 'Fixture' } });
      await waitFor(() => inputs.length === 1);
      const lead = inputs[0]!, leadToken = JSON.parse(readFileSync(lead.credentialFile, 'utf8')).token;
      if (member === 'setup') {
        const delegated = await manager.callTaskTool(credentials.lookup(leadToken)!, 'deck_delegate', { agent: 'setup', task: 'Inspect fixture', preparation: { snapshotId: lead.sessionStartContext!.snapshotId, components: ['skill-registry'] } });
        expect(delegated.ok).toBe(true);
        await waitFor(() => inputs.length === 2);
      }
      const input = inputs.at(-1)!, token = JSON.parse(readFileSync(input.credentialFile, 'utf8')).token;
      live = host.sessions.get(sessionId); turn = live.turns.get(input.taskId);
      let settled = false, injected = false, terminalPending = false;
      void turn.done.then(() => { settled = true; });
      const log = live.log, append = log.appendMany.bind(log), flush = log.flush.bind(log);
      restore = () => { log.appendMany = append; log.flush = flush; };
      log.appendMany = (drafts: any[]) => {
        const terminal = drafts.some(d => d.kind === 'diagnostic' && d.data?.code === 'preparation.activation' && d.data.stage === (member === 'lead' ? 'turn-ended' : 'setup-turn-ended'));
        terminalPending = terminal;
        if (fault.startsWith('append') && (terminal || injected && fault.endsWith('persistent'))) { injected = true; throw new Error('fixture-terminal-append'); }
        return append(drafts);
      };
      log.flush = () => {
        if (fault.startsWith('flush') && (terminalPending || injected && fault.endsWith('persistent'))) { terminalPending = false; injected = true; throw new Error('fixture-terminal-flush'); }
        terminalPending = false; return flush();
      };
      finishes.get(input.taskId)!({ status: 'completed' });
      await waitFor(() => settled || escaped !== undefined);
      expect(escaped).toBeUndefined();
      expect(injected).toBe(fault !== 'none');
      expect(settled).toBe(true);
      expect(credentials.lookup(token)).toBeUndefined();
      expect(live.turns.has(input.taskId)).toBe(false);
      expect(live.broken === true).toBe(fault !== 'none');
      if (!fault.endsWith('persistent')) expect(await manager.query('task.result', { sessionId, taskId: input.taskId })).toMatchObject({ ok: true, data: { attempts: [expect.objectContaining({ state: 'completed' })] } });
      restore();
      let closed = false;
      void manager.close().then(() => { closed = true; });
      await waitFor(() => closed, 1000, 'shutdown after terminal audit');
    } finally {
      restore();
      // Only RED teardown: release the failed candidate's leaked turn to avoid
      // leaving a hung shutdown behind after the assertion has already failed.
      if (escaped && turn && live.turns.has(turn.taskId)) host.finishTurn(live, turn, 'codex', { status: 'completed' });
      await manager.close(); cleanupTempDirs();
    }
  },
);
