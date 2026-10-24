import { expect, test } from 'bun:test';
import { DraftStore } from './draft-boundary';
import { listenForDismissal } from './dismiss-layer';
import { advanceDoubleEscape, composerEnterSubmits, chooseEscapeAction, recallAndRestore, interruptAndRecall, listenForDoubleEscape, type DoubleEscapeState } from './composer-keyboard';

const press = (state: DoubleEscapeState, now: number, extra = {}) => advanceDoubleEscape(state, { key: 'Escape', turn: 's:lead:1', now, ...extra });
test('Stop always interrupts first and recalls only its server-confirmed requeued active prompt',async()=>{
 const calls:string[]=[],active={promptId:'active',taskId:'lead',attempt:1,state:'dispatched' as const,handoff:'pending' as const,text:'text'};
 const args={active,interrupt:async()=>{calls.push('interrupt');},readInbox:async()=>({seq:4,paused:true,queued:[{promptId:'queued',text:'later'},{promptId:'active',text:'server text',requeued:true}]}),recall:async(p:{promptId:string})=>{calls.push(p.promptId);return 'recalled' as const;}};
 expect(await interruptAndRecall(args)).toBe('recalled');expect(calls).toEqual(['interrupt','active']);
 calls.length=0;expect(await interruptAndRecall({...args,active:{...active,handoff:'sending'}})).toBe('interrupted');expect(calls).toEqual(['interrupt']);
 calls.length=0;await interruptAndRecall({...args,active:undefined});expect(calls).toEqual(['interrupt']);
 calls.length=0;await expect(interruptAndRecall({...args,interrupt:async()=>{throw Error('offline');}})).rejects.toThrow('offline');expect(calls).toEqual([]);
});
test('Stop does not restore a delivered or unconfirmed prompt or an unrelated queued message',async()=>{
 let recalled=0;
 const args={active:{promptId:'active',taskId:'lead',attempt:1,state:'dispatched' as const,handoff:'pending' as const,text:'text'},interrupt:async()=>{},readInbox:async()=>({seq:4,paused:true,queued:[{promptId:'later',text:'queued'}]}),recall:async()=>{recalled++;return 'recalled' as const;}};
 expect(await interruptAndRecall(args)).toBe('interrupted');expect(recalled).toBe(0);
});
test('Stop waits for authoritative requeue and uses server text and images',async()=>{
 const active={promptId:'active',taskId:'lead',attempt:1,state:'dispatched' as const,handoff:'pending' as const,text:'cached'};
 const requeued={promptId:'active',text:'server',attachments:[{attachmentId:'image',name:'a.png',mimeType:'image/png',sizeBytes:1}],requeued:true};
 let reads=0,restored:unknown;
 const result=await interruptAndRecall({active,interrupt:async()=>{},readInbox:async()=>++reads===1?{seq:1,paused:true,queued:[],active}:{seq:2,paused:true,queued:[requeued]},recall:async(prompt)=>{restored=prompt;return 'recalled';}});
 expect(result).toBe('recalled');expect(reads).toBe(2);expect(restored).toEqual(requeued);
});

test('two distinct Esc presses within one second interrupt once', () => {
    const first = press(undefined, 0);
    expect(first.action).toBe('hint');
    const second = press(first.state, 999);
    expect(second.action).toBe('confirm');
    expect(second.state).toBeUndefined();
    expect(press(second.state, 1000).action).toBe('hint');
});

test('expired, changed-turn and inactive sequences never interrupt', () => {
    const first = press(undefined, 100).state;
    expect(press(first, 1101).action).toBe('hint');
    expect(press(first, 200, { turn: 'other:lead:1' }).action).toBe('hint');
    expect(press(first, 200, { turn: undefined }).action).toBe('ignore');
    expect(press(first, 200, { key: 'a' }).state).toBeUndefined();
});

for (const reason of ['blocked', 'isComposing', 'repeat'] as const) {
    test(`${reason} Escape cannot arm or complete interruption`, () => {
        const first = press(undefined, 0).state;
        expect(press(first, 100, { [reason]: true })).toEqual({ state: undefined, action: 'ignore' });
    });
}

test('desktop Enter sends; Shift, IME, handled events and touch Enter do not submit', () => {
    const enter = { key: 'Enter', shiftKey: false, isComposing: false, defaultPrevented: false };
    expect(composerEnterSubmits(enter, false)).toBe(true);
    expect(composerEnterSubmits(enter, true)).toBe(false);
    for (const change of [{ shiftKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'Escape' }]) {
        expect(composerEnterSubmits({ ...enter, ...change }, false)).toBe(false);
    }
});

test('recall newest unread queue item before interrupting; no queue or active Lead means no action', () => {
    const queued = [{ promptId: 'old', text: 'Older' }, { promptId: 'new', text: 'Newest\nfull text' }];
    expect(chooseEscapeAction(queued, 'lead-g2')).toEqual({ kind: 'recall', prompt: queued[1] });
    expect(chooseEscapeAction(queued)).toEqual({ kind: 'recall', prompt: queued[1] });
    expect(chooseEscapeAction([], 'lead-g2')).toEqual({ kind: 'interrupt', taskId: 'lead-g2' });
    expect(chooseEscapeAction([])).toBeUndefined();
});

function recall(cancel = async (): Promise<unknown> => ({ promptId: 'queued', state: 'cancelled' })) {
    const drafts = new DraftStore();
    let focused: string | undefined;
    return { drafts, focused: () => focused, run: () => recallAndRestore({ sessionId: 's', prompt: { promptId: 'queued', text: 'Unread\nprompt' }, drafts, cancel, focus: text => { focused = text; } }) };
}

test('restore full unread text and publish draft only after matching server cancellation receipt', async () => {
    const state = recall();
    let notifications = 0;
    state.drafts.subscribe('s', () => { notifications++; });
    expect(await state.run()).toBe('recalled');
    expect(state.drafts.get('s')).toBe('Unread\nprompt');
    expect(state.focused()).toBe('Unread\nprompt');
    expect(notifications).toBe(1);
});

test('merge recalled text before the latest draft, including edits during the cancellation request', async () => {
    let finish!: (result: unknown) => void;
    const state = recall(() => new Promise(resolve => { finish = resolve; }));
    state.drafts.set('s', 'Old draft');
    const result = state.run();
    expect(state.drafts.get('s')).toBe('Old draft');
    state.drafts.set('s', 'New draft\nwith edits');
    finish({ promptId: 'queued', state: 'cancelled' });
    expect(await result).toBe('recalled');
    expect(state.drafts.get('s')).toBe('Unread\nprompt\n\nNew draft\nwith edits');
    expect(state.focused()).toBe(state.drafts.get('s'));
});

test('consumed messages, uncertain receipts and failures never restore or claim recall', async () => {
    for (const reply of [undefined, {}, { promptId: 'other', state: 'cancelled' }, { promptId: 'queued', state: 'dispatched' }]) {
        const state = recall(async () => reply);
        expect(await state.run()).toBe('unconfirmed');
        expect(state.drafts.get('s')).toBeUndefined();
        expect(state.focused()).toBeUndefined();
    }
    const consumed = recall(async () => { throw Object.assign(new Error('Already started'), { code: 'prompt-already-started' }); });
    consumed.drafts.set('s', 'Keep');
    expect(await consumed.run()).toBe('already-started');
    expect(consumed.drafts.get('s')).toBe('Keep');
    expect(consumed.focused()).toBeUndefined();
    const failed = recall(async () => { throw Error('offline'); });
    await expect(failed.run()).rejects.toThrow('offline');
    expect(failed.drafts.get('s')).toBeUndefined();
});

const escape = (extra = {}) => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false, repeat: false, ...extra });
const tick = () => Bun.sleep(5);

test('dismissal wins even when its listener registers after the composer; dismissed Esc resets the pair', async () => {
    const target = new EventTarget();
    let now = 0, open = false, interrupts = 0;
    const hints: (string | undefined)[] = [];
    const stop = listenForDoubleEscape(target, { turn: () => 's:lead:1', blocked: () => open, onHint: hint => hints.push(hint), onConfirm: () => { interrupts++; }, now: () => now });
    const dismiss = listenForDismissal(target as Document, { isOpen: () => open, contains: () => true, dismiss: () => { open = false; } });
    target.dispatchEvent(escape()); await tick();
    open = true; now = 100;
    target.dispatchEvent(escape()); await tick();
    expect(open).toBe(false); expect(interrupts).toBe(0);
    now = 200; target.dispatchEvent(escape()); await tick();
    expect(interrupts).toBe(0);
    now = 300; target.dispatchEvent(escape()); await tick();
    expect(interrupts).toBe(1); expect(hints.at(-1)).toBeUndefined();
    stop(); dismiss();
    target.dispatchEvent(escape()); await tick(); expect(interrupts).toBe(1);
});

test('later preventDefault, IME and turn switches cannot trigger an interrupt', async () => {
    const target = new EventTarget();
    let turn: string | undefined = 's:lead:1', interrupts = 0;
    const stop = listenForDoubleEscape(target, { turn: () => turn, blocked: () => false, onHint: () => {}, onConfirm: () => { interrupts++; }, now: () => 100 });
    const prevent = (event: Event) => event.preventDefault();
    target.addEventListener('keydown', prevent);
    target.dispatchEvent(escape()); await tick();
    target.removeEventListener('keydown', prevent);
    target.dispatchEvent(escape({ isComposing: true })); await tick();
    target.dispatchEvent(escape()); turn = 'other:lead:1'; await tick();
    target.dispatchEvent(escape()); await tick();
    expect(interrupts).toBe(0);
    stop();
});

test('active pending input is recallable, queued input still takes priority', () => {
    const pending = {promptId:'active',taskId:'lead',attempt:1,state:'dispatched' as const,handoff:'pending' as const,text:'unread',attachments:[{attachmentId:'image',name:'image.png',mimeType:'image/png',sizeBytes:10}]};
    expect(chooseEscapeAction([], 'lead', pending)).toEqual({kind:'recall',prompt:pending});
    expect(chooseEscapeAction([{promptId:'queued',text:'later'}], 'lead', pending)?.kind).toBe('recall');
    expect(chooseEscapeAction([], 'lead', {...pending,handoff:'sending'})).toEqual({kind:'interrupt',taskId:'lead'});
});

test('recall restores attachments only after the matching server cancellation receipt', async () => {
    const images = [{attachmentId:'image',name:'image.png',mimeType:'image/png',sizeBytes:10}], restored: unknown[] = [];
    const drafts = new Map<string,string>([['session','existing']]);
    const args = {sessionId:'session',prompt:{promptId:'pending',text:'recalled',attachments:images},drafts,cancel:async()=>({promptId:'pending',state:'cancelled'}),focus:()=>{},restoreImages:(_id:string,attachments:unknown)=>{restored.push(attachments);}};
    await recallAndRestore(args);expect(restored).toEqual([images]);expect(drafts.get('session')).toBe('recalled\n\nexisting');
    restored.length=0;await recallAndRestore({...args,cancel:async()=>({promptId:'other',state:'cancelled'})});expect(restored).toEqual([]);
});
