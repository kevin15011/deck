import { afterEach, expect, test } from 'bun:test';
import { EventLog } from '../event-log';
import { ChatHistory } from '../chat-history';
import { cleanupTempDirs, tempDir } from './test-helpers';
const logs: EventLog[] = [];
afterEach(() => { logs.splice(0).forEach(log => log.close()); cleanupTempDirs(); });
function fixture() { const log = EventLog.open({ dir: tempDir(), sessionId: 's', segmentBytes: 2048 }); logs.push(log); return { log, append: (kind: Parameters<EventLog['append']>[0]['kind'], data: Record<string, unknown> = {}, source = { taskId: 'lead' }) => log.append({ kind, data, source }) }; }
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
