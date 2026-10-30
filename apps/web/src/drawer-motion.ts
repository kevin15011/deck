import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap, reducedMotion } from './motion';

/** Keep native modal focus/dismissal while retaining the surface for its exit. */
export function useDrawerMotion(ref: RefObject<HTMLDialogElement | null>, open: boolean): void {
    const tween = useRef<gsap.core.Tween | undefined>(undefined);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        tween.current?.kill();
        if (open && !node.open) {
            gsap.set(node, { xPercent: -100, '--backdrop-o': 0 });
            node.showModal();
        }
        if (!node.open) return;
        const finish = () => {
            if (!open) node.close();
            gsap.set(node, { clearProps: 'transform,--backdrop-o' });
        };
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const settle = () => {
            if (!preference.matches) return;
            tween.current?.kill();
            tween.current = undefined;
            finish();
        };
        preference.addEventListener('change', settle);
        const cleanup = () => {
            preference.removeEventListener('change', settle);
            tween.current?.kill();
            tween.current = undefined;
        };
        if (reducedMotion()) { finish(); return cleanup; }
        tween.current = gsap.to(node, {
            xPercent: open ? 0 : -100, '--backdrop-o': open ? 1 : 0,
            duration: open ? .28 : .18, ease: 'power3.out', onComplete: finish,
        });
        return cleanup;
    }, [open, ref]);
    useLayoutEffect(() => () => { tween.current?.kill(); }, []);
}
