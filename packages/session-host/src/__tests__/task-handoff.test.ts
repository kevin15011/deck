import {expect,test} from 'bun:test';
import {buildTaskHandoff} from '../task-handoff';
import {utf8Bytes} from '@deck/core/session/task-handoff';
import type {LedgerTask} from '../ledger';
const task=():LedgerTask=>({taskId:'work',memberId:'apply-deep',continuityRole:'work',attempts:[{attempt:1,runnerId:'codex',modelId:'m',state:'completed',startedSeq:1,result:'historical resolved F1 report',resultSeq:5},{attempt:2,runnerId:'codex',modelId:'m',state:'running',startedSeq:6}],originalInstruction:{text:'Original',bytes:8,seq:1,artifact:'/private/task/instruction-attempt-1.txt',digest:'hash'},acceptance:{items:[{id:'AC1',text:'Keep required criteria'}]},findings:[{id:'F2',state:'open',text:'Unresolved blocker'}],taskEdits:[{path:'src/a.ts',op:'update',seq:4,attempt:1,diff:'界'.repeat(20000)}]});
test('uses actual Unicode byte bounds, preserves mandatory criteria and only structured open findings',()=>{
 const t=task();const built=buildTaskHandoff({task:t,predecessor:t.attempts[0],sources:[],maxBytes:32768,captureSeq:7,artifact:'/private/task/handoff-attempt-2.txt'});
 expect(utf8Bytes(built.text)).toBeLessThanOrEqual(32768);expect(built.bytes).toBe(utf8Bytes(built.text));expect(built.truncated).toBe(true);
 expect(built.text).toContain('Keep required criteria');expect(built.text).toContain('F2');
 expect(built.text.split('Active findings')[1]?.split('Structured revision')[0]).not.toContain('F1');
 expect(built.artifactText).toContain('src/a.ts');expect(built.text).toContain('/private/task/handoff-attempt-2.txt');
 expect(built.text).toContain('/private/task/instruction-attempt-1.txt');expect(built.text).toContain('potentiallyMixed: true');
});
test('first review uses only explicit source-attempt edits, with absent/empty markers',()=>{
 const source=task(),review:LedgerTask={taskId:'review',memberId:'quality',continuityRole:'review',attempts:[{attempt:1,runnerId:'claude',modelId:'m',state:'running',startedSeq:8}],sourceTasks:[{taskId:'work',attempt:1}],taskEdits:[{path:'should-not-appear.ts',op:'add',seq:7,attempt:1}]};
 source.attempts[0]!.edits=[{path:'candidate.ts',op:'update',seq:4}];
 const built=buildTaskHandoff({task:review,sources:[{task:source,attempt:source.attempts[0]!}],maxBytes:32768,captureSeq:8,artifact:'/private/review.txt'});
 expect(built.text).toContain('not supplied');expect(built.text).toContain('candidate.ts');expect(built.text).not.toContain('should-not-appear.ts');expect(built.text).toContain('sourceAttempt');
});

for(const state of ['interrupted','cancelled'] as const)for(const content of ['completed-message','streaming-only','unavailable'] as const)test(`operator ${state} handoff uses ${content} partial evidence and mandatory verification`,()=>{
 const t=task(),previous=t.attempts[0]!;
 Object.assign(previous,{state,launchedAt:10,endedAt:20,stop:{origin:'lead',kind:state==='cancelled'?'cancel':'interrupt',commandId:'stop',launched:true,leadTaskId:'lead',leadAttempt:1},result:'legacy result retained for task.result',reportArtifact:{path:'/private/report.txt',digest:'hash',bytes:12,originalBytes:12,truncated:false}});
 if(content!=='unavailable')previous.lastAgentMessage={text:'Last public progress',firstSeq:3,seq:4,bytes:20,truncated:false,streaming:content==='streaming-only'};
 const built=buildTaskHandoff({task:t,predecessor:previous,sources:[],maxBytes:32768,captureSeq:7,artifact:'/private/handoff.txt',editArtifacts:[{sourceTask:t.taskId,captureAttempt:2,sourceAttempts:[1],path:'/private/edits.json',bytes:100,digest:'hash'}]});
 expect(built.text).toContain('INTERRUPTED');expect(built.text).toContain('NO FINAL REPORT');
 expect(built.text).toContain('Inspect the current state of task-attributed edited files before continuing or repeating actions');
 expect(built.text).toContain('/private/edits.json');expect(built.text).toContain('potentially mixed');
 expect(built.text).toContain('src/a.ts');expect(built.text).not.toContain('legacy result retained for task.result');
 if(content==='unavailable')expect(built.text).toContain('Last available public agent message: unavailable');
 else {expect(built.text).toContain('Last public progress');expect(built.text).toContain('partial evidence');}
 expect(built.bytes).toBeLessThanOrEqual(32768);
});

test('interruption status and inspection guard survive truncation with large instructions, files and Unicode evidence',()=>{
 const t=task(),previous=t.attempts[0]!;
 Object.assign(previous,{state:'interrupted',launchedAt:10,endedAt:20,stop:{origin:'user',kind:'interrupt',commandId:'stop',launched:true},lastAgentMessage:{text:'partial 界'.repeat(500),firstSeq:3,seq:4,bytes:4000,truncated:true,streaming:true}});
 t.originalInstruction!.text='instruction 界'.repeat(3000);t.taskEdits=Array.from({length:256},(_,i)=>({path:`src/file-${i}.ts`,op:'update',seq:4,attempt:1,diff:'界'.repeat(100)}));
 const built=buildTaskHandoff({task:t,predecessor:previous,sources:[],maxBytes:32768,captureSeq:7,artifact:'/private/handoff.txt',editArtifacts:[{sourceTask:t.taskId,captureAttempt:2,sourceAttempts:[1],path:'/private/edits.json',bytes:32000,digest:'hash'}]});
 expect(built.truncated).toBe(true);expect(utf8Bytes(built.text)).toBeLessThanOrEqual(32768);
 expect(built.text).toContain('NO FINAL REPORT');expect(built.text).toContain('Inspect the current state');expect(built.text).toContain('/private/edits.json');expect(built.text).toContain('Last available public agent message');
 expect(built.text).toContain('Keep required criteria');expect(built.text).toContain('F2');
});

test('interrupted attempt with no recorded edits explicitly discloses missing file evidence',()=>{
 const t=task(),previous=t.attempts[0]!;t.taskEdits=[];
 Object.assign(previous,{state:'cancelled',launchedAt:10,endedAt:20,stop:{origin:'user',kind:'cancel',commandId:'stop',launched:true}});
 const built=buildTaskHandoff({task:t,predecessor:previous,sources:[],maxBytes:32768,captureSeq:7,artifact:'/private/handoff.txt'});
 expect(built.text).toContain('NO FINAL REPORT');expect(built.text).toContain('No task-attributed edited files recorded');expect(built.text).toContain('unobserved');
});

test('interrupted reviewer notice counts explicit source edits rather than the reviewer own edits',()=>{
 const source=task();source.attempts[0]!.edits=[{path:'candidate.ts',op:'update',seq:4}];
 const review=task();review.memberId='quality';review.continuityRole='review';review.taskEdits=[];review.sourceTasks=[{taskId:source.taskId,attempt:1}];
 const previous=review.attempts[0]!;Object.assign(previous,{state:'interrupted',launchedAt:10,endedAt:20,stop:{origin:'user',kind:'interrupt',commandId:'stop',launched:true}});
 const built=buildTaskHandoff({task:review,predecessor:previous,sources:[{task:source,attempt:source.attempts[0]!}],maxBytes:32768,captureSeq:7,artifact:'/private/review.txt'});
 expect(built.text).toContain('1 task-attributed file entries recorded');expect(built.text).not.toContain('No task-attributed edited files recorded');expect(built.text).toContain('candidate.ts');
});
