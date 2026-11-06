import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { createClaudeRunnerAdapter } from './runner-adapter';

// Protects canonical regeneration without trusting prior bytes, and project input preservation.
// Oracle: approved managed-artifact policy; executable edits must be replaced before receipts.
test('Claude install repairs edited generated files without receipts and preserves project input', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-managed-')));
 try {
  const project = join(home, 'project'), dataRoot = join(home, 'deck');
  const inputs = ['.claude/settings.json', '.mcp.json', 'CLAUDE.md', 'AGENTS.md'];
  for (const file of inputs) { mkdirSync(dirname(join(project, file)), { recursive: true }); writeFileSync(join(project, file), 'foreign input\n'); }
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot });
  const input = { projectRoot: project, environmentId: 'claude-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const first = adapter.buildDeveloperTeamInstallPlan(input);
  expect(first.blocked).toBe(false);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: first });
  const edited = first.files.find(file => file.path.endsWith('/agents/deck-quality.md'))!;
  writeFileSync(edited.path, 'untrusted executable policy\n');
  rmSync(join(dataRoot, 'claude/manifest.json'));
  expect((await adapter.evaluateSessionAdmission!({})).verdict).not.toBe('admit');
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(true);
  const repair = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repair.blocked).toBe(false);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: repair });
  expect(readFileSync(edited.path, 'utf8')).toBe(edited.content);
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
  const backups = join(dataRoot, 'claude/backups/replaced');
  expect(readdirSync(backups).length).toBeGreaterThan(0);
  writeFileSync(join(dataRoot, 'claude/manifest.json'), '{invalid');
  await adapter.applyDeveloperTeamInstall({ ...input, plan: adapter.buildDeveloperTeamInstallPlan(input) });
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
  const second = adapter.buildDeveloperTeamInstallPlan(input);
  expect(second.mutationPreview?.length).toBe(0);
  await adapter.prepareSessionNativeSkills(input.deckConfig);
  for (const file of inputs) expect(readFileSync(join(project, file), 'utf8')).toBe('foreign input\n');
 } finally { rmSync(home, { recursive: true, force: true }); }
});

import { symlinkSync } from 'node:fs';
// Protects the path boundary and future-writer evidence during repair.
test('Claude generated repair refuses symlinks and newer ownership metadata', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-managed-guard-')));
 try {
  const dataRoot = join(home, 'deck'), adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot });
  const input = { projectRoot: home, environmentId: 'claude-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  const file = plan.files.find(file => file.path.endsWith('/agents/deck-quality.md'))!;
  const foreign = join(home, 'foreign'); writeFileSync(foreign, 'foreign'); rmSync(file.path); symlinkSync(foreign, file.path);
  expect(adapter.buildDeveloperTeamInstallPlan(input).blocked).toBe(true);
  expect(readFileSync(foreign, 'utf8')).toBe('foreign');
  rmSync(file.path); writeFileSync(file.path, file.content, { mode: 0o600 });
  const manifestPath = join(dataRoot, 'claude/manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.deckVersion = '999.0.0'; const bytes = JSON.stringify(manifest); writeFileSync(manifestPath, bytes);
  await expect(adapter.applyDeveloperTeamInstall({ ...input, plan: adapter.buildDeveloperTeamInstallPlan(input) })).rejects.toThrow('managed-by-newer-deck');
  expect(readFileSync(manifestPath, 'utf8')).toBe(bytes);
 } finally { rmSync(home, { recursive: true, force: true }); }
});

import { spyOn } from 'bun:test';
import * as fileEffects from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { guardRunnerAdapter } from '../../../apps/cli/src/runner-mutation-admission';
import { readRunnerFence, writePrivateState } from '@deck/core';

// Protects production refresh authority and fence settlement; oracle: design decisions 4–5.
for (const route of ['refresh', 'launch'] as const) for (const state of ['newer', 'pending', 'unreadable', 'drift'] as const) test(`Claude public ${route} respects ${state} writer fence`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-refresh-fence-')));
 try {
  const dataRoot = join(home, 'deck'), adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot });
  const config = getDefaultDeckConfig(), input = { projectRoot: home, environmentId: 'claude-development', deckConfig: config, capabilityIds: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  const file = plan.files.find(file => file.path.endsWith('/agents/deck-quality.md'))!;
  writeFileSync(file.path, 'edited policy');
  const path = join(home, 'fence.json'), self = { semver: '0.14.0', commit: 'test', channel: 'stable' as const };
  writePrivateState(path, { fenceSchema: 1, stateSchema: 1, epoch: 1, writer: state === 'newer' ? { ...self, semver: '999.0.0' } : self,
   ...(state === 'pending' ? { pending: { epoch: 2, writer: self, stateSchema: 1 } } : {}) });
  if (state === 'unreadable') writeFileSync(path, '{invalid');
  const before = readFileSync(path, 'utf8');
  let admissions = 0;
  const guarded = guardRunnerAdapter(adapter, async effect => { admissions++; return effect(); }, undefined, { path, self, stateSchema: 1 });
  const prepared = route === 'refresh' ? await guarded.prepareSessionNativeSkills!(config) : await guarded.buildLaunchPlan!({ mode: 'interactive', teamId: 'developer', projectRoot: home, deckConfig: config });
  if ('status' in prepared) expect(prepared.status).toBe('ready');
  if (state === 'drift') {
   expect(readFileSync(file.path, 'utf8')).toBe(file.content);
   expect(readRunnerFence(path)).toMatchObject({ epoch: 2 });
   expect((readRunnerFence(path) as { pending?: unknown }).pending).toBeUndefined();
   const settled = readFileSync(path, 'utf8');
   await guarded.prepareSessionNativeSkills!(config);
   expect(readFileSync(path, 'utf8')).toBe(settled);
  } else {
   expect(readFileSync(file.path, 'utf8')).toBe('edited policy');
   expect(readFileSync(path, 'utf8')).toBe(before);
   expect('status' in prepared ? prepared.diagnostics.some(item => item.code === 'claude-refresh-deferred') : prepared.preparation?.some(item => item.code === 'claude-refresh-deferred')).toBe(true);
  }
  expect(admissions).toBe(state === 'drift' ? 2 : 1);
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Protects validated choices and unrelated fields while receipts verify actual canonical bytes.
test('Claude normalizes compact selection bytes while preserving custom selection fields', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-selection-')));
 try {
  const dataRoot = join(home, 'deck'), adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot });
  const input = { projectRoot: home, environmentId: 'claude-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  await adapter.applyDeveloperTeamInstall({ ...input, plan: adapter.buildDeveloperTeamInstallPlan(input) });
  const path = join(dataRoot, 'claude/model-assignments.json'), selection = { ...JSON.parse(readFileSync(path, 'utf8')), custom: { keep: true } };
  writeFileSync(path, JSON.stringify(selection));
  await adapter.prepareSessionNativeSkills(input.deckConfig);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(selection);
  expect(existsSync(join(dataRoot, 'claude/manifest.json.pending'))).toBe(false);
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Protects rollback and retry: failed second replacement restores first; external edits remain pending.
for (const corrupt of [false, true]) for (const concurrent of ['none', 'output', 'manifest'] as const) test(`Claude ${corrupt ? 'corrupt-manifest' : 'valid-manifest'} in-place failure preserves ${concurrent === 'none' ? 'preimages and retry' : `external ${concurrent} edits and evidence`}`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-rollback-')));
 let fault: ReturnType<typeof spyOn> | undefined;
 try {
  const dataRoot = join(home, 'deck'), adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot });
  const input = { projectRoot: home, environmentId: 'claude-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  const files = plan.files.filter(file => file.path.includes('/agents/')).slice(0, 2);
  for (const file of files) writeFileSync(file.path, `edited ${file.path}`);
  const manifest = join(dataRoot, 'claude/manifest.json');
  if (corrupt) writeFileSync(manifest, '{invalid');
  const before = readFileSync(manifest, 'utf8');
  const fencePath = join(home, 'fence.json');
  const guarded = guardRunnerAdapter(adapter, async effect => effect(), undefined, { path: fencePath, self: { semver: '0.14.0', commit: 'test', channel: 'stable' }, stateSchema: 1 });
  const rename = fileEffects.rename;
  let count = 0;
  fault = spyOn(fileEffects, 'rename').mockImplementation(async (from, to) => {
   if (String(from).includes('.deck-repair-') && ++count === 2) {
    if (concurrent === 'output') writeFileSync(files[0]!.path, 'external concurrent edit');
    if (concurrent === 'manifest') writeFileSync(manifest, 'external concurrent manifest');
    throw new Error('injected second replacement failure');
   }
   return rename(from, to);
  });
  await expect(guarded.applyDeveloperTeamInstall({ ...input, plan: guarded.buildDeveloperTeamInstallPlan(input) })).rejects.toThrow();
  fault.mockRestore(); fault = undefined;
  if (concurrent === 'none') expect(readFileSync(manifest, 'utf8')).toBe(before);
  if (concurrent !== 'none') {
   if (concurrent === 'output') expect(readFileSync(files[0]!.path, 'utf8')).toBe('external concurrent edit');
   else expect(readFileSync(manifest, 'utf8')).toBe('external concurrent manifest');
   expect(existsSync(`${manifest}.pending`)).toBe(true);
   // A later authorized canonical recovery may replace changed managed output,
   // after the failed invocation has preserved it and its pending evidence.
   const retry = guarded.applyDeveloperTeamInstall({ ...input, plan: guarded.buildDeveloperTeamInstallPlan(input) });
   if (concurrent === 'manifest') await expect(retry).rejects.toThrow('recovery-required');
   else { await retry; expect(readFileSync(files[0]!.path, 'utf8')).toBe(files[0]!.content); }

  } else {
   for (const file of files) expect(readFileSync(file.path, 'utf8')).toBe(`edited ${file.path}`);
   expect(existsSync(`${manifest}.pending`)).toBe(false);
   await guarded.prepareSessionNativeSkills!(input.deckConfig);
   expect((readRunnerFence(fencePath) as { pending?: unknown }).pending).toBeUndefined();
   expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
  }
 } finally { fault?.mockRestore(); rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Protects active sessions: denied admission must use a verified prepared copy without repairing originals.
for (const route of ['refresh', 'launch'] as const) test(`Claude ${route} defers managed repair when production admission is busy`, async () => {
 const { RunnerMutationDeferredError } = await import('../../session-host/src/index');
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-refresh-busy-')));
 try {
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, 'deck') });
  const config = getDefaultDeckConfig(), input = { projectRoot: home, environmentId: 'claude-development', deckConfig: config, capabilityIds: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  const file = plan.files.find(file => file.path.endsWith('/agents/deck-quality.md'))!;
  writeFileSync(file.path, 'edited busy policy');
  const guarded = guardRunnerAdapter(adapter, async () => { throw new RunnerMutationDeferredError(); });
  const prepared = route === 'refresh' ? await guarded.prepareSessionNativeSkills!(config) : await guarded.buildLaunchPlan!({ mode: 'interactive', teamId: 'developer', projectRoot: home, deckConfig: config });
  if ('status' in prepared) expect(prepared.status).toBe('ready');
  expect(readFileSync(file.path, 'utf8')).toBe('edited busy policy');
  expect('status' in prepared ? prepared.diagnostics.some(item => item.code === 'claude-refresh-deferred') : prepared.preparation?.some(item => item.code === 'claude-refresh-deferred')).toBe(true);
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);
