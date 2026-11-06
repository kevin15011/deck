import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { holdsInstallationMutation } from "./installation-use";
import { readPrivateState, writePrivateState } from './runner-history';
export type BuildIdentity = { semver: string; commit: string; channel: 'stable' | 'beta' | 'dev' | 'canary'; payloadDigest?: string };
export type RunnerMutationJournal = {operationId:string; id:string; kind:string};
export type RunnerFence = { fenceSchema: 1; stateSchema: number; epoch: number; writer: BuildIdentity; pending?: { epoch: number; writer: BuildIdentity; stateSchema: number; journals?: readonly RunnerMutationJournal[] } };
export type RunnerFenceRead = RunnerFence | undefined | 'unreadable';
/** Parse full SemVer once; release digits stay strings to avoid numeric rounding.
 * Prerelease/build identify peers but deliberately do not order Deck channels. */
function releaseVersion(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'string') return;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value || match[4]?.split('.').some(id => /^[0-9]+$/.test(id) && id.length > 1 && id[0] === '0')) return;
  return match.slice(1, 4);
}
export function validReleaseVersion(value: unknown): value is string { return releaseVersion(value) !== undefined; }
export function compareReleaseVersions(a: string, b: string): number {
  const pa = releaseVersion(a), pb = releaseVersion(b);
  if (!pa || !pb) throw new Error('runner-release-version-invalid');
  for (let i = 0; i < 3; i++) {
    const left = pa[i]!, right = pb[i]!;
    if (left.length !== right.length) return left.length > right.length ? 1 : -1;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}
export function sameBuild(a: BuildIdentity, b: BuildIdentity): boolean {
  return a.payloadDigest && b.payloadDigest ? a.payloadDigest === b.payloadDigest : a.semver === b.semver && a.commit === b.commit && a.channel === b.channel;
}
export function validBuildIdentity(value: unknown): value is BuildIdentity {
  const v = value as BuildIdentity | null;
  return !!v && typeof v === 'object' && validReleaseVersion(v.semver) && typeof v.commit === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v.commit) && ['stable','beta','dev','canary'].includes(v.channel) && (v.payloadDigest === undefined || /^[a-f0-9]{64}$/.test(v.payloadDigest));
}
/** Epoch fences concurrency; semver orders releases. Commits, channels and hashes never order builds. */
export function decideRunnerWrite(record: RunnerFenceRead, self: BuildIdentity, intent: 'explicit' | 'refresh' | 'upgrade-sync', admits: boolean, schema: number, managedDrift = false): string {
  if (record === 'unreadable') return 'runner-fence-unreadable';
  if (record?.pending) return 'runner-write-recovery-required';
  if (record && record.stateSchema > schema) return 'managed-by-newer-schema';
  if (record && compareReleaseVersions(record.writer.semver, self.semver) > 0) return 'managed-by-newer-deck';
  if (intent === 'refresh' && admits && !managedDrift && (!record || compareReleaseVersions(self.semver, record.writer.semver) <= 0)) return 'compatible-installed-state';
  return 'write';
}
export function readRunnerFence(path: string): RunnerFenceRead {
  try {
    const v = readPrivateState(path) as RunnerFence;
    if (v?.fenceSchema !== 1 || !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !Number.isSafeInteger(v.stateSchema) || v.stateSchema < 1 || !validBuildIdentity(v.writer) || v.pending && (v.pending.epoch !== v.epoch + 1 || !Number.isSafeInteger(v.pending.stateSchema) || v.pending.stateSchema < 1 || !validBuildIdentity(v.pending.writer) || v.pending.journals !== undefined && (!Array.isArray(v.pending.journals) || v.pending.journals.length > 32 || v.pending.journals.some(j => !j || ![j.id,j.operationId,j.kind].every(s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(s)))))) return 'unreadable';
    return v;
  } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : 'unreadable'; }
}
const activeFence = new AsyncLocalStorage<{path:string; pending:RunnerFence; open: boolean; recoveryPrefix?: readonly RunnerMutationJournal[]; maximumAdapterJournals?: number}>();
function validateJournals(journals: readonly RunnerMutationJournal[]): void {
  if (journals.length > 32) throw new Error('recovery-journal-capacity');
  if (journals.some(j => !j || ![j.id, j.operationId, j.kind].every(s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(s)))) throw new Error('runner-journal-reference-invalid');
}
export function runnerProjectScope(projectRoot: string): string {
  return 'p-' + createHash('sha256').update(realpathSync(projectRoot)).digest('hex');
}
/** Attach existing adapter journal identities before effects; no second recovery journal is created. */
export function recordRunnerMutationJournals(journals: readonly RunnerMutationJournal[]): void {
  const active = activeFence.getStore();
  if (!active) return;
  if (!active.open) throw new Error('runner-fence-context-closed');
  if (JSON.stringify(readRunnerFence(active.path)) !== JSON.stringify(active.pending)) throw new Error('runner-fence-changed');
  validateJournals(journals);
  if (journals.some(j => j.kind === 'canonical-recovery-v1')) throw new Error('runner-recovery-marker-reserved');
  const prefix = active.recoveryPrefix ?? [];
  if (prefix.length) {
    const scope = prefix[1]!.id;
    if (journals.some(j => j.kind === 'deck-scope-v1' && j.id !== 'global' && j.id !== scope)) throw new Error('runner-recovery-scope-mismatch');
  }
  const adapterReferences = prefix.length ? journals.filter(j => j.kind !== 'deck-scope-v1') : [...journals];
  if (active.maximumAdapterJournals !== undefined && adapterReferences.length > active.maximumAdapterJournals) throw new Error('recovery-journal-capacity');
  const references = [...prefix, ...adapterReferences];
  validateJournals(references);
  const next = {...active.pending,pending:{...active.pending.pending!,journals: references}};
  writePrivateState(active.path,next);
  active.pending = next;
}
/** Must run inside the existing exclusive runner mutation admission. Leave uncertain effects pending. */
export async function withRunnerFence<T>(input: { path: string; self: BuildIdentity; stateSchema: number; expected?: RunnerFenceRead; effect(): Promise<T>; changed(result: T): boolean }): Promise<T> {
  const before = readRunnerFence(input.path);
  if (before === 'unreadable' || before?.pending || input.expected !== undefined && JSON.stringify(before) !== JSON.stringify(input.expected)) throw new Error('runner-fence-changed');
  const epoch = before?.epoch ?? 0;
  const pending: RunnerFence = { fenceSchema: 1, epoch, stateSchema: before?.stateSchema ?? input.stateSchema, writer: before?.writer ?? input.self, pending: { epoch: epoch + 1, writer: input.self, stateSchema: input.stateSchema } };
  writePrivateState(input.path, pending);
  const context = {path:input.path,pending,open:true};
  let result: T;
  try { result = await activeFence.run(context,input.effect); }
  finally { context.open = false; } // Uncertain effects retain their adapter journal references.
  if (JSON.stringify(readRunnerFence(input.path)) !== JSON.stringify(context.pending)) throw new Error('runner-fence-changed');
  writePrivateState(input.path, input.changed(result) ? { fenceSchema: 1, epoch: epoch + 1, stateSchema: input.stateSchema, writer: input.self } : before ?? { fenceSchema: 1, epoch, stateSchema: input.stateSchema, writer: input.self });
  return result;
}
/** An explicit recovery caller must prove journal preimages/postimages, never merely lack of an exception. */
export async function recoverRunnerFence(path: string, prove: (pending: NonNullable<RunnerFence['pending']>) => Promise<'preimage' | 'postimage' | undefined>): Promise<boolean> {
  const record = readRunnerFence(path);
  if (!record || record === 'unreadable' || !record.pending) return false;
  const proof = await prove(record.pending);
  if (!proof || JSON.stringify(readRunnerFence(path)) !== JSON.stringify(record)) return false;
  const {pending, ...prior} = record;
  writePrivateState(path, proof === 'preimage' ? prior : {...prior, epoch:pending.epoch, writer:pending.writer, stateSchema:pending.stateSchema});
  return true;
}

/** Canonical recovery under the existing exclusive installation lease. The adapter
 * resolves generator inputs independently; archive callbacks use fixed inventory paths.
 * A missing scope is deliberately not inferred from channel or journal absence. */
export async function withRunnerFenceRecovery(input: {
  path: string; mutationRoot: string; expected: RunnerFenceRead; self: BuildIdentity; stateSchema: number;
  journalKinds: readonly string[];
  context: { intent: 'refresh' | 'explicit'; projectRoot?: string };
  maximumAdapterJournals: number;
  archive(references: readonly RunnerMutationJournal[]): Promise<void>;
  reconcile(): Promise<unknown>;
  /** Includes canonical postimages AND normal read-only launch admission. */
  verify(): Promise<boolean>;
}): Promise<void> {
  if (!holdsInstallationMutation(input.mutationRoot)) throw new Error('runner-recovery-mutation-unreserved');
  const before = readRunnerFence(input.path);
  if (!before || before === 'unreadable' || !before.pending) throw new Error('runner-recovery-provenance-unproven');
  if (JSON.stringify(before) !== JSON.stringify(input.expected)) throw new Error('runner-fence-changed');
  if (!validBuildIdentity(input.self) || !Number.isSafeInteger(input.stateSchema) || input.stateSchema < 1) throw new Error('runner-recovery-writer-invalid');
  for (const state of [before, before.pending]) {
    if (state.stateSchema > input.stateSchema) throw new Error('managed-by-newer-schema');
    if (compareReleaseVersions(state.writer.semver, input.self.semver) > 0) throw new Error('managed-by-newer-deck');
  }
  const references = before.pending.journals ?? [];
  const markers = references.filter(j => j.kind === 'canonical-recovery-v1');
  if (markers.length > 1 || markers.some(j => j.id !== j.operationId)) throw new Error('runner-recovery-marker-invalid');
  const scopes = references.filter(j => j.kind === 'deck-scope-v1');
  if (!scopes.length || scopes.some(j => j.id !== 'global' && !/^p-[a-f0-9]{64}$/.test(j.id))) throw new Error('runner-recovery-scope-unproven');
  const projects = [...new Set(scopes.filter(j => j.id !== 'global').map(j => j.id))];
  if (projects.length > 1) throw new Error('runner-recovery-scope-mismatch');
  const scope = projects[0] ?? 'global';
  if (scope !== 'global' && (input.context.intent !== 'explicit' || !input.context.projectRoot || runnerProjectScope(input.context.projectRoot) !== scope)) throw new Error('runner-recovery-project-scope-required');
  const originals = references.filter(j => !['canonical-recovery-v1', 'deck-scope-v1'].includes(j.kind));
  if (originals.some(j => !input.journalKinds.includes(j.kind))) throw new Error('runner-recovery-journal-kind-unknown');
  if (!Number.isSafeInteger(input.maximumAdapterJournals) || input.maximumAdapterJournals < 0 || 2 + originals.length + input.maximumAdapterJournals > 32) throw new Error('recovery-journal-capacity');
  const id = randomUUID();
  const prefix = [{ kind: 'canonical-recovery-v1', id, operationId: id }, { kind: 'deck-scope-v1', id: scope, operationId: id }];
  const context = { path: input.path, pending: before, open: true, recoveryPrefix: prefix, maximumAdapterJournals: input.maximumAdapterJournals };
  const publish = (next: RunnerFence) => {
    if (JSON.stringify(readRunnerFence(input.path)) !== JSON.stringify(context.pending)) throw new Error('runner-fence-changed');
    writePrivateState(input.path, next);
    context.pending = next;
  };
  publish({ ...before, pending: { epoch: before.pending.epoch, writer: input.self, stateSchema: input.stateSchema, journals: [...prefix, ...originals] } });
  await input.archive(originals);
  // The callback must complete every archive/barrier before originals are released.
  publish({ ...context.pending, pending: { ...context.pending.pending!, journals: prefix } });
  try {
    await activeFence.run(context, async () => {
      await input.reconcile();
      if (!await input.verify()) throw new Error('recovery-verification-failed');
    });
  } finally { context.open = false; }
  publish({ fenceSchema: 1, epoch: before.pending.epoch, writer: input.self, stateSchema: input.stateSchema });
}
