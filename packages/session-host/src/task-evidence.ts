import { byteExcerpt } from './task-handoff';
import { sanitizeRequestInput, type RequestInputEvidence, type ContinuitySelection, type ContinuityRequest, type ContinuityRole } from '@deck/core/session/task-continuity';
import { projectRelativePath, utf8Bytes, type StructuredTaskState } from '@deck/core/session/task-handoff';
import type { SessionEvent } from '@deck/core/session/events';
import type { LedgerTask, TaskAttempt } from './ledger';
export type InstructionEvidence={text:string;bytes:number;seq:number;artifact:string;digest:string};
export type TaskContinuityState=StructuredTaskState&{assignedRoleId?:string;continuityRole?:ContinuityRole;originalInstruction?:InstructionEvidence;instructions?:InstructionEvidence[];omittedInstructions?:number;structuredSeq?:number;structuredActor?:{taskId:string;attempt:number};taskEdits?:{path:string;op:string;seq:number;attempt:number;diff?:string}[];taskEditOverflow?:boolean};
export type TaskEditArtifact={sourceTask:string;path:string;digest:string;bytes:number}&(
 {sourceAttempt:number;captureAttempt?:never;sourceAttempts?:never}|
 {sourceAttempt?:never;captureAttempt:number;sourceAttempts:number[]}
);
export type AttemptContinuityState={
 /** Explicit substantive source retained across one infrastructure-only resume failure. */
 recoveryPredecessorAttempt?:number;
 /** Latest public assistant message only; completion of a message does not finalize the attempt. */
 lastAgentMessage?:{text:string;bytes:number;firstSeq:number;seq:number;messageId?:string;streaming:boolean;truncated:boolean};stopSeq?:number;
 overlaps?:{sessionId:string;taskId:string;attempt:number}[];overlapOverflow?:boolean;reworkSources?:{taskId:string;attempt:number;findingId:string}[];reportArtifactUnavailable?:string;reportArtifact?:{path:string;digest:string;bytes:number;originalBytes:number;truncated:boolean};createdAt?:number;queuedAt?:number;preparingAt?:number;launchedAt?:number;endedAt?:number;
 continuityRequester?:{taskId:string;memberId:string;attempt:number};continuityPending?:boolean;continuityRequest?:ContinuityRequest;continuityJustification?:string;selection?:ContinuitySelection;
 requestInput?:RequestInputEvidence&{seq:number};stop?:{origin:'user'|'lead'|'system';kind:string;commandId:string;launched:boolean;leadTaskId?:string;leadAttempt?:number};
 handoff?:{bytes:number;truncated:boolean;artifact?:string;digest?:string;captureSeq:number;editArtifacts?:TaskEditArtifact[]};
 edits?:{path:string;op:string;seq:number;diff?:string}[];editOverflow?:boolean;potentiallyMixed?:boolean;concurrency?:'unknown';
};
/** Fold bounded task projections once at append/replay, never scan history at continuation. */
export function projectTaskEvidence(task:LedgerTask, event:SessionEvent):void {
 const a=task.attempts.at(-1)!;const d=event.data;
 if(d.attempt!==undefined&&d.attempt!==a.attempt)return;
 if(event.source.nativeSessionId&&a.nativeSessionId&&event.source.nativeSessionId!==a.nativeSessionId)return;
 if(event.kind==='task.created'||event.kind==='task.continued') {
  a.createdAt=Date.parse(event.ts);
  if(Number.isSafeInteger(d.recoveryPredecessorAttempt) && Number(d.recoveryPredecessorAttempt)<a.attempt && task.attempts.some(p=>p.attempt===d.recoveryPredecessorAttempt))a.recoveryPredecessorAttempt=Number(d.recoveryPredecessorAttempt);
  if(Array.isArray(d.reworkSources))a.reworkSources=structuredClone(d.reworkSources);
  if(d.continuityRequester)a.continuityRequester=structuredClone(d.continuityRequester) as AttemptContinuityState['continuityRequester'];
  if(d.continuityPending===true)a.continuityPending=true;
  if(['auto','fresh','native'].includes(String(d.continuityRequest)))a.continuityRequest=d.continuityRequest as ContinuityRequest;
  if(typeof d.continuityJustification==='string')a.continuityJustification=d.continuityJustification;
  if(typeof d.assignedRoleId==='string')task.assignedRoleId=d.assignedRoleId;
  if(['work','review','unknown'].includes(String(d.continuityRole)))task.continuityRole=d.continuityRole as ContinuityRole;
  if(d.structured&&typeof d.structured==='object') {
   Object.assign(task,structuredClone(d.structured));task.structuredSeq=event.seq;
   task.structuredActor=d.structuredActor as TaskContinuityState['structuredActor'];
   for(const v of Object.values(task.findingStates??{}))if(v.seq===0)v.seq=event.seq;
  }
  if(d.instruction&&typeof d.instruction==='object') {
   const instruction={...d.instruction as InstructionEvidence,seq:event.seq};
   task.originalInstruction??=instruction;
   const list=task.instructions??=[];list.push(instruction);
   if(list.length>8){list.shift();task.omittedInstructions=(task.omittedInstructions??0)+1;}
  }
 }
 if(event.kind==='task.state') {
  if(d.state==='queued')a.queuedAt??=Date.parse(event.ts);
  if(d.state==='running')a.preparingAt??=Date.parse(event.ts);
  if(d.selection){a.selection=structuredClone(d.selection) as ContinuitySelection;a.continuity=a.selection.continuity;delete a.continuityPending;if(a.continuity==='reseeded'){delete a.nativeSessionId;task.nativeConfirmed=false;}}
  if(d.nativeSessionId&&typeof d.nativeSessionId==='string')a.nativeSessionId=d.nativeSessionId;
  if(Array.isArray(d.overlaps)){const list=a.overlaps??=[];for(const v of d.overlaps)if(!list.some(o=>o.sessionId===v.sessionId&&o.taskId===v.taskId&&o.attempt===v.attempt)){if(list.length<32)list.push(structuredClone(v));else a.overlapOverflow=true;}}
  if(d.potentiallyMixed===true){a.potentiallyMixed=true;a.concurrency='unknown';}
  if(d.handoff)a.handoff=structuredClone(d.handoff) as AttemptContinuityState['handoff'];
  if(d.launched===true)a.launchedAt=Date.parse(event.ts);
  if(d.stop){a.stop=structuredClone(d.stop) as AttemptContinuityState['stop'];a.stopSeq=event.seq;}
 }
 if(task.memberId!=='lead'&&a.state==='running'&&(event.kind==='message.delta'||event.kind==='message.completed')
   &&(d.role===undefined||d.role==='assistant')&&!d.internal&&typeof d.text==='string'&&d.text.length){
  const messageId=typeof d.messageId==='string'&&d.messageId.length<=256?d.messageId:undefined;
  const previous=a.lastAgentMessage;
  const append=event.kind==='message.delta'&&previous?.streaming&&previous.messageId===messageId;
  // Keep only a bounded prefix, never hidden reasoning, raw logs or a transcript.
  const input=(append?previous.text:'')+byteExcerpt(d.text,4096);
  const text=byteExcerpt(input,4096);
  a.lastAgentMessage={text,bytes:utf8Bytes(text),firstSeq:append?previous.firstSeq:event.seq,seq:event.seq,
   ...(messageId?{messageId}:{}),streaming:event.kind==='message.delta',
   truncated:utf8Bytes(d.text)>4096||utf8Bytes(input)>4096||!!(append&&previous.truncated)};
 }
 if(event.kind==='usage'&&a.state==='running') {
  const input=sanitizeRequestInput(d.requestInput);
  if(input&&input.nativeThreadId===a.nativeSessionId&&input.modelId===a.modelId)a.requestInput={...input,seq:event.seq};
  else if(Object.hasOwn(d,'requestInput'))delete a.requestInput;
 }
 if(event.kind==='diagnostic'&&a.state==='running') {
  if(['context.compaction','context.invalidated','request.input-invalidated'].includes(String(d.code)))delete a.requestInput;
  if(d.code==='request.input-finalized'&&a.requestInput&&d.nativeRequestId===a.requestInput.nativeRequestId&&d.nativeThreadId===a.requestInput.nativeThreadId&&d.nativeTurnId===a.requestInput.nativeTurnId)a.requestInput.final=true;
 }
 if(event.kind==='tool.completed'&&a.state==='running'&&d.isError!==true&&d.status==='completed'&&Array.isArray(d.edits)) {
  const edits=a.edits??=[];
  for(const edit of d.edits.slice(0,257)) {
   if(!edit||typeof edit!=='object'||!projectRelativePath(edit.path)||!['add','update','delete','rename-from','rename-to'].includes(edit.op))continue;
   const existing=edits.find(e=>e.path===edit.path);
   if(!existing&&edits.length>=256){a.editOverflow=true;continue;}
   const diff=typeof edit.diff==='string'&&utf8Bytes(edit.diff)<=8192?edit.diff:undefined;
   const total=edits.reduce((n,e)=>n+utf8Bytes(e.diff??''),0);
   const value={path:edit.path,op:edit.op,seq:event.seq,...(diff&&total+utf8Bytes(diff)<=16384?{diff}:{})};
   if(existing){delete existing.diff;Object.assign(existing,value);}else edits.push(value);
   const aggregate=task.taskEdits??=[];const old=aggregate.find(e=>e.path===value.path);
   const aggregateDiffBytes=aggregate.reduce((n,e)=>n+utf8Bytes(e.diff??''),0);
   const entry={...value,attempt:a.attempt};if(aggregateDiffBytes+utf8Bytes(entry.diff??'')>16384)delete entry.diff;
   if(old){delete old.diff;Object.assign(old,entry);}else if(aggregate.length<256)aggregate.push(entry);else task.taskEditOverflow=true;
  }
 }
}
