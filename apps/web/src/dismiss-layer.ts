import { useEffect, useRef, type RefObject } from 'react';

type DismissReason = 'outside' | 'escape';
type Layer = { isOpen(): boolean; contains(target: EventTarget | null): boolean; dismiss(reason: DismissReason): void; node?(): Node | null | undefined };

/** A layer containing another open layer's node is its parent, whatever order they mounted in. */
function topLayer(): Layer | undefined {
    const open = layers.filter(item => item.isOpen());
    return open.filter(item => !open.some(other => other !== item && !!other.node?.() && item.contains(other.node!()!))).at(-1);
}
const layers: Layer[] = [];

export function hasOpenDismissLayer(): boolean { return layers.some(layer => layer.isOpen()); }

/** Outside pointerdown never cancels the underlying click. Escape closes only the top layer. */
export function listenForDismissal(target: Document, layer: Layer): () => void {
    layers.push(layer);
    const pointer = (event: PointerEvent) => {
        if (layer.isOpen() && !layer.contains(event.target)) layer.dismiss('outside');
    };
    const key = (event: KeyboardEvent) => {
        if (!layer.isOpen() || event.key !== 'Escape' || event.defaultPrevented || topLayer() !== layer) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        layer.dismiss('escape');
    };
    target.addEventListener('pointerdown', pointer, true);
    target.addEventListener('keydown', key);
    return () => {
        target.removeEventListener('pointerdown', pointer, true);
        target.removeEventListener('keydown', key);
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
    };
}

export function useDismissLayer({ open, roots, onDismiss }: { open: boolean | (() => boolean); roots: readonly RefObject<HTMLElement | null>[]; onDismiss(reason: DismissReason): void }) {
    const latest = useRef({ open, roots, onDismiss });
    latest.current = { open, roots, onDismiss };
    useEffect(() => listenForDismissal(document, {
        isOpen: () => typeof latest.current.open === 'function' ? latest.current.open() : latest.current.open,
        contains: target => target instanceof Node && latest.current.roots.some(root => root.current?.contains(target)),
        dismiss: reason => latest.current.onDismiss(reason),
        node: () => latest.current.roots[0]?.current,
    }), []);
}

export function useDetailsDismiss(details: RefObject<HTMLDetailsElement | null>) {
    useDismissLayer({ open: () => !!details.current?.open, roots: [details], onDismiss: reason => {
        if (!details.current) return;
        details.current.open = false;
        if (reason === 'escape') details.current.querySelector('summary')?.focus({ preventScroll: true });
    } });
}
