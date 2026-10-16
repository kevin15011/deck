import { expect, test } from 'bun:test';
import { conversationEvents, emptyState, pairingToken, reduceEvent } from './state';
import type { SessionEvent } from '../../../packages/core/src/session/events';
const event = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown>): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data, source: { taskId: 'lead' }, ts: '2026-01-01T00:00:00Z' });
test('replay retains pending approvals across long histories and deduplicates reconnects', () => {
    let s = reduceEvent(emptyState(), event(1, 'approval.requested', { approvalId: 'a' }));
    for (let i = 2; i < 1200; i++)
        s = reduceEvent(s, event(i, 'message.delta', { text: 'x' }));
    expect(s.approvals.a).toBeDefined();
    expect(reduceEvent(s, event(1199, 'approval.resolved', { approvalId: 'a' }))).toBe(s);
    expect(reduceEvent(s, event(1200, 'approval.resolved', { approvalId: 'a' })).approvals).toEqual({});
});
test('task continuation updates actual assignment and attempt', () => {
    const s = reduceEvent(reduceEvent(emptyState(), event(1, 'task.created', { taskId: 't', runnerId: 'codex', modelId: 'm', attempt: 1 })), event(2, 'task.continued', { taskId: 't', attempt: 2 }));
    expect(s.tasks.t).toMatchObject({ runnerId: 'codex', modelId: 'm', attempt: 2 });
});
test('legacy ended replay reopens the same view without dropping conversation history', () => {
    const state = [event(1,'message.completed',{text:'Retained answer'}),event(2,'session.ended',{}),event(3,'session.reopened',{state:'idle'})].reduce(reduceEvent,emptyState());
    expect(state.state).toBe('idle'); expect(conversationEvents(state.events).map(item=>item.data.text)).toEqual(['Retained answer']);
});

test('interrupted partial text remains separate when the same task continues', () => {
    const rows = conversationEvents([
        event(1, 'message.delta', { text: 'Partial first answer' }),
        event(2, 'turn.completed', { status: 'interrupted' }),
        event(3, 'task.continued', { attempt: 2 }),
        event(4, 'message.delta', { text: 'Second answer' }),
        event(5, 'message.completed', { text: 'Second answer complete' }),
    ]);
    expect(rows.map(row => row.data.text)).toEqual(['Partial first answer', 'Second answer complete']);
});
test('pairing token is removed from browser history immediately', () => {
    let url = '';
    expect(pairingToken({ hash: '#token=secret', pathname: '/', search: '' }, { replaceState: (_a, _b, u) => { url = u; } })).toBe('secret');
    expect(url).toBe('/');
});
test('stream completion replaces accumulated deltas without duplicate text', () => {
    const rows = conversationEvents([event(1, 'message.delta', { text: 'hel' }), event(2, 'message.delta', { text: 'lo' }), event(3, 'message.completed', { text: 'hello' }), event(4, 'message.completed', { role: 'system', internal: true, text: 'wake' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.text).toBe('hello');
});
test('failed turns remain visible beside partial output without a completion message', () => {
    const rows = conversationEvents([
        event(1, 'message.delta', { text: 'Partial answer' }),
        event(2, 'diagnostic', { message: 'Routine internal detail' }),
        event(3, 'turn.completed', { status: 'failed', error: 'Managed tools did not become ready.' }),
        event(4, 'turn.completed', { status: 'completed' }),
    ]);
    expect(rows.map(row => row.kind)).toEqual(['message.delta', 'turn.completed']);
    expect(rows[0]!.data.text).toBe('Partial answer');
    expect(rows[1]!.data.error).toBe('Managed tools did not become ready.');
});

test('Lead conversation excludes tools, child messages, delegation prompts and internal instructions', () => {
    const lead = event(1, 'message.completed', { role: 'user', text: 'My request' });
    const child = { ...event(2, 'message.completed', { role: 'user', text: 'Delegated work' }), source: { taskId: 'child', memberId: 'worker' } };
    const answer = { ...child, seq: 3, data: { role: 'assistant', text: 'Child result' } };
    const rows = conversationEvents([lead, child, answer, event(4, 'tool.started', { name: 'Read' }), event(5, 'message.completed', { role: 'system', text: 'System instruction' }), event(6, 'message.completed', { role: 'assistant', text: 'Lead answer' }), event(7, 'message.completed', { internal: true, text: 'Wake instruction' })]);
    expect(rows.map(row => row.data.text)).toEqual(['My request', 'Lead answer']);
    expect(conversationEvents([lead, child, answer], 'child').map(row => row.data.text)).toEqual(['Delegated work', 'Child result']);
});
test('Lead generations share the conversation while retaining their recorded runner and model provenance', () => {
    const old = { ...event(1, 'message.completed', { role: 'assistant', text: 'Original Lead', modelId: 'old-model' }), source: { taskId: 'lead', memberId: 'lead', runnerId: 'claude' } };
    const next = { ...event(2, 'message.delta', { text: 'New ', modelId: 'new-model' }), source: { taskId: 'lead-g1', memberId: 'lead', runnerId: 'codex' } };
    const rows = conversationEvents([old, next, { ...next, seq: 3, data: { ...next.data, text: 'Lead' } }]);
    expect(rows.map(row => row.data.text)).toEqual(['Original Lead', 'New Lead']);
    expect(rows[0]!.source.runnerId).toBe('claude'); expect(rows[1]!.source.runnerId).toBe('codex');
    expect(rows[0]!.data.modelId).toBe('old-model'); expect(rows[1]!.data.modelId).toBe('new-model');
});
test('questions replay, deduplicate, and clear on every resolution outcome',()=>{
 for(const outcome of ['answered','dismissed','cancelled']){
 const requested=event(1,'question.requested',{questionId:'q',questions:[]});
 const state=reduceEvent(emptyState(),requested);
 expect(state.questions.q).toEqual(requested);
 expect(reduceEvent(state,requested)).toBe(state);
 expect(reduceEvent(state,event(2,'question.resolved',{questionId:'q',outcome})).questions).toEqual({});
 }
});
test('approval mode replays session creation and live changes',()=>{
 const initial=reduceEvent(emptyState(),event(1,'session.created',{approvals:'relay'}));
 expect(initial.approvalMode).toBe('relay');expect(initial.approvalModeSource).toBe('session');
 const yolo=reduceEvent(initial,event(2,'session.approvals',{mode:'yolo',by:'browser'}));
 expect(yolo.approvalMode).toBe('yolo');
 expect(reduceEvent(yolo,event(3,'session.approvals',{mode:'relay',by:'browser'})).approvalMode).toBe('relay');
 const normal=reduceEvent(emptyState(),event(1,'session.created',{}));
 expect(normal.approvalMode).toBe('relay');expect(normal.approvalModeSource).toBe('default');
 expect(reduceEvent(normal,event(2,'session.approvals',{mode:'yolo',by:'browser'})).approvalModeSource).toBe('session');
});
