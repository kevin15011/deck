import { expect, test } from 'bun:test';
import { listenForDismissal } from './dismiss-layer';

test('outside pointerdown dismisses without swallowing the button click; inside stays open', () => {
    const document = new EventTarget() as Document;
    let open = true, clicked = 0;
    const inside = new Event('pointerdown', { cancelable: true });
    const stop = listenForDismissal(document, { isOpen: () => open, contains: target => target === document && inside === current, dismiss: () => { open = false; } });
    let current = inside;
    document.dispatchEvent(inside); expect(open).toBe(true);
    current = new Event('pointerdown', { cancelable: true });
    document.dispatchEvent(current); expect(open).toBe(false); expect(current.defaultPrevented).toBe(false);
    document.addEventListener('click', () => clicked++); document.dispatchEvent(new Event('click')); expect(clicked).toBe(1);
    stop();
});

test('Escape dismisses the top open layer once and listeners are cleaned up', () => {
    const document = new EventTarget() as Document;
    let outer = true, inner = true;
    const stopOuter = listenForDismissal(document, { isOpen: () => outer, contains: () => false, dismiss: () => { outer = false; } });
    const stopInner = listenForDismissal(document, { isOpen: () => inner, contains: () => false, dismiss: reason => { expect(reason).toBe('escape'); inner = false; } });
    const escape = () => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { key: 'Escape' }); return event; };
    document.dispatchEvent(escape()); expect(inner).toBe(false); expect(outer).toBe(true);
    stopInner(); document.dispatchEvent(escape()); expect(outer).toBe(false);
    stopOuter(); outer = true; document.dispatchEvent(escape()); expect(outer).toBe(true);
});

test('Escape closes a nested open layer before its parent even when the parent registered last', () => {
    const document = new EventTarget() as Document;
    const parentNode = {}, childNode = {};
    let parent = true, child = true;
    const stopChild = listenForDismissal(document, { isOpen: () => child, contains: target => target === childNode, dismiss: () => { child = false; }, node: () => childNode as Node });
    const stopParent = listenForDismissal(document, { isOpen: () => parent, contains: target => target === parentNode || target === childNode, dismiss: () => { parent = false; }, node: () => parentNode as Node });
    const escape = () => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { key: 'Escape' }); return event; };
    document.dispatchEvent(escape()); expect(child).toBe(false); expect(parent).toBe(true);
    document.dispatchEvent(escape()); expect(parent).toBe(false);
    stopChild(); stopParent();
});
