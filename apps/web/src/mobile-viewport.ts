/** Follow keyboard/browser chrome changes without touching focus, drafts or chat scroll. */
export function installMobileViewport(root: HTMLElement, host: Window = window): () => void {
    const viewport = host.visualViewport;
    if (!viewport) return () => {};
    const mobile = host.matchMedia('(max-width: 1000px)');
    let frame: number | undefined;
    const clear = () => {
        root.style.removeProperty('--mobile-viewport-height');
        root.style.removeProperty('--mobile-viewport-top');
    };
    const update = () => {
        frame = undefined;
        // Leave pinch zoom to the browser rather than reflowing content under the reader.
        if (!mobile.matches || Math.abs(viewport.scale - 1) > .01 || !Number.isFinite(viewport.height) || viewport.height <= 0 || !Number.isFinite(viewport.offsetTop)) {
            clear();
            return;
        }
        root.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
        root.style.setProperty('--mobile-viewport-top', `${Math.max(0, viewport.offsetTop)}px`);
    };
    const schedule = () => { if (frame === undefined) frame = host.requestAnimationFrame(update); };
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    host.addEventListener('resize', schedule);
    mobile.addEventListener('change', schedule);
    update();
    return () => {
        if (frame !== undefined) host.cancelAnimationFrame(frame);
        viewport.removeEventListener('resize', schedule);
        viewport.removeEventListener('scroll', schedule);
        host.removeEventListener('resize', schedule);
        mobile.removeEventListener('change', schedule);
        clear();
    };
}
