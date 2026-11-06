import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core';
import { buildDeveloperTeamInstallPlan, applyDeveloperTeamInstall, rollbackDeveloperTeamFiles, cleanupNestedSkillDirectories } from './developer-team-install';
import { createPiRunnerAdapter } from './runner-adapter';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pi-retirement-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const adapter = () => createPiRunnerAdapter({ homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
const input = () => ({ projectRoot: join(root, 'project'), environmentId: 'pi-development', deckConfig: getDefaultDeckConfig() });

// Protects suppression of the old unleased writer, including callers of the capabilities facade.
test('deprecated apply refuses before writing project output, even with a global layout', () => {
  for (const layout of [undefined, { packageRoot: join(root, 'agent/deck/package') }]) {
    const plan = buildDeveloperTeamInstallPlan(join(root, 'project'), { layout });
    expect(() => applyDeveloperTeamInstall(plan)).toThrow(/PiRunnerAdapter/);
  }
  expect(existsSync(join(root, 'project'))).toBe(false);
  expect(existsSync(join(root, 'agent'))).toBe(false);
  const sentinel = join(root, 'sentinel'); put(sentinel, 'preserve');
  expect(() => rollbackDeveloperTeamFiles({ entries: [{ absolutePath: sentinel, previousContent: 'forged' }] })).toThrow(/PiRunnerAdapter/);
  expect(readFileSync(sentinel, 'utf8')).toBe('preserve');
  const nested = join(root, 'SKILL.md/SKILL.md'); put(nested, 'ambiguous');
  expect(() => cleanupNestedSkillDirectories(root)).toThrow(/PiRunnerAdapter/);
  expect(readFileSync(nested, 'utf8')).toBe('ambiguous');
});

// Oracle: exact Deck role/profile identities retire; source, sessions and ambiguous generic skills survive.
test('public install retires exact legacy project outputs and privately backs up edited bytes', async () => {
  const project = input().projectRoot;
  const role = join(project, '.pi/agents/deck-lead.md');
  const skill = join(project, '.pi/skills/deck-lead/SKILL.md');
  const profile = join(project, '.deck/pi/profiles/developer-team/system-prompt.md');
  const keep = ['.pi/agents/custom.md', '.pi/skills/frontend-design/SKILL.md', '.pi/skills/deck-lead/notes.md', '.deck/pi/sessions/developer-team/session.json', 'source.ts'];
  for (const path of [role, skill, profile]) put(path, 'edited generated output');
  for (const path of keep) put(join(project, path), 'preserve');
  const runner = adapter();
  const plan = runner.buildDeveloperTeamInstallPlan(input());
  expect(plan.blocked).toBe(false);
  expect(plan.mutationPreview?.some(change => change.path === role && change.action === 'delete')).toBe(true);
  await runner.applyDeveloperTeamInstall({ ...input(), plan });
  for (const path of [role, skill, profile]) expect(existsSync(path)).toBe(false);
  for (const path of keep) expect(readFileSync(join(project, path), 'utf8')).toBe('preserve');
  const backups = new Bun.Glob('**/*.json').scanSync(join(root, 'agent/deck/backups'));
  expect([...backups].some(path => readFileSync(join(root, 'agent/deck/backups', path), 'utf8').includes(Buffer.from('edited generated output').toString('base64')))).toBe(true);
  expect(runner.buildDeveloperTeamInstallPlan(input()).mutationPreview).toHaveLength(0);
});

test('a symlinked legacy project leaf blocks before any global write', () => {
  put(join(root, 'outside'), 'preserve');
  const path = join(input().projectRoot, '.pi/agents/deck-lead.md');
  mkdirSync(dirname(path), { recursive: true }); symlinkSync(join(root, 'outside'), path);
  const plan = adapter().buildDeveloperTeamInstallPlan(input());
  expect(plan.blocked).toBe(true);
  expect(readFileSync(join(root, 'outside'), 'utf8')).toBe('preserve');
  expect(existsSync(join(root, 'agent/deck/package'))).toBe(false);
});

// Deprecated compatibility routes must not resurrect retired output.
test('legacy CLI and capabilities facade refuse installation without creating profiles', async () => {
  const { runPiLaunch } = await import('../../../apps/cli/src/pi-launch-command');
  const { createPiRunnerCapabilities } = await import('./runner-capabilities');
  const result = await runPiLaunch({ teamId: 'developer-team', projectRoot: input().projectRoot, flags: {}, deckConfig: getDefaultDeckConfig(), commandExists: () => true, dryRun: true });
  expect(result.status).toBe('error');
  const facade = createPiRunnerCapabilities();
  await expect(facade.teams.applyDeveloperTeamInstall({ ...input(), plan: { files: [] } })).rejects.toThrow(/PiRunnerAdapter/);
  expect(existsSync(join(input().projectRoot, '.deck'))).toBe(false);
});

// Protects failed-invocation rollback and later canonical recovery under matching project authority.
for (const concurrent of [false, true]) test(`guarded Pi repair ${concurrent ? 'preserves concurrent edits until canonical retry' : 'proves rollback and refreshes on retry'}`, async () => {
  const { guardRunnerAdapter } = await import('../../../apps/cli/src/runner-mutation-admission');
  const { readRunnerFence } = await import('@deck/core');
  const { createNodePiFileIO } = await import('./pi-global-install');
  const base = createNodePiFileIO();
  let armed = false, count = 0;
  let first: string | undefined;
  const io = { ...base, writeText(path: string, content: string, mode?: number) {
    if (armed && path.includes('/agents/')) {
      if (++count === 1) first = path;
      if (count === 2) {
        armed = false;
        if (concurrent) base.writeText(first!, 'external concurrent edit');
        throw new Error('injected second replacement failure');
      }
    }
    base.writeText(path, content, mode);
  } };
  const runner = createPiRunnerAdapter({ piFileIO: io, homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  mkdirSync(input().projectRoot, { recursive: true });
  let plan = runner.buildDeveloperTeamInstallPlan(input());
  await runner.applyDeveloperTeamInstall({ ...input(), plan });
  const agents = plan.files.filter(file => file.path.includes('/agents/')).slice(0, 2);
  for (const file of agents) put(file.path, 'edited generated');
  const fencePath = join(root, 'fence.json');
  const guarded = guardRunnerAdapter(runner, async effect => effect(), undefined, { path: fencePath, self: { semver: '0.14.0', commit: 'test', channel: 'stable' }, stateSchema: 1 });
  plan = guarded.buildDeveloperTeamInstallPlan(input());
  armed = true;
  await expect(guarded.applyDeveloperTeamInstall({ ...input(), plan })).rejects.toThrow('injected second');
  if (concurrent) {
    expect(base.readText(first!)).toBe('external concurrent edit');
    expect(existsSync(join(root, 'agent/deck/transaction.pending.json'))).toBe(true);
    await guarded.applyDeveloperTeamInstall({ ...input(), plan });
    expect(base.readText(first!)).toBe(agents.find(file => file.path === first)!.content);
    expect(existsSync(join(root, 'agent/deck/transaction.pending.json'))).toBe(false);
  } else {
    for (const file of agents) expect(base.readText(file.path)).toBe('edited generated');
    await guarded.prepareSessionNativeRole!('deck-setup', input().deckConfig);
    expect((readRunnerFence(fencePath) as { pending?: unknown }).pending).toBeUndefined();
    expect(runner.readManagedContentDrift!(input().deckConfig)).toBe(false);
  }
}, 15000);

// Protects retry after a proven no-effect abort, using the production fence and real files.
for (const failure of ['stale', 'capacity', 'settings-symlink']) test(`guarded Pi ${failure} preflight can retry after correction`, async () => {
  const { guardRunnerAdapter } = await import('../../../apps/cli/src/runner-mutation-admission');
  const role = join(input().projectRoot, '.pi/agents/deck-lead.md');
  const preimage = failure === 'capacity' ? randomBytes(13 * 1024 * 1024).toString('base64') : 'old generated';
  put(role, preimage);
  const settings = join(input().projectRoot, '.pi/settings.json');
  if (failure === 'settings-symlink') {
    put(join(input().projectRoot, '.agents/skills/helper/SKILL.md'), '---\nname: helper\n---\npersonal');
    put(settings, '{}');
  }
  const runner = adapter();
  const guarded = guardRunnerAdapter(runner, async effect => effect(), undefined, { path: join(root, 'fence.json'), self: { semver: '0.14.0', commit: 'test', channel: 'stable' }, stateSchema: 1 });
  const installInput = { ...input(), ...(failure === 'settings-symlink' ? { standaloneSkills: [{ skillId: 'helper', body: '---\nname: helper\n---\ncanonical' }] } : {}) };
  let plan = guarded.buildDeveloperTeamInstallPlan(installInput);
  if (failure === 'stale') put(role, 'changed after planning');
  if (failure === 'settings-symlink') { rmSync(settings); put(join(root, 'outside'), '{}'); symlinkSync(join(root, 'outside'), settings); }
  await expect(guarded.applyDeveloperTeamInstall({ ...input(), plan })).rejects.toThrow(failure === 'settings-symlink' ? 'symlink' : failure);
  expect(readFileSync(role, 'utf8')).toBe(failure === 'stale' ? 'changed after planning' : preimage);
  // Recovery proves the unchanged failed operation before accepting the corrected plan.
  if (failure === 'capacity') put(role, 'bounded generated');
  if (failure === 'settings-symlink') { rmSync(settings); put(settings, '{}'); }
  plan = guarded.buildDeveloperTeamInstallPlan(installInput);
  await guarded.applyDeveloperTeamInstall({ ...input(), plan });
  expect(existsSync(role)).toBe(false);
}, 15000);

// Protects concurrent permission changes during rollback before a separately authorized canonical retry.
for (const concurrentMode of [false, true]) test(`guarded Pi rollback ${concurrentMode ? 'preserves concurrent chmod' : 'restores private retired profile mode'}`, async () => {
  const { guardRunnerAdapter } = await import('../../../apps/cli/src/runner-mutation-admission');
  const { createNodePiFileIO } = await import('./pi-global-install');
  const profile = join(input().projectRoot, '.deck/pi/profiles/developer-team/system-prompt.md');
  put(profile, 'private generated profile'); chmodSync(profile, 0o600);
  const base = createNodePiFileIO();
  let armed = true;
  const io = { ...base, writeText(path: string, content: string, mode?: number) {
    if (armed && path.endsWith('/deck/manifest.json')) {
      armed = false;
      if (concurrentMode) { put(profile, 'private generated profile'); chmodSync(profile, 0o640); }
      throw new Error('injected manifest failure');
    }
    base.writeText(path, content, mode);
  } };
  const runner = createPiRunnerAdapter({ piFileIO: io, homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  const guarded = guardRunnerAdapter(runner, async effect => effect(), undefined, { path: join(root, 'fence.json'), self: { semver: '0.14.0', commit: 'test', channel: 'stable' }, stateSchema: 1 });
  let plan = guarded.buildDeveloperTeamInstallPlan(input());
  await expect(guarded.applyDeveloperTeamInstall({ ...input(), plan })).rejects.toThrow('injected manifest failure');
  expect(readFileSync(profile, 'utf8')).toBe('private generated profile');
  expect(statSync(profile).mode & 0o777).toBe(concurrentMode ? 0o640 : 0o600);
  plan = guarded.buildDeveloperTeamInstallPlan(input());
  await guarded.applyDeveloperTeamInstall({ ...input(), plan }); expect(existsSync(profile)).toBe(false);
}, 15000);

// Protects: rollback proof rechecks metadata; a distinct canonical retry uses matching project authority.
test('guarded Pi rejects stale chmod proof then canonically regenerates', async () => {
  const { guardRunnerAdapter } = await import('../../../apps/cli/src/runner-mutation-admission');
  const { createNodePiFileIO } = await import('./pi-global-install');
  const profile = join(input().projectRoot, '.deck/pi/profiles/developer-team/system-prompt.md');
  put(profile, 'private generated profile'); chmodSync(profile, 0o600);
  const base = createNodePiFileIO();
  let armed = true;
  const io = { ...base, writeText(path: string, content: string, mode?: number) {
    if (armed && path.endsWith('/deck/manifest.json')) { armed = false; throw new Error('injected manifest failure'); }
    base.writeText(path, content, mode);
  } };
  const runner = createPiRunnerAdapter({ piFileIO: io, homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  const guarded = guardRunnerAdapter(runner, async effect => effect(), undefined, { path: join(root, 'fence.json'), self: { semver: '0.14.0', commit: 'test', channel: 'stable' }, stateSchema: 1 });
  const plan = guarded.buildDeveloperTeamInstallPlan(input());
  await expect(guarded.applyDeveloperTeamInstall({ ...input(), plan })).rejects.toThrow('injected manifest failure');
  expect(statSync(profile).mode & 0o777).toBe(0o600);
  chmodSync(profile, 0o640);
  const retry = guarded.buildDeveloperTeamInstallPlan(input());
  const { readRunnerFence } = await import('@deck/core');
  const pending = readRunnerFence(join(root, 'fence.json'));
  if (!pending || pending === 'unreadable') throw new Error('Missing fixture fence');
  expect(await runner.recoverPendingMutation!(pending.pending!.journals!.filter(j => j.kind !== 'deck-scope-v1'))).toBeUndefined();
  expect(statSync(profile).mode & 0o777).toBe(0o640);
  expect(readFileSync(profile, 'utf8')).toBe('private generated profile');
  await guarded.applyDeveloperTeamInstall({ ...input(), plan: retry });
  expect(existsSync(profile)).toBe(false);
}, 15000);
