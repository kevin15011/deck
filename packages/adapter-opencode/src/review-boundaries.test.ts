import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { prepareOpenCodeNativeRole } from './native-role';
import { relative } from 'node:path';
import { buildOpenCodeDeveloperTeamInstallPlan } from './developer-team-install';
import { applyOpenCodeRefresh, planOpenCodeRefresh } from './content-refresh';
import { createDefaultOpenCodeInventoryDiscovery, createOpenCodeRunnerAdapter } from './runner-adapter';
import { withInstallationMutation } from '../../core/src/installation-use';

const templateHome = '/__deck_review_fixture__';
const template = buildOpenCodeDeveloperTeamInstallPlan(templateHome, { configDir: join(templateHome, 'opencode') });
// These boundaries authenticate bytes but never execute the plugin. Keep the
// receipted executable fixture small instead of copying the full bundled runtime.
template.executionPlugin!.content = 'export default async () => ({});';
const nativeTemplate = JSON.stringify(template);
function fixture() {
  const home = realpathSync(mkdtempSync('/tmp/deck-s4-review-')), root = join(home, 'opencode');
  const native: ReturnType<typeof buildOpenCodeDeveloperTeamInstallPlan> = JSON.parse(nativeTemplate.split(templateHome).join(home));
  const files = [
    { path: 'opencode.json', content: '{}', kind: 'other' as const },
    ...native.promptGenerationPlan.map(f => ({ path: relative(root, f.absolutePath), content: f.content, kind: 'prompt' as const })),
    { path: native.executionPlugin!.relativePath, content: native.executionPlugin!.content, kind: 'other' as const },
    { path: native.modelVariantsPlugin!.relativePath, content: native.modelVariantsPlugin!.content, kind: 'other' as const },
  ];
  applyOpenCodeRefresh(root, planOpenCodeRefresh(root, files, native.agentEntries));
  return { home, root, native, files };
}
// Q1: inventory must not execute edited code, and refresh cannot race model execution.
test('inventory authenticates plugins and holds installation use through the command', async () => {
  const { home, root } = fixture();
  let models = 0;
  const env: Record<string, string> = { HOME: home, XDG_CONFIG_HOME: home, OPENCODE_CONFIG_DIR: 'opencode' };
  const discover = createDefaultOpenCodeInventoryDiscovery({
    homeDir: home, xdgConfigHome: home, xdgDataHome: join(home, 'data'), xdgCacheHome: join(home, 'cache'),
    env, resolveExecutable: async () => '/fake/opencode',
    commandRunner: { run: async request => {
      if (request.args[0] === '--version') return { exitCode: 0, signal: null, stdout: '1.18.31', stderr: '' };
      models++;
      expect(request.env?.OPENCODE_CONFIG_DIR).toBe(root);
      await expect(withInstallationMutation(root, async () => {})).rejects.toThrow('refresh deferred');
      return { exitCode: 0, signal: null, stdout: 'openai/model\n{"providerID":"openai","variants":{}}', stderr: '' };
    } },
  });
  try {
    expect((await discover({ projectRoot: home })).state).toBe('ready');
    expect(models).toBe(1);
    env.XDG_CONFIG_HOME = join(home, 'other-config');
    env.OPENCODE_CONFIG_DIR = 'opencode';
    writeFileSync(join(root, 'plugins/developer-team-execution.js'), 'edited executable');
    expect((await discover({ projectRoot: home, mode: 'rescan' })).state).toBe('blocked');
    expect(models).toBe(1);
    await withInstallationMutation(root, async () => {});
  } finally { rmSync(home, { recursive: true, force: true }); }
});
// Q3: comments are user bytes even when the field's semantic receipt still matches.
test('refresh retains nested JSONC comments when an owned object changes', () => {
  const { home, root, native, files } = fixture();
  try {
    const path = join(root, 'opencode.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"permission": {', '"permission": {\n// retain this explanation'));
    const agents = structuredClone(native.agentEntries);
    (agents['deck-lead'] as any).permission.extra = 'deny';
    const plan = planOpenCodeRefresh(root, files, agents);
    expect(plan.writes.length).toBeGreaterThan(0);
    applyOpenCodeRefresh(root, plan);
    expect(readFileSync(path, 'utf8')).toContain('// retain this explanation');
    expect(JSON.parse(readFileSync(path, 'utf8').replace('// retain this explanation', '')).agent['deck-lead'].permission.extra).toBe('deny');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// Q2: diagnostic identifies the effective permission, including a JSONC overlay.
test('read-only role validation names the role and unsafe permission', () => {
  const { home, root } = fixture();
  try {
    writeFileSync(join(root, 'opencode.jsonc'), JSON.stringify({ agent: { 'deck-quality': { permission: { bash: 'allow' } } } }));
    expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).toThrow('deck-quality permission bash');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// Effective process overrides must not widen a protected role.
test('native launch admits restrictions and rejects nested grants', async () => {
  const { home, root } = fixture();
  try {
  for (const [name, permission, status] of [
  ['deny shorthand', 'deny', 'ready'],
  ['nested read restrictions', { read: { '*': 'allow', '*.env': 'deny' } }, 'ready'],
  ['nested bash grant', { bash: { '*': 'allow' } }, 'blocked'],
  ['nested edit approval', { edit: { '*.md': 'ask' } }, 'blocked'],
  ['nested write grant', { write: { '*.md': 'allow' } }, 'blocked'],
  ['nested bash restriction', { bash: { '*': 'deny' } }, 'ready'],
] as const) {
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root,
      sessionDriver: { baseEnv: { HOME: home, XDG_CONFIG_HOME: home,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { 'deck-quality': { permission } } }) } } });
    const { getDefaultDeckConfig } = await import('@deck/core');
    const config = getDefaultDeckConfig(); config.webSearch.enabled = false;
    const result = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config });
    expect(result.status, name).toBe(status);
  }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const source of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG']) test('native launch rejects unsafe ' + source, async () => {
  const { home, root } = fixture();
  try {
    const content = JSON.stringify({ agent: { 'deck-quality': { permission: { bash: 'allow' } } } });
    const path = join(home, 'override.json');
    writeFileSync(path, content);
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root,
      sessionDriver: { baseEnv: { HOME: home, XDG_CONFIG_HOME: home, [source]: source === 'OPENCODE_CONFIG' ? path : content } } });
    const { getDefaultDeckConfig } = await import('@deck/core');
    const config = getDefaultDeckConfig(); config.webSearch.enabled = false;
    const result = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config });
    expect(result).toMatchObject({ status: 'blocked', diagnostics: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('deck-quality permission bash') })]) });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
