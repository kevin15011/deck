import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap, reducedMotion } from './motion';

/** Only live insertions are eligible; hydration and history paging never enqueue. */
export function useUserMessageMotion(root: RefObject<HTMLElement | null>, session: string) {
    const pending = useRef(new Map<string, Set<number>>());
    const active = useRef(new Map<HTMLElement, gsap.core.Tween>());
    useLayoutEffect(() => {
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        const settle = () => {
            for (const [node, tween] of active.current) {
                tween.kill();
                gsap.set(node, { clearProps: 'opacity,transform' });
            }
            active.current.clear();
        };
        media.addEventListener('change', settle);
        return () => { media.removeEventListener('change', settle); settle(); pending.current.clear(); };
    }, [session]);
    useLayoutEffect(() => {
        const ids = pending.current.get(session);
        pending.current.clear();
        if (!ids || reducedMotion() || document.visibilityState === 'hidden' || !root.current?.clientHeight) return;
        for (const id of ids) {
            const node = root.current.querySelector<HTMLElement>(`[data-history-id="${id}"] .message.user`);
            if (!node) continue;
            const tween = gsap.fromTo(node, { opacity: 0.35, y: 6 }, {
                opacity: 1, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'opacity,transform',
                onComplete: () => { active.current.delete(node); },
            });
            active.current.set(node, tween);
        }
        for (const [node, tween] of active.current) if (!node.isConnected) { tween.kill(); active.current.delete(node); }
    });
    return (owner: string, id: number) => {
        const ids = pending.current.get(owner) ?? new Set<number>();
        ids.add(id); pending.current.set(owner, ids);
    };
}
