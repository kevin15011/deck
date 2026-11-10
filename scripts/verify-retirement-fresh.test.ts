import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFreshRetirementInputs, suites } from './verify-retirement-fresh';
import { discoverTests } from './test';

// Protects CI's explicit release inventory against file deletion/rename drift.
// Oracle: every selected contract must exist and participate in the full gate.
test('fresh retirement requires real discovered tests for every release input', () => {
  const root = resolve(import.meta.dir, '..');
  assertFreshRetirementInputs(root);
  const discovered = new Set(discoverTests(root));
  for (const suite of suites) expect(discovered.has(suite), suite).toBe(true);
});

test('missing required input fails before evidence or subprocess effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-fresh-inputs-'));
  try {
    for (const suite of suites.slice(1)) {
      const path = join(root, suite); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '');
    }
    expect(() => assertFreshRetirementInputs(root)).toThrow(suites[0]!);
    mkdirSync(join(root, suites[0]!), { recursive: true });
    expect(() => assertFreshRetirementInputs(root)).toThrow(suites[0]!);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Release and its reusable historical job must not silently reference retired files.
test('release workflow source inputs exist and explicit test inputs are discoverable', () => {
  const root = resolve(import.meta.dir, '..');
  const discovered = new Set(discoverTests(root));
  for (const workflow of ['release.yml', 'retirement-historical-diagnostic.yml']) {
    const source = readFileSync(join(root, '.github/workflows', workflow), 'utf8');
    for (const [path] of source.matchAll(/(?:scripts|apps|packages)\/[\w/.-]+\.tsx?\b/g)) {
      expect(statSync(join(root, path)).isFile(), `${workflow}: ${path}`).toBe(true);
      if (path.endsWith('.test.ts')) expect(discovered.has(path), path).toBe(true);
    }
  }
});
