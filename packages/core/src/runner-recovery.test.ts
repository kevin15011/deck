import { expect, test } from 'bun:test';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveRunnerJournal } from './runner-recovery-archive';
import { readRunnerFence, recordRunnerMutationJournals, withRunnerFence, withRunnerFenceRecovery as recover } from './runner-writer-fence';
import { withInstallationMutation } from './installation-use';
import { writePrivateState } from './runner-history';
function withRunnerFenceRecovery(input: Omit<Parameters<typeof recover>[0], 'mutationRoot' | 'expected' | 'journalKinds'>) {
 return withInstallationMutation(dirname(input.path), () => recover({ ...input, mutationRoot: dirname(input.path), expected: readRunnerFence(input.path), journalKinds: ['fixture-journal'] }));
}
const self = { semver: '1.0.0', commit: 'abc', channel: 'stable' as const };
const journal = { kind: 'fixture-journal', operationId: 'original', id: 'original' };
const scope = { kind: 'deck-scope-v1', operationId: 'original', id: 'global' };
function fixture() { const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-recovery-'))); return { root, path: join(root, 'fence.json'), live: join(root, 'transaction.pending.json') }; }
function pending(path: string, refs = [journal, scope]) { writePrivateState(path, { fenceSchema: 1, epoch: 0, stateSchema: 1, writer: self, pending: { epoch: 1, stateSchema: 1, writer: self, journals: refs } }); }
// Protects inode-preserving, private forensic archival without trusting journal contents.
test('archive retries same-inode links and preserves foreign, linked and bound history', () => {
 const { root, live } = fixture(); const archive = join(root, 'recovery-archive');
 try {
  mkdirSync(archive, { mode: 0o700 }); writeFileSync(live, 'malformed private evidence', { mode: 0o600 });
  const original = lstatSync(live); const linked = join(archive, '1700000000000-fixture-journal-original.json'); linkSync(live, linked);
  writeFileSync(join(archive, 'foreign'), 'keep'); symlinkSync(live, join(archive, 'foreign-link'));
  for (let i = 0; i < 12; i++) writeFileSync(join(archive, `${1700000000001 + i}-fixture-journal-old${i}.json`), 'old', { mode: 0o600 });
  archiveRunnerJournal({ livePath: live, reference: journal, bound: [journal], journalKinds: ['fixture-journal'] });
  expect(existsSync(live)).toBe(false); expect(lstatSync(linked).ino).toBe(original.ino);
  expect(readFileSync(linked, 'utf8')).toBe('malformed private evidence');
  expect(readdirSync(archive).filter(name => name.endsWith('.json')).length).toBe(8);
  expect(readFileSync(join(archive, 'foreign'), 'utf8')).toBe('keep');
  expect(lstatSync(join(archive, 'foreign-link')).isSymbolicLink()).toBe(true);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects refusal before live evidence is unlinked; unsafe archive permissions are never repaired.
test('archive collisions and unsafe directories preserve live evidence', () => {
 for (const fault of ['collision', 'mode', 'symlink'] as const) {
  const { root, live } = fixture(); const archive = join(root, 'recovery-archive');
  try {
   writeFileSync(live, 'evidence', { mode: 0o600 });
   if (fault === 'symlink') { mkdirSync(join(root, 'elsewhere')); symlinkSync(join(root, 'elsewhere'), archive); }
   else { mkdirSync(archive, { mode: 0o700 }); if (fault === 'mode') chmodSync(archive, 0o755); else writeFileSync(join(archive, '1700000000000-fixture-journal-original.json'), 'foreign', { mode: 0o600 }); }
   expect(() => archiveRunnerJournal({ livePath: live, reference: journal, bound: [journal], journalKinds: ['fixture-journal'] })).toThrow();
   expect(readFileSync(live, 'utf8')).toBe('evidence');
   if (fault === 'mode') expect(lstatSync(archive).mode & 0o777).toBe(0o755);
  } finally { rmSync(root, { recursive: true, force: true }); }
 }
});
// Protects durable binding across archive/reconcile failures, marker rotation, and verified commit.
test('canonical recovery retains original references until all archives complete and rotates on retry', async () => {
 const { root, path } = fixture();
 try {
  pending(path); let marker = ''; let calls = 0;
  for (let i = 0; i < 3; i++) {
   await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
    archive: async refs => { expect(refs).toEqual([journal]); const f = readRunnerFence(path) as any; expect(f.pending.journals[0].id).not.toBe(marker); marker = f.pending.journals[0].id; throw Error('archive barrier'); },
    reconcile: async () => { calls++; }, verify: async () => true,
   })).rejects.toThrow('archive barrier');
   expect((readRunnerFence(path) as any).pending.journals).toContainEqual(journal);
  }
  expect(calls).toBe(0);
  await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async refs => { expect(refs).toEqual([journal]); }, reconcile: async () => {
    recordRunnerMutationJournals([{ ...journal, id: 'new', operationId: 'new' }]);
    const refs = (readRunnerFence(path) as any).pending.journals;
    expect(refs.map((r: any) => r.kind)).toEqual(['canonical-recovery-v1', 'deck-scope-v1', 'fixture-journal']);
   }, verify: async () => true,
  });
  expect(readRunnerFence(path)).toEqual({ fenceSchema: 1, epoch: 1, writer: self, stateSchema: 1 });
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects project scope and unknown/newer writer evidence before any archive or canonical effect.
test('recovery refuses missing scope, incompatible provenance, capacity, and project mismatch without writes', async () => {
 const { root, path } = fixture();
 try {
  for (const fault of ['scope', 'newer', 'invalid', 'schema', 'capacity', 'project'] as const) {
   pending(path, fault === 'scope' ? [journal] : fault === 'project' ? [journal, { ...scope, id: 'p-' + 'a'.repeat(64) }] : [journal, scope]);
   const f = readRunnerFence(path) as any;
   if (fault === 'newer') f.writer.semver = '2.0.0';
   if (fault === 'invalid') f.writer.semver = 'garbage';
   if (fault === 'schema') f.stateSchema = 2;
   writePrivateState(path, f); const before = readFileSync(path, 'utf8'); let effects = 0;
   await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: fault === 'capacity' ? 31 : 1,
    archive: async () => { effects++; }, reconcile: async () => { effects++; }, verify: async () => true,
   })).rejects.toThrow();
   expect(effects).toBe(0); expect(readFileSync(path, 'utf8')).toBe(before);
  }
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects interrupted verification and prefix capacity even when an adapter records repeatedly.
test('failed verification remains pending and reference capacity fails before adapter effects', async () => {
 const { root, path } = fixture();
 try {
  pending(path);
  await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async () => {}, reconcile: async () => {
    for (let i = 0; i < 40; i++) recordRunnerMutationJournals([{ ...journal, id: `new${i}`, operationId: `new${i}` }]);
    expect((readRunnerFence(path) as any).pending.journals.length).toBe(3);
   }, verify: async () => false,
  })).rejects.toThrow('recovery-verification-failed');
  expect((readRunnerFence(path) as any).pending.journals.length).toBe(3);
  await expect(withRunnerFence({ path: join(root, 'other.json'), self, stateSchema: 1, effect: async () => {
   recordRunnerMutationJournals(Array.from({ length: 33 }, (_, i) => ({ ...journal, id: `j${i}` })));
  }, changed: () => true })).rejects.toThrow('recovery-journal-capacity');
 } finally { rmSync(root, { recursive: true, force: true }); }
});

import { runnerProjectScope } from './runner-writer-fence';
import { syncDirectory } from './durable-filesystem';
import { unlinkSync } from 'node:fs';
// Protects the exclusive-effect boundary; neither active use nor an unreserved caller may rotate evidence.
test('canonical recovery requires the existing mutation reservation', async () => {
 const { root, path } = fixture();
 try {
  pending(path); const before = readFileSync(path, 'utf8'); let effects = 0;
  await expect(recover({ path, mutationRoot: root, expected: readRunnerFence(path), journalKinds: ['fixture-journal'], self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async () => { effects++; }, reconcile: async () => { effects++; }, verify: async () => true,
  })).rejects.toThrow('runner-recovery-mutation-unreserved');
  expect(effects).toBe(0); expect(readFileSync(path, 'utf8')).toBe(before);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects durable project binding through each process-crash boundary. Oracles are
// current generator output and normal admission, never bytes or targets from the journal.
test('real SIGKILL recovery converges in global and matching project scope at publication boundaries', async () => {
 const boundaries = ['takeover', 'link', 'unlink', 'release', 'record', 'journal', 'publication', 'verify', 'commit'];
 for (const projectScoped of [false, true]) for (const boundary of boundaries) {
  const { root, path, live } = fixture(); const project = join(root, 'project');
  try {
   mkdirSync(project, { mode: 0o700 });
   pending(path, [journal, { ...scope, id: projectScoped ? runnerProjectScope(project) : 'global' }]);
   writeFileSync(live, 'unparseable original private evidence', { mode: 0o600 });
   const child = Bun.spawn([process.execPath, join(import.meta.dir, 'runner-recovery.fixture.ts'), root, boundary, projectScoped ? project : 'global'], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, TMPDIR: tmpdir() } });
   const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
   expect(stderr).toBe(''); expect(code).not.toBe(0); expect(child.signalCode).toBe('SIGKILL');
   const observed = readRunnerFence(path) as any;
   if (observed.pending) {
    expect(observed.pending.journals.length).toBeLessThanOrEqual(3);
    if (projectScoped) {
     const before = readFileSync(path, 'utf8');
     for (const context of [{ intent: 'refresh' as const }, { intent: 'explicit' as const, projectRoot: root }]) {
      await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context, maximumAdapterJournals: 1,
       archive: async () => { throw Error('must not archive'); }, reconcile: async () => { throw Error('must not publish'); }, verify: async () => true,
      })).rejects.toThrow('runner-recovery-project-scope-required');
      expect(readFileSync(path, 'utf8')).toBe(before);
     }
    }
    await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: projectScoped ? { intent: 'explicit', projectRoot: project } : { intent: 'refresh' }, maximumAdapterJournals: 1,
     archive: async references => { for (const reference of references) archiveRunnerJournal({ livePath: live, reference, bound: references, journalKinds: ['fixture-journal'] }); },
     reconcile: async () => {
      recordRunnerMutationJournals([{ ...journal, id: 'retry', operationId: 'retry' }]);
      writePrivateState(live, { forensic: 'retry' }); writePrivateState(join(root, 'output.json'), { canonical: true });
      unlinkSync(live); syncDirectory(root);
     }, verify: async () => JSON.parse(readFileSync(join(root, 'output.json'), 'utf8')).canonical === true,
    });
   }
   expect(readRunnerFence(path)).toEqual({ fenceSchema: 1, epoch: 1, writer: self, stateSchema: 1 });
   expect(JSON.parse(readFileSync(join(root, 'output.json'), 'utf8'))).toEqual({ canonical: true });
   expect(existsSync(live)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
 }
}, 30000);
// Protects retention before another publication even when no recovery reaches commit.
test('forty failed publications remain bounded and a later canonical retry succeeds', async () => {
 const { root, path, live } = fixture();
 try {
  pending(path); writeFileSync(live, 'original private evidence', { mode: 0o600 });
  let priorMarker = '';
  for (let i = 0; i < 40; i++) {
   await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
    archive: async refs => { for (const reference of refs) archiveRunnerJournal({ livePath: live, reference, bound: refs, journalKinds: ['fixture-journal'] }); },
    reconcile: async () => {
     recordRunnerMutationJournals([{ ...journal, id: `failure${i}`, operationId: `failure${i}` }]);
     writePrivateState(live, { forensic: i }); throw Error('publication failed');
    }, verify: async () => false,
   })).rejects.toThrow('publication failed');
   const f = readRunnerFence(path) as any;
   expect(f.pending.journals).toHaveLength(3); expect(f.pending.journals[0].id).not.toBe(priorMarker); priorMarker = f.pending.journals[0].id;
   expect(readdirSync(join(root, 'recovery-archive')).length).toBeLessThanOrEqual(8);
  }
  await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async refs => { for (const reference of refs) archiveRunnerJournal({ livePath: live, reference, bound: refs, journalKinds: ['fixture-journal'] }); },
   reconcile: async () => { writePrivateState(join(root, 'output.json'), { canonical: true }); },
   verify: async () => JSON.parse(readFileSync(join(root, 'output.json'), 'utf8')).canonical === true,
  });
  expect((readRunnerFence(path) as any).pending).toBeUndefined(); expect(existsSync(live)).toBe(false);
 } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
// Protects linked history from deletion while counting it toward actual archive capacity.
test('linked unbound archive entries count toward the bound and are never pruned', () => {
 const { root, live } = fixture(); const archive = join(root, 'recovery-archive');
 try {
  mkdirSync(archive, { mode: 0o700 });
  for (let i = 0; i < 9; i++) {
   const source = join(root, `other${i}`); writeFileSync(source, `linked ${i}`, { mode: 0o600 });
   linkSync(source, join(archive, `${1700000000000 + i}-fixture-journal-old${i}.json`));
  }
  writeFileSync(live, 'original', { mode: 0o600 });
  expect(() => archiveRunnerJournal({ livePath: live, reference: journal, bound: [journal], journalKinds: ['fixture-journal'] })).toThrow('runner-recovery-archive-capacity');
  expect(readdirSync(archive)).toHaveLength(9); expect(readFileSync(live, 'utf8')).toBe('original');
 } finally { rmSync(root, { recursive: true, force: true }); }
});

import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
// Protects evidence on unsupported filesystems and failed pruning, with successful retry.
test('link and prune failures retain original bindings and live bytes', async () => {
 for (const phase of ['link', 'prune'] as const) {
  const { root, path, live } = fixture(); const archive = join(root, 'recovery-archive');
  try {
   pending(path); writeFileSync(live, 'private original', { mode: 0o600 });
   if (phase === 'prune') {
    mkdirSync(archive, { mode: 0o700 });
    for (let i = 0; i < 12; i++) writeFileSync(join(archive, `${1700000000000 + i}-fixture-journal-old${i}.json`), 'old', { mode: 0o600 });
   }
   const link = fs.linkSync, unlink = fs.unlinkSync;
   const linkSpy = spyOn(fs, 'linkSync').mockImplementation((a, b) => { if (phase === 'link') throw Object.assign(Error('unsupported link'), { code: 'EXDEV' }); link(a, b); });
   const unlinkSpy = spyOn(fs, 'unlinkSync').mockImplementation(p => { if (phase === 'prune' && String(p).startsWith(archive)) throw Object.assign(Error('prune denied'), { code: 'EACCES' }); unlink(p); });
   let effects = 0;
   try {
    await expect(withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
     archive: async refs => { for (const reference of refs) archiveRunnerJournal({ livePath: live, reference, bound: refs, journalKinds: ['fixture-journal'] }); },
     reconcile: async () => { effects++; }, verify: async () => true,
    })).rejects.toThrow(phase === 'link' ? 'unsupported link' : 'prune denied');
   } finally { linkSpy.mockRestore(); unlinkSpy.mockRestore(); }
   expect(effects).toBe(0); expect(readFileSync(live, 'utf8')).toBe('private original');
   expect((readRunnerFence(path) as any).pending.journals).toContainEqual(journal);
   await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
    archive: async refs => { for (const reference of refs) archiveRunnerJournal({ livePath: live, reference, bound: refs, journalKinds: ['fixture-journal'] }); },
    reconcile: async () => { effects++; }, verify: async () => true,
   });
   expect(effects).toBe(1); expect(existsSync(live)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
 }
});
// Protects stale preflight plans, unsupported journal types, and changes made by a competing writer.
test('recovery compare-and-swap and known-kind checks precede effects and preserve replacement state', async () => {
 const { root, path } = fixture();
 try {
  pending(path); const expected = readRunnerFence(path);
  pending(path, [{ ...journal, id: 'replacement', operationId: 'replacement' }, scope]);
  const before = readFileSync(path, 'utf8'); let effects = 0;
  const input = { path, mutationRoot: root, expected, journalKinds: ['fixture-journal'], self, stateSchema: 1, context: { intent: 'refresh' as const }, maximumAdapterJournals: 1,
   archive: async () => { effects++; }, reconcile: async () => { effects++; }, verify: async () => true,
  };
  await expect(withInstallationMutation(root, () => recover(input))).rejects.toThrow('runner-fence-changed');
  await expect(withInstallationMutation(root, () => recover({ ...input, expected: readRunnerFence(path), journalKinds: [] }))).rejects.toThrow('runner-recovery-journal-kind-unknown');
  expect(readFileSync(path, 'utf8')).toBe(before); expect(effects).toBe(0);
  await expect(withInstallationMutation(root, () => recover({ ...input, expected: readRunnerFence(path), archive: async () => {
   pending(path); // Models a noncooperating writer replacing the fence during an await.
  } }))).rejects.toThrow('runner-fence-changed');
  expect((readRunnerFence(path) as any).pending.journals).toEqual([journal, scope]); expect(effects).toBe(0);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects a committed fence from detached adapter work retaining the async context.
test('closed recovery context cannot publish references after commit', async () => {
 const { root, path } = fixture(); let release!: () => void; let late!: Promise<void>;
 try {
  pending(path);
  await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async () => {}, reconcile: async () => {
    late = new Promise<void>(resolve => { release = resolve; }).then(() => recordRunnerMutationJournals([journal]));
   }, verify: async () => true,
  });
  const before = readFileSync(path, 'utf8'); release();
  await expect(late).rejects.toThrow('runner-fence-context-closed');
  expect(readFileSync(path, 'utf8')).toBe(before);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects core recovery even when invoked without the CLI guard: no incompatible effect.
for (const slot of ['committed', 'pending'] as const) for (const version of ['1.0.0+.', '9007199254740993.0.0', '2.0.0-beta.1+build.42']) test(`core refuses ${slot} ${version} before callbacks`, async () => {
 const { root, path } = fixture(); let effects = 0;
 const current = { ...self, semver: version.startsWith('900') ? '9007199254740992.0.0' : '1.0.0' };
 try {
  pending(path); const state = JSON.parse(readFileSync(path, 'utf8'));
  state.writer = { ...current, semver: slot === 'committed' ? version : current.semver };
  state.pending.writer = { ...current, semver: slot === 'pending' ? version : current.semver };
  writePrivateState(path, state); const before = readFileSync(path, 'utf8');
  await expect(withRunnerFenceRecovery({ path, self: current, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1,
   archive: async () => { effects++; }, reconcile: async () => { effects++; }, verify: async () => true,
  })).rejects.toThrow();
  expect(effects).toBe(0); expect(readFileSync(path, 'utf8')).toBe(before);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
// Protects valid prerelease plus build metadata across actual core recovery.
test('combined prerelease and metadata permit compatible core recovery', async () => {
 const { root, path } = fixture();
 try {
  pending(path); const state = JSON.parse(readFileSync(path, 'utf8'));
  state.writer.semver = state.pending.writer.semver = '1.0.0-beta.1+build.42'; writePrivateState(path, state);
  await withRunnerFenceRecovery({ path, self, stateSchema: 1, context: { intent: 'refresh' }, maximumAdapterJournals: 1, archive: async () => {}, reconcile: async () => {}, verify: async () => true });
  expect(readRunnerFence(path)).toMatchObject({ epoch: 1 });
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects adapter-owned kind authority: unlisted and malformed kinds preserve live evidence.
test('archive rejects kinds outside the current adapter inventory', () => {
 const { root, live } = fixture();
 try {
  writeFileSync(live, 'private evidence', { mode: 0o600 });
  for (const kinds of [[], ['other'], ['fixture-journal|other'], ['fixture', 'fixture-journal']]) {
   expect(() => archiveRunnerJournal({ livePath: live, reference: journal, bound: [journal], journalKinds: kinds })).toThrow('runner-recovery-reference-invalid');
   expect(readFileSync(live, 'utf8')).toBe('private evidence');
  }
 } finally { rmSync(root, { recursive: true, force: true }); }
});
