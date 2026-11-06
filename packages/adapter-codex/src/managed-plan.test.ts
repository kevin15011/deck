import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { createCodexRunnerAdapter } from './runner-adapter';

// Protects default adapter composition and receipt-based drift, independent of generator differences.
// Oracle: a known role is planned canonically, while receipt mismatch reaches the writer fence.
test('Codex adapter selects managed role repair and reports receipt drift', () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-managed-'))), codexHome = join(home, '.codex');
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome, journalRoot: join(home, 'journal'),
   tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const input = { projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig() };
  const first = adapter.buildDeveloperTeamInstallPlan(input);
  for (const file of first.files) { const path = join(home, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content); }
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
  const path = join(codexHome, 'agents/deck-quality.toml'), canonical = readFileSync(path, 'utf8');
  writeFileSync(path, 'sandbox_mode = "danger-full-access"');
  expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(true);
  const repair = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repair.blocked).toBe(false);
  expect(repair.files.find(file => file.path === '.codex/agents/deck-quality.toml')?.content).toBe(canonical);
 } finally { rmSync(home, { recursive: true, force: true }); }
});

import { buildCodexDeveloperTeamInstallPlan, CODEX_MANIFEST_PATH } from './developer-team-install';
import { contributionHash, contributionId } from '@deck/core';
// Protects shared-selector authority: edited recognized MCP/hook selectors regenerate, foreign TOML stays byte-identical.
test('managed Codex reconciles known hook spans and recorded generic MCP despite changed hashes', () => {
 const root = '/fixture', codexHome = '/fixture/.codex', configPath = join(codexHome, 'config.toml');
 const foreign = '# foreign formatting\n[custom]\nvalue   = "unchanged" # keep\n';
 const config = '# deck-codex-mcp:context7\n[mcp_servers.context7]\ncommand = "/edited/context7"\n\n# deck-codex-hook:readiness:start\n[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "/edited/hook" }]\n# deck-codex-hook:readiness:end\n\n' + foreign;
 const target = { path: configPath, selector: { kind: 'toml' as const, header: 'mcp_servers.context7' } };
 const manifest = JSON.stringify({ version: 1, runnerId: 'codex', root: codexHome, files: {}, contributions: [{ ...target, id: contributionId(target), hash: contributionHash('old'), ownership: 'prior-record', scope: 'global', encoding: 'bytes' }] });
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: root, codexHome, managed: true, existingFiles: new Map([[CODEX_MANIFEST_PATH, manifest], ['.codex/config.toml', config]]), mcpCapabilityIds: ['context7'], context7Command: '/verified/context7' });
 expect(plan.blocked).toBe(false);
 const next = plan.expectedFiles.find(file => file.relativePath === '.codex/config.toml')!.content;
 expect(next).toContain(foreign);
 expect(next).toContain('/verified/context7');
 expect(next).not.toContain('/edited/');
 const receipt = JSON.parse(plan.expectedFiles.find(file => file.relativePath === CODEX_MANIFEST_PATH)!.content).contributions.find((entry: any) => entry.id === contributionId(target));
 expect(receipt).toBeDefined();
});

// Protects generated legacy marker boundaries and retired runtime entries, without whole-file ownership.
test('managed Codex retires edited known hook spans and repeated legacy instruction blocks', () => {
 const start = '<!-- deck:developer-team:start -->', end = '<!-- deck:developer-team:end -->';
 const source = `before\n\n${start}\nedited one\n${end}\n\nmid\n\n${start}\nedited two\n${end}\n\nafter\n`;
 const config = '# deck-codex-hook:memory-bridge:start\n[[hooks.SessionStart]]\nhooks = [{type="command", command="/edited/retired"}]\n# deck-codex-hook:memory-bridge:end\n';
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: '/fixture', managed: true, existingFiles: new Map([['AGENTS.md', source], ['.codex/config.toml', config]]), materializationScope: 'content-only' });
 expect(plan.blocked).toBe(false);
 expect(plan.expectedFiles.find(file => file.relativePath === 'AGENTS.md')?.content).toBe('before\n\n\nmid\n\n\nafter\n');
 expect(plan.expectedFiles.find(file => file.relativePath === '.codex/config.toml')?.content).not.toContain('/edited/retired');
});

// Oracle: a marker with trailing user bytes is not an exact generated boundary.
test('managed Codex preserves malformed padded legacy boundaries', () => {
 const source = 'User\n<!-- deck:developer-team:start -->  \nprivate\n<!-- deck:developer-team:end -->\n';
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: '/fixture', managed: true, existingFiles: new Map([['AGENTS.md', source]]), materializationScope: 'content-only' });
 expect(plan.mutations.some(mutation => mutation.relativePath === 'AGENTS.md')).toBe(false);
 expect(plan.diagnostics.some(diagnostic => diagnostic.code === 'agents-marker-cleanup-blocked' && diagnostic.message.includes('line 2'))).toBe(true);
});

// Protects ownership metadata recovery without letting future metadata become ordinary drift.
test('managed Codex rebuilds corrupt receipts but preserves newer schema evidence', () => {
 const base = { projectRoot: '/fixture', managed: true };
 const invalid = buildCodexDeveloperTeamInstallPlan({ ...base, existingFiles: new Map([[CODEX_MANIFEST_PATH, '{invalid']]) });
 expect(invalid.blocked).toBe(false);
 expect(invalid.mutations.some(mutation => mutation.relativePath === CODEX_MANIFEST_PATH)).toBe(true);
 const future = buildCodexDeveloperTeamInstallPlan({ ...base, existingFiles: new Map([[CODEX_MANIFEST_PATH, JSON.stringify({ version: 2, files: {} })]]) });
 expect(future.blocked).toBe(true);
});

// Protects generic collision policy and metadata containment despite arbitrary supplied receipts.
test('managed Codex preserves an ambiguous skill and unrelated manifest paths', () => {
 const foreign = 'user-maintained skill', victim = 'must survive';
 const base = { projectRoot: '/fixture', managed: true, materializationScope: 'content-only' as const };
 const plan = buildCodexDeveloperTeamInstallPlan({ ...base, existingFiles: new Map([
  ['.agents/skills/archify/SKILL.md', foreign], ['source.ts', victim],
  [CODEX_MANIFEST_PATH, JSON.stringify({ version: 1, files: { 'source.ts': contributionHash(victim) } })],
 ]) });
 expect(plan.blocked).toBe(false);
 expect(plan.mutations.some(mutation => mutation.relativePath === 'source.ts')).toBe(false);
 expect(plan.mutations.some(mutation => mutation.relativePath === '.agents/skills/archify/SKILL.md')).toBe(false);
 expect(plan.diagnostics.some(diagnostic => diagnostic.code === 'unowned-collision')).toBe(true);
});

// Oracle: a foreign entry point makes the entire shared bundle ambiguous;
// independent roles refresh, but verification cannot claim that bundle was installed.
test('public Codex install preserves an ambiguous complete bundle and reports unmet content', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-shared-bundle-'))), codexHome = join(home, '.codex');
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome, journalRoot: join(home, 'journal'),
   tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const input = { projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), standaloneSkills: [] };
  const prefix = '.agents/skills/archify/';
  const initial = adapter.buildDeveloperTeamInstallPlan(input);
  const resource = initial.files.find(file => file.path.startsWith(prefix) && !file.path.endsWith('/SKILL.md'))!;
  expect(resource).toBeDefined();
  const entry = join(home, prefix, 'SKILL.md'); mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, 'foreign entry');
  const resourcePath = join(home, resource.path); mkdirSync(dirname(resourcePath), { recursive: true }); writeFileSync(resourcePath, 'foreign resource');
  const plan = adapter.buildDeveloperTeamInstallPlan(input);
  expect(plan.blocked).toBe(false);
  expect(plan.files.some(file => file.path.startsWith(prefix))).toBe(false);
  await adapter.applyDeveloperTeamInstall({ ...input, plan });
  expect(readFileSync(entry, 'utf8')).toBe('foreign entry');
  expect(readFileSync(resourcePath, 'utf8')).toBe('foreign resource');
  const verified = await adapter.verifyDeveloperTeamInstall(plan);
  expect(verified.valid).toBe(false);
  expect(verified.diagnostics.some(message => message.includes('archify') && message.includes('not installed'))).toBe(true);
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Oracle: every declared member needs independent recognition before any bundle
// publication; a canonical entry cannot adopt a foreign executable either.
for (const entryPresent of [false, true]) test(`public Codex preserves a partial foreign bundle across retries (entry=${entryPresent})`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-partial-bundle-')));
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, '.codex'), journalRoot: join(home, 'journal'),
   tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const input = { projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), standaloneSkills: [] };
  const prefix = '.agents/skills/archify/', resource = prefix + 'bin/archify.mjs';
  const initial = adapter.buildDeveloperTeamInstallPlan(input);
  const entry = initial.files.find(file => file.path === prefix + 'SKILL.md')!;
  mkdirSync(dirname(join(home, resource)), { recursive: true });
  writeFileSync(join(home, resource), 'foreign executable');
  if (entryPresent) writeFileSync(join(home, entry.path), entry.content);
  for (let attempt = 0; attempt < 2; attempt++) {
   const plan = adapter.buildDeveloperTeamInstallPlan(input);
   expect(plan.files.some(file => file.path.startsWith(prefix))).toBe(false);
   await adapter.applyDeveloperTeamInstall({ ...input, plan });
   expect(readFileSync(join(home, resource), 'utf8')).toBe('foreign executable');
   expect(readdirSync(join(home, prefix), { recursive: true }).sort()).toEqual(entryPresent ? ['SKILL.md', 'bin', 'bin/archify.mjs'] : ['bin', 'bin/archify.mjs']);
   const verified = await adapter.verifyDeveloperTeamInstall(plan);
   expect(verified.valid).toBe(false);
   expect(verified.diagnostics.some(message => message.includes('archify') && message.includes('not installed'))).toBe(true);
  }
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);

// Oracle: exact member receipts or matching root/path history authorize repair
// of edited resources even when the entry or the whole old manifest is missing.
for (const historyOnly of [false, true]) test(`Codex repairs established bundle members (history=${historyOnly})`, () => {
 const root = '/fixture', codexHome = '/fixture/.codex', prefix = '.agents/skills/archify/';
 const initial = buildCodexDeveloperTeamInstallPlan({ projectRoot: root, codexHome, managed: true, existingFiles: new Map() });
 const files = new Map(initial.expectedFiles.map(file => [file.relativePath, file.content]));
 const resource = prefix + 'bin/archify.mjs', canonical = files.get(resource)!;
 const manifest = JSON.parse(files.get(CODEX_MANIFEST_PATH)!);
 files.set(resource, 'edited installed executable'); files.delete(prefix + 'SKILL.md');
 if (historyOnly) files.delete(CODEX_MANIFEST_PATH);
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: root, codexHome, managed: true, existingFiles: files,
  ...(historyOnly ? { ownershipHistory: { prior: manifest.contributions } } : {}) });
 expect(plan.diagnostics.some(item => item.code === 'shared-skill-conflict')).toBe(false);
 expect(plan.expectedFiles.find(file => file.relativePath === resource)?.content).toBe(canonical);
 expect(plan.mutations.some(file => file.relativePath === prefix + 'SKILL.md')).toBe(true);
});

// Protects the production history writer/reader, not just supplied planner data.
test('public Codex regenerates edited bundle resources after receipt loss', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-bundle-repair-'))), codexHome = join(home, '.codex');
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome, journalRoot: join(home, 'journal'),
   tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
  const input = { projectRoot: home, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), standaloneSkills: [] };
  const initial = adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: initial });
  const path = '.agents/skills/archify/bin/archify.mjs', canonical = readFileSync(join(home, path), 'utf8');
  writeFileSync(join(home, path), 'edited installed executable');
  rmSync(join(home, '.agents/skills/archify/SKILL.md'));
  rmSync(join(home, CODEX_MANIFEST_PATH));
  const repair = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repair.files.find(file => file.path === path)?.content).toBe(canonical);
  await adapter.applyDeveloperTeamInstall({ ...input, plan: repair });
  expect(readFileSync(join(home, path), 'utf8')).toBe(canonical);
  expect((await adapter.verifyDeveloperTeamInstall(repair)).valid).toBe(true);
  const repeat = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repeat.files.some(file => file.path.startsWith('.agents/skills/archify/'))).toBe(false);
 } finally { rmSync(home, { recursive: true, force: true }); }
}, 15000);
