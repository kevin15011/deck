import {ClaudeStreamMapper} from '../../../adapter-claude/src/session-driver/mapper';
import {expect,test} from 'bun:test';
import {projectTaskContinuityMetrics} from '../task-continuity-metrics';
import type {SessionEvent,SessionEventKind} from '@deck/core/session/events';
function events(role:'review'|'work',state='completed'){
 let seq=0;const e=(time:number,kind:SessionEventKind,data:Record<string,unknown>):SessionEvent=>({v:1,sessionId:'s',seq:++seq,ts:new Date(time).toISOString(),kind,source:{taskId:'t',memberId:role==='review'?'quality':'apply-deep'},data});
 return [e(0,'task.created',{taskId:'t',memberId:role==='review'?'quality':'apply-deep',runnerId:'claude',modelId:'m',continuityRole:role}),e(5,'task.state',{taskId:'t',state:'queued'}),e(10,'task.state',{taskId:'t',state:'running'}),e(20,'task.state',{taskId:'t',state:'running',launched:true}),e(25,'tool.started',{toolUseId:'edit'}),e(26,'usage',{requestUsage:{requestId:'r1',inputTokens:10,cachedReadTokens:9}}),e(27,'usage',{requestUsage:{requestId:'r1',inputTokens:10,cachedReadTokens:9}}),e(30,'tool.completed',{toolUseId:'edit',status:'completed',requestId:'r1',edits:[{path:'x.ts',op:'update'}]}),e(40,'usage',{requestUsage:{requestId:'r2',inputTokens:20,cachedReadTokens:15}}),e(100,'task.state',{taskId:'t',state})];
}
test('review cost covers completion; duplicate snapshots do not inflate steps; cache is included once',()=>{
 const report=projectTaskContinuityMetrics(events('review')).attempts[0]!;
 expect(report.cost).toMatchObject({kind:'review-through-completion',status:'completed',durationMs:80,steps:2,tokens:{input:30,cachedRead:24,output:null}});
 expect(report.durationMs).toEqual({queue:5,preparation:10,nativeTurn:80,total:100});expect(report.tools.distinct).toBe(1);
 expect(projectTaskContinuityMetrics(events('review','interrupted')).attempts[0]!.cost.status).toBe('partial-interrupted');
});
test('implementation first edit cost uses correlated response and excludes later work',()=>{
 const report=projectTaskContinuityMetrics(events('work')).attempts[0]!;
 expect(report.cost).toMatchObject({kind:'implementation-through-first-edit',durationMs:10,steps:1,tokens:{input:10},reliability:'request-aligned'});
 expect(report.compaction.durationMs).toBeNull();expect(report.rework).toBe('not-established');
});

test('synchronous native rejections have a separate denominator and remain distinct from launch refusals',()=>{
 const sample=events('work');sample.push({v:1,sessionId:'s',seq:sample.length+1,ts:new Date(101).toISOString(),kind:'diagnostic',source:{taskId:'lead',memberId:'lead'},data:{code:'continuity.request-rejected',reason:'review-native-forbidden'}});
 expect(projectTaskContinuityMetrics(sample).overrides).toMatchObject({validContinuationAdmissions:0,requested:0,refused:0,synchronousRejections:{count:1,reasons:{'review-native-forbidden':1}}});
});

test('missing-session infrastructure attempts are excluded from valid continuation admissions',()=>{
 const sample=events('work');const next=(kind:SessionEventKind,data:Record<string,unknown>):SessionEvent=>({v:1,sessionId:'s',seq:sample.length+1,ts:new Date(101).toISOString(),kind,source:{taskId:'t'},data});
 sample.push(next('task.continued',{taskId:'t',attempt:2,continuity:'reseeded'}));
 expect(projectTaskContinuityMetrics(sample).overrides.validContinuationAdmissions).toBe(0);
});

// Real Claude evidence production, promoted from the independent review fixture.
for(const missing of ['intermediate','final','reconciled'] as const)test(`Claude request coverage: ${missing} usage`,()=>{
 let seq=0;const rows:SessionEvent[]=[];
 const add=(kind:SessionEventKind,data:Record<string,unknown>)=>rows.push({v:1,sessionId:'s',seq:++seq,ts:new Date(seq*10).toISOString(),kind,source:{taskId:'t',memberId:'quality',nativeSessionId:'native'},data});
 add('task.created',{taskId:'t',memberId:'quality',runnerId:'claude',modelId:'m',continuityRole:'review'});
 add('task.state',{taskId:'t',state:'running',nativeSessionId:'native',launched:true});
 const mapper=new ClaudeStreamMapper(undefined,'native','turn');
 const assistant=(id:string,tokens?:number)=>{for(const e of mapper.map({type:'assistant',session_id:'native',message:{id,model:'m',content:[{type:'text',text:'response'}],...(tokens===undefined?{}:{usage:{input_tokens:tokens,cache_creation_input_tokens:0,cache_read_input_tokens:0}})}}).events)add(e.kind as SessionEventKind,e.data);};
 const request=(id:string,tokens?:number)=>{for(const e of mapper.map({type:'stream_event',session_id:'native',event:{type:'message_start',message:{id}}}).events)add(e.kind as SessionEventKind,e.data);assistant(id,tokens);};
 request('r1',10);request('r2');if(missing!=='final')request('r3',30);
 const partial=projectTaskContinuityMetrics(rows).attempts[0]!;
 expect(partial.modelSteps).toBeNull();expect(partial.cost.steps).toBeNull();
 expect(partial.tokens?.input).toBeNull();expect(partial.tokensObserved?.input).toBe(missing==='final'?10:40);
 expect(partial.requestCoverage).toMatchObject({complete:false,missingUsage:1});
 expect(partial.cost.reliability).toBe('partial-request-coverage');
 if(missing==='reconciled'){assistant('r2',20);assistant('r2',20);}
 add('task.state',{taskId:'t',state:'completed'});
 const actual=projectTaskContinuityMetrics(rows).attempts[0]!;
 if(missing==='reconciled'){
  expect(actual.modelSteps).toBe(3);expect(actual.cost.steps).toBe(3);
  expect(actual.tokens?.input).toBe(60);expect(actual.requestCoverage).toMatchObject({complete:true,observed:3,withUsage:3,missingUsage:0});
  expect(actual.cost.reliability).toBe('observed-supported-counters');
 }else{expect(actual.modelSteps).toBeNull();expect(actual.cost.steps).toBeNull();expect(actual.cost.tokens?.input).toBeNull();}
});

test('later uncovered requests do not erase implementation cost through first edit',()=>{
 const sample=events('work');
 sample.splice(-1,0,{...sample.at(-1)!,kind:'diagnostic',data:{code:'request.observed',nativeRequestId:null}});
 sample.forEach((e,i)=>e.seq=i+1);
 const actual=projectTaskContinuityMetrics(sample).attempts[0]!;
 expect(actual.modelSteps).toBeNull();expect(actual.tokens?.input).toBeNull();
 expect(actual.cost).toMatchObject({steps:1,tokens:{input:10},reliability:'request-aligned',requestCoverage:{complete:true}});
});

// Promoted from quality's prefix fixture; event order is independent of request membership.
function prefixSample(){
 let seq=0;const rows:SessionEvent[]=[];
 const add=(kind:SessionEventKind,data:Record<string,unknown>)=>rows.push({v:1,sessionId:'s',seq:++seq,ts:new Date(seq*10).toISOString(),kind,source:{taskId:'t',memberId:'apply-deep'},data});
 const usage=(requestId:string,inputTokens:number)=>add('usage',{requestUsage:{requestId,inputTokens}});
 const observed=(nativeRequestId:string)=>add('diagnostic',{code:'request.observed',nativeRequestId});
 const edit=(requestId='r2',status='completed')=>add('tool.completed',{toolUseId:`edit-${seq}`,status,requestId,edits:[{path:'x.ts',op:'update'}]});
 const project=()=>projectTaskContinuityMetrics(rows).attempts[0]!;
 add('task.created',{taskId:'t',memberId:'apply-deep',runnerId:'claude',modelId:'m',continuityRole:'work'});
 add('task.state',{taskId:'t',state:'running',launched:true});
 return {rows,add,usage,observed,edit,project};
}

test('first-edit request without usage stays partial at completion, retaining observed lower bounds',()=>{
 const f=prefixSample();f.usage('r1',10);f.edit('failed-request','failed');f.edit();
 f.add('task.state',{taskId:'t',state:'completed'});
 expect(f.project().cost).toMatchObject({steps:null,tokens:{input:null},stepsObserved:1,tokensObserved:{input:10},requestCoverage:{observed:2,withUsage:1,missingUsage:1,complete:false},reliability:'partial-request-coverage'});
});

for(const observation of ['absent','before-edit','after-edit','after-usage'] as const){
 for(const usageTiming of ['before-edit','after-edit'] as const){
  test(`first-edit request membership reconciles ${usageTiming} usage with ${observation} observation`,()=>{
   const f=prefixSample();f.usage('r1',10);
   if(observation==='before-edit')f.observed('r2');
   if(usageTiming==='before-edit')f.usage('r2',20);
   f.edit();
   if(usageTiming==='after-edit')expect(f.project().cost).toMatchObject({steps:null,tokens:{input:null},requestCoverage:{observed:2,withUsage:1,missingUsage:1,complete:false}});
   // This usage precedes delayed r2 reconciliation, but belongs after the edit cutoff.
   f.usage('unrelated-later',100);f.edit('unrelated-later');
   if(observation==='after-edit')f.observed('r2');
   if(usageTiming==='after-edit'){
    expect(f.project().cost).toMatchObject({steps:null,requestCoverage:{observed:2,missingUsage:1,complete:false}});
    f.usage('r2',20);
   }
   if(observation==='after-usage')f.observed('r2');
   f.usage('r2',20);f.observed('r2'); // repeated snapshots/observations cannot inflate membership
   f.add('task.state',{taskId:'t',state:'completed'});
   const result=f.project();
   expect(result.cost).toMatchObject({steps:2,tokens:{input:30},stepsObserved:2,tokensObserved:{input:30},requestCoverage:{observed:2,withUsage:2,missingUsage:0,complete:true},reliability:'request-aligned'});
   expect(result.modelSteps).toBe(3);expect(result.tokens?.input).toBe(130);
  });
 }
}

for(const uncertainty of ['compaction','invalidated','counter-unavailable','counter-regressed'] as const){
 for(const when of ['before-edit','after-edit'] as const)test(`prefix uncertainty ${uncertainty} is scoped ${when}`,()=>{
  const f=prefixSample();f.usage('r1',10);f.usage('r2',20);
  const uncertain=()=>{
   if(uncertainty==='compaction')f.add('diagnostic',{code:'context.compaction',state:'started',nativeThreadId:'native',nativeTurnId:'turn',itemId:'compact'});
   else if(uncertainty==='invalidated')f.add('diagnostic',{code:'context.invalidated',reason:'compaction'});
   else if(uncertainty==='counter-unavailable')f.add('usage',{requestInput:{basis:'codex-last-input'}});
   else {for(const counter of [10,9])f.add('usage',{requestInput:{basis:'codex-last-input'},total:{totalTokens:counter},last:{inputTokens:5}});}
  };
  if(when==='before-edit')uncertain();f.edit();if(when==='after-edit')uncertain();
  f.add('task.state',{taskId:'t',state:'completed'});
  const result=f.project();
  expect(result.modelSteps).toBeNull();expect(result.requestCoverage.complete).toBe(false);
  if(when==='after-edit')expect(result.cost).toMatchObject({steps:2,tokens:{input:30},requestCoverage:{complete:true},reliability:'request-aligned'});
  else expect(result.cost).toMatchObject({steps:null,tokens:{input:null},requestCoverage:{complete:false},reliability:'partial-request-coverage'});
 });
}

function interruptedContinuationSample(options:{id?:string;state?:string;origin?:string;launched?:boolean;pending?:boolean;review?:boolean;admission?:boolean}={}){
 const rows:SessionEvent[]=[];let seq=0;const taskId=options.id??'t',memberId=options.review?'quality':'apply-deep';
 const add=(kind:SessionEventKind,data:Record<string,unknown>)=>rows.push({v:1,sessionId:'s',seq:++seq,ts:new Date(seq*10).toISOString(),kind,source:{taskId,memberId},data});
 add('task.created',{taskId,memberId,runnerId:'claude',modelId:'m',continuityRole:options.review?'review':'work'});
 add('task.state',{taskId,state:options.launched===false?'queued':'running',...(options.launched===false?{}:{launched:true})});
 const state=options.state??'interrupted';
 add('task.state',{taskId,state,...(options.origin?{stop:{origin:options.origin,kind:state==='cancelled'?'cancel':'interrupt',commandId:'operator-stop',launched:options.launched!==false,...(options.origin==='lead'?{leadTaskId:'lead',leadAttempt:1}:{})}}:{})});
 add('task.continued',{taskId,attempt:2,continuityPending:true,...(options.admission===false?{}:{continuityRequest:'auto',continuityRequester:{taskId:'lead',memberId:'lead',attempt:1}})});
 add('task.state',{taskId,state:'queued'});
 if(!options.pending)add('task.state',{taskId,state:'running',launched:true,selection:{continuity:'reseeded',reason:'native-compaction-bound-unknown',override:'none',selectedAt:seq*10,policy:{}}});
 return {rows,add,taskId};
}

for(const [state,origin,launched,cohort] of [
 ['interrupted','user',true,'operator-interrupted'],['cancelled','lead',true,'operator-interrupted'],
 ['interrupted','system',true,'system-interruption'],['interrupted',undefined,true,'unknown-interruption'],
 ['cancelled','lead',false,'queue-only-cancellation'],['failed','lead',true,'failed-predecessor'],['completed','user',true,'completed-predecessor'],
] as const)test(`interrupted continuation cohort: ${state}/${origin}/${launched}`,()=>{
 const f=interruptedContinuationSample({state,origin,launched});const result=projectTaskContinuityMetrics(f.rows),sample=result.attempts[1]!;
 expect(sample.continuation).toMatchObject({admitted:true,cohort,predecessor:{taskId:'t',attempt:1,state}});
 expect(sample.continuation.predecessor?.stop?.origin).toBe(origin);
 expect(result.interruptedContinuations).toMatchObject({admittedContinuations:1,count:cohort==='operator-interrupted'?1:0,rate:cohort==='operator-interrupted'?1:0});
 expect(sample.cost.status).toBe('no edit evidence');expect(sample.cost.durationMs).toBeNull();
});

test('interrupted continuation frequency uses explicit admissions including pending; retries and legacy unknown admissions are separate',()=>{
 const samples=[
  interruptedContinuationSample({id:'user',origin:'user',pending:true}),
  interruptedContinuationSample({id:'lead',state:'cancelled',origin:'lead'}),
  interruptedContinuationSample({id:'system',origin:'system'}),
  interruptedContinuationSample({id:'unknown'}),
  interruptedContinuationSample({id:'queued',state:'cancelled',origin:'lead',launched:false}),
  interruptedContinuationSample({id:'failed',state:'failed',origin:'lead'}),
  interruptedContinuationSample({id:'completed',state:'completed'}),
  interruptedContinuationSample({id:'retry',origin:'user'}),
  interruptedContinuationSample({id:'legacy',state:'completed',admission:false}),
 ];
 const retry=samples[7]!;retry.add('task.state',{taskId:'retry',state:'failed',reason:'native-session-not-found'});
 retry.add('task.continued',{taskId:'retry',attempt:3,continuity:'reseeded',recoveryPredecessorAttempt:1});retry.add('task.state',{taskId:'retry',state:'running',launched:true});
 const rows=samples.flatMap(f=>f.rows);rows.forEach((e,i)=>e.seq=i+1);
 const result=projectTaskContinuityMetrics(rows);
 expect(result.interruptedContinuations).toMatchObject({admittedContinuations:8,count:3,rate:3/8,pendingAdmissions:1,pendingOperatorInterrupted:1,excluded:{infrastructureRetries:1,unattributedContinuations:1}});
 expect(result.interruptedContinuations.denominator).toContain('pending');expect(result.interruptedContinuations.denominator).toContain('admitted');
 const recovery=result.attempts.find(a=>a.taskId==='retry'&&a.attempt===3)!;
 expect(recovery.continuation).toMatchObject({admitted:false,cohort:'infrastructure-retry',predecessor:{taskId:'retry',attempt:2,state:'failed'},substantivePredecessorAttempt:1});
 const replayed=projectTaskContinuityMetrics(JSON.parse(JSON.stringify(rows)));
 expect(replayed.interruptedContinuations).toEqual(result.interruptedContinuations);
 expect(replayed.attempts.find(a=>a.taskId==='lead'&&a.attempt===2)?.continuation.predecessor).toMatchObject({stop:{origin:'lead',commandId:'operator-stop',leadTaskId:'lead',leadAttempt:1},stopSeq:8});
});

test('operator interruption sample keeps partial first-edit coverage and reviews retain full-completion cost',()=>{
 const f=interruptedContinuationSample({origin:'user'});
 f.add('usage',{requestUsage:{requestId:'r1',inputTokens:10}});f.add('tool.completed',{toolUseId:'edit',status:'completed',requestId:'r2',edits:[{path:'x.ts',op:'update'}]});
 f.add('task.state',{taskId:'t',state:'completed'});
 const sample=projectTaskContinuityMetrics(f.rows).attempts[1]!;
 expect(sample.continuation.cohort).toBe('operator-interrupted');expect(sample.cost).toMatchObject({steps:null,tokens:{input:null},tokensObserved:{input:10},requestCoverage:{complete:false,missingUsage:1}});
 const review=interruptedContinuationSample({origin:'lead',state:'cancelled',review:true});
 review.add('usage',{requestUsage:{requestId:'review',inputTokens:15}});review.add('task.state',{taskId:'t',state:'completed'});
 expect(projectTaskContinuityMetrics(review.rows).attempts[1]!.cost).toMatchObject({kind:'review-through-completion',steps:1,tokens:{input:15},status:'completed'});
});

for(const missing of ['commandId','leadTaskId','leadAttempt'] as const)test(`incomplete operator provenance cannot establish an interruption cohort: ${missing}`,()=>{
 const f=interruptedContinuationSample({state:'cancelled',origin:'lead'});
 const stop=f.rows[2]!.data.stop as Record<string,unknown>;delete stop[missing];
 expect(projectTaskContinuityMetrics(f.rows).attempts[1]!.continuation.cohort).toBe('unknown-interruption');
 expect(projectTaskContinuityMetrics(f.rows).interruptedContinuations.count).toBe(0);
});
