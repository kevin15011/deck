import { expect, test } from 'bun:test';
import { sessionGrants, joinQuestionResolution, conversationEvents, emptyState, pairingToken, reduceEvent } from './state';
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

test('question resolution joins request details and strips secret values',()=>{
 const request=event(1,'question.requested',{questionId:'set',questions:[{id:'choice',header:'Choice',prompt:'Pick one',secret:false},{id:'token',prompt:'Token',secret:true}]});
 const resolved=event(3,'question.resolved',{questionId:'set',outcome:'answered',answers:{choice:['One'],token:['never-retain-this']}});
 const joined=joinQuestionResolution(resolved,request);
 expect(joined.rows).toEqual([{id:'choice',header:'Choice',prompt:'Pick one',secret:false,values:['One']},{id:'token',header:undefined,prompt:'Token',secret:true,values:[]}]);
 expect(JSON.stringify(joined)).not.toContain('never-retain-this');
 const rows=conversationEvents([request,event(2,'message.delta',{text:'Before'}),resolved,event(4,'message.completed',{text:'After'})]);
 expect(rows.map(row=>row.seq)).toEqual([2,3,4]);expect(rows[1]!.questionResolution).toEqual(joined);
});
test('question resolutions route to their own task across Lead generations',()=>{
 const request={...event(1,'question.requested',{questionId:'child-q',questions:[{id:'q',prompt:'Child prompt',secret:false}]}),source:{taskId:'child',memberId:'investigate'}};
 const child={...event(2,'question.resolved',{questionId:'child-q',outcome:'answered',answers:{q:['Child answer']}}),source:request.source};
 const lead={...event(3,'question.resolved',{questionId:'lead-q',outcome:'dismissed'}),source:{taskId:'lead-g1',memberId:'lead'}};
 expect(conversationEvents([request,child,lead]).map(row=>row.seq)).toEqual([3]);
 expect(conversationEvents([request,child,lead],'child')[0]!.questionResolution!.rows[0]!.prompt).toBe('Child prompt');
});
test('missing requests use own answer ids and tolerate legacy resolutions',()=>{
 const resolved=event(2,'question.resolved',{questionId:'missing',outcome:'answered',answers:Object.fromEntries([['__proto__',['Typed answer']]])});
 expect(joinQuestionResolution(resolved).rows).toEqual([{id:'__proto__',secret:false,values:['Typed answer']}]);
 expect(conversationEvents([resolved])[0]!.questionResolution!.rows).toHaveLength(1);
 expect(joinQuestionResolution(event(3,'question.resolved',{outcome:'answered'})).rows).toEqual([]);
 const foreign={...event(1,'question.requested',{questionId:'missing',questions:[{id:'__proto__',prompt:'Wrong session',secret:false}]}),sessionId:'other'};
 expect(conversationEvents([foreign,resolved])[0]!.questionResolution!.rows[0]!.prompt).toBeUndefined();
});
test('session grants replay, revoke, deduplicate and clear when the session ends',()=>{
 const added=event(1,'session.grant',{action:'added',grantId:'g',kind:'exact',toolKey:'codex:commandExecution',exactKey:'cat README.md',risk:'high'});
 const state=reduceEvent(emptyState(),added);
 expect(state.grants).toEqual([{grantId:'g',kind:'exact',toolKey:'codex:commandExecution',exactKey:'cat README.md',risk:'high',createdAt:added.ts}]);
 expect(reduceEvent(state,added)).toBe(state);
 expect(reduceEvent(state,event(2,'session.grant',{action:'revoked',grantId:'g'})).grants).toEqual([]);
 expect(reduceEvent(state,event(2,'session.ended',{})).grants).toEqual([]);
});
test('auto approvals resolve pending requests and join the exact action into chat',()=>{
 const request=event(1,'approval.requested',{approvalId:'a',tool:'Bash',exactKey:'cat README.md'});
 const resolved=event(2,'approval.resolved',{approvalId:'a',decision:'allow-once',auto:true,by:'session-grant:g'});
 expect([request,resolved].reduce(reduceEvent,emptyState()).approvals).toEqual({});
 expect(conversationEvents([request,resolved])[0]!.autoApproval).toEqual({tool:'Bash',exactKey:'cat README.md'});
 expect(conversationEvents([{...resolved,data:{...resolved.data,auto:false}}])).toEqual([]);
});
test('auto approvals stay in their task transcript and tolerate missing requests',()=>{
 const resolved={...event(2,'approval.resolved',{approvalId:'a',auto:true,by:'session-grant:g'}),source:{taskId:'child',memberId:'investigate'}};
 expect(conversationEvents([resolved])).toEqual([]);expect(conversationEvents([resolved],'child')[0]!.autoApproval?.tool).toBe('Tool request');
});

test('release, end and removal clear replayed permissions',()=>{
 const added=event(1,'session.grant',{action:'added',grantId:'g',kind:'tool',toolKey:'codex:commandExecution',risk:'high'});
 for(const kind of ['session.released','session.ended','session.removed'] as const){
 const state=reduceEvent(reduceEvent(emptyState(),added),event(2,kind,{}));expect(state.grants).toEqual([]);
 }
});
test('fresh zero-grant summaries clear stale grants without hiding newer grant events',()=>{
 const state=reduceEvent(emptyState(),event(10,'session.grant',{action:'added',grantId:'g',kind:'tool',toolKey:'codex:commandExecution',risk:'high'}));
 expect(sessionGrants(state,{grants:[],lastSeq:10})).toEqual([]);
 expect(sessionGrants(state,{grants:[],lastSeq:9})).toHaveLength(1);
 expect(sessionGrants(emptyState(),{grants:[],lastSeq:0})).toEqual([]);
});
