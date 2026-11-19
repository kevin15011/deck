import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SessionIndicators} from './session-indicators';
import {test,expect} from 'bun:test';
import {API,receipt,type Workspace,type Decision} from './api';
import {sessionStatus,projectStatus,subagentErrorCount,sidebarAttention} from './sidebar-state';
import {processingState} from './processing-progress';
const r=receipt({fresh:false,session:'session-a',id:'receipt-a',prompt:'Fixture input',phase:'running',text:'',detail:'',native_pid:123,model:null,local_tool_calls:0,thread:'thread',turn:'turn',accepted_ms:1,handshake_ms:null,dispatch_ms:1,first_output_ms:null,revision:1,policy:'fixture',runner:'codex',delivery:'observed'});
const w:Workspace={api:API,host_id:'fixture-host',sessions:[],session:'session-a',project:'/fixture',runner:'codex',availability:null,receipts:[r],tasks:[],trusted:false,queue_paused:false,steering_unavailable:'',team_availability:null};
// Protects independent Lead, worker and attention dimensions. Oracle: sidebar parity inventory.
test('worker approval must not turn the Lead into waiting for approval',()=>{
 const approval={task:'worker-a',state:'pending',questions:[]} as unknown as Decision;
 const value={...w,receipts:[{...r,decisions:[approval]}]};const s=sessionStatus(value,'session-a');
 expect(s.leadActivity?.state).toBe('running');expect(s.leadActivity?.pendingApprovals).toBe(0);
 expect(s.activity?.attention.approvals).toBe(1);expect(s.activity?.attention.byWorkers).toBe(1);expect(s.activity?.workers.blocked).toBe(1);
 const project=projectStatus('project-a',[s]);expect(project.leadsRunning).toBe(1);expect(project.attentionSessions).toBe(1);
});
// Protects completed/unknown work from acquiring a fake live connection or working animation.
test('only observed pending work creates processing state',()=>{
 expect(sessionStatus({...w,receipts:[]},'session-a').preparationStatus).not.toBe('ready');
 expect(processingState([{...r,phase:'completed'}],true,false).phase).toBe('idle');
 expect(processingState([],false,false).phase).toBe('connection');
 expect(processingState([{...r,phase:'queued'}],true,false).phase).toBe('waiting');
 for(const text of ['', 'Earlier progress message'])expect(processingState([{...r,phase:'running',text}],true,false).phase).toBe('working');
 expect(processingState([{...r,decisions:[{state:'pending',questions:[{}]} as Decision]}],true,false).phase).toBe('question');
});

// Protects observed completion independently from connection readiness and unread receipts.
test('composed completed indicator is available while disconnected and preserves unread',()=>{
 const session=sessionStatus({...w,receipts:[{...r,phase:'completed'}]},'session-a');
 expect(session.preparationStatus).not.toBe('ready');
 for(const unread of [false,true]) {
  const html=renderToStaticMarkup(React.createElement(SessionIndicators,{session,unread,fresh:true}));
  expect(html).toContain('data-state="completed"');
  expect(html.includes('Unread reply')).toBe(unread);
  expect(html).not.toContain('Stopped');
 }
});

// Protects Deck1 latest-task counting across retries, preparation and human blocking.
// Oracle: original workerActivity separates running, queued and blocked workers.
test('tab, session and project counts use only latest unblocked execution',()=>{
 const attempt=(id:string,phase:string)=>({id,phase});
 const tasks=[
  {id:'retry',session:'session-a',owner:'apply-deep',attempts:[attempt('old','running'),attempt('new','completed')]},
  {id:'running',session:'session-a',owner:'quality',attempts:[attempt('live','running')]},
  {id:'blocked',session:'session-a',owner:'apply-deep',attempts:[attempt('block','running')]},
  {id:'starting',session:'session-a',owner:'architect',attempts:[attempt('start','preparing')]},
  {id:'waiting',session:'session-a',owner:'setup',attempts:[attempt('queue','queued')]},
  {id:'uncertain',session:'session-a',owner:'investigate',attempts:[attempt('lost','uncertain')]},
  {id:'foreign',session:'session-b',owner:'quality',attempts:[attempt('other','running')]},
 ] as Workspace['tasks'];
 const decisions=[{task:'blocked',attempt:'block',state:'pending',questions:[]}] as unknown as Decision[];
 const value={...w,tasks,receipts:[{...r,decisions}]};
 const workers=sessionStatus(value,'session-a').activity!.workers;
 expect(workers).toEqual({active:1,queued:2,blocked:1,unsettled:1});
 expect(projectStatus('p',[sessionStatus(value,'session-a'),sessionStatus(value,'session-b')]).workers).toEqual({active:2,queued:2,blocked:1,unsettled:1});
 // A previous attempt's unresolved prompt must not block its replacement.
 value.receipts=[{...r,decisions:[{...decisions[0]!,attempt:'previous'}]}];
 expect(sessionStatus(value,'session-a').activity!.workers.active).toBe(2);
});

// Protects owning session/project error counts while preserving failed outcomes.
// Oracle: persisted handling is separate from execution status; fails if foreign errors clear.
test('handled failures clear only their owning latest error without changing outcomes',()=>{
 const tasks=[{id:'handled',session:'session-a',attempts:[{phase:'failed',failure_dismissal:{command_id:'dismiss',at_ms:10,revision:2}}]},{id:'open',session:'session-b',attempts:[{phase:'failed',treatments:[]}]}] as Workspace['tasks'];
 const value={...w,tasks};
 expect(sessionStatus(value,'session-a').activity!.errors).toBe(0);
 expect(sessionStatus(value,'session-b').activity!.errors).toBe(1);
 expect(projectStatus('p',[sessionStatus(value,'session-a'),sessionStatus(value,'session-b')]).errors).toBe(1);
 expect(value.tasks[0]!.attempts[0]!.phase).toBe('failed');
});

// The current durable disposition controls attention. Historical attempts retain their outcome.
test('only unresolved latest subagent failures and unsettled ownership count as errors',()=>{
 const treatment=(disposition:string)=>({disposition});
 const failed=(id:string,...dispositions:string[])=>({id,phase:'failed',treatments:dispositions.map(treatment)});
 const task=(id:string,attempts:object[],owner='quality',session='session-a')=>({id,session,owner,attempts});
 const tasks=[
  task('adopted',[failed('a','followup_required','adopted')]),
  task('discarded',[failed('b','rejected')]),
  task('reopened',[failed('c','adopted','followup_required')]),
  task('retried',[failed('d'),{id:'replacement',phase:'running'}]),
  task('dismissed',[{...failed('e'),failure_dismissal:{command_id:'dismiss',at_ms:10,revision:2}}]),
  task('unsettled',[{id:'f',phase:'uncertain'}]),
  task('open',[failed('g')]),
  task('lead-owned',[failed('h')],'lead'),
  task('foreign',[failed('i')],'quality','session-b'),
 ] as Workspace['tasks'];
 const value={...w,tasks};
 const before=JSON.stringify(tasks);
 const a=sessionStatus(value,'session-a'),b=sessionStatus(value,'session-b');
 expect(subagentErrorCount(value,'session-a')).toBe(3);
 expect(a.activity?.errors).toBe(3);
 expect(b.activity?.errors).toBe(1);
 expect(projectStatus('p',[a,b]).errors).toBe(4);
 expect(JSON.stringify(tasks)).toBe(before);
});

test('sidebar attention counts distinct pending requests for existing sessions',()=>{
 const approval={id:'permission',state:'pending',task:'member',questions:[]} as unknown as Decision;
 const question={id:'choice',state:'pending',questions:[{}]} as Decision;
 const liveIds=['session-a','session-b','working-only'];
 const value={...w,sessions:liveIds.map(id=>({id,title:id,native:null})),receipts:[
  {...r,decisions:[approval,question,{...approval,id:'settled',state:'settled' as const}]},
  {...r,id:'same-request',decisions:[approval]},
  {...r,session:'working-only'},
 ]};
 expect([...sidebarAttention(value,{'session-b':2,removed:3})]).toEqual([['session-a',2],['session-b',2]]);
 value.receipts[0]!.decisions=[{...approval,state:'delivered'},{...question,state:'responded'}];
 value.receipts[1]!.decisions=[];
 expect([...sidebarAttention(value,{'session-b':2})]).toEqual([['session-b',2]]);
});
