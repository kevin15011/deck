import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, constants, closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { assertNoContributionSymlink } from '../runner-contributions';

const MAX_BINARY = 320 * 1024 * 1024;
function identity(path: string): string | undefined {
  assertNoContributionSymlink(path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.size > BigInt(MAX_BINARY) || typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) throw new Error('Native destination conflicts with unsafe content.');
  const fd = openSync(path, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  let total = 0;
  try {
    for (;;) { const count = readSync(fd, buffer, 0, buffer.length, null); if (!count) break; total += count; if (total > MAX_BINARY) throw new Error('Native preimage exceeds backup bound.'); hash.update(buffer.subarray(0, count)); }
  } finally { closeSync(fd); }
  const after = lstatSync(path, { bigint: true });
  const key = (s: typeof stat) => [s.dev, s.ino, s.size, s.mode, s.uid, s.mtimeNs, s.ctimeNs].join(':');
  if (key(after) !== key(stat) || total !== Number(stat.size)) throw new Error('Native destination changed during inspection.');
  return `${key(stat)}:${hash.digest('hex')}`;
}
/** Called only for the exact native leaf in a dedicated generated release root, under
 * its mutation lease. Unknown siblings remain a collision; backups are inert and private.
 */
export async function repairNativeLeaf(input: {
  root: string; name: 'rtk' | 'codebase-memory-mcp';
  acquire: (stage: string) => Promise<unknown>; verify: (root: string) => string;
}): Promise<'installed'> {
  const { root, name } = input, parent = dirname(root), target = join(root, name);
  assertNoContributionSymlink(root);
  const directory = lstatSync(root, { bigint: true });
  if (!directory.isDirectory() || directory.mode & 0o077n || typeof process.getuid === 'function' && directory.uid !== BigInt(process.getuid()) || readdirSync(root).some(entry => entry !== name)) throw new Error('Native destination conflicts with unknown content.');
  const before = identity(target), stage = join(parent, `.native-stage-${randomUUID()}`);
  let published = false;
  try {
    await input.acquire(stage); // verifies the pinned archive and binary before touching old bytes
    if (input.verify(stage) !== 'ready') throw new Error('Native staging verification failed.');
    assertNoContributionSymlink(root);
    const now = lstatSync(root, { bigint: true });
    if (now.dev !== directory.dev || now.ino !== directory.ino || now.mode !== directory.mode || now.uid !== directory.uid || readdirSync(root).some(entry => entry !== name) || identity(target) !== before) throw new Error('Native destination changed during acquisition.');
    if (before !== undefined) {
      const backups = join(parent, '.replaced');
      assertNoContributionSymlink(backups);
      mkdirSync(backups, { mode: 0o700, recursive: true });
      const stat = lstatSync(backups);
      if (!stat.isDirectory() || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Native backup directory is unsafe.');
      const prefix = createHash('sha256').update(basename(root) + '\0' + name).digest('hex').slice(0, 16);
      const pattern = new RegExp(`^${prefix}-[0-9]{13}-[a-f0-9-]{36}\\.bin$`);
      const prior = readdirSync(backups).filter(entry => pattern.test(entry)).sort();
      // Bound retained copies before acquisition effects. Unknown members are never deleted.
      for (const entry of prior) {
        const path = join(backups, entry); assertNoContributionSymlink(path);
        const saved = lstatSync(path);
        if (!saved.isFile() || saved.mode & 0o077 || saved.size > MAX_BINARY || typeof process.getuid === 'function' && saved.uid !== process.getuid()) throw new Error('Native backup is unsafe.');
      }
      while (prior.length >= 2) unlinkSync(join(backups, prior.shift()!));
      const backup = join(backups, `${prefix}-${Date.now()}-${randomUUID()}.bin`);
      copyFileSync(target, backup, constants.COPYFILE_EXCL); chmodSync(backup, 0o600);
      if (identity(target) !== before || identity(backup)?.split(':').at(-1) !== before.split(':').at(-1)) throw new Error('Native preimage changed before publication.');
    }
    // Synchronous CAS and atomic replacement leave either old or verified new executable at the slot.
    if (identity(target) !== before) throw new Error('Native destination changed before publication.');
    renameSync(join(stage, name), target); published = true;
    if (input.verify(root) !== 'ready') throw new Error('Native publication is indeterminate; preimage retained privately.');
    return 'installed';
  } finally {
    // Only the private staging leaf created by this call may be removed. Never recurse into unknown files.
    if (existsSync(stage)) {
      assertNoContributionSymlink(stage);
      if (!published && existsSync(join(stage, name))) unlinkSync(join(stage, name));
      rmdirSync(stage);
    }
  }
}
