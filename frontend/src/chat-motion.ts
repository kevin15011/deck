import {gsap} from 'gsap';
import {useLayoutEffect, useRef, useState, type RefObject} from 'react';
import type {Receipt} from './api';

const reducedMotion = '(prefers-reduced-motion: reduce)';
const revealMs = 72;

function revealBoundary(text: string, length: number) {
    // Prefer a word boundary without scanning an entire token (code and URLs
    // can be long). Even the fallback must keep a UTF-16 pair intact.
    const whitespace = text.slice(length, length + 20).search(/\s/);
    if (whitespace >= 0) return length + whitespace;
    const unit = text.charCodeAt(length - 1);
    return unit >= 0xd800 && unit <= 0xdbff ? length + 1 : length;
}

export function useLiveLeadText(text: string, live: boolean, attempt: Receipt['attempt'], revealOnMount: boolean) {
    const initialText = revealOnMount ? '' : text;
    const [revealed, setRevealed] = useState(initialText);
    const last = useRef({text: initialText, attempt});
    const batch = useRef<{length: number; deadline: number} | undefined>(undefined);

    useLayoutEffect(() => {
        const previous = last.current;
        last.current = {text, attempt};
        let timer: number;
        const flush = () => {
            clearTimeout(timer);
            batch.current = undefined;
            setRevealed(text);
        };
        // Admission can render an empty receipt before its native attempt
        // exists. The first output still belongs to this live exchange.
        if (!live || (previous.text && previous.attempt !== attempt) ||
            !text.startsWith(previous.text) || (!batch.current && text.length - previous.text.length < 16)) {
            flush();
            return;
        }
        const media = matchMedia(reducedMotion);
        if (media.matches) {
            flush();
            return;
        }

        const now = performance.now();
        const pending = batch.current ??= {length: previous.text.length, deadline: now + revealMs};
        const frame = () => {
            const remaining = pending.deadline - performance.now();
            if (remaining <= 0 || document.hidden) {
                flush();
                return;
            }
            const progress = Math.max(1 / 3, 1 - remaining / revealMs);
            const length = pending.length + Math.ceil((text.length - pending.length) * progress);
            const prefix = text.slice(0, revealBoundary(text, length));
            setRevealed(shown => prefix.length > shown.length ? prefix : shown);
            timer = window.setTimeout(frame, Math.min(26, remaining));
        };
        const motionChanged = () => { if (media.matches) flush(); };
        media.addEventListener('change', motionChanged);
        document.addEventListener('visibilitychange', flush);
        frame();
        return () => {
            clearTimeout(timer);
            media.removeEventListener('change', motionChanged);
            document.removeEventListener('visibilitychange', flush);
        };
    }, [text, live, attempt]);

    // Terminal snapshots and corrected output bypass any pending reveal.
    return live && text.startsWith(revealed) ? revealed : text;
}

type LocalSend = {id: string; session: string; x: number; y: number; expires: number};

export function useSentMessageMotion(
    receipts: Receipt[] | undefined,
    session: string,
    visible: boolean,
    viewport: RefObject<HTMLElement | null>,
    following: RefObject<boolean>,
) {
    const send = useRef<LocalSend | undefined>(undefined);
    const stop = useRef<(() => void) | undefined>(undefined);

    useLayoutEffect(() => () => {
        send.current = undefined;
        stop.current?.();
    }, [session, visible]);

    useLayoutEffect(() => {
        const pending = send.current;
        if (!pending) return;
        if (pending.session !== session || !visible || performance.now() > pending.expires) {
            send.current = undefined;
            return;
        }
        const row = receipts?.find(r => r.id === pending.id && r.session === session);
        if (!row || row.phase === 'queued') return;
        send.current = undefined;
        const media = matchMedia(reducedMotion);
        const view = viewport.current;
        if (media.matches || document.hidden || !following.current || !view) return;
        const bubble = view.querySelector<HTMLElement>(`#exchange-${CSS.escape(row.id)} .user-message`);
        if (!bubble) return;
        const bounds = bubble.getBoundingClientRect();
        const viewBounds = view.getBoundingClientRect();
        if (!bounds.width || bounds.top < viewBounds.top || bounds.bottom > viewBounds.bottom) return;

        stop.current?.();
        // Fly a visual copy above the scroll viewport. Moving the transcript
        // element itself would clip the start and could change scrollHeight.
        const layer = document.createElement('div');
        layer.className = 'chat-send-flight';
        layer.inert = true;
        layer.setAttribute('aria-hidden', 'true');
        const visual = bubble.cloneNode(true) as HTMLElement;
        layer.append(visual);
        view.after(layer);
        const opacity = bubble.style.opacity;
        bubble.style.opacity = '0';
        gsap.set(visual, {left: bounds.left, top: bounds.top, width: bounds.width, transformOrigin: 'right center'});
        const scrollTop = view.scrollTop;
        const scrolled = () => { if (view.scrollTop !== scrollTop) finish(); };
        const finish = () => {
            tween.kill();
            layer.remove();
            bubble.style.opacity = opacity;
            view.removeEventListener('scroll', scrolled);
            bubble.removeEventListener('focusin', finish);
            window.removeEventListener('resize', finish);
            media.removeEventListener('change', finish);
            stop.current = undefined;
        };
        const tween = gsap.fromTo(visual, {
            x: pending.x - bounds.right,
            y: pending.y - (bounds.top + bounds.bottom) / 2,
            scale: .78,
            opacity: .28,
        }, {x: 0, y: 0, scale: 1, opacity: 1, duration: .24, ease: 'power3.out', onComplete: finish});
        stop.current = finish;
        view.addEventListener('scroll', scrolled, {passive: true});
        bubble.addEventListener('focusin', finish);
        window.addEventListener('resize', finish);
        media.addEventListener('change', finish);
    });

    return (id: string, session: string, button: HTMLElement | null | undefined) => {
        if (!button?.getClientRects().length || matchMedia(reducedMotion).matches) return;
        const bounds = button.getBoundingClientRect();
        send.current = {
            id, session, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
            expires: performance.now() + 2000,
        };
    };
}
