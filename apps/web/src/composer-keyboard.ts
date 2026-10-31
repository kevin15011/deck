import { useEffect, useRef, useState } from 'react';
import type { PromptInbox, QueuedPrompt } from './prompt-queue';
import { hasOpenDismissLayer } from './dismiss-layer';

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
            blocked: event => hasOpenDismissLayer() || !!document.querySelector('dialog[open]') || (event.target instanceof Element && !!event.target.closest('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover], details[open]')),
            onHint: setHintTurn,
            onConfirm: () => latest.current.onConfirm(),
        });
    }, [turn]);
    return { touchEnter, actionHint: !!turn && hintTurn === turn };
}

export type EscapeAction = { kind: 'recall'; prompt: QueuedPrompt } | { kind: 'interrupt'; taskId: string };

/** Stop never selects queued input: only the interrupted attempt's pending prompt. */
export async function interruptAndRecall({active,interrupt,readInbox,recall}: {
    active?: PromptInbox['active'];
    interrupt(): Promise<unknown>;
    readInbox(): Promise<PromptInbox>;
    recall(prompt: QueuedPrompt): Promise<'recalled' | 'already-started' | 'unconfirmed'>;
}): Promise<'interrupted' | 'recalled' | 'already-started' | 'unconfirmed'> {
    await interrupt();
    if (active?.handoff !== 'pending') return 'interrupted';
    // Interruption settles asynchronously. The server queue, not a local flag,
    // proves that the original attempt ended without claiming its input.
    for (let attempt=0;attempt<50;attempt++) {
        const inbox=await readInbox();
        const requeued=inbox.queued.find(prompt=>prompt.promptId===active.promptId && prompt.requeued);
        if (requeued && inbox.paused) return recall(requeued);
        if (inbox.active?.promptId!==active.promptId || inbox.active.handoff!=='pending') return 'interrupted';
        await new Promise(resolve=>setTimeout(resolve,100));
    }
    return 'unconfirmed';
}

/** Only queued or explicitly gated pending input is recallable; native claims are final. */
export function chooseEscapeAction(queued: QueuedPrompt[], activeLeadTaskId?: string, active?: PromptInbox['active']): EscapeAction | undefined {
    const prompt = queued.at(-1);
    if (prompt) return { kind: 'recall', prompt };
    if (active?.handoff === 'pending' && typeof active.text === 'string') return { kind: 'recall', prompt: { ...active, text: active.text } };
    if (activeLeadTaskId) return { kind: 'interrupt', taskId: activeLeadTaskId };
}

export async function recallAndRestore({ sessionId, prompt, drafts, cancel, focus, restoreImages }: {
    sessionId: string;
    prompt: QueuedPrompt;
    drafts: { get(sessionId: string): string | undefined; set(sessionId: string, text: string): unknown };
    cancel(): Promise<unknown>;
    focus(text: string): void;
    restoreImages?(sessionId: string, attachments: NonNullable<QueuedPrompt['attachments']>): void;
}): Promise<'recalled' | 'already-started' | 'unconfirmed'> {
    let receipt: unknown;
    try { receipt = await cancel(); }
    catch (cause) {
        if (cause instanceof Error && (('code' in cause && cause.code === 'prompt-already-started') || cause.message === 'prompt-already-started')) return 'already-started';
        throw cause;
    }
    if (!receipt || typeof receipt !== 'object' || !('promptId' in receipt) || receipt.promptId !== prompt.promptId || !('state' in receipt) || receipt.state !== 'cancelled') return 'unconfirmed';
    // Read after acknowledgement, so edits made during the request are preserved too.
    const draft = drafts.get(sessionId) ?? '';
    const text = prompt.text + (draft ? (prompt.text ? '\n\n' : '') + draft : '');
    if (prompt.attachments?.length) restoreImages?.(sessionId, prompt.attachments);
    drafts.set(sessionId, text);
    focus(text);
    return 'recalled';
}
