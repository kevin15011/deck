import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, readRunnerFence } from '@deck/core';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { guardRunnerAdapter } from './runner-mutation-admission';
import { previewExplicitCodexRecovery } from './explicit-codex-recovery';

// Protects: new scoped recovery preserves unproven evidence and foreign data, rejects
// concurrent changes, and blocks launch until verification or explicit retry succeeds.
// Oracle: explicit adoption starts a new operation and preserves all prior evidence.
// No empty reference set is interpreted as proof of successful historical effects.
for (const boundary of ['success', 'concurrent', 'verification', 'interruption'] as const) test(`explicit Codex recovery: ${boundary}`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-explicit-recovery-')));
 try {
  const codexHome = join(home, '.codex'), path = join(home, 'state/fence.json');
  mkdirSync(join(home, 'state'), { mode: 0o700 }); mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), 'model = "foreign-model"\n[foreign]\nvalue = "preserved"\n');
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome, journalRoot: join(home, 'journals'), tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const self = { semver: '0.14.0', commit: 'recovery', channel: 'canary' as const };
  const fence = { path, self, stateSchema: 1 };
  const prior = JSON.stringify({ fenceSchema: 1, stateSchema: 1, epoch: 4, writer: self, pending: { epoch: 5, writer: self, stateSchema: 1, journals: [] } }) + '\n';
  writeFileSync(path, prior, { mode: 0o600 });
  const input = { projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const foreign = join(home, '.agents/skills/foreign/SKILL.md');
  mkdirSync(join(home, '.agents/skills/foreign'), { recursive: true }); writeFileSync(foreign, 'foreign sentinel');
  const auth = join(codexHome, 'auth.json'); writeFileSync(auth, 'private sentinel', { mode: 0o600 });
  mkdirSync(join(home, 'journals'), { mode: 0o700 });
  const damaged = Buffer.from([255, 0, 123]);
  writeFileSync(join(home, 'journals/00000000-0000-0000-0000-000000000000.json'), damaged, { mode: 0o600 });
  const ordinaryAdmission = adapter.evaluateSessionAdmission!.bind(adapter);
  const apply = adapter.applyDeveloperTeamInstall.bind(adapter);
  if (boundary === 'interruption') adapter.applyDeveloperTeamInstall = async () => { throw new Error('interrupted before target'); };
  const preview = await previewExplicitCodexRecovery(adapter, input, fence, async effect => effect());
  expect(readFileSync(path, 'utf8')).toBe(prior);
  expect(existsSync(preview.archivePath)).toBe(false);
  expect(preview.targets.length).toBeGreaterThan(0);
  if (boundary === 'concurrent') {
   writeFileSync(join(codexHome, 'config.toml'), 'model = "concurrent"\n');
   await expect(preview.apply()).rejects.toThrow();
   expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain('concurrent');
   expect(readRunnerFence(path)).toHaveProperty('pending');
  } else {
   if (boundary === 'verification') adapter.evaluateSessionAdmission = async () => ({ verdict: 'blocked', checks: [] });
   if (boundary === 'interruption') await expect(preview.apply()).rejects.toThrow('interrupted');
   else if (boundary === 'verification') await expect(preview.apply()).rejects.toThrow('verification-failed');
   else await preview.apply();
   const archive = JSON.parse(readFileSync(preview.archivePath, 'utf8'));
   expect(archive.originalBytes).toBe(prior);
   expect(archive.journalEvidence[0].base64).toBe(damaged.toString('base64'));
   expect(archive.disposition).toBe('superseded-unproven');
   const current = readRunnerFence(path);
   if (!current || current === 'unreadable') throw new Error('Missing fence');
   expect(current.epoch).toBe(boundary === 'success' ? 6 : 5);
   expect(!!current.pending).toBe(boundary !== 'success');
   expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain('value = "preserved"');
   if (boundary === 'verification') {
    adapter.evaluateSessionAdmission = ordinaryAdmission;
    const guarded = guardRunnerAdapter(adapter, async effect => effect(), undefined, fence);
    await expect(guarded.prepareSessionNativeRole!('deck-quality', input.deckConfig)).rejects.toThrow('runner-write-recovery-required');
    await expect(guarded.prepareSessionNativeRole!('deck-quality')).rejects.toThrow('runner-write-recovery-required');
    await expect(guarded.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: input.deckConfig })).rejects.toThrow('runner-write-recovery-required');
   }
   if (boundary === 'interruption') {
    adapter.applyDeveloperTeamInstall = apply;
    const retry = await previewExplicitCodexRecovery(adapter, input, fence, async effect => effect());
    await retry.apply();
    expect(readRunnerFence(path)).not.toHaveProperty('pending');
    expect(JSON.parse(readFileSync(retry.archivePath, 'utf8')).disposition).toBe('superseded-unproven');
   }
  }
  expect(readFileSync(foreign, 'utf8')).toBe('foreign sentinel');
  expect(readFileSync(auth, 'utf8')).toBe('private sentinel');
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Protects: a killed writer retains durable evidence and can recover in a fresh process.
// Oracle: canonical recovery settles only after independently verifying the new scope.
test('explicit recovery survives process death after a real target rename', async () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-explicit-crash-')));
 try {
  const path = join(root, 'state/fence.json'), self = { semver: '0.14.0', commit: 'recovery', channel: 'canary' as const };
  mkdirSync(join(root, 'state'), { mode: 0o700 }); mkdirSync(join(root, '.codex'));
  writeFileSync(path, JSON.stringify({ fenceSchema: 1, stateSchema: 1, epoch: 4, writer: self, pending: { epoch: 5, writer: self, stateSchema: 1, journals: [] } }), { mode: 0o600 });
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'explicit-codex-recovery.fixture.ts'), root], { stdout: 'pipe', stderr: 'pipe' });
  await child.exited;
  expect(child.signalCode, await new Response(child.stderr).text()).toBe('SIGKILL');
  expect(readRunnerFence(path)).toHaveProperty('pending');
  const adapter = createCodexRunnerAdapter({ userHome: root, codexHome: join(root, '.codex'), journalRoot: join(root, 'journals'), tools: { homeDir: root, dataRoot: join(root, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const preview = await previewExplicitCodexRecovery(adapter, { projectRoot: root, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] }, { path, self, stateSchema: 1 }, async effect => effect());
  await preview.apply();
  expect(readRunnerFence(path)).not.toHaveProperty('pending');
  const archived = JSON.parse(readFileSync(preview.archivePath, 'utf8'));
  expect(archived.journalEvidence.length).toBeGreaterThan(0);
  expect(JSON.parse(archived.originalBytes)).toHaveProperty('pending');
 } finally { rmSync(root, { recursive: true, force: true }); }
}, 15000);
