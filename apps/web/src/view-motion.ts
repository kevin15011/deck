import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap, reducedMotion } from './motion';

/** A persistent paint layer follows the active control without moving its text or hit target. */
export function useActiveIndicator(ref: RefObject<HTMLElement | null>, key: unknown, selector: string, available = true) {
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;
        const indicator = document.createElement('span');
        indicator.className = 'moving-active-indicator'; indicator.setAttribute('aria-hidden', 'true'); root.prepend(indicator);
        let initialized = false;
        const update = () => {
            const active = root.querySelector<HTMLElement>(selector);
            if (!active) { indicator.style.visibility = 'hidden'; return; }
            indicator.style.visibility = 'visible';
            const box = active.getBoundingClientRect(), parent = root.getBoundingClientRect();
            const vars = { x: box.left-parent.left-root.clientLeft, y: box.top-parent.top-root.clientTop, width: box.width, height: box.height };
            gsap.killTweensOf(indicator);
            if (!initialized || reducedMotion()) gsap.set(indicator, vars);
            else gsap.to(indicator, { ...vars, duration: .36, ease: 'power3.out', overwrite: true });
            initialized = true;
        };
        const resize = new ResizeObserver(update); resize.observe(root);
        root.querySelectorAll('button').forEach(button => resize.observe(button));
        const mutations = new MutationObserver(update); mutations.observe(root, {subtree:true, attributes:true, attributeFilter:['aria-selected','aria-pressed']});
        const media = matchMedia('(prefers-reduced-motion: reduce)'); media.addEventListener('change', update);
        update();
        return () => { resize.disconnect(); mutations.disconnect(); media.removeEventListener('change', update); gsap.killTweensOf(indicator); indicator.remove(); };
    }, [ref, selector, available]);
}

/** Owns only the panel containers; children, their state and scroll offsets stay mounted. */
export function useViewMotion(ref: RefObject<HTMLElement | null>, key: unknown) {
    const previous = useRef<unknown>(key);
    const scrollPositions = useRef(new Map<HTMLElement, {top:number;left:number}>());
    const visibility = useRef(new Map<HTMLElement, boolean>());
    const boxes = useRef(new Map<HTMLElement, {left:number;top:number;width:number;height:number}>());
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;
        const panels = Array.from(root.querySelectorAll<HTMLElement>('.chat-pane, .workspace-pane, .workspace-panel'));
        if (previous.current !== key) {
            for (const panel of panels) {
                const wasVisible = visibility.current.get(panel), visible = !panel.hidden && !panel.parentElement?.closest('[hidden]');
                // A tab change must not replay entrance motion on its still-visible ancestors.
                if (visible && wasVisible) continue;
                gsap.killTweensOf(panel);
                panel.removeAttribute('data-view-exiting'); gsap.set(panel,{clearProps:'left,top,width,height'}); panel.inert = !!panel.hidden;
                if (reducedMotion()) { gsap.set(panel, {clearProps:'opacity,transform,left,top,width,height'}); continue; }
                if (!visible) {
                    if (panel.hidden && wasVisible) {
                        panel.setAttribute('data-view-exiting',''); panel.setAttribute('aria-hidden','true');
                        const box=boxes.current.get(panel); if(box) gsap.set(panel,box);
                        gsap.to(panel, {opacity:0, x:-8, duration:.3, ease:'power3.out', overwrite:true, onComplete:()=>{
                            panel.removeAttribute('data-view-exiting'); panel.removeAttribute('aria-hidden'); gsap.set(panel,{clearProps:'opacity,transform,left,top,width,height'});
                        }});
                    } else gsap.set(panel, {clearProps:'opacity,transform,left,top,width,height'});
                    continue;
                }
                panel.removeAttribute('aria-hidden');
                if (wasVisible === false) for (const [node, position] of scrollPositions.current) if (panel.contains(node)) node.scrollTo(position.left, position.top);
                // A reversal continues from live opacity/translation rather than resetting its start.
                if (!panel.style.opacity) gsap.set(panel, {opacity:.45, x:8});
                gsap.to(panel, {opacity:1, x:0, duration:.36, ease:'power3.out', overwrite:true, clearProps:'opacity,transform,left,top,width,height'});
            }
        }
        for (const panel of panels) if (!panel.hidden) boxes.current.set(panel,{left:panel.offsetLeft,top:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight});
        for (const panel of panels) visibility.current.set(panel, !panel.hidden && !panel.parentElement?.closest('[hidden]'));
        previous.current = key;
    }, [key]);
    useLayoutEffect(() => {
        const root = ref.current; if (!root) return;
        const rememberScroll = (event: Event) => { const node=event.target; if(node instanceof HTMLElement && !node.closest('[hidden]')) scrollPositions.current.set(node,{top:node.scrollTop,left:node.scrollLeft}); };
        root.addEventListener('scroll',rememberScroll,true);
        const resize = new ResizeObserver(() => {
            for (const panel of root.querySelectorAll<HTMLElement>('.chat-pane, .workspace-pane, .workspace-panel')) if (!panel.hidden && !panel.parentElement?.closest('[hidden]')) boxes.current.set(panel,{left:panel.offsetLeft,top:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight});
        });
        root.querySelectorAll('.chat-pane, .workspace-pane, .workspace-panel').forEach(panel=>resize.observe(panel));
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        const settle = () => { if (media.matches) for (const panel of root.querySelectorAll('.chat-pane, .workspace-pane, .workspace-panel')) { gsap.killTweensOf(panel); panel.removeAttribute('data-view-exiting'); panel.removeAttribute('aria-hidden'); gsap.set(panel, {clearProps:'opacity,transform,left,top,width,height'}); } };
        media.addEventListener('change', settle);
        return () => { resize.disconnect(); root.removeEventListener('scroll',rememberScroll,true); media.removeEventListener('change', settle); for (const panel of root.querySelectorAll('.chat-pane, .workspace-pane, .workspace-panel')) gsap.killTweensOf(panel); };
    }, [ref]);
}

/** Reversible height disclosure; accessibility changes immediately, painting may finish afterward. */
export function useDisclosureMotion(ref: RefObject<HTMLElement | null>, open: boolean) {
    const initial = useRef(true);
    const settled = useRef<boolean | null>(open);
    useLayoutEffect(() => {
        const node = ref.current; if (!node) return;
        gsap.killTweensOf(node);
        node.inert = !open; node.setAttribute('aria-hidden', String(!open));
        const settle = () => { gsap.killTweensOf(node); node.hidden = !open; settled.current = open; gsap.set(node, {clearProps:'height,opacity,overflow'}); };
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        if (initial.current || media.matches) { initial.current = false; settle(); }
        else {
            // React has already committed hidden={false} when opening. Only a settled
            // closed disclosure starts at zero; interrupted motion keeps its live height.
            if (open && settled.current === false) { node.hidden = false; gsap.set(node, {height:0,opacity:0}); }
            node.hidden = false;
            settled.current = null;
            gsap.to(node, {height:open ? node.scrollHeight : 0, opacity:open ? 1 : 0, overflow:'hidden', duration:.36, ease:'power3.out', overwrite:true, onComplete:settle});
        }
        const change = () => { if (media.matches) settle(); }; media.addEventListener('change', change);
        return () => { media.removeEventListener('change', change); gsap.killTweensOf(node); };
    }, [open]);
}
