import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createClaudeRunnerAdapter, expectedFiles } from './runner-adapter';
import { claudeModelMetadata, claudePluginName } from './models';
import { verifyClaudeSessionSkills } from './session-skills';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const template = expectedFiles("/template");
function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), 'claude-refresh-')); roots.push(homeDir);
  const dataRoot = join(homeDir, 'deck'), parent = join(dataRoot, 'claude');
  const root = join(parent, claudePluginName({}, []));
  for (const source of template.filter(file => ["/template/.claude-plugin/plugin.json", "/template/skills/deck-quality/SKILL.md", "/template/hooks/session-start.cjs"].includes(file.path))) {
    const file = { ...source, path: join(root, source.path.slice("/template/".length)) };
    mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, file.content, { mode: 0o600 });
  }
  const selection = join(parent, 'model-assignments.json');
  writeFileSync(selection, claudeModelMetadata({}), { mode: 0o600 });
  return { homeDir, dataRoot, root, selection, adapter: createClaudeRunnerAdapter({ homeDir, dataRoot }) };
}
// Oracle: approved resilient-verification Slice 2. Refresh does not mutate an admitted generation.
test('refresh lifecycle preserves concurrent edits, is idempotent and enforces binding', async () => {
  const f = fixture();
  const before = readFileSync(f.selection, 'utf8');
  const pending = f.adapter.prepareSessionNativeSkills();
  writeFileSync(join(f.root, "skills/deck-quality/SKILL.md"), "concurrent user edit");
  const first = await pending;
  expect(readFileSync(join(f.root, "skills/deck-quality/SKILL.md"), "utf8")).toBe("concurrent user edit");
  verifyClaudeSessionSkills(first);
  const stamp = statSync(first.selectionPath).mtimeMs;
  const skill = join(f.root, 'skills/deck-quality/SKILL.md'), hook = join(f.root, 'hooks/session-start.cjs');
  writeFileSync(skill, 'my custom skill'); writeFileSync(hook, 'throw new Error("custom executable")');
  const descriptor = await f.adapter.prepareSessionNativeSkills();
  expect(descriptor.root).toBe(first.root);
  expect(statSync(descriptor.selectionPath).mtimeMs).toBe(stamp);
  expect(readFileSync(f.selection, 'utf8')).toBe(before);
  expect(readFileSync(skill, 'utf8')).toBe('my custom skill');
  expect(readFileSync(hook, 'utf8')).toContain('custom executable');
  expect(descriptor.preparation?.some(finding => finding.kind === 'W')).toBe(true);
  expect(readFileSync(join(descriptor.root, 'hooks/session-start.cjs'), 'utf8')).not.toContain('custom executable');

  writeFileSync(f.selection, claudeModelMetadata({}, ['context7']), { mode: 0o600 });
  expect(() => verifyClaudeSessionSkills(first)).toThrow();
  const other = join(f.homeDir, 'other');
  writeFileSync(other, readFileSync(f.selection)); rmSync(f.selection); symlinkSync(other, f.selection);
  await expect(f.adapter.prepareSessionNativeSkills()).rejects.toThrow('claude-session-skills-unverified');
});
