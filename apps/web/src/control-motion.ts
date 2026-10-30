import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { gsap } from 'gsap';

/** Paint-only transitions. Retarget with to(), retaining the live presentation value. */
export function createSurfaceMotion(node: HTMLElement, onHidden: () => void) {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const original = node.style.opacity;
    let tween: gsap.core.Tween | undefined, visible = false, disposed = false;
    const finish = () => { if (!visible && !disposed) onHidden(); };
    const update = (open: boolean) => {
        visible = open;
        tween?.kill();
        if (media.matches) {
            node.style.opacity = original;
            finish();
            return;
        }
        tween = gsap.to(node, { opacity: open ? 1 : 0, duration: open ? .36 : .14,
            ease: open ? 'power3.out' : 'power2.in', overwrite: 'auto', onComplete: finish });
    };
    // Only a fresh mount starts at zero. Reversals never reset the presentation.
    if (!media.matches) gsap.set(node, { opacity: 0 });
    const change = () => update(visible);
    media.addEventListener('change', change);
    return { update, dispose() {
        disposed = true;
        tween?.kill();
        media.removeEventListener('change', change);
        node.style.opacity = original;
    } };
}

/** Retain a closing surface for its fade; its owner controls focus and native presentation. */
export function useSurfacePresence<T extends HTMLElement>(ref: RefObject<T | null>, open: boolean) {
    const [present, setPresent] = useState(open);
    const motion = useRef<ReturnType<typeof createSurfaceMotion> | null>(null);
    const latest = useRef(open); latest.current = open;
    useLayoutEffect(() => {
        if (open && !present) setPresent(true);
    }, [open, present]);
    useLayoutEffect(() => {
        if (!present || !ref.current) return;
        const controller = createSurfaceMotion(ref.current, () => { if (!latest.current) setPresent(false); });
        motion.current = controller;
        return () => { controller.dispose(); motion.current = null; };
    }, [present]);
    useLayoutEffect(() => { motion.current?.update(open); }, [open, present]);
    return present;
}

/** Scoped feedback for real button descendants; no document observer or transform ownership. */
export function useControlFeedback<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true) {
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root || !enabled) return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const originals = new Map<HTMLButtonElement, string>();
        const tweens = new Map<HTMLButtonElement, gsap.core.Tween>();
        let pressed: HTMLButtonElement | undefined;
        const paint = (button: HTMLButtonElement, down: boolean) => {
            if (!originals.has(button)) originals.set(button, button.style.opacity);
            tweens.get(button)?.kill();
            if (media.matches) { button.style.opacity = originals.get(button)!; return; }
            tweens.set(button, gsap.to(button, { opacity: down ? .72 : 1, duration: .1,
                ease: 'power2.out', overwrite: 'auto', onComplete: () => {
                    if (!down) { button.style.opacity = originals.get(button)!; originals.delete(button); tweens.delete(button); }
                } }));
        };
        const release = () => { if (pressed) paint(pressed, false); pressed = undefined; };
        const down = (event: Event) => {
            if (event instanceof PointerEvent && event.button !== 0) return;
            if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return;
            const button = event.target instanceof Element ? event.target.closest('button') : null;
            if (!button || !root.contains(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            release(); pressed = button; paint(button, true);
        };
        const keyup = (event: KeyboardEvent) => { if (['Enter', ' '].includes(event.key)) release(); };
        const change = () => { release(); for (const [button, opacity] of originals) { tweens.get(button)?.kill(); button.style.opacity = opacity; } originals.clear(); tweens.clear(); };
        const focusout = (event: FocusEvent) => { if (event.target === pressed) release(); };
        root.addEventListener('pointerdown', down); root.addEventListener('keydown', down);
        root.addEventListener('focusout', focusout);
        window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
        window.addEventListener('keyup', keyup); window.addEventListener('blur', release);
        media.addEventListener('change', change);
        return () => {
            root.removeEventListener('pointerdown', down); root.removeEventListener('keydown', down); root.removeEventListener('focusout', focusout);
            window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
            window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release);
            media.removeEventListener('change', change);
            for (const tween of tweens.values()) tween.kill();
            for (const [button, opacity] of originals) button.style.opacity = opacity;
        };
    }, [enabled]);
}
