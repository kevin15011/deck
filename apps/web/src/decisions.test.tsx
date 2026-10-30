import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Decisions, decisionSourceEvent, decisionReplyStatus, replySelectionStale, type DecisionView } from './decisions';
const decision: DecisionView = { decisionId:'decision-a',revision:2,questionRevision:1,questionSeq:3,createdSeq:3,updatedSeq:7,question:'Proceed with <unsafe> change?',state:'pending',origin:{taskId:'lead',attempt:1,admissionSeq:2},source:{promptId:'user'},key:'scope',openingFingerprint:'hash',relatedTaskIds:[],replies:[],queuedReplies:[] };
const props={connected:true,busy:false,onReply:()=>{},onClear:()=>{},onAction:()=>{},onOrigin:()=>{},onRefresh:()=>{}};
test('healthy empty decisions, including initial loading, take no panel space',()=>{
 for(const loading of [false,true])expect(renderToStaticMarkup(<Decisions {...props} decisions={[]} loading={loading}/>)).toBe('');
});
test('pending and deferred decisions start collapsed behind one accessible summary with the unresolved count',()=>{
 const html=renderToStaticMarkup(<Decisions {...props} decisions={[decision,{...decision,decisionId:'deferred',state:'deferred'}]}/>);
 expect(html.match(/class="decisions-panel"/g)).toHaveLength(1);expect(html).toContain('aria-expanded="false"');expect(html).toContain('2 open');expect(html).toContain('aria-controls=');expect(html).toContain('hidden=""');
});
test('errors and stale reply targets remain visible even without loaded decisions; history remains discoverable',()=>{
 const selected={sessionId:'s',decisionId:decision.decisionId,revision:1,questionRevision:1,question:decision.question};
 const error=renderToStaticMarkup(<Decisions {...props} decisions={[]} error="Unable to load decisions"/>);expect(error).toContain('role="alert"');expect(error).toContain('Unable to load decisions');expect(error).toContain('Refresh');
 const target=renderToStaticMarkup(<Decisions {...props} decisions={[]} selection={selected} stale/>);expect(target).toContain('id="decision-target-status"');expect(target).toContain('Question changed or closed');expect(target).toContain('Clear reply target');
 const history=renderToStaticMarkup(<Decisions {...props} decisions={[{...decision,state:'cancelled'}]} omittedTerminal={2} history/>);expect(history).toContain('Decision history');expect(history).toContain('aria-expanded="true"');expect(history).toContain('Earlier decisions remain in session history');
});
test('decision panel escapes questions and presents semantic named controls without read acknowledgements',()=>{
 const html=renderToStaticMarkup(<Decisions decisions={[decision]} connected busy={false} onReply={()=>{}} onClear={()=>{}} onAction={()=>{}} onOrigin={()=>{}} onRefresh={()=>{}}/>);
 expect(html).toContain('aria-label="Decisions"');expect(html).toContain('&lt;unsafe&gt;');expect(html).not.toContain('<unsafe>');expect(html).toContain('Awaiting answer');expect(html).toContain('View origin');expect(html).toContain('Reply');expect(html).toContain('Defer');expect(html).toContain('Cancel');expect(html).not.toContain('unread');
});
test('queued, admitted, stale and explicit resolution states are distinct',()=>{
 const reply={decisionId:decision.decisionId,revision:1,promptId:'p',taskId:'lead',attempt:2,admittedSeq:10,stale:false};
 expect(decisionReplyStatus({...decision,queuedReplies:[{promptId:'p',revision:1}]})).toBe('Reply queued · not yet delivered');
 expect(decisionReplyStatus({...decision,replies:[reply]})).toBe('Delivered · awaiting Lead resolution');
 expect(decisionReplyStatus({...decision,replies:[{...reply,stale:true}]})).toBe('Stale reply delivered · clarification needed');
 expect(decisionReplyStatus({...decision,state:'answered',replies:[reply]})).toBe('Answered by Lead');
 expect(decisionReplyStatus({...decision,state:'cancelled',replies:[{...reply,stale:true}]})).toBe('Stale reply delivered · clarification needed');
});
test('selection is session-scoped and only substantive question changes invalidate it',()=>{
 const selection={sessionId:'s',decisionId:decision.decisionId,revision:1,questionRevision:1,question:decision.question};
 expect(replySelectionStale(selection,'s',[{...decision,state:'deferred'}])).toBe(false);
 expect(replySelectionStale(selection,'other',[decision])).toBe(true);
 expect(replySelectionStale(selection,'s',[{...decision,revision:3,questionRevision:3}])).toBe(true);
 expect(replySelectionStale(selection,'s',[{...decision,state:'cancelled'}])).toBe(true);
 expect(replySelectionStale(selection,'s',[])).toBe(true);
});

test('origin lookup selects the exact historical attempt and never substitutes the current result or another prompt',()=>{
 const event=(seq:number,kind:any,data:Record<string,unknown>,taskId='child')=>({v:1 as const,sessionId:'s',seq,ts:'2026-10-18T00:00:00Z',kind,source:{taskId},data});
 const events=[event(1,'task.created',{attempt:1}),event(2,'task.result',{summary:'Original report'}),event(3,'task.continued',{attempt:2}),event(4,'task.result',{summary:'Latest report'}),event(5,'message.completed',{role:'user',promptId:'exact',text:'Original user prompt'},'lead'),event(6,'message.completed',{role:'user',promptId:'other',text:'New prompt'},'lead')];
 expect(decisionSourceEvent(events,{taskId:'child',attempt:1})?.data.summary).toBe('Original report');
 expect(decisionSourceEvent(events,{taskId:'child',attempt:2})?.data.summary).toBe('Latest report');
 expect(decisionSourceEvent(events.slice(2),{taskId:'child',attempt:1})).toBeUndefined();
 expect(decisionSourceEvent(events,{promptId:'exact'})?.seq).toBe(5);
 expect(decisionSourceEvent(events,{promptId:'missing'})).toBeUndefined();
});

test('terminal-only records reserve no composer space, including omitted history',()=>{
 for(const decisions of [[],[{...decision,state:'answered' as const}]])expect(renderToStaticMarkup(<Decisions {...props} decisions={decisions} omittedTerminal={2}/>)).toBe('');
});

// Protects exact-attempt identity when production compaction drops continuation 2.
// Oracle: an attempt-1 decision must never display attempt 2's report.
test('three-attempt CurrentEvents projection cannot attribute the retained result to attempt 1',async()=>{
 const {CurrentEvents}=await import('../../../packages/core/src/session/chat-history');
 const projection=new CurrentEvents();
 const event=(seq:number,kind:any,data:Record<string,unknown>)=>({v:1 as const,sessionId:'s',seq,ts:'2026-10-18T00:00:00Z',kind,source:{taskId:'child'},data});
 const ledger=[event(1,'task.created',{attempt:1}),event(2,'task.result',{summary:'first'}),event(3,'task.continued',{attempt:2}),event(4,'task.result',{summary:'second'}),event(5,'task.continued',{attempt:3})];
 ledger.forEach(e=>projection.apply(e));
 expect(projection.values().map(e=>e.seq)).toEqual([1,4,5]);
 expect(decisionSourceEvent(projection.values(),{taskId:'child',attempt:1})).toBeUndefined();
 expect(decisionSourceEvent(ledger,{taskId:'child',attempt:1})?.data.summary).toBe('first');
});

// Protects bounded automatic traversal and resumable attribution without retaining pages.
test('origin loading stops at its budget and resumes across a page boundary',async()=>{
 const {loadDecisionOrigin}=await import('./decisions');
 const event=(seq:number,kind:any='diagnostic',data:Record<string,unknown>={})=>({v:1 as const,sessionId:'s',seq,ts:'2026-10-18T00:00:00Z',kind,source:{taskId:'child'},data});
 let requests=0;
 const api=async(path:string)=>{
  requests++;const after=Number(new URL(path,'http://test').searchParams.get('after'));
  const events=Array.from({length:1000},(_,i)=>event(after+i+1));
  if(after===7000)events[999]=event(8000,'task.created',{attempt:1});
  if(after===8000)events[0]=event(8001,'task.result',{summary:'exact'});
  return {events,seq:after+1000,hasMore:true};
 };
 const signal=new AbortController().signal;
 const first=await loadDecisionOrigin(api,'s',{taskId:'child',attempt:1},signal);
 expect(first.event).toBeUndefined();expect(requests).toBeLessThanOrEqual(8);
 expect(first.cursor).toEqual({after:8000,attempt:1});
 const resumed=await loadDecisionOrigin(api,'s',{taskId:'child',attempt:1},signal,first.cursor);
 expect(resumed.event?.data.summary).toBe('exact');
 expect(resumed.cursor).toBeUndefined();
});

test('origin loading preserves attribution across pages and refuses other attempts and gaps',async()=>{
 const {loadDecisionOrigin}=await import('./decisions');
 const event=(seq:number,kind:any,data:Record<string,unknown>)=>({v:1 as const,sessionId:'s',seq,ts:'2026-10-18T00:00:00Z',kind,source:{taskId:'child'},data});
 const pages=[{events:[event(1,'task.created',{attempt:1}),event(2,'task.result',{summary:'first'}),event(3,'task.continued',{attempt:2})],seq:3,hasMore:true},{events:[event(4,'task.result',{summary:'second'})],seq:4,hasMore:false}];
 const api=async(path:string)=>pages[path.endsWith('after=0')?0:1];
 expect((await loadDecisionOrigin(api,'s',{taskId:'child',attempt:2},new AbortController().signal)).event?.data.summary).toBe('second');
 expect(decisionSourceEvent([event(1,'task.created',{attempt:1}),event(4,'task.result',{summary:'second'})],{taskId:'child',attempt:1})).toBeUndefined();
});

test('origin loading stops stalled cursors and ignores late responses after cancellation',async()=>{
 const {loadDecisionOrigin}=await import('./decisions');
 let requests=0;
 const stalled=await loadDecisionOrigin(async()=>{requests++;return {events:[],seq:0,hasMore:true};},'s',{promptId:'missing'},new AbortController().signal);
 expect(stalled).toEqual({});expect(requests).toBe(1);
 const controller=new AbortController();
 const late=await loadDecisionOrigin(async()=>{controller.abort();return {events:[{seq:1,kind:'message.completed',data:{role:'user',promptId:'exact'}}],seq:1,hasMore:false};},'s',{promptId:'exact'},controller.signal);
 expect(late).toEqual({});
 requests=0;
 await loadDecisionOrigin(async()=>{requests++;},'s',{promptId:'exact'},controller.signal);
 expect(requests).toBe(0);
});
