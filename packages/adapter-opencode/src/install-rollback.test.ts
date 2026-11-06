import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginRunnerContributions, contributionHash, getDefaultDeckConfig } from '@deck/core';
import { backupOpenCodeInstall, rollbackOpenCodeInstall } from './install-rollback';

// Protects caller migration: a real captured rollback can settle a pending managed journal.
// Oracle: exact pre-apply bytes restored, no partial receipt, pending removed only with proof.
test('OpenCode rollback settles pending contributions using captured preimages', () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-rollback-')));
 try {
  mkdirSync(join(root, 'plugins'));
  const path = join(root, 'plugins', 'execution.js'); writeFileSync(path, 'old');
  const state = backupOpenCodeInstall(root, [{ path: 'plugins/execution.js', content: 'canonical' }], []);
  const tx = beginRunnerContributions({ runnerId: 'opencode', root, manifestPath: state.manifestPath, deckVersion: 'test',
   targets: [{ path, selector: { kind: 'file' }, expectedHash: contributionHash('canonical') }],
   managed: { inventory: { runnerId: 'opencode', root, generatedRoots: [join(root, 'plugins')], slots: [] }, stateRoot: join(root, 'state') } });
  writeFileSync(path, 'canonical'); tx.abandon();
  expect(rollbackOpenCodeInstall(state).status).toBe('rolled-back');
  expect(readFileSync(path, 'utf8')).toBe('old');
  expect(existsSync(`${state.manifestPath}.pending`)).toBe(false);
  expect(existsSync(state.manifestPath)).toBe(false);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

import { parseJsonc } from './model-discovery-context';
import { createOpenCodeRunnerAdapter } from './runner-adapter';

// Protects public verification-failure recovery of legacy plugin migration.
// Oracle: original plugin identities, comments and concurrent foreign entries survive rollback.
for (const header of ['', '// user comment\n']) for (const concurrent of [false, true]) {
 test(`public OpenCode migration rollback preserves JSONC (${!!header}, concurrent=${concurrent})`, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-public-rollback-'))), root = join(home, 'opencode');
  try {
   mkdirSync(root);
   const path = join(root, 'opencode.json');
   const before = header + '{"plugin":["personal-plugin",' + (header ? '/* plugin comment */' : '') + '"deck-model-variants","later-plugin"],"provider":{"personal":true}}';
   writeFileSync(path, before);
   const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root, skillDiscoveryHomeDir: home });
   const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: 'opencode-development', deckConfig: getDefaultDeckConfig() });
   const backup = adapter.backupDeveloperTeamFiles!(plan);
   await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: 'opencode-development', plan });
   // A foreign config write invalidates verification, without altering affected identities.
   writeFileSync(path, readFileSync(path, 'utf8').replace('"personal":true', '"personal":true,"later":42'));
   expect((await adapter.verifyDeveloperTeamInstall!(plan)).valid).toBe(false);
   if (!concurrent) writeFileSync(path, readFileSync(path, 'utf8').replace(',"later":42', ''));
   expect((await adapter.rollbackDeveloperTeamFiles!(backup)).status).toBe('rolled-back');
   const restored = readFileSync(path, 'utf8');
   expect(restored).toContain(header);
   if (header) expect(restored).toContain('/* plugin comment */');
   expect(restored).toContain('"personal-plugin"');
   expect(restored).toContain('"deck-model-variants"');
   expect(restored).not.toContain('file://');
   expect((parseJsonc(restored) as any).plugin).toEqual(['personal-plugin', 'deck-model-variants', 'later-plugin']);
   if (concurrent) expect(restored).toContain('"later":42');
   else expect(restored).toBe(before);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
}
