import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contributionHash } from '@deck/core';
import { prepareOpenCodeNativeRole } from './native-role';
import { applyOpenCodeRefresh } from './content-refresh';
import { setup, root, config, install, drift } from './content-refresh.fixture';
setup();

// Protects user content and JSONC syntax; custom prose must not be adopted as owned.
test('custom skill and prompt remain with warnings; JSONC comments and unrelated agents survive', async () => {
  const adapter = await install();
  const skill = join(root, 'skills/deck-quality/SKILL.md'), prompt = join(root, 'prompts/deck-team/deck-quality.md');
  writeFileSync(skill, 'my skill'); writeFileSync(prompt, 'my prompt');
  const path = join(root, 'opencode.json');
  const doc = JSON.parse(readFileSync(path, 'utf8')); doc.agent.custom = { prompt: 'hello' };
  writeFileSync(path, '// keep my comment\n' + JSON.stringify(doc, null, 4));
  const role = await adapter.prepareSessionNativeRole!('deck-quality', config());
  expect(role.instructions).toBe('my prompt'); expect(role.preparation?.some(f => f.kind === 'W')).toBe(true);
  expect(readFileSync(skill, 'utf8')).toBe('my skill');
  expect(readFileSync(path, 'utf8')).toContain('// keep my comment');
  expect(readFileSync(path, 'utf8')).toContain('"custom"');
  expect(JSON.parse(readFileSync(join(root, 'deck/manifest.json'), 'utf8')).contributions.find((e: any) => e.path === prompt).hash).not.toBe(contributionHash('my prompt'));
  doc.agent['deck-quality'].tools.extra = false;
  doc.agent['deck-quality'].permission.extra = 'deny';
  writeFileSync(path, JSON.stringify(doc));
  expect(prepareOpenCodeNativeRole(root, 'deck-quality').instructions).toBe('my prompt');
  writeFileSync(join(root, 'opencode.jsonc'), '// effective override\n' + JSON.stringify({ agent: { 'deck-quality': { tools: { bash: true } } } }));
  expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).toThrow('read-only policy changed');
});
// Protects executable trust. No receipt or a changed executable must refuse before spawn.
test('edited plugin is preserved and refused at the execution boundary', async () => {
  const adapter = await install(), path = join(root, 'plugins/developer-team-execution.js');
  writeFileSync(path, 'user executable');
  await expect(adapter.prepareSessionNativeRole!('deck-quality', config())).rejects.toThrow();
  expect(readFileSync(path, 'utf8')).toBe('user executable');
});

// Protects optimistic preimages: an edit after preview must never be overwritten.
test('concurrent edit refuses publication and preserves the editor bytes', async () => {
  const adapter = await install(), path = join(root, 'prompts/deck-team/deck-quality.md');
  drift(path); const plan = adapter.prepare(); writeFileSync(path, 'concurrent editor');
  expect(() => applyOpenCodeRefresh(root, plan)).toThrow('changed during preparation');
  expect(readFileSync(path, 'utf8')).toBe('concurrent editor');
});
// Protects no unreceipted executable adoption even when bytes equal the current bundle.
test('unreceipted plugin stays unowned and cannot launch', async () => {
  const adapter = await install(), path = join(root, 'deck/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.contributions = manifest.contributions.filter((e: any) => !e.path.endsWith('developer-team-execution.js'));
  writeFileSync(path, JSON.stringify(manifest));
  await expect(adapter.prepareSessionNativeRole('deck-quality', config())).rejects.toThrow('execution-plugin-untrusted');
});

