import { constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDurableDir, syncDirectory } from './durable-filesystem';
import { contributionHash, contributionId, type RunnerContribution } from './runner-contributions';
// Full runner catalogs include thousands of resource leaves (the observed Codex
// upgrade has 7399). History remains bounded independently of other private state.
const HISTORY_SLOTS = 16384;
const HISTORY_BYTES = 16 * 1024 * 1024;
/** Historical evidence is never an admission receipt. Only exact matching preimages may be migrated. */
export type RunnerHistory = Record<string, RunnerContribution[]>;
export function runnerHistoryPath(stateRoot: string, runnerId: string, root: string): string {
  if (!/^[a-z]+$/.test(runnerId)) throw new Error('runner-history-id-invalid');
  return join(stateRoot, 'runner-history', `${runnerId}-${contributionHash(resolve(root)).slice(0, 16)}.json`);
}
export function assertPrivateStatePath(path: string, leaf = true): void {
  for (let cursor = leaf ? path : dirname(path);; cursor = dirname(cursor)) {
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (cursor !== path && !stat.isDirectory()) || (stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0) || typeof process.getuid === 'function' && stat.uid !== process.getuid() && stat.uid !== 0) throw new Error('runner-state-path-unsafe');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (dirname(cursor) === cursor) break;
  }
}
export function readPrivateState(path: string, maxBytes = 4 * 1024 * 1024): unknown {
  assertPrivateStatePath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('runner-state-file-unsafe');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
export function writePrivateState(path: string, value: unknown): void {
  assertPrivateStatePath(path);
  ensureDurableDir(dirname(path), 0o700);
  assertPrivateStatePath(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
    syncDirectory(dirname(path));
  }
  finally { try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
}
export function readRunnerHistory(path: string): RunnerHistory {
  try {
    const data = readPrivateState(path, HISTORY_BYTES) as { schema?: unknown; entries?: RunnerHistory };
    if (data.schema !== 1 || !data.entries || Array.isArray(data.entries) || typeof data.entries !== 'object' || Object.keys(data.entries).length > HISTORY_SLOTS) return {};
    const result: RunnerHistory = {};
    for (const [id, entries] of Object.entries(data.entries)) {
      if (!/^[a-f0-9]{64}$/.test(id) || !Array.isArray(entries) || entries.length > 16) return {};
      result[id] = entries.filter(e => e && /^[a-f0-9]{64}$/.test(e.hash) && contributionId(e) === id);
    }
    return result;
  } catch { return {}; } // Missing/corrupt history grants no ownership.
}
/** Call only after canonical postimages have been verified under the installation lock. */
export function appendRunnerHistory(path: string, canonicalWrites: readonly RunnerContribution[]): void {
  const entries = readRunnerHistory(path);
  try {
    const prior = readPrivateState(path, HISTORY_BYTES) as {schema?: unknown; entries?: RunnerHistory};
    if (prior.schema !== 1 || !prior.entries || JSON.stringify(prior.entries) !== JSON.stringify(entries)) throw new Error('runner-history-invalid-preserved');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  for (const entry of canonicalWrites) {
    const prior = entries[entry.id] ?? [];
    entries[entry.id] = [...prior.filter(e => e.hash !== entry.hash), entry].slice(-16);
  }
  if (Object.keys(entries).length > HISTORY_SLOTS || Buffer.byteLength(JSON.stringify({ schema: 1, entries }) + '\n') > HISTORY_BYTES) throw new Error('runner-history-capacity');
  writePrivateState(path, { schema: 1, entries });
}
