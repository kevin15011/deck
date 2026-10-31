import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export class CodexInstallationBusyError extends Error {
  readonly code = 'codex-installation-in-use';
  constructor() { super('Codex content refresh deferred while another invocation uses the installation.'); }
}
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
export async function withCodexInstallationUse<T>(root: string, effect: () => Promise<T>): Promise<T> {
  const held = lease(root, 'use');
  const scope = { root: resolve(root), file: held.file, active: true };
  try {
    if (held.conflicts()) throw new CodexInstallationBusyError();
    return await context.run(scope, effect);
  } finally { scope.active = false; held.release(); }
}
export async function withCodexInstallationMutation<T>(root: string, effect: () => Promise<T>): Promise<T> {
  const held = lease(root, 'write');
  const scope = context.getStore();
  try {
    if (held.conflicts(scope?.active && scope.root === resolve(root) ? scope.file : undefined)) throw new CodexInstallationBusyError();
    return await effect();
  } finally { held.release(); }
}

/** Keep a surviving native child protected even if the Deck parent exits abruptly. */
export function trackCodexInstallationProcess(root: string, pid: number): () => void {
  const scope = context.getStore();
  if (!scope?.active || scope.root !== resolve(root) || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('codex-installation-use-unreserved');
  return lease(root, 'use', pid).release;
}
