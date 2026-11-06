import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { createOpenCodeRunnerAdapter } from './runner-adapter';
import { buildOpenCodeLaunch } from './session-driver/launch';

// Protects the installed-to-effective policy boundary, including ancestor sources.
// Oracle: Investigate/Quality cannot gain shell or unlisted tool access through native overlays.
test('public install repairs missing receipts and launch checks every admitted role overlay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-effective-policy-'));
  const home = join(root, 'home'), project = join(home, 'project'), cwd = join(project, 'nested');
  const config = join(root, 'config/opencode');
  const env = { HOME: home, XDG_CONFIG_HOME: join(root, 'config') };
  mkdirSync(cwd, { recursive: true }); mkdirSync(join(project, '.git'));
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: config, skillDiscoveryHomeDir: home, sessionDriver: { baseEnv: env } });
  const deckConfig = getDefaultDeckConfig();
  const install = async () => {
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: cwd, environmentId: 'opencode-development', deckConfig });
    await adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: 'opencode-development', plan });
  };
  try {
    await install();
    const file = join(config, 'opencode.json'), doc = JSON.parse(readFileSync(file, 'utf8'));
    doc.agent['deck-investigate'].tools.bash = true;
    doc.agent['deck-investigate'].permission.bash = 'allow';
    writeFileSync(file, JSON.stringify(doc));
    writeFileSync(join(config, 'plugins/developer-team-execution.js'), 'edited executable');
    unlinkSync(join(config, 'deck/manifest.json'));
    await install();
    for (const id of ['deck-investigate', 'deck-quality']) {
      const role = await adapter.prepareSessionNativeRole!(id);
      const input = { memberId: id, cwd, nativeRoleDescriptor: role, projectConfigTrusted: true, mcp: { servers: [] }, mcpServerSpecs: {} };
      const io = { writePrivateFile: (name: string, content: string) => { const path = join(root, name); writeFileSync(path, content); return path; } };
      const launch = (extra = {}) => buildOpenCodeLaunch(input as any, io, { baseEnv: { ...env, ...extra } });
      expect(() => launch()).not.toThrow();
      const overlay = { agent: { [id]: { tools: { bash: true }, permission: { bash: 'allow' } } } };
      for (const path of [join(project, '.opencode/opencode.json'), join(home, '.opencode/opencode.json'), join(project, 'opencode.json')]) {
        mkdirSync(dirname(path), { recursive: true });
        const text = JSON.stringify(overlay); writeFileSync(path, text);
        expect(() => launch()).toThrow('read-only policy changed');
        expect(readFileSync(path, 'utf8')).toBe(text);
        unlinkSync(path);
      }
      const projectOverride = join(project, 'opencode.json');
      writeFileSync(projectOverride, JSON.stringify(overlay));
      expect(() => launch({ OPENCODE_PURE: 'true' })).toThrow('read-only policy changed');
      unlinkSync(projectOverride);
      expect(() => launch({ OPENCODE_CONFIG_CONTENT: JSON.stringify({ mode: { [id]: { permission: { bash: 'allow' } } } }) })).toThrow('read-only policy changed');
      for (const directory of ['agents', 'modes']) {
        const markdown = join(project, '.opencode', directory, 'local.md');
        mkdirSync(dirname(markdown), { recursive: true });
        const text = `---\nname: ${id}\npermission:\n  bash: allow\ntools:\n  bash: true\n---\nLocal role override\n`;
        writeFileSync(markdown, text);
        expect(() => launch()).toThrow('read-only policy changed');
        expect(readFileSync(markdown, 'utf8')).toBe(text);
        writeFileSync(markdown, `---\nname: ${id}\npermission:\n  read: deny\n---\nRestricted role\n`);
        expect(() => launch()).not.toThrow();
        unlinkSync(markdown);
      }
      const explicit = join(root, 'explicit.json'); writeFileSync(explicit, JSON.stringify(overlay));
      expect(() => launch({ OPENCODE_CONFIG: explicit })).toThrow('read-only policy changed');
      expect(() => launch({ OPENCODE_CONFIG_CONTENT: JSON.stringify(overlay) })).toThrow('read-only policy changed');
      expect(() => launch({ OPENCODE_PERMISSION: JSON.stringify({ bash: 'allow' }) })).toThrow('read-only policy changed');
      const path = join(project, '.opencode/opencode.json'); writeFileSync(path, JSON.stringify(overlay));
      expect(() => launch({ OPENCODE_DISABLE_PROJECT_CONFIG: 'true' })).not.toThrow();
      unlinkSync(path);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);

// Protects native load occurrences and equivalent explicit directory spellings.
// Oracle: a later native shell grant must refuse both read-only roles without changing its source.
import { validateOpenCodeEffectiveRoles } from './native-role-source';
for (const id of ['deck-investigate', 'deck-quality']) {
  test(`${id} rejects repeated explicit loads after project restrictions`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-repeated-load-')));
    try {
      const installed = join(root, 'installed'), project = join(root, 'project');
      mkdirSync(installed); mkdirSync(join(project, '.git'), { recursive: true });
      mkdirSync(join(project, '.opencode'));
      const entry = { tools: { '*': false }, permission: { '*': 'deny' } };
      writeFileSync(join(installed, 'opencode.json'), JSON.stringify({ agent: { [id]: entry } }));
      const explicit = join(project, '.opencode/opencode.json');
      const unsafe = JSON.stringify({ agent: { [id]: { tools: { bash: true }, permission: { bash: 'allow' } } } });
      writeFileSync(explicit, unsafe);
      writeFileSync(join(project, 'opencode.json'), JSON.stringify({ agent: { [id]: { tools: { bash: false }, permission: { bash: 'deny' } } } }));
      expect(() => validateOpenCodeEffectiveRoles(installed, project, { HOME: join(root, 'home'), OPENCODE_CONFIG: explicit })).toThrow('read-only policy changed');
      expect(readFileSync(explicit, 'utf8')).toBe(unsafe);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test(`${id} checks aliases for normalized explicit directories`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-directory-alias-')));
    try {
      const installed = join(root, 'installed'), project = join(root, 'project'), extra = join(root, 'extra');
      mkdirSync(installed); mkdirSync(project); mkdirSync(join(extra, 'agents'), { recursive: true });
      writeFileSync(join(installed, 'opencode.json'), JSON.stringify({ agent: { [id]: { tools: { '*': false }, permission: { '*': 'deny' } } } }));
      const path = join(extra, 'agents/alias.md');
      const unsafe = `---\nname: ${id}\npermission:\n  bash: allow\ntools:\n  bash: true\n---\nAlias\n`;
      writeFileSync(path, unsafe);
      for (const suffix of ['', '/', '/.']) {
        expect(() => validateOpenCodeEffectiveRoles(installed, project, { HOME: join(root, 'home'), OPENCODE_CONFIG_DIR: extra + suffix })).toThrow('read-only policy changed');
        expect(readFileSync(path, 'utf8')).toBe(unsafe);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// Protects bounded inspection: native-followed symlinks and oversized metadata
// refuse opaquely; large prompt bodies after bounded metadata remain compatible.
test('Markdown inspection refuses symlink traversal and excessive metadata', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-markdown-bounds-')));
  try {
    mkdirSync(join(root, 'agents'));
    const file = join(root, 'agents/local.md');
    const inspect = () => validateOpenCodeEffectiveRoles(root, root, { HOME: join(root, 'home') });
    writeFileSync(file, '---\nname: local\n---\n' + 'body'.repeat(100_000));
    expect(inspect).not.toThrow();
    writeFileSync(file, '---\nname: local\n#' + 'a'.repeat(70_000) + '\n---\n');
    expect(inspect).toThrow('opencode-native-role-inspection-limit');
    unlinkSync(file);
    symlinkSync(join(root, 'agents'), join(root, 'agents/cycle'));
    expect(inspect).toThrow('opencode-native-role-source-unsafe');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
