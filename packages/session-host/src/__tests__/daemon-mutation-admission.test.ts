// R4: exercise the shared production admission gate over its real control transport.
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDaemon } from '../daemon';
import { ControlClient } from '../control-client';
import { resolveStatePaths } from '../paths';
import { acquireRunnerMutationMarker, releaseRunnerMutationMarker } from '../runner-mutation';

test('maintenance admits cancellation and reads but excludes competing mutations', async () => {
  const home = mkdtempSync('/tmp/deck-daemon-gate-');
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home });
  const marker = { pid: process.pid, token: randomUUID() };
  const result = await startDaemon({ paths, version: 'test', anchorCommand: ['unused'], recoverOnStart: false,
    createService: () => ({ execute: async () => ({ ok: true }), query: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false }),
  });
  if (!result.ok) throw new Error('daemon unavailable');
  const client = await ControlClient.connect(paths.socket.path);
  try {
    await client.hello('test');
    expect(acquireRunnerMutationMarker(paths, marker)).toBe(true);
    const command = (type: string) => client.command({ v: 1, commandId: randomUUID(), type, preparationId: "preparation-fixture" }, 'session-fixture');
    expect((await command('session.prepare.cancel')).outcome.ok).toBe(true);
    expect((await client.query('sessions.status')).ok).toBe(true);
    expect(await client.query('web.status')).toMatchObject({ ok: false, code: 'web-unavailable' });
    expect((await command('session.prepare')).outcome).toMatchObject({ ok: false, code: 'runner-mutation-active' });
    expect(await client.query('sessions.prune')).toMatchObject({ ok: false, code: 'runner-mutation-active' });
  } finally { releaseRunnerMutationMarker(paths, marker); client.close(); await result.daemon.stop('test'); rmSync(home, { recursive: true, force: true }); }
});
