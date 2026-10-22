import {trustedOperatorStop} from './task-interruption';
import {sanitizeContextObservation,type ContextObservation,type SessionEvent} from '@deck/core/session/events';
import {Ledger,TERMINAL_TASK_STATES} from './ledger';
const n=(v:unknown):number|undefined=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):undefined;
const union=(intervals:[number,number][])=>{let total=0,end=-Infinity;for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;};
type Tokens={input:number;output?:number;reasoning?:number;cachedRead?:number;cacheWrite?:number};
type AttemptEvents={observedRequests:Map<string,{seq:number;ts:number}>;unknownRequestSeq?:number;tools:Map<string,{start?:number;end?:number}>;requests:Map<string,{ts:number;seq:number;tokens:Tokens;context?:ContextObservation}>;stepsPartialSeq?:number;lastCounter?:number;initialContext?:{observation:ContextObservation;ts:string;seq:number};firstInput?:{tokens:number;ts:string;seq:number;timing:'post-response'};firstEdit?:{ts:number;seq:number;requestId?:string};compaction:Map<string,{start?:number;end?:number}>;compacted?:boolean;outputChars:number;messageChars?:Map<string,number>};
function costs(rows:{tokens:Tokens}[],observedOnly=false){
 if(!rows.length)return null;
 const sum=(key:keyof Tokens)=>{
  let result=0,observed=false;
  for(const row of rows){const value=row.tokens[key];if(value===undefined){if(observedOnly)continue;return null;}if(!Number.isSafeInteger(result+value))return null;result+=value;observed=true;}
  return observed?result:null;
 };
 return {input:sum('input'),output:sum('output'),reasoning:sum('reasoning'),cachedRead:sum('cachedRead'),cacheWrite:sum('cacheWrite')};
}
/** Offline one-pass projector. No provider/native-history calls, billing claims, or new reviewer workflow. */
export function projectTaskContinuityMetrics(events:Iterable<SessionEvent>){
 const rejectedReasons:Record<string,number>={};
 let ledger:Ledger|undefined;const observations=new Map<string,AttemptEvents>();
 for(const event of events){
  ledger??=Ledger.empty(event.sessionId);ledger.apply(event);
  if(event.kind==='diagnostic' && event.data.code==='continuity.request-rejected' && event.source.memberId==='lead'){const reason=String(event.data.reason);rejectedReasons[reason]=(rejectedReasons[reason]??0)+1;}
  const task=ledger.task(String(event.data.taskId??event.source.taskId??'')),attempt=task?.attempts.at(-1);
  if(!task||!attempt||task.memberId==='lead'||event.data.attempt!==undefined&&event.data.attempt!==attempt.attempt||event.source.nativeSessionId&&attempt.nativeSessionId&&event.source.nativeSessionId!==attempt.nativeSessionId)continue;
  const key=JSON.stringify([task.taskId,attempt.attempt]);let o=observations.get(key);
  if(!o){o={observedRequests:new Map(),tools:new Map(),requests:new Map(),compaction:new Map(),outputChars:0};observations.set(key,o);}
  const d=event.data,ts=Date.parse(event.ts);
  if(event.kind==='message.completed'&&(d.role===undefined||d.role==='assistant')&&typeof d.text==='string'){const id=typeof d.messageId==='string'?d.messageId:`event:${event.seq}`;const sizes=o.messageChars??=new Map();o.outputChars+=d.text.length-(sizes.get(id)??0);sizes.set(id,d.text.length);}
  if(event.kind==='tool.started'||event.kind==='tool.completed'){
   const id=d.toolCallId??d.toolUseId;
   if(typeof id==='string'&&id){const tool=o.tools.get(id)??{};if(event.kind==='tool.started')tool.start??=ts;else tool.end??=ts;o.tools.set(id,tool);}
   if(event.kind==='tool.completed'&&d.status==='completed'&&d.isError!==true&&Array.isArray(d.edits)&&d.edits.length&&!o.firstEdit){
    const requestId=typeof d.requestId==='string'&&d.requestId.trim()?d.requestId:undefined;
    o.firstEdit={ts,seq:event.seq,...(requestId?{requestId}:{})};
    // An explicitly correlated edit establishes request membership by this boundary,
    // even when usage arrives later. Preserve any earlier observation, and let the
    // missing-usage coverage gap remain partial until that exact request reconciles.
    if(requestId&&!o.observedRequests.has(requestId))o.observedRequests.set(requestId,{seq:event.seq,ts});
   }
  }
  if(event.kind==='diagnostic'&&d.code==='context.compaction'){
   o.compacted=true;o.stepsPartialSeq??=event.seq;
   const k=JSON.stringify([event.source.nativeSessionId,d.nativeThreadId,d.nativeTurnId,d.itemId]);const interval=o.compaction.get(k)??{};
   if(d.state==='started')interval.start??=ts;if(d.state==='completed')interval.end??=ts;o.compaction.set(k,interval);
  }
  if(event.kind==='diagnostic'&&d.code==='context.invalidated'&&d.reason==='compaction'){o.compacted=true;o.stepsPartialSeq??=event.seq;}
  if(event.kind==='diagnostic'&&(d.code==='request.observed'||d.code==='request.input-invalidated'&&d.reason==='new-main-message')){
   if(typeof d.nativeRequestId==='string'&&d.nativeRequestId){if(!o.observedRequests.has(d.nativeRequestId))o.observedRequests.set(d.nativeRequestId,{seq:event.seq,ts});}
   else o.unknownRequestSeq??=event.seq;
  }
  if(event.kind==='usage'){
   const context=sanitizeContextObservation(d.context);if(context?.tokens!==null&&context&&!o.initialContext)o.initialContext={observation:context,ts:event.ts,seq:event.seq};
   const input=d.requestInput as Record<string,unknown>|undefined;
   if(input&&n(input.tokens)!==undefined&&!o.firstInput)o.firstInput={tokens:Number(input.tokens),ts:event.ts,seq:event.seq,timing:'post-response'};
   const u=d.requestUsage as Record<string,unknown>|undefined;
   if(u&&typeof u.requestId==='string'&&n(u.inputTokens)!==undefined){
    if(!o.observedRequests.has(u.requestId))o.observedRequests.set(u.requestId,{seq:event.seq,ts});
    o.requests.set(u.requestId,{ts,seq:event.seq,...(context?{context}:{}),tokens:{input:Number(u.inputTokens),output:n(u.outputTokens),reasoning:n(u.reasoningTokens),cachedRead:n(u.cachedReadTokens),cacheWrite:n(u.cacheWriteTokens)}});
   }else if(input?.basis==='codex-last-input'&&!o.compacted){
    const total=d.total as Record<string,unknown>|undefined,last=d.last as Record<string,unknown>|undefined,counter=n(total?.totalTokens);
    if(counter===undefined||!last)o.stepsPartialSeq??=event.seq;
    else if(o.lastCounter!==undefined&&counter<o.lastCounter)o.stepsPartialSeq??=event.seq;
    else if(o.lastCounter!==counter){
     if(n(last.inputTokens)!==undefined){o.observedRequests.set(`codex-counter:${counter}`,{seq:event.seq,ts});o.requests.set(`codex-counter:${counter}`,{ts,seq:event.seq,...(context?{context}:{}),tokens:{input:Number(last.inputTokens),output:n(last.outputTokens),reasoning:n(last.reasoningOutputTokens),cachedRead:n(last.cachedInputTokens)}});}
     o.lastCounter=counter;
    }
   }
  }
 }
 const attempts=[];
 for(const task of ledger?.tasks()??[])if(task.memberId!=='lead')for(const [index,a] of task.attempts.entries()){
  const o=observations.get(JSON.stringify([task.taskId,a.attempt]))??{observedRequests:new Map(),tools:new Map(),requests:new Map(),compaction:new Map(),stepsPartialSeq:0,outputChars:0} as AttemptEvents;
  const requests=[...o.requests.values()].sort((a,b)=>a.seq-b.seq),pairs=[...o.tools.values()],compactions=[...o.compaction.values()];
  const toolIntervals=pairs.filter((p):p is {start:number;end:number}=>p.start!==undefined&&p.end!==undefined&&p.end>=p.start).map(p=>[p.start,p.end] as [number,number]);
  const compactIntervals=compactions.filter((p):p is {start:number;end:number}=>p.start!==undefined&&p.end!==undefined&&p.end>=p.start).map(p=>[p.start,p.end] as [number,number]);
  const duration=(end:number|undefined,start:number|undefined)=>end!==undefined&&start!==undefined&&end>=start?end-start:null;
  const previous=task.attempts[index-1],operatorStop=trustedOperatorStop(previous);
  const infrastructure=a.recoveryPredecessorAttempt!==undefined||a.continuityRequest===undefined&&previous?.reason==='native-session-not-found'&&a.continuity==='reseeded';
  const admittedContinuation=a.attempt>1&&a.continuityRequest!==undefined&&!infrastructure;
  let cohort='initial';
  if(previous){
   if(infrastructure)cohort='infrastructure-retry';
   else if(!admittedContinuation)cohort='unattributed-continuation';
   else if(operatorStop)cohort='operator-interrupted';
   else if(previous.state==='failed')cohort='failed-predecessor';
   else if(previous.state==='completed')cohort='completed-predecessor';
   else if(previous.state==='cancelled'&&previous.launchedAt===undefined)cohort='queue-only-cancellation';
   else if(previous.stop?.origin==='system')cohort='system-interruption';
   else cohort=['interrupted','cancelled'].includes(previous.state)?'unknown-interruption':'other-predecessor';
  }
  const continuation={admitted:admittedContinuation,cohort,
   phase:a.launchedAt!==undefined?'launched':TERMINAL_TASK_STATES.includes(a.state)?'terminal-without-launch':a.selection?'preparing':'pending',
   predecessor:previous?{taskId:task.taskId,attempt:previous.attempt,state:previous.state,stop:previous.stop??null,stopSeq:previous.stopSeq??null,launchedAt:previous.launchedAt??null,endedAt:previous.endedAt??null,endedSeq:previous.endedSeq??null,trustedOperatorInterruption:!!operatorStop}:null,
   ...(a.recoveryPredecessorAttempt===undefined?{}:{substantivePredecessorAttempt:a.recoveryPredecessorAttempt})};
  const review=task.continuityRole==='review';
  const endpoint=review?a.endedAt:o.firstEdit?.ts;
  const aligned=o.firstEdit?.requestId?o.requests.get(o.firstEdit.requestId):undefined;
  const cutoff=review?Infinity:o.firstEdit?.seq??0;
  const prefix=[...o.requests.entries()].filter(([id])=>(o.observedRequests.get(id)?.seq??Infinity)<=cutoff).map(([,row])=>row);
  const coverage=(end:number)=>{
   const observed=[...o.observedRequests.entries()].filter(([,r])=>r.seq<=end);
   const missingUsage=observed.filter(([id])=>!o.requests.has(id)).length;
   const unknownIdentity=o.unknownRequestSeq!==undefined&&o.unknownRequestSeq<=end;
   // Later compaction/counter failures cannot invalidate an already complete prefix.
   // Uncertainty before the endpoint remains partial even if later usage is available.
   const uncertainSteps=o.stepsPartialSeq!==undefined&&o.stepsPartialSeq<=end;
   return {observed:observed.length,withUsage:observed.length-missingUsage,missingUsage,unknownIdentity,complete:!uncertainSteps&&!unknownIdentity&&!missingUsage&&observed.length>0};
  };
  const requestCoverage=coverage(Infinity),costCoverage=coverage(cutoff);
  const totalTokens=(rows:{tokens:Tokens}[],complete:boolean)=>{const observed=costs(rows);return complete?observed:observed?{input:null,output:null,reasoning:null,cachedRead:null,cacheWrite:null}:null;};
  attempts.push({taskId:task.taskId,memberId:task.memberId,assignedRoleId:task.assignedRoleId,role:task.continuityRole??'unknown',attempt:a.attempt,continuation,runnerId:a.runnerId,modelId:a.modelId,thinking:a.thinking,state:a.state,continuity:a.continuity,requestedContinuity:a.continuityRequest,requester:a.continuityRequester,justification:a.continuityJustification,selection:a.selection??null,handoff:a.handoff??null,initialInput:o.firstInput??null,initialContext:o.initialContext??null,eligibilityInput:a.selection?.input??null,
   durationMs:{queue:duration(a.preparingAt,a.queuedAt),preparation:duration(a.launchedAt,a.preparingAt),nativeTurn:duration(a.endedAt,a.launchedAt),total:duration(a.endedAt,a.createdAt)},
   tools:{distinct:o.tools.size,matched:toolIntervals.length,unionMs:union(toolIntervals),incomplete:toolIntervals.length!==pairs.length},
   requestCoverage,modelSteps:requestCoverage.complete?requests.length:null,modelStepsObserved:requests.length,stepObservations:requests.map(r=>({seq:r.seq,ts:r.ts,...r.tokens,...(r.context?{nearbyContext:r.context}:{})})),tokens:totalTokens(requests,requestCoverage.complete),tokensObserved:costs(requests,true),outputChars:o.outputChars,
   compaction:{durationMs:compactIntervals.length?union(compactIntervals):null,incomplete:compactIntervals.length!==compactions.length||!!o.compacted&&!compactIntervals.length},
   cost:{kind:review?'review-through-completion':'implementation-through-first-edit',status:review?(a.state==='completed'?'completed':TERMINAL_TASK_STATES.includes(a.state)?`partial-${a.state}`:'in-progress'):o.firstEdit?'observed':'no edit evidence',durationMs:duration(endpoint,a.launchedAt),requestCoverage:costCoverage,tokens:totalTokens(prefix,costCoverage.complete),tokensObserved:costs(prefix,true),stepsObserved:prefix.length,steps:costCoverage.complete?prefix.length:null,reliability:!costCoverage.complete?'partial-request-coverage':review?'observed-supported-counters':aligned?'request-aligned':'partial-prefix-or-unavailable'},
   rework:a.reworkSources?.length?{kind:'linked-open-finding',sources:a.reworkSources}:'not-established',
  });
 }
 const admitted=attempts.filter(a=>a.continuation.admitted),requested=admitted.filter(a=>a.requestedContinuity==='native'),granted=requested.filter(a=>a.selection?.override==='granted');
 const interrupted=admitted.filter(a=>a.continuation.cohort==='operator-interrupted');
 const cohorts:Record<string,number>={};for(const a of admitted)cohorts[a.continuation.cohort]=(cohorts[a.continuation.cohort]??0)+1;
 const interruptedContinuations={count:interrupted.length,rate:admitted.length?interrupted.length/admitted.length:null,admittedContinuations:admitted.length,
  pendingAdmissions:admitted.filter(a=>a.continuation.phase==='pending').length,pendingOperatorInterrupted:interrupted.filter(a=>a.continuation.phase==='pending').length,cohorts,
  excluded:{initialAttempts:attempts.filter(a=>a.continuation.cohort==='initial').length,infrastructureRetries:attempts.filter(a=>a.continuation.cohort==='infrastructure-retry').length,unattributedContinuations:attempts.filter(a=>a.continuation.cohort==='unattributed-continuation').length},
  denominator:'All admitted user/Lead-requested delegated continuations with recorded continuity request, across roles, including pending and terminal-without-launch admissions. Initial attempts, infrastructure retries, and historical continuations without admission metadata are excluded. Pending operator-interrupted admissions are included in count and rate; they are not asserted launched samples.'};
 return {attempts,interruptedContinuations,overrides:{validContinuationAdmissions:admitted.length,requested:requested.length,granted:granted.length,refused:requested.filter(a=>a.selection?.override==='refused').length,pending:requested.filter(a=>!a.selection).length,requestRate:admitted.length?requested.length/admitted.length:null,grantRate:requested.length?granted.length/requested.length:null,synchronousRejections:{count:Object.values(rejectedReasons).reduce((n,v)=>n+v,0),reasons:rejectedReasons,denominator:'synchronous rejected native requests; excluded from valid continuation admissions'}},limitations:['Input includes cache; cached input is reported separately, never added twice.','Observed time is not inferred model-processing time or billing savings.','Uncorrelated steps/tokens are unavailable or partial; historical finding rework cannot be inferred from prose.']};
}
