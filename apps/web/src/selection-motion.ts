import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';

/** One non-interactive canvas plane; navigation and focus never wait for its tween. */
export function createSelectionMotion(root: HTMLElement) {
    const owner = root.closest<HTMLElement>('.sidebar, .session-drawer');
    const scroll = root.querySelector<HTMLElement>('.navigation-scroll');
    if (!owner || !scroll) return { update() {}, dispose() {} };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    svg.classList.add('session-selection-plane');
    svg.setAttribute('aria-hidden', 'true'); svg.append(path); owner.append(svg);
    const fades = ['top','bottom'].map(edge => {
        const fade = document.createElement('span'); fade.className = `navigation-overflow-fade ${edge}`;
        fade.setAttribute('aria-hidden','true'); owner.append(fade); return fade;
    });
    const updateFades = () => {
        const viewport = scroll.getBoundingClientRect(), bounds = owner.getBoundingClientRect();
        const overflow = scroll.scrollHeight > scroll.clientHeight + 1;
        fades[0]!.style.top = `${viewport.top-bounds.top}px`;
        fades[1]!.style.top = `${viewport.bottom-bounds.top-10}px`;
        gsap.set(fades[0]!, {opacity: overflow && scroll.scrollTop > 1 ? 1 : 0});
        gsap.set(fades[1]!, {opacity: overflow && scroll.scrollTop+scroll.clientHeight < scroll.scrollHeight-1 ? 1 : 0});
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const paint = { x: 0, y: 0, width: 0, height: 0 };
    let lastTarget: typeof paint | undefined;
    let row: HTMLElement | null = null, tween: gsap.core.Tween | undefined, disposed = false;
    const draw = () => {
        const { x, y, width, height: h } = paint, right = x + width, r = Math.min(10, h / 2);
        path.setAttribute('d', `M${x+r},${y}H${right-r}Q${right},${y} ${right},${y-r}V${y+h+r}Q${right},${y+h} ${right-r},${y+h}H${x+r}Q${x},${y+h} ${x},${y+h-r}V${y+r}Q${x},${y} ${x+r},${y}Z`);
    };
    const update = (animate = true) => {
        if (disposed) return;
        updateFades();
        const next = root.querySelector<HTMLElement>('.session.selected')?.closest<HTMLElement>('.session-row') ?? null;
        const changed = next !== row;
        if (changed) { if (row) observer.unobserve(row); if (next) observer.observe(next); }
        const previous = row; row = next;
        const bounds = owner.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
        svg.style.clipPath = `inset(${Math.max(0, viewport.top-bounds.top)}px 0 ${Math.max(0, bounds.bottom-viewport.bottom)}px 0)`;
        const box = row?.getBoundingClientRect();
        if (!box || !box.height || !viewport.height || row?.closest('[hidden], [inert]') || !owner.getClientRects().length) {
            tween?.kill(); svg.style.visibility = 'hidden'; return;
        }
        const wasHidden = svg.style.visibility === 'hidden';
        svg.style.visibility = 'visible';
        const target = { x: box.left-bounds.left, y: box.top-bounds.top, width: owner.clientWidth-(box.left-bounds.left), height: box.height };
        // Layout/scroll changes track immediately; selection changes retarget the live shape.
        if (!changed && !wasHidden && lastTarget && Object.entries(target).every(([key, value]) => lastTarget![key as keyof typeof paint] === value) && !media.matches) return;
        lastTarget = target;
        tween?.kill();
        if (!animate || !previous || wasHidden || media.matches) { Object.assign(paint, target); draw(); }
        else tween = gsap.to(paint, { ...target, duration: .36, ease: 'power3.out', overwrite: 'auto', onUpdate: draw });
    };
    const layout = () => update(false);
    const observer = new ResizeObserver(layout);
    observer.observe(owner); observer.observe(scroll); if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', layout, { passive: true });
    window.addEventListener('resize', layout); media.addEventListener('change', layout);
    owner.addEventListener('toggle', layout);
    const content = new MutationObserver(layout); content.observe(scroll, {childList:true,subtree:true,characterData:true});
    update(false);
    return { update, dispose() {
        disposed = true; tween?.kill(); observer.disconnect(); content.disconnect(); fades.forEach(fade => fade.remove());
        scroll.removeEventListener('scroll', layout); window.removeEventListener('resize', layout);
        media.removeEventListener('change', layout); owner.removeEventListener('toggle', layout); svg.remove();
    } };
}

export function useSelectionMotion(ref: RefObject<HTMLElement | null>, collapsed: boolean) {
    const controller = useRef<ReturnType<typeof createSelectionMotion> | null>(null);
    useLayoutEffect(() => {
        if (!ref.current || collapsed) return;
        const motion = createSelectionMotion(ref.current); controller.current = motion;
        return () => { motion.dispose(); controller.current = null; };
    }, [collapsed]);
    useLayoutEffect(() => { controller.current?.update(); });
}
