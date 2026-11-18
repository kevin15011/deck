import {test,expect} from 'bun:test';
import {advanceDoubleEscape,composerEnterSubmits,listenForDoubleEscape,type DoubleEscapeState} from './composer-keyboard';
const press=(state:DoubleEscapeState,now:number,extra={})=>advanceDoubleEscape(state,{key:'Escape',turn:'s:lead:1',now,...extra});
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

const escape = (extra = {}) => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: false, repeat: false, ...extra });
const tick = () => Bun.sleep(5);

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

