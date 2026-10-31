import { gsap } from './motion';

/** A single phase owns both opposite border highlights, including after a resize. */
export function attachComposerFocus(input: HTMLTextAreaElement) {
    const composer = input.closest<HTMLElement>('.composer');
    if (!composer) return () => {};
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('composer-focus-light'); svg.setAttribute('aria-hidden', 'true');
    // Broad, smooth modulation is masked to the actual one-pixel border band.
    const gradientId = `composer-sheen-${crypto.randomUUID()}`;
    const defs = document.createElementNS(ns, 'defs');
    const gradient = document.createElementNS(ns, 'radialGradient');
    gradient.id = gradientId;
    for (const [offset, opacity] of [['0%', '.48'], ['45%', '.26'], ['100%', '0']]) {
        const stop = document.createElementNS(ns, 'stop');
        stop.setAttribute('offset', offset!); stop.setAttribute('stop-color', 'currentColor');
        stop.setAttribute('stop-opacity', opacity!); gradient.append(stop);
    }
    const mask = document.createElementNS(ns, 'mask');
    mask.id = `${gradientId}-band`; mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const path = document.createElementNS(ns, 'rect');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'white'); path.setAttribute('stroke-width', '1');
    mask.append(path); defs.append(gradient, mask); svg.append(defs);
    const band = document.createElementNS(ns, 'g');
    band.setAttribute('mask', `url(#${mask.id})`); svg.append(band);
    const pools = [0, .5].map(() => {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', '90'); circle.setAttribute('fill', `url(#${gradientId})`);
        band.append(circle); return circle;
    });
    composer.append(svg); composer.classList.add('composer-focus-ready');
    const phase = { value: 0 };
    let tween: gsap.core.Tween | undefined, intersecting = true;
    const media = ['(prefers-reduced-motion: reduce)', '(forced-colors: active)', '(prefers-contrast: more)'].map(query => matchMedia(query));
    const paint = () => {
        const length = path.getTotalLength();
        if (!length) return;
        pools.forEach((pool, index) => {
            const point = path.getPointAtLength(((phase.value / 100 + index / 2) % 1) * length);
            pool.setAttribute('cx', String(point.x)); pool.setAttribute('cy', String(point.y));
        });
    };
    const stop = () => { tween?.kill(); tween = undefined; };
    const update = () => {
        const focused = document.activeElement === input;
        if (composer.classList.contains('composer-input-focused') !== focused) composer.classList.toggle('composer-input-focused', focused);
        const active = focused && !document.hidden && intersecting && input.getClientRects().length > 0 && !input.closest('[hidden], [inert]');
        svg.style.visibility = active && !media.some(query => query.matches) ? 'visible' : 'hidden';
        if (!active || media.some(query => query.matches)) { stop(); return; }
        if (!tween) tween = gsap.to(phase, {value:phase.value+100, duration:18, repeat:-1, ease:'none', onUpdate:paint});
    };
    const resize = new ResizeObserver(() => {
        const width = composer.offsetWidth, height = composer.offsetHeight;
        const radius = Math.max(0, parseFloat(getComputedStyle(composer).borderTopLeftRadius)-.5);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        [path].forEach(path => { path.setAttribute('x','.5'); path.setAttribute('y','.5'); path.setAttribute('width',String(Math.max(0,width-1))); path.setAttribute('height',String(Math.max(0,height-1))); path.setAttribute('rx',String(radius)); });
        paint(); update();
    });
    resize.observe(composer);
    const intersection = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? false; update(); }); intersection.observe(composer);
    const mutations = new MutationObserver(update);
    for (let node: HTMLElement | null = composer; node; node = node.parentElement) mutations.observe(node,{attributes:true,attributeFilter:['hidden','inert','class']});
    input.addEventListener('focus',update); input.addEventListener('blur',update);
    document.addEventListener('visibilitychange',update); media.forEach(query=>query.addEventListener('change',update));
    update();
    return () => {
        stop(); resize.disconnect(); intersection.disconnect(); mutations.disconnect();
        input.removeEventListener('focus',update); input.removeEventListener('blur',update);
        document.removeEventListener('visibilitychange',update); media.forEach(query=>query.removeEventListener('change',update));
        svg.remove(); composer.classList.remove('composer-focus-ready','composer-input-focused');
    };
}
