import { afterEach, expect, test } from 'bun:test';
import { copyText } from './clipboard';

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
    for (const [key, descriptor] of [['navigator', navigatorDescriptor], ['document', documentDescriptor]] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});
for (const [label, text] of [
    ['raw Lead markdown', '## Result\n\n**Ready** [link](https://example.com)\n\n```ts\nconst x = 1;\n```\n'],
    ['exact user text', '  Please keep\n\n  these spaces & <tags> 😀\n'],
]) test(`copies ${label} without transforming the source`, async () => {
    let copied: string | undefined;
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {clipboard: {writeText: async (value: string) => { copied = value; }}}});
    await copyText(text!);
    expect(copied).toBe(text);
});
function fallback(succeeds = true) {
    const state = {value: '', removed: false, focused: false, selected: false};
    const textarea = {value: '', style: {}, setAttribute() {}, select() {state.selected = true;}, remove() {state.removed = true;}};
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {
        activeElement: {focus(options: FocusOptions) {state.focused = options.preventScroll === true;}},
        getSelection: () => null,
        createElement: () => textarea,
        body: {appendChild() {}},
        execCommand(command: string) {expect(command).toBe('copy'); state.value = textarea.value; return succeeds;},
    }});
    return state;
}
test('LAN HTTP fallback preserves exact text and restores focus without scrolling', async () => {
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {}});
    const state = fallback();
    await copyText('  raw\ntext\n');
    expect(state).toEqual({value: '  raw\ntext\n', removed: true, focused: true, selected: true});
});
test('denied Clipboard API falls back; failed fallback rejects and cleans up', async () => {
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {clipboard: {writeText: async () => {throw new Error('Denied');}}}});
    const success = fallback(); await copyText('fallback'); expect(success.value).toBe('fallback');
    const failure = fallback(false); await expect(copyText('failed')).rejects.toThrow('Copy failed');
    expect(failure.removed).toBe(true); expect(failure.focused).toBe(true);
});
