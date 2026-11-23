import {test,expect} from 'bun:test';
import {conversationTimeline,windowRange} from './conversation-timeline';
import type {Receipt,Task} from './api';
const receipt=(id:string,at:number,attempt:string)=>({id,session:'s',accepted_ms:at,attempt,phase:'completed'} as Receipt);
const task=(id:string,at:number,parent_attempt:string)=>({id,session:'s',owner:'quality',root:parent_attempt,parent_attempt,attempts:[{id:id+'-1',accepted_ms:at}]} as Task);
// Protects recorded delegation placement and parent-turn grouping; oracle: feedback round 1.
test('delegations remain in their parent turn, ordered by first acceptance, independent of poll order',()=>{
 const rows=conversationTimeline([receipt('b',200,'b'),receipt('a',100,'a')],[task('late',160,'a'),task('early',120,'a'),task('second',220,'b')],'s');
 expect(rows.map(r=>r.key)).toEqual(['receipt:a','task:early:early-1','task:late:late-1','receipt:b','task:second:second-1']);
});
test('unbound tasks interleave by recorded acceptance and stable source order on ties',()=>{
 expect(conversationTimeline([receipt('a',100,'a'),receipt('b',200,'b')],[task('x',150,'missing'),task('y',150,'missing')],'s').map(r=>r.key)).toEqual(['receipt:a','task:x:x-1','task:y:y-1','receipt:b']);
});
test('a settled outcome without dispatch does not appear as a Lead turn',()=>{
 const continuation={task:'worker',attempt:'worker-1',source_seq:5,origin:'a'};
 const skipped={...receipt('skipped',110,'skip'),continuation,dispatch_ms:null};
 const dispatched={...receipt('dispatched',120,'sent'),continuation,dispatch_ms:121};
 const user={...receipt('user',130,'user'),phase:'cancelled' as const,dispatch_ms:null};
 expect(conversationTimeline([receipt('a',100,'a'),skipped,dispatched,user],[],'s').map(r=>r.key))
  .toEqual(['receipt:a','receipt:dispatched','receipt:user']);
});
test('history window stays bounded at either end while moving older and newer',()=>{
 expect(windowRange(500)).toEqual({start:380,end:500});
 expect(windowRange(500,460)).toEqual({start:340,end:460});
 expect(windowRange(70)).toEqual({start:0,end:70});
 expect(windowRange(500,500,60)).toEqual({start:440,end:500});
});

test('a delayed continuation appears after its completed Lead receipt, retaining the first attempt',()=>{
 const original={...task('quality',120,'lead-original'),root:'original'};
 const oldTurn=receipt('original',100,'lead-original');
 const retryTurn=receipt('retry',300,'lead-retry');
 const before=conversationTimeline([oldTurn,retryTurn],[original],'s');
 const retry={...original.attempts[0]!,id:'retry-2',phase:'running' as const,accepted_ms:420,authority:{root:'retry',attempt:'lead-retry'}};
 const after=conversationTimeline([oldTurn,retryTurn,receipt('later',400,'lead-later')],[{...original,attempts:[...original.attempts,retry]}],'s');
 expect(after.map(row=>row.key)).toEqual([...before.map(row=>row.key),'task:quality:retry-2','receipt:later']);
 expect(after[1]?.attempt).toBe(original.attempts[0]);
 expect(after[3]?.attempt).toBe(retry);
});
test('unbound continuations use acceptance time while legacy follow-ups stay with their Lead',()=>{
 const original=receipt('a',100,'a');
 const later=receipt('b',200,'b');
 const first=task('worker',110,'a');
 const continuation={...first,attempts:[...first.attempts,{...first.attempts[0]!,id:'worker-2',accepted_ms:210}]};
 const foreign={...task('foreign',120,'a'),session:'other'};
 const foreignTurn={...receipt('foreign',120,'foreign'),session:'other'};
 expect(conversationTimeline([original,later,foreignTurn],[continuation,foreign],'s').map(row=>row.key))
  .toEqual(['receipt:a','task:worker:worker-1','receipt:b','task:worker:worker-2']);
 expect(conversationTimeline([{...original,mode:'team'},later],[continuation],'s').map(row=>row.key))
  .toEqual(['receipt:a','task:worker:worker-1','task:worker:worker-2','receipt:b']);
});
