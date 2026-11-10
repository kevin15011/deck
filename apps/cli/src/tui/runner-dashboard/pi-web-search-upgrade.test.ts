import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig, type DashboardState } from '@deck/core';
import { TAVILY_PROVIDER_DESCRIPTOR } from '@deck/provider-tavily';
import { createPiRunnerAdapter } from '@deck/adapter-pi';
import { createPiTools } from '../../../../../packages/adapter-pi/src/pi-owned-tools';
import { hashJsonValue } from '../../../../../packages/adapter-pi/src/pi-manifest';
import { normalizeDashboardCapabilityInventory } from './inventory';

// Protects the observed historical memory-env entry through public Dashboard planning
// and the manifest-owned install transaction. A same-name foreign server stays blocked.
// Owned cases publish the full durable package; conflict-only cases keep the default limit.
for (const scenario of ['historical', 'edited', 'invalid-receipt', 'foreign'] as const) test(`Pi Dashboard reconciles recorded Web Search: ${scenario}`, async () => {
  const owned = scenario === 'historical' || scenario === 'edited';
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pi-web-upgrade-')));
  const previousCredential = process.env.TAVILY_API_KEY;
  try {
    process.env.TAVILY_API_KEY = 'fixture-process-credential';
    const agent = join(home, '.pi/agent'), pi = join(home, 'pi'), npx = join(home, 'npx');
    mkdirSync(join(agent, 'deck'), { recursive: true });
    writeFileSync(pi, '#!/bin/sh\nif [ \"$1\" = --version ]; then echo 1.0.0; else printf \"No packages installed\\n\"; fi\n', { mode: 0o700 });
    writeFileSync(npx, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const legacy = { command: '/opt/homebrew/bin/npx', args: ['-y', 'tavily-mcp@0.2.22'], env: { DECK_RUNNER_MEMORY_ENDPOINT: '', DECK_RUNNER_MEMORY_TOKEN: '', DECK_RUNNER_MEMORY_TOKEN_FILE: '' }, exposure: 'direct' };
    const foreign = { command: 'personal', env: { PERSONAL_KEY: 'retain-fixture-value' } };
    const path = join(agent, 'mcp.json');
    writeFileSync(path, JSON.stringify({ personal: 'keep', mcpServers: { 'web-search': scenario === 'edited' ? { ...legacy, command: '/untrusted/edited-npx' } : legacy, personal: foreign } }));
    writeFileSync(join(agent, 'deck/manifest.json'), JSON.stringify({ schema: 'deck-pi-manifest-v1', files: {}, settings: { packages: [], addedPackages: [], skillExclusions: [] }, mcp: { servers: owned ? { 'web-search': hashJsonValue(legacy) } : scenario === 'invalid-receipt' ? { 'web-search': 'invalid' } : {} } }));
    const tools = createPiTools({ homeDir: home, env: { HOME: home }, dataRoot: join(home, 'data', 'deck'), resolveCommand: name => name === 'npx' ? npx : undefined });
    const adapter = createPiRunnerAdapter({ homeDirectory: home, env: { HOME: home }, piCommand: pi, piTools: tools, webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR });
    const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: 'tavily' };
    const input = { projectRoot: home, runnerId: 'pi', environmentId: 'pi-development', deckConfig: config };
    const inventory = await adapter.getCapabilityInventory(input);
    expect(normalizeDashboardCapabilityInventory(inventory, 'pi', 'pi-development')).toMatchObject({ ok: true });
    const state = { runnerId: 'pi', environmentId: 'pi-development', selectedCapabilities: { 'web-search': true }, packageInstructions: {}, webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR } as DashboardState;
    const review = adapter.buildReviewPlan(state, inventory);
    const action = Object.values(review.groups).flat().find(action => action.capabilityId === 'web-search' && action.kind === 'write-pi-mcp-config');
    expect(inventory.capabilities.find(entry => entry.capabilityId === 'web-search')?.webSearchEvidence?.mcpConfigConflict).toBe(!owned);
    expect(action).toBeDefined();
    expect(action?.status === 'blocked').toBe(!owned);
    const build = () => adapter.buildDeveloperTeamInstallPlan({ ...input, capabilityIds: ['web-search'] });
    const before = readFileSync(path, 'utf8'), plan = build();
    if (!owned) {
      expect(plan.diagnosticEntries?.some(entry => entry.code === 'PI_MCP_ENTRY_CONFLICT')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(before);
      return;
    }
    expect(plan.diagnosticEntries?.filter(entry => entry.severity === 'error') ?? []).toHaveLength(0);
    await adapter.applyDeveloperTeamInstall({ ...input, plan });
    expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.mcpServers.personal).toEqual(foreign);
    expect(after.personal).toBe('keep');
    expect(after.mcpServers['web-search']).toEqual({ command: npx, args: ['-y', 'tavily-mcp@0.2.22'], env: {}, exposure: 'direct' });
    expect(readFileSync(path, 'utf8')).not.toContain(process.env.TAVILY_API_KEY!);
    expect(build().mutationPreview).toHaveLength(0);
  } finally {
    if (previousCredential === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previousCredential;
    rmSync(home, { recursive: true, force: true });
  }
}, scenario === 'historical' || scenario === 'edited' ? 15000 : 5000);
