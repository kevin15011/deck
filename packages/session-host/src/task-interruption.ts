import type { TaskAttempt } from './ledger';

/** Only host-recorded, settled operator stops of a launched execution qualify. */
export function trustedOperatorStop(attempt:TaskAttempt|undefined):TaskAttempt['stop']|undefined {
 if(!attempt)return;
 const stop=attempt.stop;
 if(!stop||!['interrupted','cancelled'].includes(attempt.state)
   ||!['user','lead'].includes(stop.origin)||!['interrupt','cancel'].includes(stop.kind)
   ||attempt.state==='cancelled'&&stop.kind!=='cancel'||stop.launched!==true
   ||typeof stop.commandId!=='string'||!stop.commandId.trim())return;
 const {launchedAt,endedAt}=attempt;
 if(typeof launchedAt!=='number'||typeof endedAt!=='number'
   ||!Number.isFinite(launchedAt)||!Number.isFinite(endedAt)||endedAt<launchedAt)return;
 if(stop.origin==='lead'&&(typeof stop.leadTaskId!=='string'||!stop.leadTaskId.trim()
   ||!Number.isSafeInteger(stop.leadAttempt)||stop.leadAttempt!<1))return;
 return stop;
}
