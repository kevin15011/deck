import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contributionHash } from '@deck/core';
import { prepareOpenCodeNativeRole } from './native-role';
import { applyOpenCodeRefresh } from './content-refresh';
import { setup, root, config, install, drift } from './content-refresh.fixture';
setup();

// Protects canonical managed regeneration while preserving unrelated JSONC content.
test('managed skill and prompt regenerate; JSONC comments and unrelated agents survive', async () => {
  const adapter = await install();
  const skill = join(root, 'skills/deck-quality/SKILL.md'), prompt = join(root, 'prompts/deck-team/deck-quality.md');
  const canonicalSkill = readFileSync(skill, 'utf8'), canonicalPrompt = readFileSync(prompt, 'utf8');
  writeFileSync(skill, 'my skill'); writeFileSync(prompt, 'my prompt');
  const path = join(root, 'opencode.json');
  const doc = JSON.parse(readFileSync(path, 'utf8')); doc.agent.custom = { prompt: 'hello' };
  writeFileSync(path, '// keep my comment\n' + JSON.stringify(doc, null, 4));
  const role = await adapter.prepareSessionNativeRole!('deck-quality', config());
  expect(role.instructions).toBe(canonicalPrompt.trim());
  expect(readFileSync(skill, 'utf8')).toBe(canonicalSkill);
  expect(readFileSync(path, 'utf8')).toContain('// keep my comment');
  expect(readFileSync(path, 'utf8')).toContain('"custom"');
  expect(JSON.parse(readFileSync(join(root, 'deck/manifest.json'), 'utf8')).contributions.find((e: any) => e.path === prompt).hash).toBe(contributionHash(canonicalPrompt));
  doc.agent['deck-quality'].tools.extra = false;
  doc.agent['deck-quality'].permission.extra = 'deny';
  writeFileSync(path, JSON.stringify(doc));
  expect(prepareOpenCodeNativeRole(root, 'deck-quality').instructions).toBe(canonicalPrompt.trim());
  writeFileSync(join(root, 'opencode.jsonc'), '// effective override\n' + JSON.stringify({ agent: { 'deck-quality': { tools: { bash: true } } } }));
  expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).toThrow('read-only policy changed');
});
// Protects executable trust. No receipt or a changed executable must refuse before spawn.
test('edited plugin refuses read-only admission until canonical refresh repairs it', async () => {
  const adapter = await install(), path = join(root, 'plugins/developer-team-execution.js');
  const canonical = readFileSync(path, 'utf8');
  writeFileSync(path, 'user executable');
  expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).toThrow('execution-plugin-untrusted');
  expect(readFileSync(path, 'utf8')).toBe('user executable');
  await adapter.prepareSessionNativeRole!('deck-quality', config());
  expect(readFileSync(path, 'utf8')).toBe(canonical);
});

// Protects optimistic preimages: an edit after preview must never be overwritten.
test('concurrent edit refuses publication and preserves the editor bytes', async () => {
  const adapter = await install(), path = join(root, 'prompts/deck-team/deck-quality.md');
  drift(path); const plan = adapter.prepare(); writeFileSync(path, 'concurrent editor');
  expect(() => applyOpenCodeRefresh(root, plan)).toThrow('changed during preparation');
  expect(readFileSync(path, 'utf8')).toBe('concurrent editor');
});
// Protects rejection before repair, then trusted regeneration of the exact managed plugin.
test('unreceipted managed plugin refuses admission until canonical repair', async () => {
  const adapter = await install(), path = join(root, 'deck/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.contributions = manifest.contributions.filter((e: any) => !e.path.endsWith('developer-team-execution.js'));
  writeFileSync(path, JSON.stringify(manifest));
  expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).toThrow('execution-plugin-untrusted');
  await adapter.prepareSessionNativeRole('deck-quality', config());
  expect(() => prepareOpenCodeNativeRole(root, 'deck-quality')).not.toThrow();
});

