/** Exclusive runner mutation admission. No timer, restart or delayed background apply. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ControlClient } from './control-client';
import { ControlServer } from './control-server';
import { acquireDaemonLock } from './daemon-lock';
import { pingDaemon } from './daemon-client';
import { systemClock } from './clock';
import { ensureStateLayout, resolveStatePaths, type StatePaths } from './paths';
import { createNodeProbe, type ProcessProbe } from './process-probe';

export class RunnerMutationDeferredError extends Error {
  readonly code = 'runner-mutation-deferred';
  constructor() { super('Runner changes deferred: daemon work is active or activity is unknown. Retry when idle; use deck runner cleanup --plan and deck doctor to review.'); }
}
/** Admission succeeded. Effects may have completed; never treat this as safe to replay. */
export class RunnerMutationCleanupError extends Error {
  readonly code = 'runner-mutation-cleanup-failed';
  readonly markerPath: string;
  readonly guardPath: string;
  constructor(paths: StatePaths, readonly operation: PromiseSettledResult<unknown>, readonly cleanupError: unknown) {
    const marker = markerPath(paths);
    super(`Runner mutation cleanup failed after admission; ${operation.status === 'fulfilled' ? 'operation completed' : 'operation failed'}. Preserve results and backups; do not replay automatically. Reservation: ${marker}. Guard: ${marker}.gate. Use deck doctor and docs/runners.md#offline-runner-mutation-guard-recovery.`,
      {cause: operation.status === 'rejected' ? operation.reason : cleanupError});
    this.markerPath = marker;
    this.guardPath = `${marker}.gate`;
  }
}
const markerPath = (paths: StatePaths) => join(paths.daemonDir, 'runner-mutation.json');
type Marker = { pid: number; token: string };

/** All marker mutations share this short, synchronous critical section, including
 * replacement acquisition. Never age/reclaim this gate: a paused holder could
 * otherwise resume and delete a successor's gate. An interrupted/unknown gate
 * fails closed and needs explicit offline recovery, rather than a timed takeover.
 */
function withMarkerGuard<T>(paths: StatePaths, busy: T, effect: () => T): T {
  const gate = `${markerPath(paths)}.gate`;
  try { mkdirSync(gate, { mode: 0o700 }); } catch { return busy; }
  try { return effect(); } finally { try { rmdirSync(gate); } catch { /* fail closed */ } }
}

/** Called only under the guard; ownership probing and deletion cannot cross a replacement. */
function reclaimDeadMarker(paths: StatePaths, probe: Pick<ProcessProbe,'presence'>, observed?: Marker | null): boolean {
  try {
    const value = JSON.parse(readFileSync(markerPath(paths), 'utf8')) as Marker;
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string') return true;
    // A reader that observed a different owner cannot reclaim its successor.
    // Let a later fresh read establish liveness for that reservation instead.
    if (observed !== undefined && (!observed || observed.pid !== value.pid || observed.token !== value.token)) return true;
    if (probe.presence(value.pid) !== 'absent') return true;
    unlinkSync(markerPath(paths)); return false;
  } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
}

/** Unknown/corrupt state is busy. A live owner's lease never expires on a timeout/socket loss. */
export function runnerMutationActive(paths: StatePaths, probe: Pick<ProcessProbe,'presence'> = createNodeProbe()): boolean {
  // The first probe is advisory and never deletes. In particular, a slow starter
  // need not hold the gate while checking an owner that another daemon replaces.
  let observed: Marker | null = null;
  try {
    const value = JSON.parse(readFileSync(markerPath(paths), 'utf8')) as Marker;
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string') return true;
    if (probe.presence(value.pid) !== 'absent') return true;
    observed = value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true; }
  // Re-read AND probe under the same guard used by acquire/release. A second
  // unguarded read would still permit deletion of a newer live reservation.
  return withMarkerGuard(paths, true, () => reclaimDeadMarker(paths, probe, observed));
}
export function acquireRunnerMutationMarker(paths: StatePaths, value: unknown): boolean {
  const marker = value as Partial<Marker> | undefined;
  if (!marker || !Number.isSafeInteger(marker.pid) || marker.pid! <= 0 || typeof marker.token !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.token)) return false;
  return withMarkerGuard(paths, false, () => {
    if (reclaimDeadMarker(paths, createNodeProbe())) return false;
    try { writeFileSync(markerPath(paths), JSON.stringify(marker), {flag:'wx',mode:0o600});return true; } catch { return false; }
  });
}
type ReleaseResult = 'released' | 'unowned' | 'unknown' | 'contended';
function releaseMarker(paths: StatePaths, value: unknown): ReleaseResult {
  return withMarkerGuard<ReleaseResult>(paths, 'contended', () => {
    try {
      const marker = JSON.parse(readFileSync(markerPath(paths),'utf8')) as Marker;
      if (marker.token !== (value as Marker)?.token || marker.pid !== (value as Marker)?.pid) return 'unowned';
      unlinkSync(markerPath(paths)); return 'released';
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unowned' : 'unknown'; }
  });
}
export function releaseRunnerMutationMarker(paths: StatePaths, value: unknown): boolean {
  return releaseMarker(paths, value) === 'released';
}
async function finishReservation(paths: StatePaths, identity: Marker): Promise<void> {
  // A simultaneous short reader must not leave this live process permanently
  // reserved. Retry cleanup in the caller's finally, never as background apply.
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = releaseMarker(paths, identity);
    if (result === 'released' || result === 'unowned') return;
    if (result !== 'contended') break;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Could not release runner mutation reservation at ${markerPath(paths)}; guard contention or unreadable reservation persists.`);
}
/** Capture both outcomes without a finally exception replacing the operation's evidence. */
async function withReservationCleanup<T>(paths: StatePaths, effect: () => T | Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let operation: PromiseSettledResult<T>;
  try { operation = {status:'fulfilled', value:await effect()}; }
  catch (reason) { operation = {status:'rejected', reason}; }
  try { await cleanup(); }
  catch (error) { throw new RunnerMutationCleanupError(paths, operation, error); }
  if (operation.status === 'rejected') throw operation.reason;
  return operation.value;
}
const admitted = new AsyncLocalStorage<{root:string;active:boolean}>();
async function runAdmitted<T>(root:string,effect:()=>T|Promise<T>):Promise<T>{
  const scope={root,active:true};
  try{return await admitted.run(scope,effect);}finally{scope.active=false;}
}
export async function withIdleRunnerMutation<T>(effect: () => T | Promise<T>, options: { paths?: StatePaths } = {}): Promise<T> {
  const paths = options.paths ?? resolveStatePaths();
  const scope=admitted.getStore();
  if (scope?.active && scope.root === paths.root) return effect();
  try {ensureStateLayout(paths);} catch {throw new RunnerMutationDeferredError();}
  const identity = {pid:process.pid,token:randomUUID()};
  const probe = createNodeProbe();
  // Reserve daemon startup when offline; never reclaim an unreadable/unknown holder.
  let lock: Awaited<ReturnType<typeof acquireDaemonLock>> | undefined;
  if (!existsSync(paths.lockFile)) lock = await acquireDaemonLock(paths, {clock:systemClock,presence:probe.presence,
    role:'runner-mutation',ping:async holder => (await pingDaemon(paths.socket.path,{timeoutMs:500}))?.nonce === holder.nonce});
  if (lock?.ok) {
    let reservation: ControlServer | undefined;
    try {
      // A leftover/unresponsive socket makes activity unknown. Do not unlink it here.
      if (existsSync(paths.socket.path) || readdirSync(paths.sessionsDir).length > 0) throw new RunnerMutationDeferredError();
      if (!acquireRunnerMutationMarker(paths,identity)) throw new RunnerMutationDeferredError();
      return await withReservationCleanup(paths, async () => {
        // Keep the existing lock handshake alive for older clients too. This serves only
        // busy/refusal replies during this operation; it cannot create sessions or restart.
        const busy = {ok:false as const,code:'runner-mutation-active'};
        const server = new ControlServer({socketPath:paths.socket.path,
          service:{execute:async()=>busy,openLog:()=>undefined,hasRunningWork:()=>true},
          daemon:{version:'runner-mutation',pid:process.pid,nonce:lock.nonce,status:()=>({runningWork:true,activeSessions:false}),requestRestart:()=>({ok:false,code:'busy'})}});
        try {await server.listen();reservation=server;} catch {throw new RunnerMutationDeferredError();}
        return await runAdmitted(paths.root,effect);
      }, async () => {
        // Retain both cleanup errors if closing the temporary server also fails.
        let closeError: unknown;
        try { await reservation?.close(); } catch (error) { closeError = error; }
        try { await finishReservation(paths,identity); }
        catch (error) { if (closeError !== undefined) throw new AggregateError([closeError,error], 'Runner reservation cleanup failed'); throw error; }
        if (closeError !== undefined) throw closeError;
      });
    } finally {lock.release();}
  }
  let client: ControlClient | undefined;
  try {
    client = await ControlClient.connect(paths.socket.path,{timeoutMs:1000});
    const result = await client.query('runner-mutation.acquire', identity);
    if (!result.ok) throw new RunnerMutationDeferredError();
  } catch {client?.close();throw new RunnerMutationDeferredError();}
  return withReservationCleanup(paths, () => runAdmitted(paths.root,effect), async () => {
    // Remove only our own marker even if the socket failed. Admission reads the same marker.
    try {await finishReservation(paths,identity);} finally {client.close();}
  });
}
