import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, fstatSync, linkSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareReleaseVersions, validBuildIdentity, readRunnerFence, withRunnerFenceRecovery, type DeveloperTeamAdapterInstallInput } from '@deck/core';
import { assertPrivateStatePath, readPrivateState, writePrivateState } from '../../../packages/core/src/runner-history';
import { ensureDurableDir, syncDirectory } from '../../../packages/core/src/durable-filesystem';
import { withInstallationMutation } from '../../../packages/core/src/installation-use';
import type { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import type { RunnerFenceOptions, RunnerMutationAdmission } from './runner-mutation-admission';

/** Explicit recovery preview, deliberately absent from automatic launch/Setup paths.
 * apply() requires a separate adoption decision by its caller. It never proves or
 * rolls back the unknown old operation; it preserves it and starts a NEW epoch. */
export async function previewExplicitCodexRecovery(
 adapter: ReturnType<typeof createCodexRunnerAdapter>, input: DeveloperTeamAdapterInstallInput,
 fence: RunnerFenceOptions, admission: RunnerMutationAdmission,
) {
 fence = structuredClone(fence);
 if (!validBuildIdentity(fence.self) || !Number.isSafeInteger(fence.stateSchema) || fence.stateSchema < 1) throw new Error('runner-recovery-writer-invalid');
 const before = readRunnerFence(fence.path);
 if (!before || before === 'unreadable' || !before.pending || before.pending.journals?.some(j => !['native', 'native-skills', 'canonical-recovery-v1', 'deck-scope-v1'].includes(j.kind))) throw new Error('codex-explicit-recovery-legacy-fence-required');
 if (!adapter.mutationRoot) throw new Error('codex-explicit-recovery-root-required');
 for (const state of [before, before.pending]) {
  if (state.stateSchema > fence.stateSchema || compareReleaseVersions(state.writer.semver, fence.self.semver) > 0) throw new Error('codex-explicit-recovery-newer-writer');
 }
 if (!Number.isSafeInteger(before.pending.epoch + 1)) throw new Error('runner-recovery-epoch-exhausted');
 const originalBytes = readFileSync(fence.path, 'utf8');
 if (JSON.stringify(JSON.parse(originalBytes)) !== JSON.stringify(before)) throw new Error('runner-fence-changed');
 const recovery = adapter.prepareExplicitCanonicalRecovery(structuredClone(input));
 const snapshotJournals = () => {
  assertPrivateStatePath(join(recovery.journalRoot, 'inventory'));
  let names: string[];
  try { names = readdirSync(recovery.journalRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const entries = names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort().map(name => {
   const path = join(recovery.journalRoot, name);
   assertPrivateStatePath(path);
   const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
   try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('codex-recovery-journal-unsafe');
    // Preserve even damaged bytes. Parsing a journal grants no recovery authority.
    return { name, mode: stat.mode & 0o777, base64: readFileSync(fd).toString('base64') };
   } finally { closeSync(fd); }
  });
  if (Buffer.byteLength(JSON.stringify(entries)) > 128 * 1024 * 1024) throw new Error('codex-recovery-evidence-capacity');
  return entries;
 };
 const journalEvidence = snapshotJournals();
 const digest = createHash('sha256').update(originalBytes).digest('hex');
 const targets = Object.freeze(structuredClone(recovery.targets).map(target => Object.freeze(target)));
 const revision = createHash('sha256').update(JSON.stringify({ targets, journalEvidence })).digest('hex').slice(0, 16);
 const archivePath = join(dirname(fence.path), 'recovery-archive', `unproven-${digest}-${revision}.json`);
 let used = false;
 return { archivePath, targets, journalPaths: journalEvidence.map(entry => join(recovery.journalRoot, entry.name)), originalDigest: digest,
  async apply() {
   if (used) throw new Error('codex-explicit-recovery-preview-consumed');
   used = true;
   return admission(() => withInstallationMutation(adapter.mutationRoot!, async () => {
    const unchanged = () => {
     if (JSON.stringify(readRunnerFence(fence.path)) !== JSON.stringify(before) || readFileSync(fence.path, 'utf8') !== originalBytes) throw new Error('runner-fence-changed');
    };
    unchanged();
    assertPrivateStatePath(archivePath);
    ensureDurableDir(dirname(archivePath), 0o700);
    const evidence = { schema: 1, journalEvidence, disposition: 'superseded-unproven', originalBytes, originalDigest: digest, mutationRoot: adapter.mutationRoot, scope: 'global', targets };
    // Exclusive creation and barriers: an interruption never loses the original bytes.
    const temp = `${archivePath}.${randomUUID()}.tmp`;
    try {
     const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
     try { writeFileSync(fd, JSON.stringify(evidence) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
     try { linkSync(temp, archivePath); }
     catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (JSON.stringify(readPrivateState(archivePath, 160 * 1024 * 1024)) !== JSON.stringify(evidence)) throw new Error('codex-explicit-recovery-archive-conflict');
     }
    } finally { try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    syncDirectory(dirname(archivePath));
    unchanged();
    if (JSON.stringify(snapshotJournals()) !== JSON.stringify(journalEvidence)) throw new Error('codex-recovery-journals-changed');
    const id = randomUUID();
    // Epoch 5 is retained as unproven evidence, never declared committed. Epoch 6
    // is a separate explicit operation with the caller's current global scope.
    const adopted = { ...before, epoch: before.pending!.epoch, pending: {
     epoch: before.pending!.epoch + 1, writer: fence.self, stateSchema: fence.stateSchema,
     journals: [{ kind: 'canonical-recovery-v1', id, operationId: id }, { kind: 'deck-scope-v1', id: 'global', operationId: id }],
    } };
    writePrivateState(fence.path, adopted);
    // The immutable archive now owns these exact historical bytes. Retire them
    // from the active journal pool so damaged history cannot break normal pruning.
    // Unknown filenames remain untouched. A failed barrier keeps the NEW fence pending.
    if (JSON.stringify(snapshotJournals()) !== JSON.stringify(journalEvidence)) throw new Error('codex-recovery-journals-changed');
    for (const entry of journalEvidence) unlinkSync(join(recovery.journalRoot, entry.name));
    if (journalEvidence.length) syncDirectory(recovery.journalRoot);
    await withRunnerFenceRecovery({ ...fence, mutationRoot: adapter.mutationRoot!, expected: adopted, context: { intent: 'explicit' }, ...recovery });
   }));
  },
 };
}
