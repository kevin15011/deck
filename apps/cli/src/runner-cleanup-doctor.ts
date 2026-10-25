import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ControlClient,resolveStatePaths} from '@deck/session-host';
import {cleanupRoots,planRunnerCleanup,type CleanupRoots} from './runner-cleanup-command';
import type {DoctorCategoryResult,DoctorCheckItem} from './doctor-command/types';
/** Current filesystem evidence, without acknowledging consent, recovering or collecting anything. */
export async function reviewRunnerCleanup(roots:CleanupRoots=cleanupRoots(), state=resolveStatePaths()):Promise<DoctorCategoryResult> {
 const items:DoctorCheckItem[]=[];
 const report=planRunnerCleanup(roots);
 for(const plan of report.plans){
  if(plan.entries.length || plan.diagnostics.length)items.push({status:'warning',message:`${plan.runnerId}: ${plan.entries.filter(e=>e.action==='remove').length} proven-owned removals, ${plan.entries.filter(e=>e.action==='conditional-remove').length} individual reviews, ${plan.entries.filter(e=>e.action==='preserve').length} retained contributions.`,suggestion:'Run deck runner cleanup --plan --json, then --review when idle. Retained references need verified replacement before collection.'});
  const manifest=plan.runnerId==='claude'?join(roots.data,'claude/manifest.json'):join(roots[plan.runnerId as 'codex'|'pi'|'opencode'],'deck/manifest.json');
  if(existsSync(`${manifest}.pending`))items.push({status:'error',message:`${plan.runnerId}: pending contribution recovery at ${manifest}.pending.`,suggestion:'Inspect the existing transaction and backups before retrying update. Do not delete the pending receipt.'});
 }
 let client:ControlClient|undefined;
 try{
  const marker=join(state.daemonDir,'runner-mutation.json'),guard=`${marker}.gate`;
  if(existsSync(guard))items.push({status:'warning',message:`Runner mutation guard at ${guard} is contended or interrupted; activity is unknown and runner changes must be deferred. Reservation: ${marker}.`,suggestion:'Retry after current operations finish. For persistent interruption, see docs/runners.md#offline-runner-mutation-guard-recovery. Independently establish that no daemon, daemon starters or runner mutations can be active or resume before manually removing only the empty guard. Preserve the reservation, backups and receipts; age or a failed ping is not proof.'});
  if(existsSync(marker))items.push({status:'warning',message:`Runner mutation reservation or recovery at ${marker} is present; updates may be deferred. Retry only after its owner finishes; inspect recovery if it persists.`});
  if(existsSync(state.lockFile)){
   client=await ControlClient.connect(state.socket.path,{timeoutMs:500});
   const reply=await client.request({t:'daemon.status'},1000);
   const status=reply.t==='daemon.status'?reply.status as Record<string,unknown>:undefined;
   if(!status || typeof status.activeSessions !== 'boolean' || status.runningWork || status.pendingApprovals || status.pendingQuestions || status.activeSessions || status.stopping)items.push({status:'warning',message:'Runner migration is deferred while daemon sessions/work are active or activity is unknown. Planning remains available; retry when idle.'});
  } else if (existsSync(state.socket.path) || (existsSync(state.sessionsDir) && readdirSync(state.sessionsDir).length > 0)) {
   // Admission cannot establish that offline sessions/socket evidence is idle.
   // Inspect only: doctor must not start a daemon, reserve, repair or recover.
   items.push({status:'warning',message:'Daemon activity is unknown: offline session history or socket evidence is present. Runner changes must be deferred. Read-only planning remains available.'});
  }
 }catch{items.push({status:'warning',message:'Daemon activity is unknown; runner changes must be deferred. Read-only planning remains available.'});}finally{client?.close();}
 if(!items.length)items.push({status:'ok',message:'No retired runner contributions or pending contribution recovery detected.'});
 return{category:'Runner Migration',status:items.some(i=>i.status==='error')?'error':items.some(i=>i.status==='warning')?'warning':'ok',items};
}
