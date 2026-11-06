import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contributionId, contributionHash, readRunnerContributions, compareReleaseVersions, validReleaseVersion, assertNoContributionSymlink } from '@deck/core';
import { inspectRecoveryJournal, recoveryHash } from '../../core/src/canonical-recovery-preflight';

/** Legacy/no-fence completion is permitted only after canonical postimages already
 * exist. This assessment performs no effects and never reads a journal-selected path. */
export function precheckClaudeContributionRecovery(root: string, version: string, targets: readonly { path: string; content: string }[]): void {
  const path = join(root, 'manifest.json'), journal = inspectRecoveryJournal(path + '.pending');
  if (!journal) return;
  const raw = journal.value;
  const compatible = (v: unknown) => typeof v === 'string' && validReleaseVersion(v) && compareReleaseVersions(v, version) <= 0;
  if (raw?.runnerId !== 'claude' || raw.root !== root || raw.manifestPath !== path || raw.scope !== 'global' || raw.managed !== true || !compatible(raw.deckVersion) || !Array.isArray(raw.targets) || raw.targets.length !== targets.length) throw new Error('claude-legacy-recovery-unproven');
  const manifest = readRunnerContributions(path);
  if (manifest && (manifest.runnerId !== 'claude' || manifest.root !== root || !compatible(manifest.deckVersion))) throw new Error('claude-legacy-recovery-manifest-incompatible');
  const expected = new Map(targets.map(target => [contributionId({ path: target.path, selector: { kind: 'file' } }), target]));
  const seen = new Set<string>();
  for (const entry of raw.targets) {
    const target = expected.get(entry?.id);
    if (!target || seen.has(entry.id) || entry.target?.path !== target.path || entry.target?.selector?.kind !== 'file' || Object.keys(entry.target.selector).length !== 1 || entry.postimage !== contributionHash(target.content) || !recoveryHash(entry.preimage)) throw new Error('claude-legacy-recovery-target-unproven');
    seen.add(entry.id);
  }
  for (const target of targets) {
    assertNoContributionSymlink(target.path);
    if (!existsSync(target.path) || readFileSync(target.path, 'utf8') !== target.content) throw new Error('claude-legacy-recovery-postimage-unproven');
  }
  journal.unchanged();
}
