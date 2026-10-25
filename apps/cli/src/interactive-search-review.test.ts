import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig, nativeSearchEvidence, type RunnerAdapter } from '@deck/core';
import { buildReviewedInteractiveLaunch, reviewInteractiveSearchSessions } from './interactive-search-review';
import { executeRunnerLaunchPlan } from './runner-launch-command';

for (const runnerId of ['codex', 'claude', 'opencode']) test(`${runnerId}: interactive launch and doctor warn on changed effective search; planning and doctor stay read-only`, async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'deck-interactive-search-'));
  let mode = 'cached'; let model = 'openai/first';
  const adapter = { runnerId, displayName: runnerId, readModelAssignments: () => ({ 'deck-lead': model }),
    inspectNativeSearch: async (input: any) => nativeSearchEvidence(mode === 'disabled' ? 'unavailable' : 'available', 'effective-config', { mode, model: input.modelId }),
    buildLaunchPlan: async () => ({ status: 'ready', plan: { command: 'codex', args: [], cwd: stateRoot, stdin: 'inherit', stdio: 'inherit' }, diagnostics: [] }),
  } as unknown as RunnerAdapter;
  const deckConfig = getDefaultDeckConfig();
  const input = { mode: 'interactive' as const, projectRoot: stateRoot, teamId: 'developer-team', deckConfig };
  const options = { stateRoot, getAdapter: () => adapter };
  try {
    const first = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(first.status).toBe('ready');
    expect(readdirSync(stateRoot)).toEqual([]);
    if (first.status !== 'ready') throw new Error('launch');
    await executeRunnerLaunchPlan(first.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    const before = readFileSync(first.plan.interactiveSearchReview!.path, 'utf8');
    expect(await reviewInteractiveSearchSessions(deckConfig, stateRoot, options)).toEqual([]);
    mode = 'disabled';
    const warnings = await reviewInteractiveSearchSessions(deckConfig, stateRoot, options);
    expect(warnings[0]?.message).toContain('reopen');
    expect(readFileSync(first.plan.interactiveSearchReview!.path, 'utf8')).toBe(before);
    const next = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(next.diagnostics.some(item => item.code === 'interactive-search-reopen-required')).toBe(true);
    if (next.status !== 'ready') throw new Error('launch');
    await executeRunnerLaunchPlan(next.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    expect(await reviewInteractiveSearchSessions(deckConfig, stateRoot, options)).toEqual([]);
    model = 'openai/second';
    expect((await reviewInteractiveSearchSessions(deckConfig, stateRoot, options))[0]?.code).toBe('interactive-search-reopen-required');
  } finally { rmSync(stateRoot, { recursive: true, force: true }); }
});

test('Pi and managed/noninteractive launches do not use the interactive exception', async () => {
  const adapter = { runnerId: 'pi', buildLaunchPlan: async () => ({ status: 'ready', plan: {}, diagnostics: [] }) } as unknown as RunnerAdapter;
  const launch = await buildReviewedInteractiveLaunch(adapter, { mode: 'interactive', projectRoot: '/tmp', teamId: 'developer-team', deckConfig: getDefaultDeckConfig() });
  expect(launch.status === 'ready' && launch.plan.interactiveSearchReview).toBeUndefined();
});

test('a newly opened session does not hide the stale selection of another still-open CLI', async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'deck-search-concurrent-'));
  let mode = 'cached';
  const adapter = { runnerId: 'codex', readModelAssignments: () => ({}), inspectNativeSearch: async () => nativeSearchEvidence('available', 'effective-config', { mode }),
    buildLaunchPlan: async () => ({ status: 'ready', plan: { command: 'codex', args: [], cwd: stateRoot, stdin: 'inherit', stdio: 'inherit' }, diagnostics: [] }),
  } as unknown as RunnerAdapter;
  const deckConfig = getDefaultDeckConfig(); const options = { stateRoot, getAdapter: () => adapter };
  const input = { mode: 'interactive' as const, projectRoot: stateRoot, teamId: 'developer-team', deckConfig };
  const first = await buildReviewedInteractiveLaunch(adapter, input, options);
  if (first.status !== 'ready') throw new Error('launch');
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const running = executeRunnerLaunchPlan(first.plan, { inheritedEnv: {}, spawn: async () => { await held; return { exitCode: 0, stdout: '', stderr: '' }; } });
  try {
    mode = 'live';
    const next = await buildReviewedInteractiveLaunch(adapter, input, options);
    if (next.status !== 'ready') throw new Error('launch');
    await executeRunnerLaunchPlan(next.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    expect((await reviewInteractiveSearchSessions(deckConfig, stateRoot, options))[0]?.code).toBe('interactive-search-reopen-required');
    finish(); await running;
    expect(await reviewInteractiveSearchSessions(deckConfig, stateRoot, options)).toEqual([]);
  } finally { finish(); await running; rmSync(stateRoot, { recursive: true, force: true }); }
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { createOpenCodeRunnerAdapter } from '@deck/adapter-opencode';
import { TAVILY_PROVIDER_DESCRIPTOR } from '@deck/provider-tavily';
for (const excluded of [false, true]) test(`production OpenCode launch and stale review use native project admission (excluded: ${excluded})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-project-review-'));
  const global = join(root, 'global'), project = join(root, 'project'); mkdirSync(global); mkdirSync(project);
  const environment = { TAVILY_API_KEY: 'fixture-only', ...(excluded ? { OPENCODE_DISABLE_PROJECT_CONFIG: 'true' } : {}) };
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: global, sessionDriver: { baseEnv: environment }, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR });
  writeFileSync(join(global, 'opencode.json'), JSON.stringify({ model: 'anthropic/sonnet' }));
  writeFileSync(join(project, 'opencode.json'), JSON.stringify({ model: 'opencode/big-pickle' }));
  const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
  const input = { mode: 'interactive' as const, teamId: 'developer-team', projectRoot: project, deckConfig };
  const options = { stateRoot: root, getAdapter: () => adapter };
  try {
    const launch = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(launch.status).toBe('ready'); if (launch.status !== 'ready') throw new Error('launch');
    const mcp = launch.plan.envOverlay?.OPENCODE_CONFIG_CONTENT ? JSON.parse(launch.plan.envOverlay.OPENCODE_CONFIG_CONTENT.value).mcp : undefined;
    expect(mcp?.['web-search']?.enabled === true).toBe(excluded);
    await executeRunnerLaunchPlan(launch.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    expect(await reviewInteractiveSearchSessions(deckConfig, project, options)).toEqual([]);
    writeFileSync(join(project, 'opencode.json'), JSON.stringify({ model: 'anthropic/sonnet', tools: { websearch: false }, permission: { websearch: 'deny' } }));
    const warnings = await reviewInteractiveSearchSessions(deckConfig, project, options);
    expect(warnings.some(item => item.code === 'interactive-search-reopen-required')).toBe(!excluded);
    const reopen = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(reopen.status).toBe('ready');
    if (reopen.status === 'ready' && !excluded) expect(reopen.plan.envOverlay?.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const source of ['explicit', 'directory', 'inline', 'permission'] as const) test(`OpenCode production launch and both review entry points reread ${source} overrides`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-opencode-override-review-'));
  const global = join(root, 'global'), project = join(root, 'project'), override = join(root, 'override');
  for (const path of [global, project, override]) mkdirSync(path);
  writeFileSync(join(global, 'opencode.json'), JSON.stringify({ model: 'anthropic/sonnet' }));
  const environment: Record<string, string> = { TAVILY_API_KEY: 'fixture-only', OPENCODE_DISABLE_PROJECT_CONFIG: 'true' };
  const setPermission = (permission: string) => {
    const content = JSON.stringify({ permission: { websearch: permission } });
    if (source === 'explicit') { environment.OPENCODE_CONFIG = join(override, 'custom.json'); writeFileSync(environment.OPENCODE_CONFIG, content); }
    if (source === 'directory') { environment.OPENCODE_CONFIG_DIR = override; writeFileSync(join(override, 'opencode.json'), content); }
    if (source === 'inline') environment.OPENCODE_CONFIG_CONTENT = content;
    if (source === 'permission') environment.OPENCODE_PERMISSION = JSON.stringify({ websearch: permission });
  };
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: global, sessionDriver: { baseEnv: environment }, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR });
  const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
  const input = { mode: 'interactive' as const, teamId: 'developer-team', projectRoot: project, deckConfig };
  const options = { stateRoot: join(root, 'state'), getAdapter: () => adapter };
  try {
    setPermission('deny');
    const launch = await buildReviewedInteractiveLaunch(adapter, input, options);
    if (launch.status !== 'ready') throw new Error('launch');
    expect(launch.plan.envOverlay?.TAVILY_API_KEY).toBeUndefined();
    await executeRunnerLaunchPlan(launch.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    expect(await reviewInteractiveSearchSessions(deckConfig, project, options)).toEqual([]);
    setPermission('allow');
    expect((await reviewInteractiveSearchSessions(deckConfig, project, options)).some(d => d.code === 'interactive-search-reopen-required')).toBe(true);
    const next = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(next.status).toBe('ready');
    expect(next.diagnostics.some(d => d.code === 'interactive-search-reopen-required')).toBe(true);
    if (next.status === 'ready') expect(next.plan.envOverlay?.TAVILY_API_KEY?.value).toBe('fixture-only');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
