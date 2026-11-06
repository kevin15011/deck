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

// Protects Developer Team entry: native startup must select Lead even when the
// user's OpenCode default is Build or another primary agent. The launch must
// leave shared defaults intact and retain an explicitly selected model.
test('Developer Team interactive launch selects Lead without changing native defaults', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-lead-'));
  try {
    const configPath = join(root, 'opencode.json');
    const before = JSON.stringify({ default_agent: 'build' });
    writeFileSync(configPath, before);
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, sessionDriver: { baseEnv: {} } });
    const input = { projectRoot: root, mode: 'interactive' as const, teamId: 'developer-team', modelId: 'fixture/model', deckConfig: getDefaultDeckConfig() };
    const launch = await adapter.buildLaunchPlan!(input);
    expect(launch.status).toBe('ready');
    if (launch.status !== 'ready') throw new Error('launch');
    expect(launch.plan.args).toEqual([root, '--agent', 'deck-lead', '--model', 'fixture/model']);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    const other = await adapter.buildLaunchPlan!({ ...input, teamId: 'custom-team' });
    expect(other.status).toBe('ready');
    if (other.status === 'ready') expect(other.plan.args).not.toContain('--agent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects search admission against disagreement between the native default and
// the launched agent, without changing foreign configuration or model precedence.
for (const leadNative of [true, false]) {
  test(`interactive search follows selected agent (Lead native=${leadNative})`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-opencode-selected-search-'));
    try {
      const native = 'opencode/big-pickle', fallback = 'anthropic/claude-sonnet';
      const before = JSON.stringify({ default_agent: 'build', agent: {
        build: { model: leadNative ? fallback : native },
        'deck-lead': { model: leadNative ? native : fallback },
      }, mcp: { personal: { type: 'local', command: ['personal-tool'] } } });
      writeFileSync(join(root, 'opencode.json'), before);
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, sessionDriver: { baseEnv: {} }, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR });
      const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
      const input = { projectRoot: root, mode: 'interactive' as const, teamId: 'developer-team', deckConfig };
      expect((await adapter.buildLaunchPlan!(input)).status).toBe(leadNative ? 'ready' : 'blocked');
      expect((await adapter.buildLaunchPlan!({ ...input, teamId: 'custom-team' })).status).toBe(leadNative ? 'blocked' : 'ready');
      expect((await adapter.buildLaunchPlan!({ ...input, modelId: native })).status).toBe('ready');
      const blocked = await adapter.buildLaunchPlan!({ ...input, modelId: fallback });
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') expect(blocked.code).toBe('web-search-fallback-unavailable');
      expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// Protects first native startup: OpenCode adds its schema when absent. Canonical
// installation must prevent that write from revoking the captured generation.
test('canonical install keeps generation stable across first native schema initialization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-cold-generation-'));
  try {
    const configRoot = join(root, 'config');
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configRoot, skillDiscoveryHomeDir: root });
    const input = { projectRoot: root, environmentId: 'opencode-development', deckConfig: getDefaultDeckConfig() };
    const plan = adapter.buildDeveloperTeamInstallPlan(input);
    await adapter.applyDeveloperTeamInstall({ ...input, plan });
    const before = adapter.readPreparationGeneration!();
    const path = join(configRoot, 'opencode.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    if (!config.$schema) writeFileSync(path, JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...config }));
    expect(adapter.readPreparationGeneration!()).toBe(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
