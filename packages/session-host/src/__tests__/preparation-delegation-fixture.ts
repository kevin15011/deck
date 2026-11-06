// Protects authenticated repair continuation: missing/stale requests cannot silently launch an unarmed Setup.
import { expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import type { DriverTaskInput, RunnerSessionDriver, TurnOutcome } from '@deck/core/session/driver';
import { ProjectPreparationService } from '../../../sdd-runtime/src/execution/project-preparation';
import { composeSessionStartContextV1 } from '../../../sdd-runtime/src/execution/session-start-context';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { BridgeService } from '../bridge-service';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { tempDir, cleanupTempDirs, waitFor } from './test-helpers';

export async function exercisePreparationDelegation(fault: 'restart' | 'missing-role' | 'missing-binding' | 'revoked-binding'): Promise<void> {
  const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
  writeFileSync(join(project, '.gitignore'), '/.atl/skill-registry.md\n');
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const broker = new ApprovalBroker({ sink: { emit() {} } });
  const inputs: DriverTaskInput[] = [];
  let leadRunner = 'claude', staleCodex = false, bindingActive = true;
  const driver = (runnerId: string): RunnerSessionDriver => ({ runnerId, protocol: runnerId === 'claude' ? 'claude-stream-json' : 'codex-app-server', testedVersions: { min: '1', maxTested: '1' },
    probe: async () => ({ status: 'ready', capabilities: [] }),
    startTask: async (input, io) => {
      let finish!: (outcome: TurnOutcome) => void;
      const done = new Promise<TurnOutcome>(resolve => { finish = resolve; });
      const nativeSessionId = `native-${input.taskId}`;
      const role = input.nativeRole ?? input.nativeRoleDescriptor!;
      if (input.memberId !== 'setup' || fault !== 'missing-binding') expect(io.validatedLaunch?.({ roleId: role.roleId, generation: role.generation, nativeSessionId, launchId: nativeSessionId, current: () => bindingActive })).toBe(true);
      inputs.push(input);
      return { nativeSessionId: Promise.resolve(nativeSessionId), done, send: async () => ({ status: 'completed' }), interrupt: async () => { finish({ status: 'interrupted' }); }, close: async () => { finish({ status: 'interrupted' }); } };
    },
  });
  const drivers = [driver('claude'), driver('codex')];
  const createService = () => new ProjectPreparationService({ registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId, resolveLocator: async () => ({ status: 'missing' }), listSources: async () => ({ outcome: 'complete', sources: [], diagnostics: [] }) }) });
  let service = createService();
  const manager = new SessionManager({ paths, broker, credentials, supervisor: {} as Supervisor, homeDir: home,
    drivers: { get: id => drivers.find(d => d.runnerId === id), list: () => drivers }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, maxConcurrentTasks: 4, members: { lead: { runnerId: leadRunner, modelId: 'fixture' }, setup: { runnerId: 'codex', modelId: 'fixture' } } }),
    assignedRoleId: id => `deck-${id}`,
    childMcp: async runnerId => ({ runnerPackages: () => [], resolveServer: () => undefined,
      ...(runnerId === 'claude' ? { nativeSkills: { contentHash: 'g', root: home, files: {}, selectionPath: '', selectionHash: '', pluginName: 'fixture' } } : {}),
      ...(runnerId === 'codex' && fault === 'missing-role' ? {} : { prepareNativeRole: async (roleId: string) => {
        if (staleCodex) throw new Error('codex-session-skills-unverified: reinstall required');
        return { runnerId, roleId, generation: 'g', roleRef: roleId, source: { root: home, files: {} }, instructions: '', hooks: [] };
      } }),
    }),
    projectPreparation: { status: s => service.status(s), delegate: (r, s, t) => service.delegate(r, s, t), repair: (r, i) => service.repair(r, i), reconcile: (s, r) => service.reconcile(s, r) }, sessionStartContext: composeSessionStartContextV1,
    preparationScope: input => ({ ...input, policyDigest: 'p', members: Object.entries(input.members).map(([memberId, a]) => ({ memberId, runnerId: a.runnerId, bindingId: memberId, capabilities: {} })) }),
  });
  const bridge = new BridgeService({ credentials, broker, status: g => manager.taskStatus(g), callTaskTool: (g, n, a, c) => manager.callTaskTool(g, n, a, c) });
  const activation: Record<string, unknown>[] = [];
  manager.subscribeEvents(event => { if (event.kind === 'diagnostic' && event.data.code === 'preparation.activation') activation.push(event.data); });
  try {
    const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
    expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
    await manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: 'prompt', type: 'prompt.send', text: 'Repair registry' } });
    await waitFor(() => inputs.length === 1);
    const call = (input: DriverTaskInput, tool: string, args?: unknown) => bridge.call({ token: JSON.parse(readFileSync(input.credentialFile, 'utf8')).token, tool, arguments: args });
    const lead = inputs[0]!;
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'assessment', snapshotId: lead.sessionStartContext!.snapshotId, status: 'eligible', attempt: 1 }));
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'handoff', boundary: 'driver-input', snapshotId: lead.sessionStartContext!.snapshotId }));
    const delegate = (args: object) => call(lead, 'deck_delegate', { agent: 'setup', task: 'Repair registry', ...args });
    service = createService(); // Actual loss of the daemon's process-local snapshot cache.
    const stale = await delegate({ preparation: { snapshotId: lead.sessionStartContext!.snapshotId, components: ['skill-registry'] } });
    expect(stale).toMatchObject({ ok: false, code: 'preparation-snapshot-stale' });
    const snapshot = JSON.parse((stale as any).message).snapshot;
    expect(snapshot.snapshotId).toBe(lead.sessionStartContext!.snapshotId);
    expect(await delegate({ preparation: { components: ['skill-registry'] } })).toMatchObject({ ok: false, code: 'preparation-request-invalid' });
    expect(inputs).toHaveLength(1);
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'delegation', status: 'rejected', reason: 'preparation-snapshot-stale' }));
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'delegation', status: 'rejected', reason: 'preparation-request-invalid' }));
    const preparation = { snapshotId: snapshot.snapshotId, components: ['skill-registry'] };
    const accepted = await delegate({ preparation }); expect(accepted.ok).toBe(true);
    const taskId = (accepted as any).data.taskId;
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'delegation', status: 'delegated', setupTaskId: taskId, setupAttempt: 1, snapshotId: preparation.snapshotId }));
    if (fault === 'missing-role') {
      await waitFor(async () => (await manager.query('task.result', { sessionId, taskId }) as any).data.attempts.at(-1).state === 'failed');
      expect(inputs).toHaveLength(1);
      expect(JSON.stringify(await manager.query('task.result', { sessionId, taskId }))).toContain('preparation-launch-binding-unavailable');
      expect(activation).toContainEqual(expect.objectContaining({ stage: 'setup-turn-ended', outcome: 'failed', reason: 'preparation-launch-binding-unavailable', snapshotId: preparation.snapshotId }));
      return;
    }
    await waitFor(() => inputs.length === 2);
    expect(inputs[1]!.mcp.sessionTools).toContain('deck_prepare_project');
    await call(lead, 'deck_task_cancel', { taskId });
    await waitFor(async () => (await manager.query('task.result', { sessionId, taskId }) as any).data.attempts.at(-1).state === 'cancelled');
    expect(await delegate({ continueTaskId: taskId })).toMatchObject({ ok: false, code: 'preparation-request-required' });
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'delegation', status: 'rejected', reason: 'preparation-request-required' }));
    const retried = await delegate({ continueTaskId: taskId, preparation }); expect(retried.ok).toBe(true);
    await waitFor(() => inputs.length === 3);
    const setup = inputs[2]!;
    expect(setup.sessionStartContext!.text).toContain(JSON.stringify(preparation));
    if (fault === 'revoked-binding') bindingActive = false;
    if (fault === 'missing-binding' || fault === 'revoked-binding') {
      const refused = await call(setup, 'deck_prepare_project', preparation);
      expect(refused).toMatchObject({ ok: false, code: 'preparation-authority-unavailable' });
      expect(JSON.parse((refused as any).message)).toMatchObject({ reason: 'launch-binding-unavailable', retry: expect.any(String) });
      expect(activation).toContainEqual(expect.objectContaining({ stage: 'repair', status: 'rejected', reason: 'preparation-authority-unavailable', attempt: 2, snapshotId: preparation.snapshotId }));
      expect(() => readFileSync(join(project, '.atl/skill-registry.md'))).toThrow();
      return;
    }
    const mismatched = await call(setup, 'deck_prepare_project', { ...preparation, snapshotId: 'different' });
    expect(mismatched).toMatchObject({ ok: false, code: 'preparation-authority-revoked' });
    expect(JSON.parse((mismatched as any).message)).toMatchObject({ reason: 'request-snapshot-mismatch', retry: expect.any(String) });
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'repair', status: 'rejected', reason: 'preparation-authority-revoked', snapshotId: preparation.snapshotId }));
    expect(() => readFileSync(join(project, '.atl/skill-registry.md'))).toThrow();
    expect(await call(setup, 'deck_prepare_project', preparation)).toMatchObject({ ok: true, data: { status: 'changed' } });
    const bytes = readFileSync(join(project, '.atl/skill-registry.md'));
    expect(await call(setup, 'deck_prepare_project', preparation)).toMatchObject({ ok: true, data: { status: 'reconciled' } });
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'repair', status: 'completed', outcome: 'changed', snapshotId: preparation.snapshotId, attempt: 2 }));
    expect(activation).toContainEqual(expect.objectContaining({ stage: 'repair', status: 'completed', outcome: 'reconciled', snapshotId: preparation.snapshotId, attempt: 2 }));
    expect(readFileSync(join(project, '.atl/skill-registry.md')).equals(bytes)).toBe(true);
    expect(readFileSync(join(project, '.atl/skill-registry.md'), 'utf8')).toContain('skill-registry');
    const token = JSON.parse(readFileSync(setup.credentialFile, 'utf8')).token;
    credentials.revoke(token);
    expect((await bridge.call({ token, tool: 'deck_prepare_project', arguments: preparation })).ok).toBe(false);
    expect(readFileSync(join(project, '.atl/skill-registry.md')).equals(bytes)).toBe(true);
    // A stale Codex Lead is rejected during preparation, before model input.
    leadRunner = 'codex'; staleCodex = true;
    const other = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create-other', type: 'session.create', projectRoot: project } });
    expect(other.ok).toBe(true);
    const otherId = (other as any).data.sessionId;
    await manager.execute({ sessionId: otherId, clientId: 'test', command: { v: 1, commandId: 'prepare', type: 'session.prepare' } });
    await waitFor(async () => (await manager.query('session.readiness', { sessionId: otherId }) as any).data.status === 'failed');
    expect(await manager.query('session.readiness', { sessionId: otherId })).toMatchObject({ ok: true, data: { reasonCode: 'codex-session-skills-unverified' } });
    expect(inputs).toHaveLength(3);
  } finally { await manager.close(); cleanupTempDirs(); }
}
