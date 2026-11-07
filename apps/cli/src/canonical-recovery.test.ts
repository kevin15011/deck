import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { guardRunnerAdapter } from './runner-mutation-admission';
import { getDefaultDeckConfig, readRunnerFence } from '@deck/core';

// Protects restart convergence through the public CLI guard and actual adapters.
// Oracle: accepted canonical recovery design; a killed process has no rollback closure.
// Fails if journal bytes authorize output, scope is lost, or admission precedes repair.
// Global target recovery republishes and verifies ten times; its 30s limit allows
// the suite's four-worker integration load. Other cases retain their 15s limit.
for (const runner of ['pi', 'claude'] as const) for (const scope of ['global', 'project'] as const) for (const retryBoundary of ['target', 'archive', 'verify'] as const) test(`${runner} canonical recovery after real child ${retryBoundary} termination (${scope})`, async () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-canonical-crash-')));
 try {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'canonical-recovery.fixture.ts'), root, runner, 'target', scope], { stdout: 'pipe', stderr: 'pipe' });
  const code = await child.exited;
  const errors = await new Response(child.stderr).text();
  expect(code, errors).not.toBe(0);
  expect(child.signalCode, errors).toBe('SIGKILL');
  if (retryBoundary !== 'target') {
   const retry = Bun.spawn([process.execPath, join(import.meta.dir, 'canonical-recovery.fixture.ts'), root, runner, retryBoundary, scope], { stdout: 'pipe', stderr: 'pipe' });
   await retry.exited;
   expect(retry.signalCode, await new Response(retry.stderr).text()).toBe('SIGKILL');
  }
  const path = join(root, 'fence.json'), agent = join(root, 'agent'), projectRoot = scope === 'global' ? agent : join(root, 'project');
  expect(readRunnerFence(path)).toHaveProperty('pending');
  const raw = runner === 'pi' ? createPiRunnerAdapter({ homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: agent }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) }) : createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, 'deck') });
  const guarded = guardRunnerAdapter(raw, async effect => effect(), undefined, { path, self: { semver: '0.14.0', commit: 'retry', channel: 'stable' }, stateSchema: 1 });
  const input = { projectRoot, environmentId: `${runner}-development`, deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const before = readFileSync(path, 'utf8');
  if (runner === 'pi' && scope === 'project') {
   await expect(guarded.prepareSessionNativeRole!('deck-quality', input.deckConfig)).rejects.toThrow('project-scope-required');
   expect(readFileSync(path, 'utf8')).toBe(before);
  }
  if (retryBoundary === 'target') {
   const pendingPath = runner === 'pi' ? join(agent, 'deck/transaction.pending.json') : join(root, 'deck/claude/manifest.json.pending');
   const bytes = readFileSync(pendingPath, 'utf8'), journal = JSON.parse(bytes);
   const foreign = join(root, 'foreign'); writeFileSync(foreign, 'foreign sentinel');
   if (runner === 'pi') journal.targets[0].path = foreign;
   else journal.targets[0].target.path = foreign;
   writeFileSync(pendingPath, JSON.stringify(journal));
   await expect(guarded.applyDeveloperTeamInstall({ ...input, plan: guarded.buildDeveloperTeamInstallPlan(input) })).rejects.toThrow('target-untrusted');
   expect(readFileSync(path, 'utf8')).toBe(before);
   expect(readFileSync(foreign, 'utf8')).toBe('foreign sentinel');
   writeFileSync(pendingPath, bytes);
   if (runner === 'pi' && scope === 'project') {
    const wrong = join(root, 'other-project'); mkdirSync(wrong);
    const wrongInput = { ...input, projectRoot: wrong };
    await expect(guarded.applyDeveloperTeamInstall({ ...wrongInput, plan: guarded.buildDeveloperTeamInstallPlan(wrongInput) })).rejects.toThrow('project-scope-required');
    expect(readFileSync(path, 'utf8')).toBe(before);
   }
   // Canonical publication alone cannot commit while ordinary admission refuses.
   const admission = raw.evaluateSessionAdmission!.bind(raw);
   raw.evaluateSessionAdmission = () => ({ verdict: 'blocked', checks: [] });
   for (let attempt = 0; attempt < (scope === 'global' ? 10 : 1); attempt++) {
    await expect(guarded.applyDeveloperTeamInstall({ ...input, plan: guarded.buildDeveloperTeamInstallPlan(input) })).rejects.toThrow('verification-failed');
    const failed = readRunnerFence(path);
    if (!failed || failed === 'unreadable') throw new Error('Lost recovery binding');
    expect(failed.pending?.journals?.length).toBeLessThanOrEqual(3);
    expect(failed.pending?.journals?.[0]?.kind).toBe('canonical-recovery-v1');
    expect(failed.pending?.journals?.[1]?.kind).toBe('deck-scope-v1');
   }
   raw.evaluateSessionAdmission = admission;
  }
  const plan = guarded.buildDeveloperTeamInstallPlan(input);
  await guarded.applyDeveloperTeamInstall({ ...input, plan });
  expect((await raw.evaluateSessionAdmission!()).verdict).toBe('admit');
  expect(readRunnerFence(path)).not.toHaveProperty('pending');
  expect(existsSync(runner === 'pi' ? join(agent, 'deck/transaction.pending.json') : join(root, 'deck/claude/manifest.json.pending'))).toBe(false);
 } finally { rmSync(root, { recursive: true, force: true }); }
}, scope === 'global' && retryBoundary === 'target' ? 30000 : 15000);
