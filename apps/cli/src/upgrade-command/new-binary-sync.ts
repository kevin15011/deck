import { spawnSync } from 'node:child_process';
import type { RunnerSyncResult } from './runner-sync';
import { ManifestFileSchema } from './manifest-store';
import { assertPrivateStatePath } from '@deck/core';
import { computeFileSha256 } from './backup-store';
export type SyncSpawn = (command: string, args: readonly string[]) => {status: number | null; stdout?: string | Buffer | null};
/** No shell, bounded output and deadline. Only the newly installed executable owns content synchronization. */
export function syncWithNewBinary(input: {executable: string; expectedDigest?: string; backupId?: string; projectRoot: string; spawn?: SyncSpawn}): RunnerSyncResult {
 const deferred = (uncertain = false): RunnerSyncResult => ({...(uncertain ? {backupRecoveryRequired:true} : {}),outcomes:[{runnerId:'deck',status:'deferred',filesWritten:[],diagnostics:['The new executable could not confirm content synchronization. Refresh at the next idle preparation or Review & Install; the upgrade backup is retained.'],adapterBackup:undefined}],manifestEntries:[]});
 const args = ['internal','runner-sync',...(input.backupId ? ['--backup-id',input.backupId] : []),'--json'];
 try {
  if (!input.spawn) {
    assertPrivateStatePath(input.executable);
    if (!input.expectedDigest || computeFileSha256(input.executable) !== input.expectedDigest) return deferred();
  }
  const result = (input.spawn ?? ((command,argv) => spawnSync(command,[...argv],{cwd:input.projectRoot,env:process.env,encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:4*1024*1024})))(input.executable,args);
  if (result.status !== 0 || !result.stdout || Buffer.byteLength(result.stdout) > 4*1024*1024) return deferred(true);
  const data = JSON.parse(result.stdout.toString()) as RunnerSyncResult;

  if (!Array.isArray(data.outcomes) || !Array.isArray(data.manifestEntries) || !data.manifestEntries.every(f => ManifestFileSchema.safeParse(f).success && f.owner.startsWith("runner:")) || data.outcomes.some(o => !o || typeof o.runnerId !== 'string' || !['synced','skipped','failed','deferred'].includes(o.status) || !Array.isArray(o.filesWritten) || !o.filesWritten.every((p: unknown)=>typeof p==='string') || !Array.isArray(o.diagnostics) || !o.diagnostics.every((d: unknown)=>typeof d==='string'))) return deferred(true);
  if (data.manifestRemovals && (!Array.isArray(data.manifestRemovals) || !data.manifestRemovals.every(f => f && typeof f.path === 'string' && f.path.startsWith('/') && typeof f.owner === 'string' && f.owner.startsWith('runner:')))) return deferred(true);
  return data;
 } catch { return deferred(true); }
}
