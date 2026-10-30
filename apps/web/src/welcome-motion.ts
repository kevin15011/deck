import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap, reducedMotion } from './motion';

/** Move the existing dock; never reparent the focused input or postpone delivery. */
export function useWelcomeMotion(ref: RefObject<HTMLDivElement | null>, welcome: boolean, session: string): void {
    const previous = useRef({ session, welcome: false });
    useLayoutEffect(() => {
        const dock = ref.current, pane = dock?.parentElement;
        const greeting = pane?.querySelector<HTMLElement>('.conversation-welcome');
        if (!dock || !pane || !greeting) return;
        const sameSession = previous.current.session === session;
        const changed = previous.current.welcome !== welcome;
        previous.current = { session, welcome };
        let dockTween: gsap.core.Tween | undefined, greetingTween: gsap.core.Tween | undefined;
        const place = (animate: boolean) => {
            dockTween?.kill(); greetingTween?.kill();
            const currentY = Number(gsap.getProperty(dock, 'y')) || 0;
            const baseTop = dock.getBoundingClientRect().top - currentY;
            const targetTop = Math.min(greeting.getBoundingClientRect().bottom - (Number(gsap.getProperty(greeting, 'y')) || 0) + 24,
                pane.getBoundingClientRect().bottom - dock.offsetHeight - 12);
            const y = welcome ? Math.min(0, targetTop - baseTop) : 0;
            const visible = welcome && pane.clientHeight > greeting.offsetHeight + dock.offsetHeight + 64;
            greeting.inert = !visible;
            pane.toggleAttribute('data-welcome', visible);
            if (!animate || reducedMotion()) {
                gsap.set(dock, { y: visible ? y : 0 });
                gsap.set(greeting, { autoAlpha: visible ? 1 : 0, y: 0 });
                return;
            }
            dockTween = gsap.to(dock, { y: visible ? y : 0, duration: .44, ease: 'power3.inOut' });
            greetingTween = gsap.to(greeting, { autoAlpha: visible ? 1 : 0, y: visible ? 0 : -12,
                duration: visible ? .3 : .18, ease: 'power2.out' });
        };
        place(sameSession && changed);
        let dimensions = `${pane.clientWidth}:${pane.clientHeight}:${dock.offsetHeight}:${greeting.offsetHeight}`;
        const observer = new ResizeObserver(() => {
            const next = `${pane.clientWidth}:${pane.clientHeight}:${dock.offsetHeight}:${greeting.offsetHeight}`;
            if (next !== dimensions) { dimensions = next; place(false); }
        });
        observer.observe(pane); observer.observe(dock); observer.observe(greeting);
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const settle = () => place(false);
        media.addEventListener('change', settle);
        return () => { observer.disconnect(); media.removeEventListener('change', settle); dockTween?.kill(); greetingTween?.kill(); };
    }, [ref, welcome, session]);
    useLayoutEffect(() => () => {
        if (ref.current) gsap.set(ref.current, { clearProps: 'transform' });
    }, [ref]);
}
