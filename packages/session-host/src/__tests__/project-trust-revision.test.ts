import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectStore } from '../project-store';
import { cleanupTempDirs, tempDir } from './test-helpers';

afterEach(cleanupTempDirs);
function fixture() {
  const root = tempDir(), home = join(root, 'home'), state = join(root, 'state');
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, 'repo'));
  const store = new ProjectStore({ stateRoot: state, home });
  const project = store.register(join(home, 'repo'));
  return { store, project, state, home, reopen: () => new ProjectStore({ stateRoot: state, home }) };
}
const consent = (projectId: string, trusted: boolean, expectedRevision: number, commandId: string = crypto.randomUUID()) =>
  ({ type: 'project.trust' as const, runnerId: 'opencode' as const, projectId, trusted, expectedRevision, commandId });

test('Quality37: evicted grant replay after reopening cannot restore revoked authority', () => {
  const f = fixture(), grant = consent(f.project.projectId, true, 0, 'original-grant');
  f.store.executeCommand(grant);
  f.store.executeCommand(consent(f.project.projectId, false, 1, 'revoke'));
  for (let i = 0; i < 1000; i++) f.store.executeCommand({
    type: 'project.rename', commandId: 'rename-' + i, projectId: f.project.projectId, name: f.project.name,
  });
  expect(JSON.parse(readFileSync(join(f.state, 'projects.json'), 'utf8')).registrations['original-grant']).toBeUndefined();
  const reopened = f.reopen();
  expect(reopened.projectTrust(f.project.projectId)).toMatchObject({ trusted: false, revision: 2 });
  expect(() => reopened.executeCommand(grant)).toThrow('project-trust-conflict');
  expect(f.reopen().projectTrust(f.project.projectId)).toMatchObject({ trusted: false, revision: 2 });
});

test('fresh consent succeeds but delayed/reordered grant and revoke commands cannot cross revisions', () => {
  const f = fixture(), id = f.project.projectId;
  f.store.executeCommand(consent(id, true, 0));
  f.store.executeCommand(consent(id, false, 1));
  const reopened = f.reopen();
  expect(() => reopened.executeCommand(consent(id, true, 0))).toThrow('project-trust-conflict');
  reopened.executeCommand(consent(id, true, 2));
  expect(() => reopened.executeCommand(consent(id, false, 1))).toThrow('project-trust-conflict');
  expect(reopened.projectTrust(id)).toMatchObject({ trusted: true, revision: 3 });
  reopened.executeCommand(consent(id, false, 3));
  expect(f.reopen().projectTrust(id)).toMatchObject({ trusted: false, revision: 4 });
});

test('even unchanged-state consent advances the durable fence against pending authorization', () => {
  const f = fixture(), id = f.project.projectId, delayed = consent(id, true, 0);
  f.store.executeCommand(consent(id, false, 0));
  expect(f.reopen().projectTrust(id)).toMatchObject({ trusted: false, revision: 1 });
  expect(() => f.store.executeCommand(delayed)).toThrow('project-trust-conflict');
  f.store.executeCommand(consent(id, true, 1));
  f.store.executeCommand(consent(id, true, 2));
  expect(f.reopen().projectTrust(id)).toMatchObject({ trusted: true, revision: 3 });
});

test('retained exact retries remain idempotent but cannot substitute fresh revision consent', () => {
  const f = fixture(), id = f.project.projectId, grant = consent(id, true, 0, 'stable');
  f.store.executeCommand(grant);
  f.store.executeCommand(consent(id, false, 1));
  expect(f.store.executeCommand(grant).duplicate).toBe(true);
  expect(f.store.projectTrust(id)).toMatchObject({ trusted: false, revision: 2 });
  expect(() => f.store.executeCommand({ ...grant, expectedRevision: 2 })).toThrow('command-id-reused');
});

test('legacy persisted grants survive migration; revisionless commands never mutate or replay authority', () => {
  const f = fixture(), file = join(f.state, 'projects.json'), stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.projects[0].opencodeTrust = { trusted: true, revision: 7 };
  stored.registrations.legacy = {
    type: 'project.trust', fingerprint: JSON.stringify(['project.trust', f.project.projectId, 'opencode', true]),
    data: { project: f.project },
  };
  writeFileSync(file, JSON.stringify(stored));
  const store = f.reopen();
  expect(store.projectTrust(f.project.projectId)).toMatchObject({ trusted: true, revision: 7 });
  for (const [commandId, trusted] of [['legacy', true], ['missing-receipt', false]] as const) expect(() => store.executeCommand({
    type: 'project.trust', projectId: f.project.projectId, runnerId: 'opencode', trusted, commandId,
  } as any)).toThrow('project-trust-invalid');
  store.executeCommand(consent(f.project.projectId, false, 7));
  expect(f.reopen().projectTrust(f.project.projectId)).toMatchObject({ trusted: false, revision: 8 });
});
