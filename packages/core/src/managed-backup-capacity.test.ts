import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { backupManagedPreimages } from './managed-artifacts';
import { beginRunnerContributions, contributionHash } from './runner-contributions';

// Protects legitimate generated upgrades and retry without adopting backup bytes as receipts.
// Oracle: exact canonical bundle preimage survives a failed commit and a successful retry.
test('large generated preimages survive failed publication and canonical retry within storage bounds', () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-backup-upgrade-')));
 try {
  const path = join(root, 'generated/plugin.js'); mkdirSync(dirname(path));
  const original = readFileSync(new URL('../../adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js', import.meta.url));
  expect(original.length).toBeGreaterThan(16 * 1024 * 1024);
  writeFileSync(path, original);
  const canonical = Buffer.concat([original, Buffer.from('\n// canonical upgrade\n')]);
  const target = { path, selector: { kind: 'file' as const }, expectedHash: contributionHash(canonical) };
  const input = { runnerId: 'opencode', root, manifestPath: join(root, 'manifest.json'), deckVersion: '1.0.0', targets: [target], managed: {
   inventory: { runnerId: 'opencode', root, generatedRoots: [dirname(path)], slots: [] }, stateRoot: join(root, 'state'),
  } };
  const first = beginRunnerContributions(input);
  expect(() => first.commit()).toThrow('postimage');
  expect(readFileSync(path)).toEqual(original);
  expect(existsSync(input.manifestPath)).toBe(false);
  first.abort();
  const saved = readFileSync(first.backupPath!);
  const backup = JSON.parse(saved.toString());
  expect(backup.schema).toBe(2);
  const entry = backup.entries[0];
  expect(entry.encoding).toBe('gzip-base64');
  const decoded = gunzipSync(Buffer.from(entry.content, 'base64'), { maxOutputLength: 64 * 1024 * 1024 });
  expect(decoded).toEqual(original);
  expect(entry.bytes).toBe(original.length);
  expect(statSync(first.backupPath!).mode & 0o777).toBe(0o600);
  const retry = beginRunnerContributions(input);
  writeFileSync(path, canonical); retry.commit();
  expect(readFileSync(first.backupPath!)).toEqual(saved);
  expect(existsSync(`${input.manifestPath}.pending`)).toBe(false);
  expect(JSON.parse(readFileSync(input.manifestPath, 'utf8')).contributions[0].hash).toBe(contributionHash(canonical));
  const directory = dirname(retry.backupPath!);
  expect(readdirSync(directory).reduce((n, name) => n + statSync(join(directory, name)).size, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects independent encoded/raw capacity guards and preservation of earlier forensic evidence.
// Oracle: incompressible excess or aggregate decoded excess fails before publication/pruning.
test('backup rejection preserves prior evidence for encoded and aggregate raw excess', () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-backup-bound-')));
 try {
  const target = { path: join(root, 'plugin'), selector: { kind: 'file' as const } };
  const save = (contents: Uint8Array[]) => backupManagedPreimages({ root, runnerId: 'opencode', stateRoot: join(root, 'state'), entries: contents.map(content => ({ target, content })) })!;
  const path = save([Buffer.from('foreign preimage')]), before = readFileSync(path);
  const names = readdirSync(dirname(path));
  expect(() => save([randomBytes(13 * 1024 * 1024)])).toThrow('capacity');
  const chunk = Buffer.alloc(33 * 1024 * 1024);
  expect(() => save([chunk, chunk])).toThrow('capacity');
  expect(readFileSync(path)).toEqual(before);
  expect(readdirSync(dirname(path))).toEqual(names);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
