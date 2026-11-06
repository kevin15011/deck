import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { AdapterRegistry } from '@deck/core';
import { assertNoContributionSymlink } from '../../../packages/core/src/runner-contributions';
import { backupManagedPreimages } from '../../../packages/core/src/managed-artifacts';
import { acquireRegistryLease } from '../../../packages/core/src/skill-discovery/registry-lease';

const START = '<!-- deck:developer-team:start -->';
const END = '<!-- deck:developer-team:end -->';
type Options = { stateRoot: string; lockRoot?: string };
type Result = { changed: boolean; diagnostic?: string };

/** Exact line spans only. Validate the entire document before planning any removal. */
function plan(source: string): { content: string; removed: string[]; diagnostic?: string } {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const spans: [number, number][] = [];
  let start: number | undefined;
  const invalid = (line: number) => ({ content: source, removed: [], diagnostic: `AGENTS.md legacy retirement preserved the document: malformed Deck boundary at line ${line + 1}.` });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r?\n$/, '');
    if (line === START) {
      if (start !== undefined) return invalid(i);
      start = i;
    } else if (line === END) {
      if (start === undefined) return invalid(i);
      spans.push([start, i + 1]); start = undefined;
    } else if (line.includes(START) || line.includes(END)) return invalid(i);
  }
  if (start !== undefined) return invalid(start);
  const removed = spans.map(([from, to]) => lines.slice(from, to).join(''));
  for (const [from, to] of spans.reverse()) lines.splice(from, to - from);
  return { content: lines.join(''), removed };
}

/** One atomic effect, under the shared project lease. Backups are inert span bytes;
 * there is no multi-file journal to replay and no ownership of surrounding instructions.
 * Same-user noncooperating edits in the final check/rename window remain a POSIX limit.
 */
export async function retireLegacyProjectInstructions(projectRoot: string, options: Options): Promise<Result> {
  const root = resolve(projectRoot), file = join(root, 'AGENTS.md');
  let temporary: string | undefined, lease: Awaited<ReturnType<typeof acquireRegistryLease>> | undefined;
  let changed = false;
  try {
    assertNoContributionSymlink(file);
    try { fs.lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { changed: false }; throw e; }
    lease = await acquireRegistryLease(root, { lockRoot: options.lockRoot, waitMs: 0 });
    if (!lease.ok) return { changed: false, diagnostic: `AGENTS.md legacy retirement deferred: project lock ${lease.reason}.` };
    const snapshot = () => {
      assertNoContributionSymlink(file);
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const before = fs.fstatSync(fd);
        if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024) throw new Error('unsafe');
        const bytes = Buffer.alloc(before.size + 1);
        const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
        const after = fs.fstatSync(fd), path = fs.lstatSync(file);
        if (size !== before.size || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || before.ino !== path.ino || before.dev !== path.dev || !path.isFile()) throw new Error('changed');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
        return { content, stat: after };
      } finally { fs.closeSync(fd); }
    };
    const before = snapshot(), next = plan(before.content);
    if (next.diagnostic) return { changed: false, diagnostic: next.diagnostic };
    if (!next.removed.length) return { changed: false };
    backupManagedPreimages({ stateRoot: options.stateRoot, runnerId: 'project', root, entries: next.removed.map(content => ({ target: { path: file, selector: { kind: 'text', start: START, end: END } }, content })) });
    temporary = join(root, `.AGENTS.md.${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, next.content);
      fs.fchmodSync(fd, before.stat.mode & 0o777);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const current = snapshot();
    if (!lease.lease.held() || current.content !== before.content || current.stat.mode !== before.stat.mode || current.stat.ino !== before.stat.ino || current.stat.dev !== before.stat.dev || current.stat.ctimeMs !== before.stat.ctimeMs) throw new Error('changed');
    fs.renameSync(temporary, file); temporary = undefined; changed = true;
    const directory = fs.openSync(root, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return { changed };
  } catch (e) {
    const reason = (e as Error).message === 'changed' ? 'changed during retirement' : 'unsafe or unavailable';
    return { changed, diagnostic: `AGENTS.md legacy retirement ${changed ? "completed; durability requires inspection" : "preserved current instructions"}: ${reason}.` };
  } finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch { /* Private inert temporary output is never adopted. */ } }
    if (lease?.ok) lease.lease.release();
  }
}

/** Install authority covers retired generated spans; it does not authorize registry writes. */
export function createProjectInstallRefresh(registry: AdapterRegistry, options: Options) {
  return async (projectRoot: string): Promise<void> => {
    const result = await retireLegacyProjectInstructions(projectRoot, options);
    if (result.diagnostic) console.warn(result.diagnostic);
    const { refreshSharedSkillCatalogView } = await import('../../../packages/core/src/skill-discovery/shared');
    await refreshSharedSkillCatalogView({ projectRoot, providers: registry.list().flatMap(adapter => adapter.skillDiscovery ? [adapter.skillDiscovery] : []) });
  };
}
