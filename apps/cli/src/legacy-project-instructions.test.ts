import { afterEach, expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectInstallRefresh, retireLegacyProjectInstructions } from './legacy-project-instructions';
import { acquireRegistryLease } from '../../../packages/core/src/skill-discovery/registry-lease';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture(source: string) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'deck-project-agents-'))); roots.push(root);
  const project = join(root, 'project'); fs.mkdirSync(project);
  const file = join(project, 'AGENTS.md'); fs.writeFileSync(file, source, { mode: 0o600 });
  return { root, project, file, options: { stateRoot: join(root, 'state'), lockRoot: join(root, 'locks') } };
}
const start = '<!-- deck:developer-team:start -->', end = '<!-- deck:developer-team:end -->';
// Oracle: only exact complete owned spans retire; every outside byte survives.
test('project retirement preserves outside bytes, modes, inputs and is idempotent', async () => {
  const prefix = '\uFEFF# Personal\r\n\r\n', between = '\r\nKeep me.\n\n', suffix = '\nUser tail';
  const source = `${prefix}${start}\r\nedited generated instructions\r\n${end}\r\n${between}${start}\nold instructions\n${end}\n${suffix}`;
  const { project, file, options } = fixture(source);
  for (const input of ['CLAUDE.md', '.mcp.json', 'session.json']) fs.writeFileSync(join(project, input), 'private input');
  const result = await retireLegacyProjectInstructions(project, options);
  expect(result).toEqual({ changed: true });
  expect(fs.readFileSync(file, 'utf8')).toBe(prefix + between + suffix);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  for (const input of ['CLAUDE.md', '.mcp.json', 'session.json']) expect(fs.readFileSync(join(project, input), 'utf8')).toBe('private input');
  const before = fs.statSync(file);
  expect(await retireLegacyProjectInstructions(project, options)).toEqual({ changed: false });
  expect(fs.statSync(file).ino).toBe(before.ino);
});
for (const source of [end, start, `${start}\n${start}\n${end}`, `${start}\n${end}\n${end}`, `prefix ${start}\n${end}`]) test(`malformed boundary preserves the whole document: ${JSON.stringify(source)}`, async () => {
  const { project, file, options } = fixture(source);
  const result = await retireLegacyProjectInstructions(project, options);
  expect(result.changed).toBe(false);
  expect(result.diagnostic).toMatch(/AGENTS.md.*line \d+/);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
});
test('project symlink and active project writer preserve instructions', async () => {
  const source = `${start}\nold\n${end}\n`, { root, project, file, options } = fixture(source);
  const lease = await acquireRegistryLease(project, { lockRoot: options.lockRoot });
  expect(lease.ok).toBe(true);
  try {
    const result = await retireLegacyProjectInstructions(project, options);
    expect(result.diagnostic).toContain('busy');
    expect(fs.readFileSync(file, 'utf8')).toBe(source);
  } finally { if (lease.ok) lease.lease.release(); }
  fs.renameSync(file, join(root, 'foreign'));
  fs.symlinkSync(join(root, 'foreign'), file);
  expect((await retireLegacyProjectInstructions(project, options)).diagnostic).toContain('unsafe');
  expect(fs.readFileSync(join(root, 'foreign'), 'utf8')).toBe(source);
});
test('concurrent replacement after backup preserves new bytes and private temporary writes', async () => {
  const source = `Keep\n${start}\nold\n${end}\n`, { project, file, options } = fixture(source);
  const write = fs.writeFileSync;
  let observed = false;
  const spy = spyOn(fs, 'writeFileSync').mockImplementation(((path: any, bytes: any, ...args: any[]) => {
    (write as any)(path, bytes, ...args);
    if (typeof path === 'number' && String(bytes) === 'Keep\n') {
      observed = true;
      expect(fs.fstatSync(path).mode & 0o777).toBe(0o600);
      write(file, 'concurrent user edit');
    }
  }) as typeof fs.writeFileSync);
  try {
    const result = await retireLegacyProjectInstructions(project, options);
    expect(observed).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.diagnostic).toContain('changed');
    expect(fs.readFileSync(file, 'utf8')).toBe('concurrent user edit');
  } finally { spy.mockRestore(); }
});

// Production shared callback + public guard: admission is required, then all runners
// reconcile the same project spans. Runner-native effects are replaced, not the writer.
for (const runnerId of ['claude', 'codex', 'opencode', 'pi']) test(`${runnerId} admitted public install retires project spans; denial and failure preserve them`, async () => {
  const { createAdapterRegistry } = await import('../../../packages/core/src/adapter-registry');
  const { guardRunnerAdapter } = await import('./runner-mutation-admission');
  const source = `User\n${start}\nold\n${end}\nTail`, { project, file, options } = fixture(source);
  const registry = createAdapterRegistry();
  let fail = false;
  const result = { changedCount: 1, unchangedCount: 0, results: [] };
  const adapter = { runnerId, environmentIds: [`${runnerId}-development`], applyDeveloperTeamInstall: async () => { if (fail) throw new Error('install failed'); return result; } } as unknown as import('@deck/core').RunnerAdapter;
  registry.register(runnerId, adapter);
  const refresh = createProjectInstallRefresh(registry, options);
  const denied = guardRunnerAdapter(adapter, async () => { throw new Error('busy'); }, refresh);
  await expect(denied.applyDeveloperTeamInstall({ projectRoot: project } as never)).rejects.toThrow('busy');
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  const admitted = guardRunnerAdapter(adapter, async effect => effect(), refresh);
  fail = true;
  await expect(admitted.applyDeveloperTeamInstall({ projectRoot: project } as never)).rejects.toThrow('install failed');
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  fail = false;
  expect(await admitted.applyDeveloperTeamInstall({ projectRoot: project } as never)).toBe(result);
  expect(fs.readFileSync(file, 'utf8')).toBe('User\nTail');
});
test('failed private backup preserves the original instructions', async () => {
  const source = `${start}\nold\n${end}\n`, { root, project, file, options } = fixture(source);
  fs.mkdirSync(join(root, 'foreign'));
  fs.symlinkSync(join(root, 'foreign'), options.stateRoot);
  expect((await retireLegacyProjectInstructions(project, options)).diagnostic).toContain('unsafe');
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  expect(fs.readdirSync(join(root, 'foreign'))).toEqual([]);
});

test('default CLI registry installs Codex and retires only the project-owned spans', async () => {
  const { createDefaultAdapterRegistry } = await import('./runner-adapters');
  const { getDefaultDeckConfig } = await import('@deck/core');
  const source = `Project guidance\n${start}\nedited\n${end}\n`, { root, project, file } = fixture(source);
  const registry = createDefaultAdapterRegistry({ codex: { userHome: root, codexHome: join(root, '.codex'), journalRoot: join(root, 'journals'), tools: { homeDir: root, dataRoot: join(root, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } } });
  const adapter = registry.get('codex');
  const input = { projectRoot: project, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), standaloneSkills: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  expect((await adapter.applyDeveloperTeamInstall({ ...input, plan })).changedCount).toBeGreaterThan(0);
  expect(fs.readFileSync(file, 'utf8')).toBe('Project guidance\n');
}, 15000);
