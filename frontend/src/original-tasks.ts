import {useEffect,useRef,useState} from 'react';
import {request,type Task,type TaskAttempt} from './api';
export type DisplayAttempt=Omit<Pick<TaskAttempt,'failure_dismissal'|'failure_dismissal_blocker'|'id'|'phase'|'report'|'treatments'|'provenance'|'requested_model'|'observed_model'|'context'|'native_session'|'native_message'|'accepted_ms'|'cancel_requested'|'detail'>,'phase'|'provenance'> & Partial<Pick<TaskAttempt,'settled_ms'>> & {prompt?:string;phase:string;provenance:Pick<TaskAttempt['provenance'],'runner'>;number?:number;original?:{taskId:string;snapshot:string;displayId:string};recordedNumber?:number|null};
export type DisplayTask=Pick<Task,'id'|'session'|'owner'> & {attempts:DisplayAttempt[];historyError?:string;executionId?:string;revision?:number;original?:{taskId:string;snapshot:string}};
interface RecordedTask {id:string;member:string|null;order:number;attempts:{number:number|null;state:string|null;runner:string|null;model:string|null;result:{seq:number;text:string;digest:string}|null}[]}
export function useOriginalTasks(session:string,enabled:boolean,visible:boolean){
 const [value,setValue]=useState<{session:string;tasks:DisplayTask[];snapshot:string;next:string|null}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const loaded=useRef('');
 const controller=useRef<AbortController|undefined>(undefined),pending=useRef(false);
 function decode(p:Record<string,unknown>):DisplayTask[]{
  if(p.session!==session||!Array.isArray(p.agentTasks)||typeof p.snapshot!=='string')throw Error('Original task identity mismatch');
  const project=(p.metadata as {projectRoot?:string})?.projectRoot;
  if(typeof project!=='string'||!(p.nextTask===null||typeof p.nextTask==='string'))throw Error('Invalid original task page');
  const nullable=(v:unknown)=>v===null||typeof v==='string';
  for(const t of p.agentTasks as RecordedTask[]){
   if(!t||typeof t.id!=='string'||!nullable(t.member)||!Number.isSafeInteger(t.order)||!Array.isArray(t.attempts)||!t.attempts.length)throw Error('Invalid recorded task');
   const attempts=new Set<number|null>();
   for(const a of t.attempts){if(!a||!(a.number===null||Number.isSafeInteger(a.number)&&a.number>0)||attempts.has(a.number)||![a.state,a.runner,a.model].every(nullable)||!(a.result===null||a.result&&Number.isSafeInteger(a.result.seq)&&a.result.seq>0&&typeof a.result.text==='string'&&typeof a.result.digest==='string'))throw Error('Invalid recorded attempt');attempts.add(a.number);}
  }
  if(new Set((p.agentTasks as RecordedTask[]).map(t=>t.id)).size!==p.agentTasks.length)throw Error('Duplicate original task identity');
  return (p.agentTasks as RecordedTask[]).map(t=>({id:JSON.stringify(['original',project,t.id]),session,owner:t.member??'Unknown member',original:{taskId:t.id,snapshot:p.snapshot as string},attempts:t.attempts.map(a=>({id:'original:'+String(a.number??'unknown'),original:{taskId:t.id,snapshot:p.snapshot as string,displayId:JSON.stringify(['original',project,t.id])},recordedNumber:a.number,phase:a.state??'unknown',report:a.result?{attempt:String(a.number),digest:a.result.digest,text:a.result.text}:null,treatments:[],provenance:{runner:a.runner??''},requested_model:a.model??'',observed_model:null,native_session:null,native_message:null,accepted_ms:t.order,cancel_requested:false,detail:''}))}));
 }
 useEffect(()=>{if(!enabled||!visible)return;const c=new AbortController();controller.current=c;pending.current=false;setBusy(false);if(loaded.current===session+':'+retry)return()=>{c.abort();pending.current=false;};setValue(undefined);setError('');setBusy(true);pending.current=true;
 void request('GET',`/api/history/sessions/${encodeURIComponent(session)}?limit=1&includeTasks=true`,undefined,c.signal).then(v=>{if(c.signal.aborted)return;const p=v as Record<string,unknown>;const tasks=decode(p);loaded.current=session+':'+retry;setValue({session,tasks,snapshot:p.snapshot as string,next:p.nextTask as string|null});}).catch(e=>{if(!c.signal.aborted)setError(String(e));}).finally(()=>{if(!c.signal.aborted){pending.current=false;setBusy(false);}});return()=>{c.abort();pending.current=false;};},[session,enabled,visible,retry]);
 async function more(){if(!value||value.session!==session||!value.next||pending.current)return;const c=controller.current;if(!c||c.signal.aborted)return;pending.current=true;setBusy(true);try{const p=await request('GET',`/api/history/sessions/${encodeURIComponent(session)}?limit=1&includeTasks=true&snapshot=${encodeURIComponent(value.snapshot)}&tasksAfter=${encodeURIComponent(value.next)}`,undefined,c.signal) as Record<string,unknown>;if(c.signal.aborted)return;if(p.snapshot!==value.snapshot)throw Error('Original snapshot mismatch');const tasks=decode(p);setValue({...value,tasks:[...value.tasks,...tasks],next:p.nextTask as string|null});setError('');}catch(e){if(!c.signal.aborted)setError(String(e));}finally{if(!c.signal.aborted){pending.current=false;setBusy(false);}}}
 return {tasks:enabled&&value?.session===session?value.tasks:[],next:value?.session===session?value.next:null,busy:enabled&&busy,error:enabled?error:'',more,retry:()=>setRetry(v=>v+1)};
}

// A backend binding is the only authority for merging two presentation lineages.
// Per-attempt provenance preserves passive routes and existing historical read keys.
export function mergeTasks(original:DisplayTask[],live:Task[],session:string):DisplayTask[]{
 const models:DisplayTask[]=original.slice();
 for(const t of live.filter(t=>t.session===session&&t.attempts.length)){
  const at=t.original?models.findIndex(h=>h.original?.taskId===t.original!.task_id):-1;
  if(at<0)models.push({id:t.original?.display_id??t.id,revision:t.revision,executionId:t.id,session:t.session,owner:t.owner,attempts:t.attempts});
  else if(models[at]!.original!.snapshot!==t.original!.fingerprint)models[at]={id:t.original!.display_id,revision:t.revision,executionId:t.id,session:t.session,owner:t.owner,attempts:t.attempts,historyError:"Historical snapshot changed; original attempts are unavailable for this lineage."};
  else {const h=models[at]!;models[at]={id:h.id,session:t.session,owner:t.owner,attempts:[...h.attempts,...t.attempts],revision:t.revision,executionId:t.id};}
 }
 return models.sort((a,b)=>(b.attempts.at(-1)?.accepted_ms??0)-(a.attempts.at(-1)?.accepted_ms??0));
}
