import {hasOpenDismissLayer} from './dismiss-layer';
import { useEffect, useRef, useState } from 'react';

export const DOUBLE_ESCAPE_MS = 1000;
export const TOUCH_COMPOSER_QUERY = '(pointer: coarse), (hover: none)';
export type DoubleEscapeState = { turn: string; at: number } | undefined;

type EscapePress = { key: string; now: number; turn?: string; blocked?: boolean; isComposing?: boolean; repeat?: boolean };
export function advanceDoubleEscape(state: DoubleEscapeState, press: EscapePress): { state: DoubleEscapeState; action: 'ignore' | 'hint' | 'confirm' } {
    if (press.key !== 'Escape' || !press.turn || press.blocked || press.isComposing || press.repeat)
        return { state: undefined, action: 'ignore' };
    if (state?.turn === press.turn && press.now >= state.at && press.now - state.at <= DOUBLE_ESCAPE_MS)
        return { state: undefined, action: 'confirm' };
    return { state: { turn: press.turn, at: press.now }, action: 'hint' };
}

export function composerEnterSubmits(event: { key: string; shiftKey: boolean; isComposing: boolean; defaultPrevented: boolean }, touch: boolean): boolean {
    return event.key === 'Enter' && !touch && !event.shiftKey && !event.isComposing && !event.defaultPrevented;
}

/** Capture eligibility before dismissal; act only after all Escape consumers ran. */
export function listenForDoubleEscape(target: EventTarget, options: {
    turn(): string | undefined;
    blocked(event: KeyboardEvent): boolean;
    onHint(turn?: string): void;
    onConfirm(): void;
    now?(): number;
}): () => void {
    let state: DoubleEscapeState, timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const clear = () => { clearTimeout(timer); options.onHint(undefined); };
    const key = (raw: Event) => {
        const event = raw as KeyboardEvent;
        if (event.key !== 'Escape' && !state && !pending.size) return;
        const turn = options.turn(), blocked = options.blocked(event), now = (options.now ?? Date.now)();
        // Browser microtasks can run between capture and target listeners. A task
        // observes preventDefault even when a later consumer stops propagation.
        const deferred = setTimeout(() => {
            pending.delete(deferred);
            if (disposed) return;
            const result = advanceDoubleEscape(state, { key: event.key, now, turn, blocked: blocked || event.defaultPrevented || turn !== options.turn(), isComposing: event.isComposing || event.keyCode === 229, repeat: event.repeat });
            state = result.state;
            clear();
            if (result.action === 'hint') {
                options.onHint(turn);
                timer = setTimeout(() => { state = undefined; options.onHint(undefined); }, DOUBLE_ESCAPE_MS);
            } else if (result.action === 'confirm') {
                event.preventDefault();
                options.onConfirm();
            }
        }, 0);
        pending.add(deferred);
    };
    target.addEventListener('keydown', key, true);
    return () => { disposed = true; clearTimeout(timer); pending.forEach(clearTimeout); target.removeEventListener('keydown', key, true); };
}

export function useComposerKeyboard(turn: string | undefined, onConfirm: () => void) {
    const [touchEnter, setTouchEnter] = useState(() => window.matchMedia(TOUCH_COMPOSER_QUERY).matches);
    const [hintTurn, setHintTurn] = useState<string>();
    const latest = useRef({ turn, onConfirm }); latest.current = { turn, onConfirm };
    useEffect(() => {
        const media = window.matchMedia(TOUCH_COMPOSER_QUERY);
        const update = () => setTouchEnter(media.matches);
        update(); media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    useEffect(() => {
        setHintTurn(undefined);
        return listenForDoubleEscape(window, {
            turn: () => latest.current.turn,
            blocked: event => hasOpenDismissLayer() || document.hidden || !document.getElementById('prompt')?.getClientRects().length || !!document.getElementById('prompt')?.closest('[hidden], [inert]') || !!(document.getElementById('prompt') as HTMLTextAreaElement | null)?.disabled || !!document.querySelector('dialog[open], .composer-quota-panel:popover-open') || (event.target instanceof Element && !!event.target.closest('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover], details[open]')),
            onHint: setHintTurn,
            onConfirm: () => latest.current.onConfirm(),
        });
    }, [turn]);
    return { touchEnter, actionHint: !!turn && hintTurn === turn };
}

