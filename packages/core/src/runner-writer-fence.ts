import { AsyncLocalStorage } from "node:async_hooks";
import { readPrivateState, writePrivateState } from './runner-history';
export type BuildIdentity = { semver: string; commit: string; channel: 'stable' | 'beta' | 'dev' | 'canary'; payloadDigest?: string };
export type RunnerMutationJournal = {operationId:string; id:string; kind:string};
export type RunnerFence = { fenceSchema: 1; stateSchema: number; epoch: number; writer: BuildIdentity; pending?: { epoch: number; writer: BuildIdentity; stateSchema: number; journals?: readonly RunnerMutationJournal[] } };
export type RunnerFenceRead = RunnerFence | undefined | 'unreadable';
export function compareReleaseVersions(a: string, b: string): number {
  const pa = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(a), pb = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) if (+pa[i]! !== +pb[i]!) return +pa[i]! - +pb[i]!;
  return 0;
}
export function sameBuild(a: BuildIdentity, b: BuildIdentity): boolean {
  return a.payloadDigest && b.payloadDigest ? a.payloadDigest === b.payloadDigest : a.semver === b.semver && a.commit === b.commit && a.channel === b.channel;
}
export function validBuildIdentity(value: unknown): value is BuildIdentity {
  const v = value as BuildIdentity | null;
  return !!v && typeof v === 'object' && typeof v.semver === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(v.semver) && typeof v.commit === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v.commit) && ['stable','beta','dev','canary'].includes(v.channel) && (v.payloadDigest === undefined || /^[a-f0-9]{64}$/.test(v.payloadDigest));
}
/** Epoch fences concurrency; semver orders releases. Commits, channels and hashes never order builds. */
export function decideRunnerWrite(record: RunnerFenceRead, self: BuildIdentity, intent: 'explicit' | 'refresh' | 'upgrade-sync', admits: boolean, schema: number): string {
  if (record === 'unreadable') return 'runner-fence-unreadable';
  if (record?.pending) return 'runner-write-recovery-required';
  if (record && record.stateSchema > schema) return 'managed-by-newer-schema';
  if (record && compareReleaseVersions(record.writer.semver, self.semver) > 0) return 'managed-by-newer-deck';
  if (intent === 'refresh' && admits && (!record || compareReleaseVersions(self.semver, record.writer.semver) <= 0)) return 'compatible-installed-state';
  return 'write';
}
export function readRunnerFence(path: string): RunnerFenceRead {
  try {
    const v = readPrivateState(path) as RunnerFence;
    if (v?.fenceSchema !== 1 || !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !Number.isSafeInteger(v.stateSchema) || v.stateSchema < 1 || !validBuildIdentity(v.writer) || v.pending && (v.pending.epoch !== v.epoch + 1 || !Number.isSafeInteger(v.pending.stateSchema) || v.pending.stateSchema < 1 || !validBuildIdentity(v.pending.writer) || v.pending.journals !== undefined && (!Array.isArray(v.pending.journals) || v.pending.journals.length > 32 || v.pending.journals.some(j => !j || ![j.id,j.operationId,j.kind].every(s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(s)))))) return 'unreadable';
    return v;
  } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : 'unreadable'; }
}
const activeFence = new AsyncLocalStorage<{path:string; pending:RunnerFence}>();
/** Attach existing adapter journal identities before effects; no second recovery journal is created. */
export function recordRunnerMutationJournals(journals: readonly RunnerMutationJournal[]): void {
  const active = activeFence.getStore();
  if (!active) return;
  if (JSON.stringify(readRunnerFence(active.path)) !== JSON.stringify(active.pending)) throw new Error('runner-fence-changed');
  active.pending = {...active.pending,pending:{...active.pending.pending!,journals}};
  writePrivateState(active.path,active.pending);
}
/** Must run inside the existing exclusive runner mutation admission. Leave uncertain effects pending. */
export async function withRunnerFence<T>(input: { path: string; self: BuildIdentity; stateSchema: number; expected?: RunnerFenceRead; effect(): Promise<T>; changed(result: T): boolean }): Promise<T> {
  const before = readRunnerFence(input.path);
  if (before === 'unreadable' || before?.pending || input.expected !== undefined && JSON.stringify(before) !== JSON.stringify(input.expected)) throw new Error('runner-fence-changed');
  const epoch = before?.epoch ?? 0;
  const pending: RunnerFence = { fenceSchema: 1, epoch, stateSchema: before?.stateSchema ?? input.stateSchema, writer: before?.writer ?? input.self, pending: { epoch: epoch + 1, writer: input.self, stateSchema: input.stateSchema } };
  writePrivateState(input.path, pending);
  const context = {path:input.path,pending};
  const result = await activeFence.run(context,input.effect); // Uncertain effects retain their adapter journal references.
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
