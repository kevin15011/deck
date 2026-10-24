import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

/** Single entry point for UI motion: components ask for a preset instead of owning timelines. */
if (typeof window !== 'undefined') gsap.registerPlugin(Flip);

const isBrowser = typeof window !== 'undefined';
const useBrowserLayoutEffect = isBrowser ? useLayoutEffect : useEffect;

export const reducedMotion = (): boolean => isBrowser && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ease = { out: 'power3.out', in: 'power2.in', spring: 'back.out(1.6)', soft: 'power2.inOut' } as const;
export const duration = { instant: 0.12, fast: 0.18, base: 0.28, slow: 0.42 } as const;

export type Preset = 'fade' | 'rise' | 'pop' | 'slide-left' | 'slide-right' | 'drop';
const from: Record<Preset, gsap.TweenVars> = {
    fade: { opacity: 0 },
    rise: { opacity: 0, y: 10 },
    drop: { opacity: 0, y: -8 },
    pop: { opacity: 0, scale: 0.94, y: 4 },
    'slide-left': { opacity: 0, x: -24 },
    'slide-right': { opacity: 0, x: 24 },
};
const cleared = 'opacity,transform,x,y,scale';

export function animateIn(target: gsap.TweenTarget, preset: Preset = 'rise', vars: gsap.TweenVars = {}): gsap.core.Tween | undefined {
    if (!isBrowser || reducedMotion()) return;
    return gsap.fromTo(target, from[preset], { opacity: 1, x: 0, y: 0, scale: 1, duration: duration.base, ease: preset === 'pop' ? ease.spring : ease.out, clearProps: cleared, overwrite: 'auto', ...vars });
}
export function animateOut(target: gsap.TweenTarget, preset: Preset = 'fade', done?: () => void, vars: gsap.TweenVars = {}): void {
    if (!isBrowser || reducedMotion()) { done?.(); return; }
    const { opacity, ...rest } = from[preset];
    gsap.to(target, { ...rest, opacity: 0, duration: duration.fast, ease: ease.in, overwrite: 'auto', onComplete: done, ...vars });
}

/** Animates the element on mount; `enabled` false skips (e.g. history hydration). */
export function useAppear<T extends HTMLElement>(ref: RefObject<T | null>, preset: Preset = 'rise', enabled = true, vars?: gsap.TweenVars): void {
    useBrowserLayoutEffect(() => {
        const node = ref.current;
        if (!node || !enabled) return;
        const tween = animateIn(node, preset, vars);
        return () => { tween?.kill(); };
    }, []);
}

/** Animates every time `open` flips to true (menus, popovers, dialogs). */
export function useOpenAnimation<T extends HTMLElement>(ref: RefObject<T | null>, open: boolean, preset: Preset = 'pop', vars?: gsap.TweenVars): void {
    useBrowserLayoutEffect(() => {
        const node = ref.current;
        if (!node || !open) return;
        const tween = animateIn(node, preset, vars);
        return () => { tween?.kill(); };
    }, [open]);
}

/** Height-animated disclosure. Returns whether the content should remain mounted/visible. */
export function collapse(node: HTMLElement, open: boolean, onClosed?: () => void): void {
    gsap.killTweensOf(node);
    if (reducedMotion()) { gsap.set(node, { clearProps: 'height,opacity,overflow' }); if (!open) onClosed?.(); return; }
    if (open) {
        gsap.fromTo(node, { height: 0, opacity: 0, overflow: 'hidden' }, { height: 'auto', opacity: 1, duration: duration.base, ease: ease.out, clearProps: 'height,opacity,overflow' });
    } else {
        gsap.to(node, { height: 0, opacity: 0, overflow: 'hidden', duration: duration.fast, ease: ease.in, onComplete: () => { gsap.set(node, { clearProps: 'height,opacity,overflow' }); onClosed?.(); } });
    }
}

/**
 * Smoothly relocates children of a container whenever `key` changes (reorder, insert, remove).
 * State is captured after each render and replayed with GSAP Flip on the next.
 */
export function useFlip<T extends HTMLElement>(ref: RefObject<T | null>, key: unknown, selector = ':scope > *'): void {
    const state = useRef<Flip.FlipState | null>(null);
    const previousKey = useRef(key);
    useBrowserLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const targets = Array.from(node.querySelectorAll<HTMLElement>(selector));
        if (state.current && previousKey.current !== key && !reducedMotion()) {
            Flip.from(state.current, { targets, duration: duration.base, ease: ease.out, absolute: false, overwrite: 'auto', onEnter: els => gsap.fromTo(els, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: duration.base, clearProps: 'opacity,transform' }), onLeave: els => gsap.to(els, { opacity: 0, duration: duration.fast }) });
        }
        previousKey.current = key;
        state.current = Flip.getState(targets);
    });
}

export { gsap, Flip };
