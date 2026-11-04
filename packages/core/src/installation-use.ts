import { assertNoContributionSymlink } from "./runner-contributions";
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export class InstallationBusyError extends Error {
  readonly code = 'runner-installation-in-use';
  constructor() { super('Runner content refresh deferred while another invocation uses the installation.'); }
}
type MutationScope = { root: string; active: boolean; children: Promise<PromiseSettledResult<unknown>>[] };
const mutationContext = new AsyncLocalStorage<MutationScope>();
const context = new AsyncLocalStorage<{ root: string; file: string; active: boolean }>();

/** Birth identity survives exec but cannot be inherited by a reused PID. */
function processIdentity(pid: number): string {
  if (process.platform === 'linux') {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    if (!start) throw new Error('process-identity-unavailable');
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}`;
  }
  if (process.platform !== 'darwin') throw new Error('process-identity-unavailable');
  const options = { encoding: 'utf8' as const, timeout: 2000, maxBuffer: 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } };
  const boot = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], options).trim();
  const birth = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], options).trim();
  if (!birth) throw new Error('process-identity-unavailable');
  return `${boot}:${birth}`;
}

/** Unique immutable lease names avoid replacement/reclamation races. Unknown owners stay busy;
 * dead owners are ignored (and their unique files can safely be removed). No timeout evicts a live owner.
 */
function lease(root: string, kind: 'use' | 'write', pid = process.pid) {
  const dir = join(resolve(root), 'deck', 'installation-use');
  assertNoContributionSymlink(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${pid}-${randomUUID()}.${kind}`;
  writeFileSync(join(dir, file), JSON.stringify({ identity: processIdentity(pid) }), { flag: 'wx', mode: 0o600 });
  return { file, release: () => { try { unlinkSync(join(dir, file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }, conflicts(ignore?: string) {
    return readdirSync(dir).some(name => {
      if (name === file || name === ignore) return false;
      const match = /^(\d+)-[a-f0-9-]{36}\.(use|write)$/.exec(name);
      if (!match) return true;
      let stale = false;
      try {
        const owner = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        stale = typeof owner.identity === 'string' && owner.identity !== processIdentity(Number(match[1]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Either the unique lease disappeared or the process did. Both are stale.
          stale = true;
        } else {
          try { process.kill(Number(match[1]), 0); }
          catch (probe) { stale = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
        }
      }
      if (stale) {
        try { unlinkSync(join(dir, name)); } catch { /* another observer reclaimed it */ }
        return false;
      }
      return kind === 'write' || match[2] === 'write';
    });
  } };
}
export function acquireInstallationUse(root: string) {
  const held = lease(root, 'use');
  let active = true;
  try { if (held.conflicts()) throw new InstallationBusyError(); }
  catch (error) { held.release(); throw error; }
  return { file: held.file, release() { if (active) { active = false; held.release(); } }, trackProcess(pid: number) {
    if (!active || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('runner-installation-use-unreserved');
    return lease(root, 'use', pid).release;
  } };
}
export async function withInstallationUse<T>(root: string, effect: () => Promise<T>): Promise<T> {
  const held = acquireInstallationUse(root);
  const scope = { root: resolve(root), file: held.file, active: true };
  try { return await context.run(scope, effect); }
  finally { scope.active = false; held.release(); }
}
/** Each invocation drains only its own descendants, never its parent or siblings. */
async function runMutationEffect<T>(scope: MutationScope, effect: () => Promise<T>): Promise<T> {
  let outcome: PromiseSettledResult<T>;
  try { outcome = { status: 'fulfilled', value: await mutationContext.run(scope, effect) }; }
  catch (reason) { outcome = { status: 'rejected', reason }; }
  // Inherited work starting after this callback closes needs a new reservation.
  // Still-running children have their own open scopes and drain their descendants.
  scope.active = false;
  const children = await Promise.all(scope.children);
  if (outcome.status === 'rejected') throw outcome.reason;
  const rejected = children.find(child => child.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  return outcome.value;
}

export function withInstallationMutation<T>(root: string, effect: () => Promise<T>): Promise<T> {
  const current = mutationContext.getStore();
  const mutation: MutationScope = { root: resolve(root), active: true, children: [] };
  if (current?.active && current.root === mutation.root) {
    const running = runMutationEffect(mutation, effect);
    // Observe immediately, including detached rejections, without changing the
    // promise returned to an awaiting caller. Parent failure keeps its identity.
    current.children.push(running.then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    ));
    return running;
  }
  return (async () => {
    const held = lease(root, 'write');
    const scope = context.getStore();
    try {
      if (held.conflicts(scope?.active && scope.root === mutation.root ? scope.file : undefined)) throw new InstallationBusyError();
      return await runMutationEffect(mutation, effect);
    } finally { mutation.active = false; held.release(); }
  })();
}

/** Keep a surviving native child protected even if the Deck parent exits abruptly. */
export function trackInstallationProcess(root: string, pid: number): () => void {
  const scope = context.getStore();
  if (!scope?.active || scope.root !== resolve(root) || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('runner-installation-use-unreserved');
  return lease(root, 'use', pid).release;
}
