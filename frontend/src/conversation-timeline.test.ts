import {test,expect} from 'bun:test';
import {conversationTimeline,windowRange} from './conversation-timeline';
import type {Receipt,Task} from './api';
const receipt=(id:string,at:number,attempt:string)=>({id,accepted_ms:at,attempt,phase:'completed'} as Receipt);
const task=(id:string,at:number,parent_attempt:string)=>({id,session:'s',owner:'quality',parent_attempt,attempts:[{accepted_ms:at}]} as Task);
// Protects recorded delegation placement and parent-turn grouping; oracle: feedback round 1.
test('delegations remain in their parent turn, ordered by first acceptance, independent of poll order',()=>{
 const rows=conversationTimeline([receipt('b',200,'b'),receipt('a',100,'a')],[task('late',160,'a'),task('early',120,'a'),task('second',220,'b')],'s');
 expect(rows.map(r=>r.key)).toEqual(['receipt:a','task:early','task:late','receipt:b','task:second']);
});
test('unbound tasks interleave by recorded acceptance and stable source order on ties',()=>{
 expect(conversationTimeline([receipt('a',100,'a'),receipt('b',200,'b')],[task('x',150,'missing'),task('y',150,'missing')],'s').map(r=>r.key)).toEqual(['receipt:a','task:x','task:y','receipt:b']);
});
test('history window stays bounded at either end while moving older and newer',()=>{
 expect(windowRange(500)).toEqual({start:380,end:500});
 expect(windowRange(500,460)).toEqual({start:340,end:460});
 expect(windowRange(70)).toEqual({start:0,end:70});
 expect(windowRange(500,500,60)).toEqual({start:440,end:500});
});
