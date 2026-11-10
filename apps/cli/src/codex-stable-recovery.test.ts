import { expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { RunnerDashboardScreens } from './tui/screens/runner-dashboard-screens';
import { createDefaultRunnerDashboardState, type RunnerReviewPlan } from './tui/runner-dashboard/state';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, readRunnerFence, type RunnerAdapter } from '@deck/core';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { guardRunnerAdapter, prepareReviewedRunnerRecovery, applyReviewedRunnerRecovery } from './runner-mutation-admission';
import { acquireInstallationUse } from '../../../packages/core/src/installation-use';
import { runRunnerReviewPlan } from './tui/runner-dashboard/action-runner';
import { runRunnerLaunch } from './runner-launch-command';

// Protects the stable installer dead end: an unproven operation must be preserved,
// then superseded by a verified, explicitly reviewed installation. Empty references
// are never historical proof; foreign files and damaged evidence must survive.
test('reviewed Codex installation recovers unproven stable state and admits subsequent actions', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-stable-recovery-')));
 try {
  const codexHome = join(home, '.codex'), path = join(home, 'state/fence.json');
  mkdirSync(codexHome); mkdirSync(join(home, 'state'), {mode: 0o700}); mkdirSync(join(home, 'journals'), {mode: 0o700});
  writeFileSync(join(codexHome, 'config.toml'), 'model = "foreign"\n[foreign]\nvalue = "keep"\n');
  writeFileSync(join(codexHome, 'auth.json'), 'private sentinel', {mode: 0o600});
  const journal = join(home, 'journals/00000000-0000-0000-0000-000000000000.json');
  writeFileSync(journal, 'damaged evidence', {mode: 0o600});
  const self = {semver: '0.15.1', commit: '2ff95a7', channel: 'stable' as const};
  const prior = JSON.stringify({fenceSchema: 1, stateSchema: 1, epoch: 1, writer: self, pending: {epoch: 2, writer: self, stateSchema: 1, journals: []}}) + '\n';
  writeFileSync(path, prior, {mode: 0o600});
  const raw = createCodexRunnerAdapter({userHome: home, codexHome, journalRoot: join(home, 'journals'), tools: {homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true}});
  const adapter = guardRunnerAdapter(raw, async effect => effect(), undefined, {path, self, stateSchema: 1});
  const input = {projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [], recoverIncompleteOperation: true as const};
  // Seed the prior installed generation without replaying hundreds of unrelated
  // durable writes. Recovery must repair a genuinely missing managed role.
  const installedPlan = raw.buildDeveloperTeamInstallPlan(input);
  for (const file of installedPlan.files) {
   const target = join(home, file.path);
   mkdirSync(dirname(target), {recursive: true});
   writeFileSync(target, file.content, {mode: 0o644});
  }
  rmSync(join(codexHome, 'agents/deck-quality.toml'));
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  const backup = adapter.backupDeveloperTeamFiles(plan);
  expect(readFileSync(path, 'utf8')).toBe(prior);
  await adapter.applyDeveloperTeamInstall({...input, plan});
  expect(readRunnerFence(path)).not.toHaveProperty('pending');
  expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
  expect(backup.payload).toBeDefined();
  const archives = readdirSync(join(home, 'state/recovery-archive'));
  const archive = JSON.parse(readFileSync(join(home, 'state/recovery-archive', archives[0]!), 'utf8'));
  expect(archive.originalBytes).toBe(prior);
  expect(Buffer.from(archive.journalEvidence[0].base64, 'base64').toString()).toBe('damaged evidence');
  expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain('value = "keep"');
  expect(readFileSync(join(codexHome, 'auth.json'), 'utf8')).toBe('private sentinel');
  // A rejected replay is a known no-effect failure, not a new incomplete operation.
  const committed = readFileSync(path, 'utf8');
  await expect(adapter.applyDeveloperTeamInstall({...input, plan})).rejects.toThrow('already applied');
  expect(readFileSync(path, 'utf8')).toBe(committed);
  const record = JSON.parse(committed);
  writeFileSync(path, JSON.stringify({...record, pending: {epoch: record.epoch + 1, writer: self, stateSchema: 1, journals: []}}), {mode: 0o600});
  const pending = readFileSync(path, 'utf8');
  // The dashboard preflight must respect active native users before any adoption.
  const use = acquireInstallationUse(codexHome);
  try { await expect(applyReviewedRunnerRecovery(prepareReviewedRunnerRecovery(adapter, emptyReview(), input, true))).rejects.toThrow('refresh deferred'); }
  finally {use.release();}
  expect(readFileSync(path, 'utf8')).toBe(pending);
  const evaluate = raw.evaluateSessionAdmission!.bind(raw);
  raw.evaluateSessionAdmission = async () => ({verdict: 'blocked', checks: []});
  await expect(applyReviewedRunnerRecovery(prepareReviewedRunnerRecovery(adapter, emptyReview(), input, true))).rejects.toThrow('verification-failed');
  expect(readRunnerFence(path)).toHaveProperty('pending');
  await expect(adapter.prepareSessionNativeRole!('deck-quality')).rejects.toThrow('recovery-required');
  raw.evaluateSessionAdmission = evaluate;
  // A new reviewed retry recovers the interrupted recovery, including no-drift state.
  await applyReviewedRunnerRecovery(prepareReviewedRunnerRecovery(adapter, emptyReview(), input, true));
  expect(readRunnerFence(path)).not.toHaveProperty('pending');
  expect((await adapter.evaluateSessionAdmission!()).verdict).toBe('admit');

 } finally {rmSync(home, {recursive: true, force: true});}
}, 30000);

// Protects a predictable refusal from poisoning an otherwise idle installation.
// Oracle: blocked plans have no authorized effects and must refuse before fencing.
test('a blocked reviewed plan does not create stale pending state', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-blocked-plan-')));
 try {
  const path = join(home, 'fence.json');
  const raw = createCodexRunnerAdapter({userHome: home, codexHome: join(home, '.codex'), journalRoot: join(home, 'journals'), tools: {homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true}});
  const adapter = guardRunnerAdapter(raw, async effect => effect(), undefined, {path, self: {semver: '0.15.1', commit: 'stable', channel: 'stable'}, stateSchema: 1});
  const input = {projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), modelAssignments: {'deck-quality': 'unconfirmed'}};
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  expect(plan.blocked).toBe(true);
  await expect(adapter.applyDeveloperTeamInstall({...input, plan})).rejects.toThrow();
  expect(readRunnerFence(path)).toBeUndefined();
 } finally {rmSync(home, {recursive: true, force: true});}
});

// Protects compatibility and concurrency before explicit adoption. The original
// fence bytes remain the oracle: rejection must not archive, mutate or downgrade.
for (const fault of ['newer-writer', 'pending-writer', 'newer-schema', 'pending-schema', 'unknown-journal', 'changed-fence'] as const) test(`reviewed recovery preserves ${fault}`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-recovery-refusal-')));
 try {
  const path = join(home, 'state/fence.json');
  mkdirSync(join(home, 'state'), {mode: 0o700});
  const self = {semver: '0.15.1', commit: 'stable', channel: 'stable' as const};
  const record = {fenceSchema: 1, epoch: 4, stateSchema: fault === 'newer-schema' ? 2 : 1,
   writer: {...self, semver: fault === 'newer-writer' ? '9.0.0' : self.semver},
   pending: {epoch: 5, stateSchema: fault === 'pending-schema' ? 2 : 1,
    writer: {...self, semver: fault === 'pending-writer' ? '9.0.0' : self.semver},
    journals: fault === 'unknown-journal' ? [{kind: 'foreign', id: 'unknown', operationId: 'unknown'}] : []}};
  writeFileSync(path, JSON.stringify(record), {mode: 0o600});
  const raw = createCodexRunnerAdapter({userHome: home, codexHome: join(home, '.codex'), journalRoot: join(home, 'journals'), tools: {homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true}});
  const adapter = guardRunnerAdapter(raw, async effect => effect(), undefined, {path, self, stateSchema: 1});
  const input = {projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [], recoverIncompleteOperation: true as const};
  const before = readFileSync(path, 'utf8');
  if (fault === 'changed-fence') {
   const plan = adapter.buildDeveloperTeamInstallPlan(input);
   const changed = JSON.stringify({...record, writer: {...self, commit: 'concurrent'}});
   writeFileSync(path, changed, {mode: 0o600});
   await expect(adapter.applyDeveloperTeamInstall({...input, plan})).rejects.toThrow('fence-changed');
   expect(readFileSync(path, 'utf8')).toBe(changed);
  } else {
   expect(() => adapter.buildDeveloperTeamInstallPlan(input)).toThrow();
   expect(readFileSync(path, 'utf8')).toBe(before);
  }
  expect(readdirSync(join(home, 'state'))).toEqual(['fence.json']);
 } finally {rmSync(home, {recursive: true, force: true});}
});

// Protects CLI confirmation even when the installation has no file drift.
// Oracle: archiving/superseding an operation requires explicit user adoption.
for (const confirmed of [false, true]) test(`CLI recovery without file drift requires confirmation (${confirmed})`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-recovery-confirm-')));
 let writes = 0;
 try {
  const adapter = {runnerId: 'codex', displayName: 'Codex', environmentIds: ['codex-development'],
   readModelAssignments: () => ({}), readThinkingAssignments: () => ({}),
   buildDeveloperTeamInstallPlan: (input: {recoverIncompleteOperation?: true}) => {
    expect(input.recoverIncompleteOperation).toBe(true);
    return {files: [], mutationPreview: [], recovery: {archivePath: join(home, 'archive.json')}};
   },
   backupDeveloperTeamFiles: () => ({}),
   applyDeveloperTeamInstall: async () => {writes++; return {results: [], changedCount: 0, unchangedCount: 0};},
   verifyDeveloperTeamInstall: async () => ({valid: true, diagnostics: []}),
  } as unknown as RunnerAdapter;
  const result = await runRunnerLaunch({adapter, installOnly: true, interactive: true,
   launch: {projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: getDefaultDeckConfig()},
   presentPreview: async () => {}, confirm: async () => confirmed,
   processEffects: {inheritedEnv: {HOME: home}, spawn: async () => {throw Error('must not launch');}},
  });
  expect(writes).toBe(confirmed ? 1 : 0);
  expect(result.status).toBe(confirmed ? 'installed' : 'blocked');
 } finally {rmSync(home, {recursive: true, force: true});}
});

// Protects user scope: confirming only tools must explain the prerequisite and never apply team content.
test('tool-only Review & Install blocks with an actionable recovery prerequisite', async () => {
 let writes = 0;
 const adapter = {runnerId: 'codex',
  buildDeveloperTeamInstallPlan: () => ({files: [], recovery: {archivePath: '/unused'}}),
  applyDeveloperTeamInstall: async () => {writes++;},
 } as unknown as RunnerAdapter;
 const review = prepareReviewedRunnerRecovery(adapter, emptyReview(), {projectRoot: '/unused', environmentId: 'codex-development', deckConfig: getDefaultDeckConfig()}, false);
 expect(review.ready).toBe(false);
 await applyReviewedRunnerRecovery(review);
 expect(writes).toBe(0);
});

function emptyReview(): import('./tui/runner-dashboard/state').RunnerReviewPlan {
 return {ready: true, diagnostics: [], groups: {automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: []}};
}

// Protects the production dashboard composition: review precedes effects, freshness
// and cancellation precede recovery, first installation creates config, and real
// Context7 installation actions can execute afterward. Only the package acquisition
// edge is fake; adapter, fence, transaction, review runner and verification are real.
test('dashboard reviewed recovery installs absent configuration and Context7 and is idempotent', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-dashboard-recovery-')));
 try {
  const codexHome = join(home, '.codex'), path = join(home, 'state/fence.json');
  mkdirSync(codexHome); mkdirSync(join(home, 'state'), {mode: 0o700});
  writeFileSync(join(codexHome, 'auth.json'), 'preserve credentials', {mode: 0o600});
  const self = {semver: '0.15.1', commit: '2ff95a7', channel: 'stable' as const};
  const prior = JSON.stringify({fenceSchema: 1, stateSchema: 1, epoch: 1, writer: self, pending: {epoch: 2, writer: self, stateSchema: 1, journals: []}});
  writeFileSync(path, prior, {mode: 0o600});
  let acquisitions = 0;
  const raw = createCodexRunnerAdapter({userHome: home, codexHome, journalRoot: join(home, 'journals'), tools: {
   homeDir: home, dataRoot: join(home, 'deck'), nodeCommand: process.execPath, verifyNodeRuntime: () => true,
   npmArtifactEffects: {acquire: async stage => {
    acquisitions++;
    const pkg = join(stage, 'node_modules/@upstash/context7-mcp');
    mkdirSync(pkg, {recursive: true});
    writeFileSync(join(pkg, 'cli.js'), 'canonical package fixture', {mode: 0o700});
    mkdirSync(join(stage, 'node_modules/.bin'));
    symlinkSync('../@upstash/context7-mcp/cli.js', join(stage, 'node_modules/.bin/context7-mcp'));
   }},
  }});
  const adapter = guardRunnerAdapter(raw, async effect => effect(), undefined, {path, self, stateSchema: 1});
  const input = {projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: ['context7']};
  // Model interruption after content writes but before config creation. Seed only
  // unrelated already-written content to avoid hundreds of redundant fsyncs.
  for (const file of raw.buildDeveloperTeamInstallPlan(input).files) {
   const target = join(home, file.path);
   if (target === join(codexHome, 'config.toml')) continue;
   mkdirSync(dirname(target), {recursive: true});
   writeFileSync(target, file.content, {mode: 0o644});
  }
  const state = createDefaultRunnerDashboardState({runnerScope: 'codex', screen: 'review-plan', selectedCapabilities: {context7: true},
   teams: {'developer-team': {teamId: 'developer-team', label: 'Developer Team', selected: true}}});
  const inventory = await adapter.getCapabilityInventory({...input, runnerId: 'codex'});
  // Other required prerequisites are already satisfied; their acquisition is outside this incident.
  for (const capability of inventory.capabilities) if (capability.capabilityId !== 'context7') Object.assign(capability, {isInstalled: true, isBlocked: false});
  const buildReview = () => prepareReviewedRunnerRecovery(adapter,
   adapter.buildReviewPlan({runnerId: 'codex', environmentId: input.environmentId, selectedCapabilities: {context7: true}, packageInstructions: {}, teams: state.teams}, inventory) as RunnerReviewPlan, input, true);
  const review = buildReview();
  state.plan = review; state.planGeneratedForRevision = state.planRevision;
  const rendered = renderToString(React.createElement(RunnerDashboardScreens, {state}), {columns: 2000});
  expect(rendered).toContain('recovery-archive');
  expect(rendered).toContain(join(codexHome, 'config.toml'));
  expect(review.recoveryPreview?.targets.some(t => t.path === join(codexHome, 'config.toml'))).toBe(true);
  expect(review.recoveryPreview?.archivePath).toContain('recovery-archive');
  expect(readFileSync(path, 'utf8')).toBe(prior);
  const controller = new AbortController(); controller.abort();
  const dependencies = {beforeActions: () => applyReviewedRunnerRecovery(review), signal: controller.signal};
  expect(await runRunnerReviewPlan(review, dependencies)).toEqual([]);
  expect(readFileSync(path, 'utf8')).toBe(prior);
  const stale = await runRunnerReviewPlan(review, {beforeActions: dependencies.beforeActions,
   dashboardState: {plan: review, planGeneratedForRevision: 1, planRevision: 2} as never});
  expect(stale[0]?.status).toBe('failed');
  expect(readFileSync(path, 'utf8')).toBe(prior);
  const execute = (plan: RunnerReviewPlan) => runRunnerReviewPlan(plan, {projectRoot: home, runnerId: 'codex', dashboardState: state,
   beforeActions: () => applyReviewedRunnerRecovery(plan), runnerAdapter: adapter,
   installTeamBundle: async (_root, options) => {
    const native = adapter.buildDeveloperTeamInstallPlan({...input, capabilityIds: options?.capabilityIds});
    const result = await adapter.applyDeveloperTeamInstall({...input, plan: native});
    expect((await adapter.verifyDeveloperTeamInstall(native)).valid).toBe(true);
    return {...result, results: [...result.results]};
   },
  });
  const results = await execute(review);
  expect(results.filter(r => r.status === 'failed')).toEqual([]);
  expect(results.find(r => r.actionId === 'codex.tool.context7.install')?.status).toBe('executed');
  expect(acquisitions).toBe(1);
  expect(readRunnerFence(path)).not.toHaveProperty('pending');
  expect(Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8'))).toBeDefined();
  expect(readFileSync(join(codexHome, 'auth.json'), 'utf8')).toBe('preserve credentials');
  expect((await adapter.evaluateSessionAdmission!()).verdict).toBe('admit');
  expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain('mcp_servers.context7');
  const settled = readFileSync(path, 'utf8');
  const second = buildReview(); state.plan = second;
  const repeated = await execute(second);
  expect(repeated.filter(r => r.status === 'failed')).toEqual([]);
  expect(adapter.buildDeveloperTeamInstallPlan(input).mutationPreview).toEqual([]);
  expect(acquisitions).toBe(1);
  expect(readFileSync(path, 'utf8')).toBe(settled);
 } finally {rmSync(home, {recursive: true, force: true});}
}, 30000);
