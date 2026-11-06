import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getDefaultDeckConfig, buildCapabilityInstructionBundle, type DashboardState } from '@deck/core';
import { getStandaloneSkills } from '@deck/core/skills/external';
import { TAVILY_PROVIDER_DESCRIPTOR } from '@deck/provider-tavily';
import { OPENCODE_RUNNER_CAPABILITY_IDS } from './capability-catalog';
import { createOpenCodeRunnerAdapter } from './runner-adapter';
import originals from './fixtures/legacy-opencode-content.json';
import externalBodies from './fixtures/legacy-skill-bodies.json';
import internalBodies from './fixtures/legacy-internal-bodies.json';
const bodies = { ...externalBodies, ...internalBodies };
const marker = '\n\n## Package Instructions (configured)\n';
const suffix = originals['skills/api-and-interface-design/SKILL.md'].split(marker)[1]!;
const preimages: Record<string, string> = { ...originals, ...Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, body + marker + suffix])) };

// Protects upgrades from known pre-receipt releases. The independent oracle is the
// historical renderer/source recorded in legacy-content.ts, not discovered local names.
// Altered bytes and content transplanted into another shared name must remain foreign.
test('public team install upgrades exact legacy bundles and preserves near matches', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-legacy-upgrade-'))), root = join(home, 'opencode');
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  try {
    process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, '.config');
    const ids = Object.keys(preimages).filter(path => path.startsWith('skills/')).map(path => path.split('/')[1]!);
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
    const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: 'tavily' };
    const state = { runnerId: 'opencode', environmentId: 'opencode-development', selectedCapabilities: { 'web-search': true, 'codebase-memory': true, rtk: true }, packageInstructions: { 'codebase-memory': true, 'code-economy': true, rtk: true }, teams: { 'developer-team': { selected: true } }, webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR } satisfies DashboardState & { teams: Record<string, { selected: boolean }> };
    const review = adapter.buildReviewPlan(state, { runnerId: 'opencode', environmentId: 'opencode-development', capabilities: OPENCODE_RUNNER_CAPABILITY_IDS.map(capabilityId => ({ capabilityId, label: capabilityId, description: '', section: 'runner-capabilities', requirementLevel: 'optional', installKind: 'runner-native', isBlocked: false, isInstalled: capabilityId !== 'web-search' })) });
    expect(review.groups.teamApplications.find(action => action.id === 'team.developer-team.apply')?.status).toBe('ready');
    expect(review.groups.configWrites.find(action => action.id === 'capability.web-search.mcp-config')?.status).toBe('ready');
    const build = () => adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: 'opencode-development', deckConfig: config, capabilityInstructions: buildCapabilityInstructionBundle(['codebase-memory', 'code-economy', 'rtk', 'web-search']) });
    for (const id of ids) {
      const path = join(root, 'skills', id, 'SKILL.md'); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, preimages[`skills/${id}/SKILL.md`]!);
      writeFileSync(join(dirname(path), 'personal.txt'), 'retain extra file');
    }
    const edited = join(root, 'skills', ids[0]!, 'SKILL.md'), original = readFileSync(edited, 'utf8');
    writeFileSync(edited, original + '\nuser edit');
    const denied = build();
    expect(denied.diagnosticEntries?.some(entry => entry.code === 'opencode-shared-skill-conflict')).toBe(true);
    expect(denied.files.some(file => file.path.startsWith(`skills/${ids[0]}/`))).toBe(false);
    expect(readFileSync(edited, 'utf8')).toBe(original + '\nuser edit');
    writeFileSync(edited, preimages['skills/ci-cd-and-automation/SKILL.md']);
    expect(build().diagnosticEntries?.some(entry => entry.code === 'opencode-shared-skill-conflict')).toBe(true);
    writeFileSync(edited, original);
    const plan = build();
    expect(plan.diagnosticEntries?.filter(entry => entry.severity === 'error') ?? []).toHaveLength(0);
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: 'opencode-development', plan });
    expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
    for (const id of ids) {
      expect(readFileSync(join(root, 'skills', id, 'personal.txt'), 'utf8')).toBe('retain extra file');
    }
    expect(build().mutationPreview).toHaveLength(0);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(home, { recursive: true, force: true });
  }
});

// Protects historical optional-package combinations, beyond the observed all-enabled
// fixture. Canonical historical fragments supply the oracle; edited suffixes refuse.
test('historical renderer subsets remain exact and slot-scoped', async () => {
  const { recognizeOpenCodeLegacyFile } = await import('./legacy-content');
  const { composeCapabilityInstructions } = await import('@deck/core');
  const sections = suffix.split(/(?=^## (?:Codebase Memory|Context Mode|RTK CLI Proxy) Package$)/m);
  const fragments = sections.slice(1).map(markdown => ({ packageId: 'rtk' as const, surface: 'skill' as const, markdown: markdown.trimEnd() }));
  expect(fragments).toHaveLength(3);
  for (const [path, body] of Object.entries(bodies)) {
    for (let mask = 1; mask < 8; mask++) {
      const rendered = composeCapabilityInstructions(body, { instructions: fragments.filter((_, bit) => mask & 1 << bit) }, { surface: 'skill', teamId: 'developer-team', skillId: path.split('/')[1] });
      expect(recognizeOpenCodeLegacyFile(path, rendered)).toBe(true);
      expect(recognizeOpenCodeLegacyFile(path, rendered + 'user edit')).toBe(false);
      expect(recognizeOpenCodeLegacyFile('skills/foreign/SKILL.md', rendered)).toBe(false);
    }
  }
});
