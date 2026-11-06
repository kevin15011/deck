import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginRunnerContributions, contributionHash, contributionId } from '@deck/core';
// Protects caller-authoritative version when legacy accounting discovers pending evidence.
// Oracle: newer/unknown provenance must refuse before publication, even with canonical bytes.
// Fails if journal version is promoted into the new receipt or the journal disappears.
test('contribution completion refuses a newer pending writer before effects', () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'claude-legacy-version-')));
 try {
  const path = join(root, 'manifest.json'), target = { path: join(root, 'output'), selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  mkdirSync(join(root, 'generated')); target.path = join(root, 'generated/output');
  writeFileSync(target.path, 'canonical');
  const bytes = JSON.stringify({ runnerId: 'claude', root, deckVersion: '999.0.0+build.1', manifestPath: path, managed: true, scope: 'global', targets: [{ target, id: contributionId(target), preimage: 'absent', postimage: target.expectedHash }] });
  writeFileSync(path + '.pending', bytes, { mode: 0o600 });
  expect(() => beginRunnerContributions({ runnerId: 'claude', root, manifestPath: path, deckVersion: '0.14.0', targets: [target], managed: { stateRoot: join(root, 'backups'), inventory: { runnerId: 'claude', root, generatedRoots: [join(root, 'generated')], slots: [] } } })).toThrow('incompatible');
  expect(readFileSync(path + '.pending', 'utf8')).toBe(bytes);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

import { precheckClaudeContributionRecovery } from './recovery-precheck';
// Protects the no-fence path: exact identity, shape, version and canonical bytes
// must all qualify before an existing journal can be completed.
for (const fault of ['none', 'version', 'path', 'bytes', 'scope'] as const) test(`Claude read-only legacy assessment: ${fault}`, () => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'claude-legacy-precheck-')));
 try {
  const manifestPath = join(root, 'manifest.json'), target = { path: join(root, 'output'), selector: { kind: 'file' as const } };
  writeFileSync(target.path, fault === 'bytes' ? 'edited' : 'canonical');
  const journalTarget = fault === 'path' ? { ...target, path: join(root, 'foreign') } : target;
  const bytes = JSON.stringify({ runnerId: 'claude', root, deckVersion: fault === 'version' ? '999.0.0+build' : '0.14.0', manifestPath, managed: true, scope: fault === 'scope' ? 'project' : 'global', targets: [{ target: journalTarget, id: contributionId(journalTarget), preimage: 'absent', postimage: contributionHash('canonical') }] });
  writeFileSync(manifestPath + '.pending', bytes, { mode: 0o600 });
  const check = () => precheckClaudeContributionRecovery(root, '0.14.0', [{ path: target.path, content: 'canonical' }]);
  if (fault === 'none') expect(check).not.toThrow(); else expect(check).toThrow();
  expect(readFileSync(manifestPath + '.pending', 'utf8')).toBe(bytes);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
