import { expect, test } from 'bun:test';
import { CurrentEvents, HISTORY_WINDOW_SIZE, type HistoryMessage } from '../../../packages/core/src/session/chat-history';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { mergeHistory, snapshotView } from './chat-history';
import { leadProgress } from './lead-progress';
const event = (seq: number, kind: SessionEvent['kind'], data: SessionEvent['data'] = {}): SessionEvent => ({ v: 1, sessionId: 's', seq, ts: '2026-01-01T00:00:00Z', source: { taskId: 'lead', memberId: 'lead' }, kind, data });
const row = (id: number, seq = id): HistoryMessage => ({ ...event(seq, 'message.completed', { text: String(id) }), historyId: id });
test('history windows stay bounded in both directions and stale backfill cannot replace live completion', () => {
    let rows = Array.from({ length: 120 }, (_, i) => row(i + 500));
    rows = mergeHistory(rows, [row(500, 900)], 'live');
    rows = mergeHistory(rows, Array.from({ length: 40 }, (_, i) => row(i + 460)), 'older');
    expect(rows).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(rows[0]?.historyId).toBe(460);
    expect(rows.find(r => r.historyId === 500)?.seq).toBe(900);
    rows = mergeHistory(rows, Array.from({ length: 40 }, (_, i) => row(i + 580)), 'newer');
    expect(rows).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(rows.at(-1)?.historyId).toBe(619);
    expect(new Set(rows.map(r => r.historyId)).size).toBe(rows.length);
});
test('compact snapshot preserves authoritative controls, task state and current progress without old content', () => {
    const current = new CurrentEvents();
    let seq = 0;
    const events: SessionEvent[] = [];
    const push = (kind: SessionEvent['kind'], data: SessionEvent['data'] = {}) => { const e = event(++seq, kind, data); events.push(e); current.apply(e); };
    push('session.created');
    push('session.state', { state: 'running' });
    push('task.created', { taskId: 'lead', state: 'running' });
    push('approval.requested', { approvalId: 'old' });
    push('question.requested', { questionId: 'old' });
    for (let i = 0; i < 10000; i++) {
        push('message.completed', { role: 'user', text: 'Historical synthetic content' });
    }
    push('approval.resolved', { approvalId: 'old' });
    push('question.resolved', { questionId: 'old', outcome: 'answered', by: 'test', answers: { secret: ['hidden'] } });
    push('turn.started');
    push('tool.started', { toolUseId: 'one', toolName: 'Read' });
    push('tool.started', { toolUseId: 'two', toolName: 'Write' });
    push('tool.completed', { toolUseId: 'two' });
    push('approval.requested', { approvalId: 'pending' });
    const snapshot = snapshotView(current.values(), seq);
    expect(Object.keys(snapshot.approvals)).toEqual(['pending']);
    expect(snapshot.questions).toEqual({});
    expect(snapshot.tasks.lead?.state).toBe('running');
    expect(snapshot.state).toBe('running');
    expect(snapshot.seq).toBe(seq);
    expect(snapshot.events.length).toBeLessThan(12);
    expect(JSON.stringify(snapshot.events)).not.toContain('hidden');
    expect(JSON.stringify(snapshot.events)).not.toContain('Historical synthetic content');
    expect(leadProgress(current.values(), { sessionId: 's' })).toEqual(leadProgress(events, { sessionId: 's' }));
    push('approval.resolved', { approvalId: 'pending' });
    push('turn.completed', { status: 'completed' });
    expect(leadProgress(current.values(), { sessionId: 's' })).toBeUndefined();
});
test('stream snapshots and live deltas share an identity and completion replaces all deltas', () => {
    const current = new CurrentEvents();
    current.apply(event(1, 'turn.started'));
    current.apply(event(2, 'message.delta', { text: 'One ' }));
    current.apply(event(3, 'message.delta', { delta: 'two' }));
    const snapshot = current.values().find(e => e.kind === 'message.delta');
    expect(snapshot?.data.text).toBe('One two');
    let rows = mergeHistory([{ ...snapshot!, historyId: 2 }], [{ ...event(4, 'message.delta', { text: ' three' }), historyId: 2 }], 'live');
    expect(rows[0]?.data.text).toBe('One two three');
    expect(mergeHistory(rows, [{ ...event(4, 'message.delta', { text: ' three' }), historyId: 2 }], 'live')).toEqual(rows);
    rows = mergeHistory(rows, [{ ...event(5, 'message.completed', { text: 'Final response' }), historyId: 2 }], 'live');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data.text).toBe('Final response');
    expect(mergeHistory(rows, [{ ...event(4, 'message.delta', { text: 'stale' }), historyId: 2 }], 'live')).toEqual(rows);
});
test('draft subscriptions isolate sessions and asynchronous clearing reaches the current composer', async () => {
    const { DraftStore } = await import('./draft-boundary');
    const drafts = new DraftStore();
    let lead = 0, other = 0;
    const unsubscribe = drafts.subscribe('s', () => lead++);
    drafts.subscribe('t', () => other++);
    drafts.set('s', 'Original');
    drafts.set('s', 'Original');
    expect(lead).toBe(1);
    expect(other).toBe(0);
    unsubscribe();
    drafts.set('s', 'New draft');
    expect(lead).toBe(1);
    drafts.subscribe('s', () => lead++);
    drafts.set('s', '');
    expect(lead).toBe(2);
    expect(drafts.get('s')).toBe('');
});
test('compaction retains failed queued receipts and drops dispatched or cancelled queue content', async () => {
    const { failedQueuedPrompts } = await import('./prompt-queue');
    const current = new CurrentEvents();
    current.apply(event(1, 'prompt.queued', { promptId: 'failed', text: 'Synthetic failed queue' }));
    current.apply(event(2, 'prompt.state', { promptId: 'failed', state: 'failed', reason: 'runner-driver-unavailable' }));
    current.apply(event(3, 'prompt.queued', { promptId: 'cancelled', text: 'Synthetic cancelled' }));
    current.apply(event(4, 'prompt.state', { promptId: 'cancelled', state: 'cancelled' }));
    current.apply(event(5, 'prompt.queued', { promptId: 'active', text: 'Synthetic active' }));
    current.apply(event(6, 'prompt.dispatched', { promptId: 'active', taskId: 'lead' }));
    current.apply(event(7, 'prompt.queue', { paused: true }));
    expect(failedQueuedPrompts(current.values()).map(item => item.promptId)).toEqual(['failed']);
    expect(JSON.stringify(current.values())).not.toContain('Synthetic cancelled');
    expect(JSON.stringify(current.values())).not.toContain('Synthetic active');
});

test('hidden instructions and concurrent user rows cannot displace current assistant evidence',()=>{
 const current=new CurrentEvents();
 current.apply(event(1,'message.completed',{role:'assistant',text:'Last reply'}));
 current.apply(event(2,'message.completed',{role:'system',text:'Hidden instruction'}));
 current.apply(event(3,'message.delta',{text:'Partial '}));
 current.apply(event(4,'message.completed',{role:'user',text:'Concurrent user'}));
 current.apply(event(5,'message.delta',{text:'answer'}));
 current.apply(event(6,'message.delta',{text:'Hidden delta',internal:true}));
 expect(current.values().find(e=>e.kind==='message.completed'&&e.data.role==='assistant')?.data.text).toBe('Last reply');
 expect(current.values().find(e=>e.kind==='message.delta')?.data.text).toBe('Partial answer');
 expect(JSON.stringify(current.values())).not.toContain('Hidden instruction');expect(JSON.stringify(current.values())).not.toContain('Hidden delta');
});

test('a lagging inbox summary cannot resurrect dispatched or cancelled prompts after compaction',async()=>{
 const {reconcileInbox}=await import('./prompt-queue');const current=new CurrentEvents();
 current.apply(event(1,'prompt.queued',{promptId:'old',text:'Synthetic old'}));
 const old={seq:1,paused:false,queued:[{promptId:'old',text:'Synthetic old'}]};
 current.apply(event(2,'prompt.dispatched',{promptId:'old',taskId:'lead',attempt:1}));
 current.apply(event(3,'prompt.queue',{paused:true,reason:'Synthetic pause'}));
 let inbox=reconcileInbox(current.values(),old);expect(inbox.queued).toEqual([]);expect(inbox.active?.promptId).toBe('old');expect(inbox.paused).toBe(true);
 current.apply(event(4,'prompt.state',{promptId:'old',state:'completed'}));
 current.apply(event(5,'prompt.queued',{promptId:'new',text:'Synthetic new'}));
 current.apply(event(6,'prompt.queue',{paused:false}));
 inbox=reconcileInbox(current.values(),old);expect(inbox.active).toBeUndefined();expect(inbox.queued.map(row=>row.promptId)).toEqual(['new']);expect(inbox.paused).toBe(false);
 current.apply(event(7,'prompt.state',{promptId:'new',state:'cancelled'}));
 expect(reconcileInbox(current.values(),old).queued).toEqual([]);
});

test('compacted steering evidence keeps accepted delivery out of the pending queue and exposes live readiness', async () => {
    const { reconcileInbox, emptyInbox } = await import('./prompt-queue');
    const current = new CurrentEvents();
    current.apply(event(1, 'prompt.queued', { promptId: 'p', text: 'Steer now' }));
    current.apply(event(2, 'prompt.steering', { promptId: 'p', taskId: 'lead' }));
    current.apply(event(3, 'prompt.steered', { promptId: 'p', steeringSeq: 2, state: 'accepted' }));
    current.apply(event(4, 'prompt.queue', { paused: false }));
    current.apply(event(5, 'diagnostic', { code: 'prompt.steering-capability', available: true }));
    const inbox = reconcileInbox(current.values(), emptyInbox());
    expect(inbox.queued).toEqual([]);
    expect(inbox.deliveries).toEqual([{ promptId: 'p', text: 'Steer now', state: 'accepted' }]);
    expect(inbox.steeringAvailable).toBe(true);
    for (let i = 0; i < 100; i++) {
        current.apply(event(6 + i * 3, 'prompt.queued', { promptId: `p${i}`, text: 'Bounded delivery' }));
        current.apply(event(7 + i * 3, 'prompt.steering', { promptId: `p${i}` }));
        current.apply(event(8 + i * 3, 'prompt.steered', { promptId: `p${i}`, state: 'accepted' }));
    }
    expect(reconcileInbox(current.values(), emptyInbox()).deliveries).toHaveLength(16);
    expect(current.values().length).toBeLessThan(55);
});
