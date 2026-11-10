import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureMarker } from './retirement-matrix-fixture';
import { migratedRecoveryScenario } from './retirement-historical-scenarios';

// Protects the maintained migration harness's recovery oracle: concurrent edits
// must survive rejection, then captured preimages permit rollback and retry.
test('historical recovery uses independent captured authority and preserves file bytes', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-recovery-oracle-')));
  try {
    writeFileSync(join(home, '.retirement-fixture'), fixtureMarker);
    const target = join(home, 'migrated.txt');
    writeFileSync(target, 'captured migrated file');
    expect(migratedRecoveryScenario(home, 'codex', target).status).toBe('verified');
    expect(readFileSync(target, 'utf8')).toBe('captured migrated file');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
