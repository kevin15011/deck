import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, recordOwnedRunnerArtifactTree, readRunnerContributions, readContribution, contributionHash, type RunnerAdapter } from '@deck/core';
import { createOpenCodeRunnerAdapter } from '@deck/adapter-opencode';
import { runRunnerSync as runRunnerSyncActual } from './runner-sync';

for (const effect of ['none', 'unrelated', 'edit'] as const) test(`real OpenCode runner-sync rollback and retry (${effect})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-rollback-'));
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
  const config = getDefaultDeckConfig();
  const installInput = { projectRoot: root, environmentId: 'opencode-development' as const, deckConfig: config };
  try {
    const initial = adapter.buildDeveloperTeamInstallPlan(installInput);
    await adapter.applyDeveloperTeamInstall({ ...installInput, plan: initial });
    const manifestPath = join(root, 'deck/manifest.json'), prompt = join(root, 'prompts/deck-team/deck-lead.md');
    const beforeManifest = readFileSync(manifestPath, 'utf8'), beforePrompt = readFileSync(prompt, 'utf8');
    config.orchestratorPersonality = 'guia';
    let postApplyManifest = '';
    const failed = new Proxy(adapter, { get(target, key) {
      if (key === 'verifyDeveloperTeamInstall') return () => {
        if (effect === 'unrelated') {
          const artifact = join(root, 'deck/external-tool'); writeFileSync(artifact, 'independent package');
          recordOwnedRunnerArtifactTree({ runnerId: 'opencode', root, manifestPath, artifactRoot: artifact, sourceItemId: 'external-tool' });
          const path = join(root, 'opencode.json'), value = JSON.parse(readFileSync(path, 'utf8')); value.personal = { setting: 'user-added-during-apply' }; writeFileSync(path, JSON.stringify(value));
        }
        if (effect === 'edit') writeFileSync(prompt, 'intervening user edit');
        postApplyManifest = readFileSync(manifestPath, 'utf8');
        return { valid: false, diagnostics: ['fixture verification failure'] };
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const registry = (selected: RunnerAdapter) => ({ has: () => true, get: () => selected, list: () => [selected] });
    const result = await runRunnerSync({ config, registry: registry(failed), projectRoot: root, deckVersion: 'test', runnerIds: ['opencode'] });
    expect(result.outcomes[0]!.status).toBe('failed');
    if (effect === 'edit') {
      expect(result.outcomes[0]!.diagnostics.join(' ')).toContain('rollback');
      expect(readFileSync(prompt, 'utf8')).toBe('intervening user edit');
      expect(readFileSync(manifestPath, 'utf8')).toBe(postApplyManifest);
      const retry = adapter.buildDeveloperTeamInstallPlan(installInput);
      await expect(adapter.applyDeveloperTeamInstall({ ...installInput, plan: retry })).rejects.toThrow('Owned contribution changed');
      return;
    }
    expect(readFileSync(prompt, 'utf8')).toBe(beforePrompt);
    if (effect === 'none') expect(readFileSync(manifestPath, 'utf8')).toBe(beforeManifest);
    else {
      expect(JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8')).personal.setting).toBe('user-added-during-apply');
      expect(readRunnerContributions(manifestPath)!.contributions.some(entry => entry.sourceItemId === 'external-tool')).toBe(true);
    }
    for (const entry of readRunnerContributions(manifestPath)!.contributions) expect(contributionHash(readContribution(entry)!)).toBe(entry.hash);
    const retry = await runRunnerSync({ config, registry: registry(adapter), projectRoot: root, deckVersion: 'test', runnerIds: ['opencode'] });
    expect(retry.outcomes[0]!.status).toBe('synced');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);

function runRunnerSync(input: Parameters<typeof runRunnerSyncActual>[0]) { return runRunnerSyncActual({...input,retirement:false,mutationAdmission:async effect=>effect()}); }
