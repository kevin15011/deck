import { linkSync, lstatSync, readdirSync, unlinkSync, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDurableDir, syncDirectory } from './durable-filesystem';
import { assertPrivateStatePath } from './runner-history';
import type { RunnerMutationJournal } from './runner-writer-fence';

function privateFile(stat: Stats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}
function sameInode(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function statIfPresent(path: string): Stats | undefined {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Fixed livePath and bound references come from the current adapter inventory/fence,
 * never from journal targets. Caller holds the existing exclusive mutation lease.
 * Archives are forensic evidence only: this function never parses or replays bytes. */
export function archiveRunnerJournal(input: { livePath: string; reference: RunnerMutationJournal; bound: readonly RunnerMutationJournal[]; journalKinds: readonly string[] }): void {
  const { livePath, reference, bound, journalKinds } = input;
  if (!journalKinds.length || journalKinds.some(kind => !/^[a-zA-Z0-9-]{1,128}$/.test(kind) || journalKinds.some(other => other !== kind && kind.startsWith(other + '-')))) throw new Error('runner-recovery-reference-invalid');
  const entryName = new RegExp(`^\\d{13}-(${[...journalKinds].sort((a, b) => b.length - a.length).join('|')})-([a-zA-Z0-9-]{1,128})\\.json$`);
  if (!journalKinds.includes(reference.kind) || reference.id !== reference.operationId || !/^[a-zA-Z0-9-]{1,128}$/.test(reference.id) || !bound.some(r => r.kind === reference.kind && r.id === reference.id && r.operationId === reference.operationId)) throw new Error('runner-recovery-reference-invalid');
  assertPrivateStatePath(livePath);
  const live = statIfPresent(livePath);
  if (!live) {
    // A previous unlink may have succeeded but its barrier failed. Complete it
    // before the caller can release the original binding. Absence proves no output.
    syncDirectory(dirname(livePath));
    return;
  }
  if (!privateFile(live)) throw new Error('runner-recovery-journal-unsafe');
  const archiveDir = join(dirname(livePath), 'recovery-archive');
  assertPrivateStatePath(archiveDir);
  ensureDurableDir(archiveDir, 0o700);
  const directory = lstatSync(archiveDir);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 || typeof process.getuid === 'function' && directory.uid !== process.getuid()) throw new Error('runner-recovery-archive-unsafe');
  const names = readdirSync(archiveDir);
  const suffix = `-${reference.kind}-${reference.id}.json`;
  const matches = names.filter(name => entryName.test(name) && name.endsWith(suffix));
  if (matches.length > 1) throw new Error('runner-recovery-archive-collision');
  let archivePath = matches.length ? join(archiveDir, matches[0]!) : undefined;
  if (archivePath) {
    const existing = lstatSync(archivePath);
    if (!privateFile(existing) || !sameInode(live, existing)) throw new Error('runner-recovery-archive-collision');
  }
  // Reserve space before linking: eight managed archives in the normal case,
  // or the finite bound transaction set if larger. Bound and live-linked entries
  // are never pruned; linked history still counts toward actual capacity.
  const entries = names.flatMap(name => {
    const match = entryName.exec(name);
    if (!match) return [];
    const path = join(archiveDir, name), stat = lstatSync(path);
    return privateFile(stat) ? [{ name, path, stat, bound: bound.some(r => r.kind === match[1] && r.id === match[2]) }] : [];
  });
  const reserved = entries.filter(entry => entry.bound).length + (archivePath ? 0 : 1);
  const historical = entries.filter(entry => !entry.bound).sort((a, b) => a.name.localeCompare(b.name));
  const budget = Math.max(8, reserved) - reserved;
  let excess = historical.length - budget;
  if (historical.filter(entry => entry.stat.nlink > 1).length > budget) throw new Error('runner-recovery-archive-capacity');
  for (const entry of historical) {
    if (excess <= 0) break;
    if (entry.stat.nlink !== 1) continue;
    const current = lstatSync(entry.path);
    if (!privateFile(current) || !sameInode(current, entry.stat) || current.nlink !== 1) throw new Error('runner-recovery-archive-changed');
    unlinkSync(entry.path); excess--;
  }
  syncDirectory(archiveDir);
  if (!archivePath) {
    archivePath = join(archiveDir, `${Date.now()}${suffix}`);
    linkSync(livePath, archivePath); // No overwrite and no cross-filesystem copy fallback.
  }
  syncDirectory(archiveDir);
  const current = lstatSync(livePath), archived = lstatSync(archivePath);
  if (!privateFile(current) || !privateFile(archived) || !sameInode(current, live) || !sameInode(current, archived) || current.nlink < 2 || archived.nlink < 2) throw new Error('runner-recovery-archive-changed');
  unlinkSync(livePath);
  syncDirectory(dirname(livePath));
}
