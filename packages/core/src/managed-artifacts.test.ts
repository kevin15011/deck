import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginRunnerContributions, contributionHash, readRunnerContributions, recoverRunnerContributionTransaction } from './runner-contributions';
import { decideRunnerWrite } from './runner-writer-fence';

const build = { semver: '1.0.0', commit: 'abc', channel: 'stable' as const };
function fixture() {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-managed-')));
 const path = join(root, 'generated', 'plugin.js'); mkdirSync(join(root, 'generated'));
 return { root, path, runnerId: 'codex', manifestPath: join(root, 'receipts.json'), deckVersion: '1.0.0',
  managed: { inventory: { runnerId: 'codex', root, generatedRoots: [join(root, 'generated')], slots: [] }, stateRoot: join(root, 'state') } };
}
// Protects canonical regeneration without adoption; oracle: managed policy P1/P2/P5.
// Fails if old bytes veto replacement or arbitrary apply bytes become a receipt.
test('managed transactions replace unreceipted and edited output, back up preimages, and require canonical publication', () => {
 const f = fixture();
 try {
  writeFileSync(f.path, 'old executable');
  const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  let tx = beginRunnerContributions({ ...f, targets: [target] });
  expect(tx.backupPath).toBeDefined();
  const backup = JSON.parse(readFileSync(tx.backupPath!, 'utf8'));
  expect(Buffer.from(backup.entries[0].content, 'base64').toString()).toBe('old executable');
  expect(statSync(tx.backupPath!).mode & 0o777).toBe(0o600);
  writeFileSync(f.path, 'arbitrary');
  expect(() => tx.commit()).toThrow('postimage');
  expect(existsSync(f.manifestPath)).toBe(false);
  writeFileSync(f.path, 'canonical'); tx.commit();
  expect(readRunnerContributions(f.manifestPath)?.contributions[0]?.hash).toBe(target.expectedHash);
  writeFileSync(f.path, 'edited');
  tx = beginRunnerContributions({ ...f, targets: [target] });
  writeFileSync(f.path, 'canonical'); tx.commit();
  tx = beginRunnerContributions({ ...f, targets: [target] });
  expect(tx.backupPath).toBeUndefined(); tx.commit();
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects equal-version repair AND convergence; oracle: policy P6, no build hash ordering.
test('managed drift permits equal-version repair without bypassing newer, pending or corrupt fences', () => {
 const record = { fenceSchema: 1 as const, epoch: 1, stateSchema: 1, writer: build };
 expect(decideRunnerWrite(record, build, 'refresh', true, 1, true)).toBe('write');
 expect(decideRunnerWrite(record, { ...build, channel: 'canary' }, 'refresh', true, 1, false)).toBe('compatible-installed-state');
 expect(decideRunnerWrite({ ...record, writer: { ...build, semver: '2.0.0' } }, build, 'refresh', true, 1, true)).toBe('managed-by-newer-deck');
 expect(decideRunnerWrite({ ...record, pending: { epoch: 2, stateSchema: 1, writer: build } }, build, 'refresh', true, 1, true)).toBe('runner-write-recovery-required');
 expect(decideRunnerWrite('unreadable', build, 'refresh', true, 1, true)).toBe('runner-fence-unreadable');
});

import { backupManagedPreimages, classifyManagedSlot, inspectManagedDrift, type ManagedTargetInventory } from './managed-artifacts';
import { contributionId, type RunnerContribution } from './runner-contributions';
function receipt(target: { path: string; selector: { kind: 'file' } }, content: string): RunnerContribution {
 return { ...target, id: contributionId(target), hash: contributionHash(content), encoding: 'bytes', ownership: 'dedicated-location', scope: 'global' };
}
// Protects bounded authority; oracle: only trusted inventory may enumerate writable paths/selectors.
// Fails if forged receipts/history or a broad prefix expands the managed target set.
test('receipts and history recognize only enumerated candidates, never neighboring paths or selectors', () => {
 const f = fixture();
 try {
  const path = join(f.root, 'shared.json');
  const target = { path, selector: { kind: 'json' as const, keys: ['agent', 'deck-quality'] }, expectedHash: contributionHash('{}') };
  const inventory: ManagedTargetInventory = { ...f.managed.inventory, slots: [{ ...target, authority: 'generated' }] };
  expect(classifyManagedSlot({ inventory, target, content: 'edited' })).toBe('generated-slot');
  for (const foreign of [
   { path, selector: { kind: 'json' as const, keys: ['agent', 'deck-custom'] } },
   { path, selector: { kind: 'file' as const } },
   { path: join(f.root, '..', 'outside'), selector: { kind: 'file' as const } },
   { path: join(f.root, 'generated-neighbor', 'script'), selector: { kind: 'file' as const } },
  ]) {
   const forged = { ...foreign, id: contributionId(foreign), hash: contributionHash('edited') } as RunnerContribution;
   expect(classifyManagedSlot({ inventory, target: foreign, content: 'edited', receipts: [forged], history: [forged] })).toBe('ambiguous');
  }
  const generic = { path: join(f.root, 'generic-skill'), selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  const candidates: ManagedTargetInventory = { ...inventory, slots: [{ ...generic, authority: 'recognized' }] };
  const old = receipt(generic, 'historical');
  expect(classifyManagedSlot({ inventory: candidates, target: generic, content: 'edited' })).toBe('ambiguous');
  expect(classifyManagedSlot({ inventory: candidates, target: generic, content: 'edited', history: [old] })).toBe('history');
  expect(classifyManagedSlot({ inventory: candidates, target: generic, content: 'edited', receipts: [{ ...old, id: 'f'.repeat(64) }] })).toBe('ambiguous');
  expect(classifyManagedSlot({ inventory: candidates, target: generic, content: 'canonical' })).toBe('canonical');
  expect(classifyManagedSlot({ inventory: candidates, target: generic, content: undefined })).toBe('new');
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects convergence: an installed valid receipt beats a same-version generator difference.
test('drift inspection is read-only and uses receipts rather than peer generator output', () => {
 const f = fixture();
 try {
  const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canary generator') };
  writeFileSync(f.path, 'stable generator');
  const installed = receipt(target, 'stable generator');
  const inspect = (receipts: RunnerContribution[] = []) => inspectManagedDrift({ inventory: f.managed.inventory, targets: [target], receipts });
  expect(inspect([installed]).drift).toBe(false);
  expect(inspect().drift).toBe(true);
  writeFileSync(f.path, 'edited'); expect(inspect([installed]).drift).toBe(true);
  expect(readFileSync(f.path, 'utf8')).toBe('edited');
  expect(existsSync(f.manifestPath)).toBe(false); expect(existsSync(f.managed.stateRoot)).toBe(false);
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects journal and backup safe failure; oracle: no canonical verification means no receipt.
test('managed rollback, missing postimages, required hashes and backup failures preserve trust boundaries', () => {
 const f = fixture();
 try {
  const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  writeFileSync(f.path, 'original');
  expect(() => beginRunnerContributions({ ...f, targets: [{ ...target, expectedHash: undefined }] })).toThrow('postimage-required');
  expect(existsSync(`${f.manifestPath}.pending`)).toBe(false);
  let tx = beginRunnerContributions({ ...f, targets: [target] });
  rmSync(f.path); expect(() => tx.commit()).toThrow('postimage missing');
  expect(() => tx.abort()).toThrow('rollback');
  writeFileSync(f.path, 'original'); tx.abort();
  expect(existsSync(f.manifestPath)).toBe(false);
  expect(existsSync(tx.backupPath!)).toBe(true);
  const bad = join(f.root, 'not-a-directory'); writeFileSync(bad, 'block');
  expect(() => beginRunnerContributions({ ...f, managed: { ...f.managed, stateRoot: bad }, targets: [target] })).toThrow();
  expect(readFileSync(f.path, 'utf8')).toBe('original');
  expect(existsSync(`${f.manifestPath}.pending`)).toBe(false);
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects symlink refusal and metadata immutability across the adapter's asynchronous apply.
test('managed mode refuses symlinks and freezes canonical expectations before effects', () => {
 const f = fixture();
 try {
  const outside = join(f.root, 'foreign'); writeFileSync(outside, 'foreign'); symlinkSync(outside, f.path);
  const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  expect(() => beginRunnerContributions({ ...f, targets: [target] })).toThrow('symlink');
  rmSync(f.path);
  const tx = beginRunnerContributions({ ...f, targets: [target] });
  target.expectedHash = contributionHash('untrusted'); target.path = outside;
  writeFileSync(f.path, 'untrusted'); expect(() => tx.commit()).toThrow('postimage');
  writeFileSync(f.path, 'canonical'); tx.commit();
  expect(readFileSync(outside, 'utf8')).toBe('foreign');
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects sibling content/privacy; oracle: only selected spans enter recovery storage.
test('shared selector backups exclude unrelated secrets and preserve caller rollback', () => {
 const f = fixture();
 try {
  const path = join(f.root, 'shared.json'), original = '{"secret":"untouched-secret","agent":{"deck-quality":{ /* edited */ "write": true },"foreign":{"write":true}}}';
  writeFileSync(path, original);
  const target = { path, selector: { kind: 'json' as const, keys: ['agent', 'deck-quality'] }, expectedHash: contributionHash('{"write":false}') };
  const managed = { ...f.managed, inventory: { ...f.managed.inventory, slots: [{ ...target, authority: 'generated' as const }] } };
  const tx = beginRunnerContributions({ ...f, managed, targets: [target] });
  const backup = JSON.parse(readFileSync(tx.backupPath!, 'utf8'));
  expect(Buffer.from(backup.entries[0].content, 'base64').toString()).toBe('{ /* edited */ "write": true }');
  expect(readFileSync(tx.backupPath!, 'utf8')).not.toContain('untouched-secret');
  const value = JSON.parse(original.replace('/* edited */', '')); value.agent['deck-quality'].write = false; writeFileSync(path, JSON.stringify(value)); tx.commit();
  expect(JSON.parse(readFileSync(path, 'utf8')).secret).toBe('untouched-secret');
  expect(JSON.parse(readFileSync(path, 'utf8')).agent.foreign).toEqual({ write: true });
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects storage bounds and symlink-safe retention; oracle: at most 5 transactions / 16 MiB serialized.
test('private backups enforce transaction and byte bounds and reject linked storage', () => {
 const f = fixture();
 try {
  const save = (content: string | Uint8Array) => backupManagedPreimages({ ...f, stateRoot: f.managed.stateRoot, entries: [{ target: { path: f.path, selector: { kind: 'file' } }, content }] })!;
  let latest = '';
  for (let i = 0; i < 7; i++) latest = save('old');
  const directory = join(latest, '..');
  expect(readdirSync(directory)).toHaveLength(5);
  for (let i = 0; i < 4; i++) latest = save(randomBytes(4 * 1024 * 1024));
  const names = readdirSync(directory);
  expect(names.length).toBeLessThanOrEqual(5);
  expect(names.reduce((sum, name) => sum + statSync(join(directory, name)).size, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(existsSync(latest)).toBe(true);
  const before = readdirSync(directory);
  expect(() => save(randomBytes(13 * 1024 * 1024))).toThrow('capacity');
  expect(readdirSync(directory)).toEqual(before);
  rmSync(directory, { recursive: true }); symlinkSync(join(f.root, 'generated'), directory);
  expect(() => save('old')).toThrow('unsafe');
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
// Protects the production transaction boundary against forged metadata and inventory widening.
test('managed transaction rejects forged out-of-inventory receipts and mismatched inventories', () => {
 const f = fixture();
 try {
  const foreign = { path: join(f.root, 'foreign'), selector: { kind: 'file' as const }, expectedHash: contributionHash('new') };
  writeFileSync(foreign.path, 'foreign');
  writeFileSync(f.manifestPath, JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: f.runnerId, root: f.root, deckVersion: 'old', contributions: [receipt(foreign, 'foreign')] }));
  expect(() => beginRunnerContributions({ ...f, targets: [foreign] })).toThrow('ambiguous');
  const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('new') };
  expect(() => beginRunnerContributions({ ...f, managed: { ...f.managed, inventory: { ...f.managed.inventory, runnerId: 'pi' } }, targets: [target] })).toThrow('identity-mismatch');
  expect(() => beginRunnerContributions({ ...f, managed: { ...f.managed, inventory: { ...f.managed.inventory, generatedRoots: [f.root] } }, targets: [target] })).toThrow('generated-root-invalid');
  expect(() => beginRunnerContributions({ ...f, targets: [target, target] })).toThrow('duplicate');
  expect(existsSync(`${f.manifestPath}.pending`)).toBe(false);
  expect(readFileSync(foreign.path, 'utf8')).toBe('foreign');
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// Protects MA-WP1-01: journal data cannot expand trusted inventory or choose executable hashes.
// Oracle: accepted authority design 1/2/4; fails if begin publishes any unproven recovery receipt.
test('managed recovery preserves forged journals before any receipt or metadata effect', () => {
 for (const attack of ['outside', 'hash', 'runner', 'root', 'manifest', 'inventory'] as const) {
  const f = fixture();
  try {
   const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
   const tx = beginRunnerContributions({ ...f, targets: [target] }); tx.abandon();
   const pending = `${f.manifestPath}.pending`, journal = JSON.parse(readFileSync(pending, 'utf8'));
   writeFileSync(f.path, 'canonical');
   if (attack === 'outside') {
    const foreign = { ...target, path: join(f.root, 'foreign.js') }; writeFileSync(foreign.path, 'foreign');
    journal.targets = [{ target: foreign, id: contributionId(foreign), ownership: 'new-write', preimage: 'absent', postimage: contributionHash('foreign') }];
   }
   if (attack === 'hash') { writeFileSync(f.path, 'foreign'); journal.targets[0].postimage = contributionHash('foreign'); journal.targets[0].target.expectedHash = contributionHash('foreign'); }
   if (attack === 'runner') journal.runnerId = 'pi';
   if (attack === 'root') journal.root = join(f.root, 'other');
   if (attack === 'manifest') journal.manifestPath = join(f.root, 'other.json');
   writeFileSync(pending, JSON.stringify(journal)); const before = readFileSync(pending, 'utf8');
   const input = attack === 'inventory' ? { ...f, managed: { ...f.managed, inventory: { ...f.managed.inventory, runnerId: 'pi' } } } : f;
   expect(() => beginRunnerContributions({ ...input, targets: [target] })).toThrow();
   expect(readFileSync(pending, 'utf8')).toBe(before);
   expect(existsSync(f.manifestPath)).toBe(false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 }
});
// Protects MA-WP1-02: all managed postimages must be checked independent of receipt ownership.
// Oracle: canonical generator hash; fails if malformed ownership can retain a forged launch proof.
test('managed commit derives ownership and checks canonical bytes despite malformed previous ownership', () => {
 for (const ownership of ['', null, false, 'forged']) {
  const f = fixture();
  try {
   const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
   writeFileSync(f.path, 'foreign');
   writeFileSync(f.manifestPath, JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: f.runnerId, root: f.root, contributions: [{ ...receipt(target, 'foreign'), ownership }] }));
   const tx = beginRunnerContributions({ ...f, targets: [target] });
   expect(() => tx.commit()).toThrow('postimage');
   expect(existsSync(`${f.manifestPath}.pending`)).toBe(true);
   writeFileSync(f.path, 'canonical'); const entries = tx.commit();
   expect(entries).toHaveLength(1); expect(entries[0]?.ownership).toBe('dedicated-location');
   expect(entries[0]?.hash).toBe(target.expectedHash);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 }
});
// Protects MA-WP1-03 and restart compatibility: scope survives publication, never inferred from a journal.
// Oracle: caller's trusted project/root identity; fails if recovery converts project receipts to global.
test('managed restart recovery preserves project scope and rejects scope changes', () => {
 for (const mutateScope of [false, true]) {
  const f = fixture();
  try {
   const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
   const input = { ...f, managed: { ...f.managed, scope: 'project' as const }, targets: [target] };
   const tx = beginRunnerContributions(input); writeFileSync(f.path, 'canonical'); tx.abandon();
   const pending = `${f.manifestPath}.pending`;
   if (mutateScope) {
    const journal = JSON.parse(readFileSync(pending, 'utf8')); journal.scope = 'global'; writeFileSync(pending, JSON.stringify(journal));
    expect(() => beginRunnerContributions(input)).toThrow(); expect(existsSync(pending)).toBe(true);
    expect(existsSync(f.manifestPath)).toBe(false);
   } else {
    const retry = beginRunnerContributions(input);
    expect(readRunnerContributions(f.manifestPath)?.contributions[0]?.scope).toBe('project');
    expect(retry.commit()[0]?.scope).toBe('project');
   }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 }
});

// Protects legacy compatibility without journal-only adoption; oracle: caller-known canonical targets.
// Fails if a legacy hash can publish by itself, or a valid global legacy transaction cannot resume.
test('legacy journal recovery requires canonical authority or independently captured rollback preimages', () => {
 for (const mode of ['publish', 'rollback'] as const) {
  const f = fixture();
  try {
   const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
   const tx = beginRunnerContributions({ ...f, targets: [target] }); tx.abandon();
   const pending = `${f.manifestPath}.pending`, journal = JSON.parse(readFileSync(pending, 'utf8'));
   delete journal.managed; delete journal.manifestPath; delete journal.scope;
   writeFileSync(pending, JSON.stringify(journal));
   if (mode === 'rollback') {
    expect(() => recoverRunnerContributionTransaction(f.manifestPath)).toThrow('authority');
    expect(recoverRunnerContributionTransaction(f.manifestPath, { ...f, targets: [target], rollbackPreimages: [{ target, hash: 'absent' }] })).toBe('rolled-back');
    expect(existsSync(f.manifestPath)).toBe(false);
   } else {
    writeFileSync(f.path, 'canonical');
    expect(() => recoverRunnerContributionTransaction(f.manifestPath)).toThrow('authority');
    expect(existsSync(pending)).toBe(true); expect(existsSync(f.manifestPath)).toBe(false);
    expect(recoverRunnerContributionTransaction(f.manifestPath, { ...f, targets: [target] })).toBe('completed');
    expect(readRunnerContributions(f.manifestPath)?.contributions[0]?.scope).toBe('global');
   }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 }
});
// Protects scoped partial recovery and refuses context-free managed recovery, even for rollback.
// Oracle: only canonical completed targets receive receipts; untouched siblings retain their scope.
test('managed recovery accounts only canonical completed targets and preserves unproven journals', () => {
 const f = fixture();
 try {
  const targets = [f.path, join(f.root, 'generated', 'other.js')].map(path => ({ path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') }));
  const input = { ...f, managed: { ...f.managed, scope: 'project' as const }, targets };
  const tx = beginRunnerContributions(input); tx.abandon();
  expect(() => recoverRunnerContributionTransaction(f.manifestPath)).toThrow('authority');
  writeFileSync(f.path, 'canonical');
  expect(recoverRunnerContributionTransaction(f.manifestPath, { ...input, rollbackPreimages: targets.map(target => ({ target, hash: 'absent' as const })) })).toBe('recovered-partial');
  const entries = readRunnerContributions(f.manifestPath)!.contributions;
  expect(entries).toHaveLength(1); expect(entries[0]?.path).toBe(f.path); expect(entries[0]?.scope).toBe('project');
  expect(existsSync(`${f.manifestPath}.pending`)).toBe(false);
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// Protects MA-WP1-01 evidence retention independently of attacker-controlled journal mode.
// Oracle: no settlement without caller authority and proven preimages; no receipt/evidence loss.
test('recovery retains downgraded stripped forged-preimage and empty journals', () => {
 for (const attack of ['downgraded', 'stripped', 'empty'] as const) {
  const f = fixture();
  try {
   const target = { path: f.path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
   const tx = beginRunnerContributions({ ...f, targets: [target] }); tx.abandon();
   writeFileSync(f.path, 'noncanonical');
   const pending = `${f.manifestPath}.pending`, journal = JSON.parse(readFileSync(pending, 'utf8'));
   journal.managed = false;
   journal.targets[0].preimage = contributionHash('noncanonical');
   if (attack === 'stripped') { delete journal.managed; delete journal.scope; delete journal.manifestPath; }
   if (attack === 'empty') journal.targets = [];
   writeFileSync(pending, JSON.stringify(journal)); const before = readFileSync(pending, 'utf8');
   expect(() => recoverRunnerContributionTransaction(f.manifestPath)).toThrow();
   expect(readFileSync(pending, 'utf8')).toBe(before);
   expect(() => recoverRunnerContributionTransaction(f.manifestPath, { ...f, targets: [target] })).toThrow();
   expect(readFileSync(pending, 'utf8')).toBe(before);
   expect(existsSync(f.manifestPath)).toBe(false);
   expect(readFileSync(f.path, 'utf8')).toBe('noncanonical');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 }
});

// Protects complete inventory validation and first-slot precedence during indexed assessment.
test('drift assessment validates unselected slots and preserves first matching authority', () => {
 const f = fixture();
 try {
  const path = join(f.root, 'shared'); writeFileSync(path, 'foreign');
  const target = { path, selector: { kind: 'file' as const }, expectedHash: contributionHash('canonical') };
  const slots = [{ ...target, authority: 'recognized' as const }, { ...target, authority: 'generated' as const }];
  const inventory = { ...f.managed.inventory, slots };
  expect(inspectManagedDrift({ inventory, targets: [target] }).ambiguous).toEqual([target]);
  expect(() => inspectManagedDrift({ inventory: { ...inventory, slots: [...slots, { ...target, path: join(f.root, '..', 'outside'), authority: 'generated' }] }, targets: [target] })).toThrow('managed-slot-outside-root');
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
