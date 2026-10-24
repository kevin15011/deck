import { afterEach, expect, test } from 'bun:test';
import { EventLog } from '../event-log';
import { ChatHistory } from '../chat-history';
import { cleanupTempDirs, tempDir } from './test-helpers';
const logs: EventLog[] = [];
afterEach(() => { logs.splice(0).forEach(log => log.close()); cleanupTempDirs(); });
function fixture() { const log = EventLog.open({ dir: tempDir(), sessionId: 's', segmentBytes: 2048 }); logs.push(log); return { log, append: (kind: Parameters<EventLog['append']>[0]['kind'], data: Record<string, unknown> = {}, source = { taskId: 'lead' }) => log.append({ kind, data, source }) }; }
test('paged Claude historical acceptance retains its immutable runner through mirror reconstruction and reload',()=>{
 const {log,append}=fixture();append('prompt.queued',{promptId:'p',text:'Earlier Claude input'});
 const fence=append('prompt.steering',{promptId:'p',taskId:'lead',attempt:1,runnerId:'claude',nativeThreadId:'thread',nativeTurnId:'original',clientUserMessageId:'p',text:'Exact native input'});
 append('prompt.steered',{promptId:'p',steeringSeq:fence.seq,state:'accepted',eligible:false,stale:false,via:'history'});
 const index=new ChatHistory(log);expect(index.page().messages[0]?.data.steeringRunnerId).toBe('claude');
 const mirror=append('message.completed',{role:'user',text:'Earlier Claude input',promptId:'p',steering:true,steeringSeq:fence.seq,steeringRunnerId:'claude',historical:true});index.apply(mirror);
 expect(index.page().messages).toHaveLength(1);expect(new ChatHistory(log).page().messages[0]?.data).toMatchObject({steeringRunnerId:'claude',historical:true});
});
test('pagination across stream starts/completion and turn boundaries preserves stable row identity', () => {
    const { log, append } = fixture();
    const start = append('message.delta', { text: 'First ' });
    append('message.delta', { delta: 'part' });
    for (let i = 0; i < 60; i++)
        append('message.completed', { role: 'user', text: `Synthetic ${i}` });
    const index = new ChatHistory(log), page = index.page();
    expect(page.messages).toHaveLength(40);
    const done = append('message.completed', { text: 'Completed stream' });
    index.apply(done);
    const older = index.page({ before: page.before });
    expect(older.messages[0]?.historyId).toBe(start.seq);
    expect(older.messages[0]?.data.text).toBe('Completed stream');
    expect(index.messageAt(done)?.historyId).toBe(start.seq);
    expect(index.messageAt(done)?.seq).toBe(done.seq);
    const next = append('message.delta', { text: 'Next' });
    index.apply(next);
    expect(index.messageAt(next)?.data.text).toBe('Next');
    const delta = append('message.delta', { text: ' part' });
    index.apply(delta);
    expect(index.messageAt(delta)?.data.text).toBe(' part');
    expect(index.page().messages.at(-1)?.data.text).toBe('Next part');
    const boundary = append('turn.completed', { status: 'completed' });
    index.apply(boundary);
    const third = append('message.delta', { text: 'New turn' });
    index.apply(third);
    expect(index.page().messages.at(-1)?.historyId).toBe(third.seq);
});
test('child, internal and system messages are excluded; resolved questions retain private metadata across pages', () => {
    const { log, append } = fixture();
    append('message.completed', { text: 'child' }, { taskId: 'child' });
    append('message.completed', { text: 'internal', internal: true });
    append('message.completed', { text: 'system', role: 'system' });
    append('question.requested', { questionId: 'q', questions: [{ id: 'public', prompt: 'Public', secret: false }, { id: 'secret', prompt: 'Secret', secret: true }] });
    for (let i = 0; i < 100; i++)
        append('message.completed', { text: `Synthetic ${i}` });
    append('question.resolved', { questionId: 'q', outcome: 'answered', by: 'browser', answers: { public: ['Share'], secret: ['Never transfer'] } });
    const index = new ChatHistory(log), recent = index.page();
    const question = recent.messages.at(-1)!;
    expect(question.request?.data.questions).toHaveLength(2);
    expect(question.data.answers).toEqual({ public: ['Share'] });
    expect(JSON.stringify(recent)).not.toContain('Never transfer');
    let before = recent.before, all = [...recent.messages];
    while (before) {
        const page = index.page({ before });
        all.unshift(...page.messages);
        before = page.before;
    }
    expect(all).toHaveLength(101);
    expect(all.every(row => row.data.internal !== true && row.data.role !== 'system' && row.data.text !== 'child')).toBe(true);
    // Building from durable history and maintaining a live index yield identical pages.
    expect(new ChatHistory(log).page()).toEqual(index.page());
});
test('subagent resolutions without a source use the initiating request identity', () => {
    const { log, append } = fixture();
    append('question.requested', { questionId: 'child', questions: [] }, { taskId: 'child' });
    log.append({ kind: 'question.resolved', data: { questionId: 'child', outcome: 'dismissed', by: 'test' } });
    expect(new ChatHistory(log).page().messages).toEqual([]);
});

test('large histories scan once and materialize only the requested rows thereafter',()=>{
 const {log}=fixture();
 for(let page=0;page<60;page++)log.appendMany(Array.from({length:100},(_,i)=>({kind:'message.completed' as const,data:{text:`Synthetic ${page*100+i}`}})));
 let scans=0,reads=0;
 const readAfter=log.readAfter.bind(log),readEvent=log.readEvent.bind(log);
 log.readAfter=function*(after:number){scans++;yield* readAfter(after);};
 log.readEvent=(seq:number)=>{reads++;return readEvent(seq);};
 const index=new ChatHistory(log);expect(scans).toBe(1);expect(reads).toBe(0);
 const recent=index.page();expect(recent.messages).toHaveLength(40);expect(reads).toBe(40);
 reads=0;const older=index.page({before:recent.before});expect(older.messages).toHaveLength(40);expect(reads).toBe(40);expect(scans).toBe(1);
});

test('task history is separately paged and child live content never enters the Lead stream',()=>{
 const {log,append}=fixture();
 for(let i=0;i<100;i++)append('message.completed',{text:`Child ${i}`},{taskId:'child'});
 const index=new ChatHistory(log), recent=index.page({taskId:'child'});
 expect(index.page().messages).toEqual([]);expect(recent.messages).toHaveLength(40);expect(recent.messages.at(-1)?.data.text).toBe('Child 99');
 expect(index.page({taskId:'child',before:recent.before}).messages.at(-1)?.data.text).toBe('Child 59');
 const event=append('message.delta',{text:'Child live'},{taskId:'child'});index.apply(event);
 expect(index.messageAt(event)).toBeUndefined();expect(index.messageAt(event,'child')?.data.text).toBe('Child live');
});

test('paged steering acceptance reconstructs a missing mirror at its original fence and stays deduplicated live', () => {
    const { log, append } = fixture();
    append('prompt.queued', { promptId: 'p', text: 'Earlier steering' });
    const fence = append('prompt.steering', { promptId: 'p', taskId: 'lead', attempt: 1, nativeThreadId: 'thread', nativeTurnId: 'turn', clientUserMessageId: 'p', text: 'Earlier steering\n\n[Deck genuine user input reference: p]' });
    append('message.completed', { role: 'user', text: 'Later input' });
    const accepted = append('prompt.steered', { promptId: 'p', steeringSeq: fence.seq, state: 'accepted', eligible: false, stale: true, via: 'history' });
    const index = new ChatHistory(log);
    expect(index.page().messages.map(row => row.data.text)).toEqual(['Earlier steering', 'Later input']);
    expect(index.messageAt(accepted)).toMatchObject({ historyId: fence.seq, ts: fence.ts, data: { role: 'user', historical: true, decisionReply: { stale: true } } });
    const mirror = append('message.completed', { role: 'user', text: 'Earlier steering', promptId: 'p', steering: true, steeringSeq: fence.seq, historical: true, decisionReply: { stale: true } });
    index.apply(mirror);
    expect(index.page().messages.map(row => row.data.text)).toEqual(['Earlier steering', 'Later input']);
    expect(index.messageAt(mirror)?.historyId).toBe(fence.seq);
    expect(new ChatHistory(log).page()).toEqual(index.page());
    expect(index.page({ before: fence.seq + 1, limit: 1 }).messages[0]?.historyId).toBe(fence.seq);
});

test('compacted current evidence retains a bounded decision refresh cursor', () => {
    const { log, append } = fixture();
    append('decision.reply', { decisionId: 'd', promptId: 'p', revision: 1, taskId: 'lead', attempt: 1, admittedSeq: 1, stale: false });
    const index = new ChatHistory(log);
    expect(index.current.values().some(event => event.kind === 'decision.reply')).toBe(true);
    const later = append('decision.reply', { decisionId: 'd2', promptId: 'p2', revision: 1, taskId: 'lead', attempt: 1, admittedSeq: 1, stale: false });
    index.apply(later);
    expect(index.current.values().filter(event => event.kind.startsWith('decision.')).map(event => event.seq)).toEqual([later.seq]);
});

test('compaction survives real history hydration, live projection and reconnect independently of paging', async () => {
 const { leadProgress } = await import('../../../../apps/web/src/lead-progress');
 const { snapshotView } = await import('../../../../apps/web/src/chat-history');
 const { log, append } = fixture();
 append('turn.started');
 const data = { code: 'context.compaction', state: 'started', itemId: 'compact', nativeThreadId: 'thread', nativeTurnId: 'turn' };
 append('diagnostic', data);
 for (let i = 0; i < 150; i++) append('message.completed', { role: 'user', text: `row ${i}` });
 const index = new ChatHistory(log), page = index.page();
 expect(page.messages).toHaveLength(40);
 expect(leadProgress(snapshotView(page.events, page.seq).events, { sessionId: 's' })?.phase).toBe('compacting');
 const before = index.current.values();
 expect(index.page({ before: page.before }).events).toEqual([]);
 expect(index.current.values()).toEqual(before);
 expect(leadProgress(new ChatHistory(log).page().events, { sessionId: 's' })?.phase).toBe('compacting');
 index.apply(append('diagnostic', { ...data, state: 'completed', itemId: 'unknown' }));
 expect(leadProgress(index.current.values(), { sessionId: 's' })?.phase).toBe('compacting');
 index.apply(append('diagnostic', { ...data, state: 'completed' }));
 expect(leadProgress(index.current.values(), { sessionId: 's' })?.phase).toBe('waiting');
 expect(leadProgress(new ChatHistory(log).page().events, { sessionId: 's' })?.phase).toBe('waiting');
 index.apply(append('turn.completed', { status: 'completed' }));
 expect(leadProgress(new ChatHistory(log).page().events, { sessionId: 's' })).toBeUndefined();
});

test('delivery receipts and requeued image input survive paging and index rebuild',()=>{
  const {log,append}=fixture(),image={attachmentId:'image',name:'photo.png',mimeType:'image/png',sizeBytes:10};
  append('prompt.queued',{promptId:'p',text:'keep',attachments:[image]});append('prompt.dispatched',{promptId:'p',taskId:'lead',attempt:1,handoff:'gated',text:'keep',attachments:[image]});
  const bubble=append('message.completed',{role:'user',promptId:'p',text:'keep',handoff:'pending',attachments:[image]});
  append('prompt.requeued',{promptId:'p',taskId:'lead',attempt:1,text:'keep',attachments:[image],reason:'startup'});
  for(let i=0;i<125;i++)append('message.completed',{role:'assistant',text:`answer ${i}`});
  const index=new ChatHistory(log),page=index.page({before:bubble.seq+1});
  expect(page.messages.find(e=>e.seq===bubble.seq)?.data.attachments).toEqual([image]);
  expect(index.current.values().find(e=>e.kind==='prompt.requeued')?.data).toMatchObject({text:'keep',attachments:[image]});
  const dispatch=append('prompt.dispatched',{promptId:'p',taskId:'lead',attempt:2,handoff:'gated',text:'keep',attachments:[image]});index.apply(dispatch);
  const receipt=append('prompt.handoff',{promptId:'p',taskId:'lead',attempt:2,state:'unknown'});index.apply(receipt);
  expect(index.current.values().find(e=>e.kind==='prompt.handoff')?.data.state).toBe('unknown');
  expect(new ChatHistory(log).current.values()).toEqual(index.current.values());
});
