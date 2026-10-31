import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { inspectOpenCodeNativeSearch } from './native-search';
import { TAVILY_PROVIDER_DESCRIPTOR } from '@deck/provider-tavily';
import { createOpenCodeRunnerAdapter } from './runner-adapter';
import { writeOpenCodeWebSearchMcpConfig } from './web-search';

test('interactive reopen selects current native/fallback route without editing shared config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-interactive-'));
  const environment = { OPENCODE_ENABLE_EXA: '1', TAVILY_API_KEY: 'fixture-only' };
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, sessionDriver: { baseEnv: environment }, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR });
  const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
  const input = { projectRoot: root, mode: 'interactive' as const, teamId: 'developer-team', deckConfig };
  try {
    expect(writeOpenCodeWebSearchMcpConfig({ configPath: join(root, 'opencode.json'), provider: TAVILY_PROVIDER_DESCRIPTOR }).ok).toBe(true);
    const before = readFileSync(join(root, 'opencode.json'), 'utf8');
    let launch = await adapter.buildLaunchPlan!(input);
    expect(launch.status).toBe('ready');
    if (launch.status !== 'ready') throw new Error('launch');
    expect(JSON.parse(launch.plan.envOverlay!.OPENCODE_CONFIG_CONTENT!.value).mcp['web-search'].enabled).toBe(false);
    environment.OPENCODE_ENABLE_EXA = '0';
    launch = await adapter.buildLaunchPlan!(input);
    expect(launch.status).toBe('ready');
    if (launch.status !== 'ready') throw new Error('launch');
    expect(JSON.parse(launch.plan.envOverlay!.OPENCODE_CONFIG_CONTENT!.value).mcp['web-search'].enabled).toBe(true);
    expect(launch.plan.envOverlay?.TAVILY_API_KEY).toEqual({ value: 'fixture-only', sensitive: true });
    expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toBe(before);
    writeFileSync(join(root, 'opencode.json'), JSON.stringify({ mcp: { 'web-search': { type: 'local', command: ['user-search'] } } }));
    environment.OPENCODE_ENABLE_EXA = '1';
    launch = await adapter.buildLaunchPlan!(input);
    expect(launch.diagnostics.some(item => item.code === 'web-search-unresolved-existing-route-preserved')).toBe(true);
    if (launch.status === 'ready') expect(launch.plan.envOverlay?.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a higher priority user search entry is never suppressed using a lower priority Deck receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-search-origin-'));
  try {
    expect(writeOpenCodeWebSearchMcpConfig({ configPath: join(root, 'opencode.json'), provider: TAVILY_PROVIDER_DESCRIPTOR }).ok).toBe(true);
    const search = inspectOpenCodeNativeSearch({ projectRoot: root, environment: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { 'web-search': { type: 'local', command: ['user-search'] } } }) } }, root);
    expect(search.ownedFallbackServerIds).toBeUndefined();
    expect(search.unresolvedFallbackServerIds).toEqual(['web-search']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('interactive selection preserves an existing inline authority rule when it disables Deck search', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-inline-authority-'));
  try {
    const content = JSON.stringify({ model: 'opencode/big-pickle', permission: 'deny', mcp: { personal: { type: 'local', command: ['personal-tool'] } } });
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, sessionDriver: { baseEnv: { OPENCODE_CONFIG_CONTENT: content } } });
    const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
    const launch = await adapter.buildLaunchPlan!({ projectRoot: root, mode: 'interactive', teamId: 'developer-team', deckConfig });
    expect(launch.status).toBe('ready');
    if (launch.status === 'ready') expect(JSON.parse(launch.plan.envOverlay!.OPENCODE_CONFIG_CONTENT!.value)).toEqual(JSON.parse(content));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
