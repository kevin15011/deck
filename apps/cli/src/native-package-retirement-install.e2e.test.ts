import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, contributionId, validContributionHash, readContribution, contributionHash, applyPackageRetirement, recordRemovedRunnerContributions, type RunnerAdapter } from '@deck/core';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { createOpenCodeRunnerAdapter } from '../../../packages/adapter-opencode/src/runner-adapter';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
import { planRunnerCleanup } from './runner-cleanup-command';
for (const runner of ['codex', 'claude', 'opencode', 'pi']) test(`${runner}: clean candidate install and repeat verify actual granular manifest bytes`, async () => {
  const home = mkdtempSync(join(tmpdir(), `deck-retirement-${runner}-`));
  const root = runner === 'claude' ? join(home, 'data/deck/claude') : join(home, runner);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const adapter: RunnerAdapter = runner === 'codex' ? createCodexRunnerAdapter({ userHome: home, codexHome: root, tools: { homeDir: home, dataRoot: join(home, 'data/deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } })
    : runner === 'claude' ? createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, 'data/deck') })
    : runner === 'opencode' ? createOpenCodeRunnerAdapter({ developerTeamConfigDir: root })
    : createPiRunnerAdapter({ homeDirectory: home, env: { HOME: home, PI_CODING_AGENT_DIR: root }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  const input = { projectRoot: home, environmentId: `${runner}-development` as never, deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  expect(plan.blocked ?? false).toBe(false);
  for (const file of plan.files.filter(file => file.kind === 'agent' || file.path.endsWith('SKILL.md'))) expect(file.content).not.toMatch(/serena|context.mode/i);
  const first = await adapter.applyDeveloperTeamInstall({ ...input, plan });
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
  expect(manifestText).not.toContain('0'.repeat(64));
  const repeated = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: repeated });
  expect((await adapter.verifyDeveloperTeamInstall(repeated)).valid).toBe(true);
  expect(readFileSync(manifestPath, 'utf8')).toBe(manifestText);
  // Repair a missing owned agent through the default adapter, without altering surviving files.
  const agent = plan.files.find(file => file.kind === 'agent') ?? plan.files.find(file => file.path.endsWith('SKILL.md'))!;
  const actualAgentPath = manifest.contributions.find((entry: any) => entry.selector.kind === "file" && entry.hash === contributionHash(agent.content))!.path;
  unlinkSync(actualAgentPath);
  const repair = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repair.blocked ?? false).toBe(false);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: repair });
  expect(readFileSync(actualAgentPath, 'utf8')).toBe(agent.content);
  expect((await adapter.verifyDeveloperTeamInstall(repair)).valid).toBe(true);
  const cleanup = planRunnerCleanup({ home, data: join(home, 'data/deck'), codex: runner === 'codex' ? root : join(home,'codex'), opencode: runner === 'opencode' ? root : join(home,'opencode'), pi: runner === 'pi' ? root : join(home,'pi') }, [runner]);
  expect(cleanup.plans[0]!.entries).toHaveLength(0);
  // A recorded retired installation leaf is removed through the same per-runner accounting.
  const obsolete = join(root, 'deck/retired-installation.bin'); mkdirSync(join(root, 'deck'), { recursive: true });
  writeFileSync(obsolete, 'previous retired install');
  const target = { path: obsolete, selector: { kind: 'file' as const } };
  const receipt = { ...target, id: contributionId(target), hash: contributionHash('previous retired install'), sourceItemId: 'package:context-mode', ownership: 'prior-record', scope: 'global', encoding: 'bytes' };
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8')); previous.contributions.push(receipt); writeFileSync(manifestPath, JSON.stringify(previous));
  const roots = { home, data: join(home, 'data/deck'), codex: runner === 'codex' ? root : join(home, 'codex'), opencode: runner === 'opencode' ? root : join(home, 'opencode'), pi: runner === 'pi' ? root : join(home, 'pi') };
  const retirement = planRunnerCleanup(roots, [runner]).plans[0]!;
  expect(retirement.entries).toHaveLength(1);
  applyPackageRetirement(retirement, [], { manifestPath });
  expect(JSON.parse(readFileSync(manifestPath, 'utf8')).contributions.some((entry: any) => entry.id === receipt.id)).toBe(false);
  expect(planRunnerCleanup(roots, [runner]).plans[0]!.entries).toEqual([]);
}, 120000);
