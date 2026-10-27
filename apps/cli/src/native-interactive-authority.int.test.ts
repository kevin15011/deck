import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core';
import { createCodexRunnerAdapter } from '@deck/adapter-codex';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { TAVILY_PROVIDER_DESCRIPTOR } from '@deck/provider-tavily';
import { buildReviewedInteractiveLaunch, reviewInteractiveSearchSessions } from './interactive-search-review';
import { prepareClaudeInteractiveLaunch } from './claude-interactive-launch';
import { executeRunnerLaunchPlan } from './runner-launch-command';

for (const trusted of [false, true]) test(`Codex production launch/review respects native project trust (${trusted})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-codex-authority-')), project = join(root, 'project'), codexHome = join(root, '.codex');
  mkdirSync(join(project, '.codex'), { recursive: true });
  const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
  const adapter = createCodexRunnerAdapter({ codexHome, userHome: root, sessionDriver: { baseEnv: { HOME: root, CODEX_HOME: codexHome } },
    tools: { homeDir: root, dataRoot: join(root, 'data/deck'), resolveCommand: () => undefined },
    webSearchCredential: () => 'fixture-only', webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR,
    preflight: { probe: async () => ({ found: true, version: '0.146.1', help: 'Usage: codex', execHelp: 'Usage: codex exec' }), inspectTrust: async () => trusted ? 'trusted' : 'untrusted' } });
  try {
    const install = adapter.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: 'codex-development', deckConfig, capabilityIds: [], standaloneSkills: [] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: 'codex-development', plan: install });
    const global = join(codexHome, 'config.toml');
    writeFileSync(global, readFileSync(global, 'utf8') + `\n[projects.${JSON.stringify(project)}]\ntrust_level = "${trusted ? 'trusted' : 'untrusted'}"\n`);
    writeFileSync(join(project, '.codex/config.toml'), 'web_search = "disabled"\n');
    const input = { projectRoot: project, mode: 'interactive' as const, teamId: 'developer-team', deckConfig };
    const options = { stateRoot: join(root, 'state'), getAdapter: () => adapter };
    const first = await buildReviewedInteractiveLaunch(adapter, input, options);
    expect(first.status).toBe('ready'); if (first.status !== 'ready') throw new Error(JSON.stringify(first.diagnostics));
    expect(first.plan.args.some(arg => arg.startsWith('mcp_servers.web-search.command='))).toBe(trusted);
    await executeRunnerLaunchPlan(first.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    writeFileSync(join(project, '.codex/config.toml'), 'web_search = "live"\n');
    expect((await reviewInteractiveSearchSessions(deckConfig, project, options)).some(d => d.code === 'interactive-search-reopen-required')).toBe(trusted);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

for (const trusted of [false, true]) test(`Claude production preparation/review respects persisted project trust (${trusted})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-claude-authority-')), project = join(root, 'project');
  mkdirSync(join(project, '.claude'), { recursive: true });
  const bin = join(root, 'tavily-mcp'); writeFileSync(bin, 'fixture-only', { mode: 0o700 });
  writeFileSync(join(root, '.claude.json'), JSON.stringify({ projects: { [project]: { hasTrustDialogAccepted: trusted } } }));
  const settings = join(project, '.claude/settings.json'); writeFileSync(settings, JSON.stringify({ permissions: { deny: ['WebSearch'] } }));
  const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, 'data/deck'), sessionDriver: { baseEnv: { HOME: root, CLAUDE_CODE_USE_BEDROCK: '1' } },
    resolveCommand: name => name === 'tavily-mcp' ? bin : undefined, webSearchCredential: () => 'fixture-only', webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR });
  const deckConfig = getDefaultDeckConfig(); deckConfig.webSearch = { enabled: true, provider: 'tavily' };
  try {
    const install = adapter.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: 'claude-development', deckConfig });
    await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: 'claude-development', plan: install });
    const input = { projectRoot: project, mode: 'interactive' as const, teamId: 'developer-team', deckConfig };
    const first = await prepareClaudeInteractiveLaunch(adapter, input);
    expect(first.status).toBe('ready'); if (first.status !== 'ready') throw new Error(JSON.stringify(first.diagnostics));
    expect(!!first.plan.envOverlay?.TAVILY_API_KEY).toBe(!trusted);
    // Use an isolated review ledger while retaining the real adapter's inspector.
    const options = { stateRoot: join(root, 'state'), getAdapter: () => adapter };
    const review = await buildReviewedInteractiveLaunch(adapter, input, options);
    if (review.status !== 'ready') throw new Error('review launch');
    await executeRunnerLaunchPlan(review.plan, { inheritedEnv: {}, spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    writeFileSync(settings, JSON.stringify({ model: 'haiku', permissions: { deny: [] } }));
    expect((await reviewInteractiveSearchSessions(deckConfig, project, options)).some(d => d.code === 'interactive-search-reopen-required')).toBe(trusted);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
