import { ControlServer } from "../control-server";
import { acquireDaemonLock } from "../daemon-lock";
import { systemClock } from "../clock";
import { getDefaultDeckConfig } from "@deck/core/config/deck-config";
// Protects S3-Q3: preparation reserves idle refresh before counting itself as work,
// without granting a second preparation admission while the first is active.
import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { resolveStatePaths, ensureStateLayout } from '../paths';
import { withIdleRunnerMutation, RunnerMutationDeferredError, runnerMutationActive } from '../runner-mutation';
import type { RunnerSessionDriver } from '@deck/core/session/driver';
import type { Supervisor } from '../supervisor';
import { waitFor } from './test-helpers';

test('idle preparation refreshes, competing preparation defers, reservation releases', async () => {
  const home = mkdtempSync('/tmp/deck-preparation-mutation-');
  const project = join(home, 'project'); mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home });
  ensureStateLayout(paths);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, writes = 0, deferrals = 0;
  const driver = { runnerId: 'codex', probe: async () => ({ status: 'ready', capabilities: [] }) } as unknown as RunnerSessionDriver;
  const manager = new SessionManager({ paths, homeDir: home,
    broker: new ApprovalBroker({ sink: { emit() {} } }), credentials: new CredentialRegistry({ socketPath: paths.socket.path }), supervisor: {} as Supervisor,
    drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } }),
    assignedRoleId: () => 'deck-lead',
    childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined,
      prepareNativeRole: async roleId => {
        const call = ++calls;
        try { await withIdleRunnerMutation(async () => { writes++; }, { paths }); }
        catch (error) { if (!(error instanceof RunnerMutationDeferredError)) throw error; deferrals++; }
        if (call === 1) await hold;
        return { runnerId: 'codex', roleId, roleRef: roleId, generation: 'g', source: { root: home, files: {} }, instructions: '', hooks: [] };
      },
    }),
  });
  const lock = await acquireDaemonLock(paths, { clock: systemClock, presence: () => 'alive', ping: async () => false });
  if (!lock.ok) throw new Error('fixture lock unavailable');
  const server = new ControlServer({ socketPath: paths.socket.path, daemon: { version: 'fixture', pid: process.pid, nonce: lock.nonce, status: () => ({ runningWork: manager.hasRunningWork(), activeSessions: true }), requestRestart: () => ({ ok: false, code: 'busy' }) }, service: {
    execute: input => manager.execute(input), openLog: id => manager.openLog(id), hasRunningWork: () => manager.hasRunningWork(),
    query: async () => ({ ok: false, code: manager.hasRunningWork() ? 'runner-mutation-deferred' : 'unexpected-idle-request' }),
  } });
  await server.listen();
  try {
    const create = async (id: string) => {
      const result = await manager.execute({ clientId: 'test', command: { v: 1, commandId: id, type: 'session.create', projectRoot: project } });
      expect(result).toMatchObject({ ok: true });
      return (result as any).data.sessionId as string;
    };
    const first = await create('first'), second = await create('second');
    const prepare = (sessionId: string) => manager.execute({ sessionId, clientId: 'test', command: { v: 1, commandId: `prepare-${sessionId}`, type: 'session.prepare' } });
    expect((await prepare(first)).ok).toBe(true);
    await waitFor(() => calls === 1);
    expect(writes).toBe(1);
    expect(runnerMutationActive(paths)).toBe(true);
    expect((await prepare(second)).ok).toBe(true);
    await waitFor(() => deferrals === 1);
    expect(writes).toBe(1);
    release();
    await waitFor(() => !manager.hasRunningWork());
    expect(runnerMutationActive(paths)).toBe(false);
  } finally { release(); await manager.close(); await server.close(); lock.release(); rmSync(home, { recursive: true, force: true }); }
});
