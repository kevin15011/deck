import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, type RunnerAdapter } from '@deck/core';
import { inspectCodexNativeSearch } from '../../../packages/adapter-codex/src/native-search';
import { inspectOpenCodeNativeSearch } from '../../../packages/adapter-opencode/src/native-search';
import { inspectClaudeNativeSearch } from '../../../packages/adapter-claude/src/native-search';
import { inspectPiNativeSearch } from '../../../packages/adapter-pi/src/native-search';
import { resolveSessionChildMcp } from './session-shared-services';
const fixture = () => mkdtempSync(join(tmpdir(), 'deck-search-preparation-'));
test('per-turn preparation rereads effective config and never reuses another member decision', async () => {
  const root = fixture(); const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: 'tavily' };
  const adapter = { runnerId: 'codex', inspectNativeSearch: async (input: any) => inspectCodexNativeSearch(input, root) } as RunnerAdapter;
  writeFileSync(join(root, 'config.toml'), 'web_search="live"\n');
  const native = await resolveSessionChildMcp(adapter, config, {});
  expect(native.runnerPackages('codex')).toEqual([]);
  writeFileSync(join(root, 'config.toml'), 'web_search="disabled"\n');
  const fallback = await resolveSessionChildMcp(adapter, config, { TAVILY_API_KEY: 'fixture-only' });
  expect(fallback.runnerPackages('codex')).toEqual(['web-search']);
  expect((await resolveSessionChildMcp({ runnerId: 'pi', inspectNativeSearch: async input => inspectPiNativeSearch(input, root) } as RunnerAdapter, config, { TAVILY_API_KEY: 'fixture-only' })).runnerPackages('pi')).toEqual(['web-search']);
  writeFileSync(join(root, 'config.toml'), 'web_search="cached"\n');
  expect((await resolveSessionChildMcp(adapter, config, {})).runnerPackages('codex')).toEqual([]);
});
test('supported runner provider/flags/permission and extension inventory matrix', () => {
  const root = fixture(); const base = { projectRoot: root, environment: {} };
  writeFileSync(join(root, 'config.toml'), 'web_search="live"\n');
  expect(inspectCodexNativeSearch({ ...base, flags: ['-c', 'web_search="disabled"'] }, root).availability).toBe('unavailable');
  for (const name of ['OPENCODE_ENABLE_EXA', 'OPENCODE_ENABLE_PARALLEL']) expect(inspectOpenCodeNativeSearch({ ...base, modelId: 'anthropic/claude-sonnet-4', environment: { [name]: '1' } }, root).availability).toBe('available');
  expect(inspectOpenCodeNativeSearch({ ...base, modelId: 'anthropic/claude-sonnet-4' }, root).availability).toBe('unavailable');
  expect(inspectOpenCodeNativeSearch({ ...base, modelId: 'opencode/big-pickle' }, root).availability).toBe('available');
  expect(inspectClaudeNativeSearch({ ...base, modelId: 'sonnet', environment: { CLAUDE_CODE_USE_BEDROCK: '1' } }, root).availability).toBe('unavailable');
  expect(inspectClaudeNativeSearch({ ...base, modelId: 'sonnet' }, root).availability).toBe('available');
  expect(inspectClaudeNativeSearch({ ...base, modelId: 'inherit' }, root).availability).toBe('available');
  expect(inspectClaudeNativeSearch({ ...base, flags: ['--disallowedTools', 'WebSearch'] }, root).webAllowed).toBe(false);
  expect(inspectPiNativeSearch({ ...base, exposedTools: ['read'] }, root).availability).toBe('unavailable');
  expect(inspectPiNativeSearch({ ...base, exposedTools: ['web_search'] }, root).availability).toBe('available');
});

test('effective config model, OpenCode launch flags and global deny participate in search selection', () => {
  const root = fixture(); const base = { projectRoot: root, environment: {} };
  writeFileSync(join(root, 'config.toml'), 'model="first"\n');
  const first = inspectCodexNativeSearch(base, root);
  writeFileSync(join(root, 'config.toml'), 'model="second"\n');
  expect(inspectCodexNativeSearch(base, root).configFingerprint).not.toBe(first.configFingerprint);
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({ model: 'opencode/big-pickle', permission: 'deny' }));
  expect(inspectOpenCodeNativeSearch(base, root).webAllowed).toBe(false);
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({ model: 'opencode/big-pickle' }));
  expect(inspectOpenCodeNativeSearch({ ...base, flags: ['--model', 'anthropic/sonnet'] }, root).availability).toBe('unavailable');
});
test('unknown warns, disabled does not inject and absent fallback fails visibly', async () => {
  const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: 'tavily' };
  const adapter = { runnerId: 'fixture' } as RunnerAdapter;
  const result = await resolveSessionChildMcp(adapter, config, { TAVILY_API_KEY: 'fixture-only' });
  expect(result.searchDiagnostics).toContain('native-search-possible-duplicate');
  expect(result.searchDiagnostics).toContain('native-search-detection-defect');
  await expect(resolveSessionChildMcp(adapter, config, {})).rejects.toThrow('fallback');
  config.webSearch.enabled = false;
  expect((await resolveSessionChildMcp(adapter, config, {})).runnerPackages('fixture')).toEqual([]);
});

test('production inspectors honor current member environment over constructor defaults', async () => {
  const { createClaudeRunnerAdapter } = await import('../../../packages/adapter-claude/src/runner-adapter');
  const { createOpenCodeRunnerAdapter } = await import('../../../packages/adapter-opencode/src/runner-adapter');
  const root = fixture();
  const claude = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, 'data/deck'), sessionDriver: { baseEnv: { CLAUDE_CODE_USE_BEDROCK: '1' } } });
  expect((await claude.inspectNativeSearch!({ projectRoot: root, modelId: 'sonnet', environment: {} })).availability).toBe('available');
  expect((await claude.inspectNativeSearch!({ projectRoot: root, modelId: 'sonnet' })).availability).toBe('unavailable');
  const opencode = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, sessionDriver: { baseEnv: { OPENCODE_ENABLE_EXA: '1' } } });
  expect((await opencode.inspectNativeSearch!({ projectRoot: root, modelId: 'anthropic/sonnet', environment: {} })).availability).toBe('unavailable');
  expect((await opencode.inspectNativeSearch!({ projectRoot: root, modelId: 'anthropic/sonnet', environment: { OPENCODE_ENABLE_PARALLEL: '1' } })).availability).toBe('available');
  const second = fixture();
  writeFileSync(join(second, 'opencode.json'), JSON.stringify({ tools: { websearch: false } }));
  expect((await opencode.inspectNativeSearch!({ projectRoot: root, modelId: 'opencode/big-pickle', environment: { OPENCODE_CONFIG_DIR: second } })).availability).toBe('unavailable');
});
