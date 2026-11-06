import { afterEach, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRunnerGenerationReference, guardRunnerGenerationRetirement, inspectRunnerGenerationReferences } from './runner-generation-references';
import { contributionHash } from './runner-contributions';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const roots: string[] = [];
let ps: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  ps?.mockRestore(); ps = undefined;
  Object.defineProperty(process, 'platform', platform);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'deck-generation-')); roots.push(parent);
  const root = join(parent, 'developer-team-v2-aabb'), selectionPath = join(parent, 'model-assignments.json');
  mkdirSync(root);
  writeFileSync(selectionPath, JSON.stringify({ plugin: 'developer-team-v2-ccdd' }));
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  ps = spyOn(childProcess, 'execFileSync');
  return { parent, root, selectionPath };
}
const self = () => `${process.getuid!()} ${process.pid} /bin/bun test\n`;

// Protects: a complete unused process inventory permits collection; current,
// held and interrupted generation evidence always vetoes it (independent oracle).
test('Darwin unused generation can retire while selection and launch receipts preserve it', () => {
  const f = fixture(); ps!.mockReturnValue(self());
  expect(inspectRunnerGenerationReferences(f.root, f.selectionPath)).toEqual([]);
  const releaseGate = guardRunnerGenerationRetirement(f.root, f.selectionPath);
  expect(existsSync(join(f.parent, '.developer-team-v2-aabb.retiring'))).toBe(true);
  releaseGate();
  writeFileSync(f.selectionPath, JSON.stringify({ plugin: 'developer-team-v2-aabb' }));
  expect(() => guardRunnerGenerationRetirement(f.root, f.selectionPath)).toThrow('Current plugin selection');
  const release = acquireRunnerGenerationReference({ root: f.root, selectionPath: f.selectionPath, selectionHash: contributionHash(readFileSync(f.selectionPath)) });
  writeFileSync(f.selectionPath, JSON.stringify({ plugin: 'developer-team-v2-ccdd' }));
  expect(() => guardRunnerGenerationRetirement(f.root, f.selectionPath)).toThrow('Launch reference receipts');
  release();
  writeFileSync(join(f.parent, 'manifest.json.pending'), '{}');
  expect(() => guardRunnerGenerationRetirement(f.root, f.selectionPath)).toThrow('pending recovery');
  expect(existsSync(join(f.parent, '.developer-team-v2-aabb.retiring'))).toBe(false);
});

// ps cannot prove argv boundaries, relative paths or symlink aliases. Any flag
// for this user must preserve; command bytes must never enter diagnostics.
for (const command of ['claude --plugin-dir=/private/secret', 'claude --plugin-dir "relative path"', 'claude --plugin-dir /different/generation', 'wrapper argument--plugin-dir=alias']) {
  test(`Darwin preserves uncertain plugin arguments: ${command.split(' ')[0]}`, () => {
    const f = fixture(); ps!.mockReturnValue(self() + `${process.getuid!()} 987 ${command}\n`);
    const reasons = inspectRunnerGenerationReferences(f.root, f.selectionPath);
    expect(reasons.join(';')).toContain('Native process 987');
    expect(reasons.join(';')).not.toContain(command);
    expect(() => guardRunnerGenerationRetirement(f.root, f.selectionPath)).toThrow('remains referenced');
    expect(existsSync(f.root)).toBe(true);
  });
}

for (const table of ['', 'malformed', '1 2 other-user\n', ...['?', '(claude)', '[claude]', '-'].map(command => () => self() + `${process.getuid!()} 987 ${command}\n`), () => self() + 'truncated\n']) {
  test('Darwin incomplete inventory preserves the generation', () => {
    const f = fixture(); ps!.mockReturnValue(typeof table === 'function' ? table() : table);
    expect(() => guardRunnerGenerationRetirement(f.root, f.selectionPath)).toThrow('cannot be completely inspected');
  });
}
test('Darwin process inspection failure preserves without leaking subprocess output', () => {
  const f = fixture(); ps!.mockImplementation(() => { throw new Error('credential-sentinel'); });
  const reasons = inspectRunnerGenerationReferences(f.root, f.selectionPath).join(';');
  expect(reasons).toContain('cannot be completely inspected');
  expect(reasons).not.toContain('credential-sentinel');
});
test('Darwin ignores plugin arguments belonging to another user', () => {
  const f = fixture(); ps!.mockReturnValue(self() + `${process.getuid!() + 1} 987 claude --plugin-dir /elsewhere\n`);
  expect(inspectRunnerGenerationReferences(f.root, f.selectionPath)).toEqual([]);
});
