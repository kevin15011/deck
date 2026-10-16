import { expect, test } from 'bun:test';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { indicatorState, leadActivityFromEvents, replyForTask, advanceRead } from './status-indicator';
const event = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown> = {}, taskId = 'lead', memberId = taskId): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data: kind === 'message.completed' ? {role:'assistant',...data} : data, source: { taskId, memberId }, ts: '2026-01-01T00:00:00Z' });
test('status distinguishes work, preparation, approvals and terminal outcomes', () => {
 expect(indicatorState('running', 0)).toBe('working'); expect(indicatorState('preparing', 0)).toBe('waiting');
 expect(indicatorState('running', 1)).toBe('approval'); expect(indicatorState('failed', 0)).toBe('error');
 expect(indicatorState('ownership-unsettled', 0)).toBe('error'); expect(indicatorState('completed', 0)).toBe('completed');
});
test('Lead summary uses current generation state and public replies across generations only', () => {
 const events = [event(1,'message.completed',{text:'Old answer'}),event(2,'task.state',{state:'running'},'child'),event(3,'message.completed',{text:'Child'},'child'),event(4,'message.completed',{text:'Internal',internal:true}),event(5,'task.state',{state:'queued'},'lead-g1','lead'),event(6,'message.completed',{role:'user',text:'Request'},'lead-g1','lead')];
 expect(leadActivityFromEvents(events,'lead-g1')).toEqual({taskId:'lead-g1',state:'queued',pendingApprovals:0,pendingQuestions:0,lastReplySeq:1});
 expect(leadActivityFromEvents([...events,event(7,'message.completed',{text:'New answer'},'lead-g1','lead')],'lead-g1')?.lastReplySeq).toBe(7);
});
test('subagent reply belongs to the current attempt, prefers real assistant completion over repeated result', () => {
 const events=[event(1,'task.created',{attempt:1},'child'),event(2,'message.completed',{text:'Result'},'child'),event(3,'task.result',{summary:'Result'},'child')];
 expect(replyForTask(events,'child')).toMatchObject({seq:2,text:'Result',attempt:1});
 expect(replyForTask([...events,event(4,'task.continued',{attempt:2},'child')],'child')).toBeUndefined();
 expect(replyForTask([...events,event(4,'task.continued',{attempt:2},'child'),event(5,'task.result',{summary:'Fallback'},'child')],'child')).toMatchObject({seq:5,text:'Fallback',attempt:2});
});
test('read acknowledgements are monotonic and scoped to actual response identities',()=>{
 const initial={s:8}; expect(advanceRead(initial,'s',3)).toBe(initial); expect(advanceRead(initial,'child:2',4)).toEqual({s:8,'child:2':4});
});

test('source-sparse generation states and preparation remain attributed to current Lead only',()=>{
 const queued={...event(1,'task.state',{taskId:'lead-g2',state:'queued'}),source:{}};
 const preparing={...event(2,'diagnostic',{code:'session.preparation',generation:2,status:'preparing'}),source:{}};
 const wrong={...preparing,seq:3,data:{...preparing.data,generation:1,status:'ready'}};
 expect(leadActivityFromEvents([queued,preparing,wrong],'lead-g2').state).toBe('preparing');
 expect(leadActivityFromEvents([event(1,'message.completed',{role:undefined,text:'Not a canonical public reply'})],'lead').lastReplySeq).toBe(0);
});

test('preparation override restores the actual previous Lead outcome',()=>{
 const events=[event(1,'task.state',{state:'completed'}),{...event(2,'diagnostic',{code:'session.preparation',generation:0,status:'preparing'}),source:{}},{...event(3,'diagnostic',{code:'session.preparation',generation:0,status:'ready'}),source:{}}];
 expect(leadActivityFromEvents(events.slice(0,2),'lead').state).toBe('preparing');
 expect(leadActivityFromEvents(events,'lead').state).toBe('completed');
});
test('pending questions wait for user and resolve independently',()=>{
 const events=[event(1,'question.requested',{questionId:'q'})];
 expect(leadActivityFromEvents(events,'lead').pendingQuestions).toBe(1);
 expect(indicatorState('running',0,1)).toBe('question');
 expect(leadActivityFromEvents([...events,event(2,'question.resolved',{questionId:'q'})],'lead').pendingQuestions).toBe(0);
});
