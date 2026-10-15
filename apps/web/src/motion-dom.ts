import { animateIn, duration, ease, gsap, installInteractionMotion, reducedMotion, type Preset } from './motion';

/**
 * Document-level motion: entrances for content that appears after the first paint, dialog and
 * panel reveals, ambient loops and the sidebar width. Keeps components free of animation code.
 */
const entrances: { selector: string; preset: Preset; vars?: gsap.TweenVars }[] = [
    { selector: '.message', preset: 'rise' },
    { selector: '.activity-list > *, .activity-row', preset: 'rise' },
    { selector: '.prompt-queue, .prompt-queue li', preset: 'rise' },
    { selector: '.approvals .approval', preset: 'pop' },
    { selector: '.task-card', preset: 'rise' },
    { selector: '.session-row, .project-group', preset: 'rise', vars: { duration: 0.22 } },
    { selector: '.image-drafts > *, .image-error', preset: 'pop' },
    { selector: '.empty', preset: 'rise', vars: { duration: 0.4 } },
    { selector: '.error, [role="alert"], .history-error, .conversation-feedback > *', preset: 'drop' },
    { selector: '.question-dock, .question-panel', preset: 'rise' },
];
const bulkLimit = 8, settleMs = 700, started = typeof performance !== 'undefined' ? performance.now() : 0;
const ambient = new WeakMap<Element, gsap.core.Tween>();

function ambientSync(root: ParentNode): void {
    for (const orbit of root.querySelectorAll<SVGElement>('.agent-indicator .work-orbit')) {
        const active = orbit.closest('.agent-indicator')?.hasAttribute('data-animate') === true && !reducedMotion(), tween = ambient.get(orbit);
        if (active && !tween) ambient.set(orbit, gsap.to(orbit, { rotation: 360, svgOrigin: '8 8', duration: 1.7, ease: 'none', repeat: -1 }));
        if (!active && tween) { tween.kill(); ambient.delete(orbit); gsap.set(orbit, { clearProps: 'transform' }); }
    }
    for (const dot of root.querySelectorAll<HTMLElement>('.lead-progress-dot')) {
        const active = dot.closest('.lead-progress')?.getAttribute('data-phase') !== 'idle' && !reducedMotion(), tween = ambient.get(dot);
        if (active && !tween) ambient.set(dot, gsap.to(dot, { opacity: 0.35, scale: 0.8, duration: 0.7, ease: ease.soft, repeat: -1, yoyo: true }));
        if (!active && tween) { tween.kill(); ambient.delete(dot); gsap.set(dot, { clearProps: 'opacity,transform' }); }
    }
}

function reveal(element: HTMLElement, preset: Preset, vars?: gsap.TweenVars): void {
    if (element instanceof HTMLDialogElement) {
        animateIn(element, element.classList.contains('session-drawer') ? 'slide-left' : 'pop', { duration: duration.base });
        gsap.fromTo(element, { '--backdrop-o': 0 }, { '--backdrop-o': 1, duration: duration.base, ease: ease.out });
        return;
    }
    animateIn(element, preset, vars);
}

export function installMotion(root: Document = document): () => void {
    if (typeof window === 'undefined') return () => {};
    const stopInteractions = installInteractionMotion(root);
    const observer = new MutationObserver(records => {
        const settled = performance.now() - started > settleMs && root.visibilityState !== 'hidden';
        const entered = new Map<number, Set<HTMLElement>>();
        const wanted = (index: number) => entered.get(index) ?? entered.set(index, new Set()).get(index)!;
        for (const record of records) {
            if (record.type === 'attributes') {
                const target = record.target as HTMLElement;
                if (record.attributeName === 'open' && target instanceof HTMLDialogElement && target.open && record.oldValue === null && !reducedMotion()) reveal(target, 'pop');
                else if (record.attributeName === 'hidden' && !target.hidden && record.oldValue !== null && target.classList.contains('workspace-panel') && settled) animateIn(target, 'rise', { duration: duration.fast });
                else if (record.attributeName === 'aria-selected' && target.getAttribute('role') === 'tab' && target.getAttribute('aria-selected') === 'true' && settled && !reducedMotion()) gsap.fromTo(target, { scale: 0.92 }, { scale: 1, duration: duration.base, ease: ease.spring, clearProps: 'transform', overwrite: 'auto' });
                else if (record.attributeName === 'class' && target.classList.contains('workbench') && settled && !reducedMotion()) {
                    const was = (record.oldValue ?? '').split(/\s+/).includes('sidebar-collapsed'), now = target.classList.contains('sidebar-collapsed');
                    if (was !== now) gsap.fromTo(target, { gridTemplateColumns: `${was ? 60 : 224}px minmax(0px, 1fr)` }, { gridTemplateColumns: `${now ? 60 : 224}px minmax(0px, 1fr)`, duration: duration.base, ease: ease.out, clearProps: 'gridTemplateColumns' });
                }
                continue;
            }
            if (!settled) continue;
            for (const node of record.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                entrances.forEach(({ selector }, index) => {
                    if (node.matches(selector)) wanted(index).add(node);
                    for (const child of node.querySelectorAll<HTMLElement>(selector)) wanted(index).add(child);
                });
            }
        }
        // A large batch is a history load or session switch, not something new arriving.
        const done = new Set<HTMLElement>();
        entered.forEach((nodes, index) => {
            const { preset, vars } = entrances[index]!, fresh = [...nodes].filter(node => node.isConnected && !done.has(node) && !node.closest('[data-no-motion]'));
            if (!fresh.length || fresh.length > bulkLimit) return;
            fresh.forEach(node => done.add(node));
            fresh.forEach((node, order) => reveal(node, preset, { ...vars, delay: Math.min(order, 4) * 0.04 }));
        });
        ambientSync(root);
    });
    observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['open', 'hidden', 'data-animate', 'data-phase', 'aria-selected', 'class'] });
    ambientSync(root);
    return () => { observer.disconnect(); stopInteractions(); };
}
