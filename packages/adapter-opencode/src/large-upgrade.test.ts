import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { planOpenCodeRefresh, applyOpenCodeRefresh } from './content-refresh';
import { buildOpenCodeDeveloperTeamInstallPlan } from './developer-team-install';
import { prepareOpenCodeNativeRole } from './native-role';

// Protects the real generated-bundle upgrade path, conditional rollback and repeat installation.
// Oracle: failed receipt publication restores exact old executable/shared bytes; retry admits roles.
test('canonical OpenCode upgrade backs up large bundle and rolls back before successful retry', () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-large-upgrade-'))), root = join(home, 'opencode');
 try {
  const native = buildOpenCodeDeveloperTeamInstallPlan(home, { configDir: root });
  const plugin = native.executionPlugin!;
  const path = join(root, plugin.relativePath); mkdirSync(dirname(path), { recursive: true });
  const original = plugin.content + '\n// prior generated version\n'; writeFileSync(path, original);
  const shared = '// personal config\n{"provider":{"custom":{"secret":"untouched"}}}';
  writeFileSync(join(root, 'opencode.json'), shared);
  const files = [{ path: 'opencode.json', content: '{}', kind: 'other' as const },
   { path: plugin.relativePath, content: plugin.content, kind: 'other' as const },
   { path: native.modelVariantsPlugin!.relativePath, content: native.modelVariantsPlugin!.content, kind: 'other' as const },
   ...native.promptGenerationPlan.map(file => ({ path: file.absolutePath.slice(root.length + 1), content: file.content, kind: 'prompt' as const }))];
  const plan = () => planOpenCodeRefresh(root, files, native.agentEntries);
  expect(() => applyOpenCodeRefresh(root, plan(), path => { if (path.endsWith('/manifest.json')) throw new Error('publication fault'); return () => {}; })).toThrow('publication fault');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toBe(shared);
  expect(existsSync(join(root, 'deck/manifest.json.pending'))).toBe(false);
  const result = applyOpenCodeRefresh(root, plan());
  const backup = JSON.parse(readFileSync(result.backupPath!, 'utf8'));
  const entry = backup.entries.find((entry: any) => entry.path === path);
  expect(gunzipSync(Buffer.from(entry.content, 'base64')).toString()).toBe(original);
  expect(readFileSync(join(root, 'opencode.json'), 'utf8')).toContain('"secret":"untouched"');
  for (const id of ['deck-investigate', 'deck-quality']) expect(() => prepareOpenCodeNativeRole(root, id)).not.toThrow();
  expect(plan().writes).toHaveLength(0);
  expect(applyOpenCodeRefresh(root, plan()).changedCount).toBe(0);
  expect(readdirSync(dirname(result.backupPath!)).length).toBeGreaterThanOrEqual(2);
 } finally { rmSync(home, { recursive: true, force: true }); }
});
