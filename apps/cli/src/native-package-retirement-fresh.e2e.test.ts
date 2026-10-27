import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, validContributionHash, readContribution, contributionHash, type RunnerAdapter } from '@deck/core';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { createOpenCodeRunnerAdapter } from '../../../packages/adapter-opencode/src/runner-adapter';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
import { resolveSessionChildMcp } from './session-shared-services';
for (const runner of ['codex', 'claude', 'opencode', 'pi']) test(`${runner}: fresh defaults install, repeat, granular receipts and managed preparation`, async () => {
  const home = mkdtempSync(join(tmpdir(), `deck-retirement-${runner}-`));
  const root = runner === 'claude' ? join(home, 'data/deck/claude') : join(home, runner);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const adapter: RunnerAdapter = runner === 'codex' ? createCodexRunnerAdapter({ userHome: home, codexHome: root, tools: { homeDir: home, dataRoot: join(home, 'data/deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } })
    : runner === 'claude' ? createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, 'data/deck') })
    : runner === 'opencode' ? createOpenCodeRunnerAdapter({ developerTeamConfigDir: root })
    : createPiRunnerAdapter({ homeDirectory: home, env: { HOME: home, PI_CODING_AGENT_DIR: root }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  const input = { projectRoot: home, environmentId: `${runner}-development` as never, deckConfig: getDefaultDeckConfig() };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  expect(plan.blocked ?? false).toBe(false);
  for (const file of plan.files) expect(/\bserena\b|context[- ]mode/i.test(file.content), file.path).toBe(false);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
  const manifestPath = runner === 'claude' ? join(root, 'manifest.json') : join(root, 'deck/manifest.json');
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  expect(manifest.contributions.length).toBeGreaterThan(10);
  for (const contribution of manifest.contributions) {
    expect(validContributionHash(contribution.hash)).toBe(true);
    expect(contribution.path.startsWith(home)).toBe(true);
    const bytes = readContribution(contribution);
    expect(bytes).toBeDefined();
    expect(contribution.hash).toBe(contributionHash(bytes!));
  }
  expect(manifest.contributions.some((entry: any) => /codebase-memory|context-mode|serena/.test(entry.sourceItemId ?? ''))).toBe(false);
  expect(manifestText).not.toContain('0'.repeat(64));
  const repeated = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: repeated });
  expect((await adapter.verifyDeveloperTeamInstall(repeated)).valid).toBe(true);
  expect(readFileSync(manifestPath, 'utf8')).toBe(manifestText);
  if (runner !== 'pi') {
    let readinessCalls = 0;
    const resolver = await resolveSessionChildMcp(adapter, input.deckConfig, {}, {
      context: { projectRoot: home, sessionId: 'fresh', taskId: runner, signal: new AbortController().signal },
      readiness: { ensure: async () => { readinessCalls++; throw new Error('Default must not prepare Codebase Memory'); }, release: async () => {} } as never,
    });
    expect(readinessCalls).toBe(0);
    expect(resolver.runnerPackages(runner)).not.toContain('codebase-memory');
    expect(resolver.runnerPackages(runner)).not.toContain('context-mode');
    expect(resolver.runnerPackages(runner)).not.toContain('serena');
    await resolver.release?.();
  }
}, 120000);
