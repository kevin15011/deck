import { resolveTheme, type Theme } from './theme';

type SnapshotTransition = {
    ready: Promise<unknown>;
    updateCallbackDone: Promise<unknown>;
    finished: Promise<unknown>;
    skipTransition(): void;
};
type RevealAnimation = { finished: Promise<unknown>; cancel(): void };
type Bounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
type Environment = {
    root: Pick<HTMLElement, 'dataset' | 'setAttribute' | 'removeAttribute'> & {
        animate?: (frames: Keyframe[], options: KeyframeAnimationOptions) => RevealAnimation;
    };
    start?: (update: () => void) => SnapshotTransition;
    createWave?: (color: string) => () => void;
    reducedMotion(): boolean;
    viewport(): { width: number; height: number };
    schedule?: (callback: () => void, delay: number) => () => void;
};
type Run = { transition?: SnapshotTransition; animation?: RevealAnimation; waveAnimation?: RevealAnimation; removeWave?: () => void; clearTimer?: () => void };
const duration = 1000;
const easing = 'cubic-bezier(.22,.61,.36,1)';

/** Equal point counts let WAAPI interpolate a thin annulus over one snapshot. */
function waveClip(x: number, y: number, radius: number): string {
    const circle = (r: number, reverse = false) => Array.from({ length: 97 }, (_, index) => {
        const angle = (reverse ? -index : index) * Math.PI / 48;
        return `${x + Math.cos(angle) * r}px ${y + Math.sin(angle) * r}px`;
    });
    return `polygon(evenodd,${[...circle(radius + 8), ...circle(Math.max(0, radius - 8), true)].join(',')})`;
}

function browserEnvironment(): Environment {
    return {
        root: document.documentElement,
        start: typeof document.startViewTransition === 'function' ? update => document.startViewTransition(update) : undefined,
        createWave: color => {
            const node = document.createElement('div');
            node.className = 'theme-reveal-wave';
            node.setAttribute('aria-hidden', 'true');
            node.style.backgroundColor = color;
            document.body.append(node);
            return () => node.remove();
        },
        reducedMotion: () => document.visibilityState === 'hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        viewport: () => ({ width: innerWidth, height: innerHeight }),
    };
}

/** Only snapshots animate. Identity guards keep superseded browser callbacks inert. */
export function createThemeReveal(env: Environment = browserEnvironment()) {
    const schedule = env.schedule ?? ((callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); });
    let requested = resolveTheme(env.root.dataset.theme), active: Run | undefined, disposed = false;
    function end(run: Run) {
        if (active !== run) return;
        active = undefined;
        run.clearTimer?.();
        run.animation?.cancel();
        run.waveAnimation?.cancel();
        run.removeWave?.();
        try { run.transition?.skipTransition(); } catch { /* A failed capture may already be gone. */ }
        env.root.removeAttribute('data-theme-reveal');
        env.root.dataset.theme = requested;
    }
    function cancel() { if (active) end(active); }
    return {
        select(theme: Theme, bounds: Bounds): boolean {
            if (disposed || theme === requested) return false;
            // Read geometry before changing theme/style or starting capture.
            const { width, height } = env.viewport();
            const x = Math.min(width, Math.max(0, bounds.left + bounds.width / 2));
            const y = Math.min(height, Math.max(0, bounds.top + bounds.height / 2));
            const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
            const source = requested;
            cancel();
            requested = theme;
            const waveColor = source === 'dark' && theme === 'green' ? '#93c9b1' : source === 'green' && theme === 'dark' ? '#ff7040' : undefined;
            if (!env.start || !env.root.animate || env.reducedMotion()) {
                env.root.dataset.theme = theme;
                return true;
            }
            const run: Run = {};
            active = run;
            env.root.setAttribute('data-theme-reveal', '');
            // Don't let a slow/failed capture hold a working chat behind snapshots.
            run.clearTimer = schedule(() => end(run), 180);
            try {
                const transition = env.start(() => {
                    if (active !== run || disposed) return;
                    env.root.dataset.theme = theme;
                    // Named capture separates this single decorative surface from chat snapshots.
                    if (waveColor) run.removeWave = env.createWave?.(waveColor);
                });
                run.transition = transition;
                void transition.updateCallbackDone.then(() => {}, () => end(run));
                void transition.finished.then(() => end(run), () => end(run));
                void transition.ready.then(() => {
                    if (active !== run || disposed) return;
                    if (env.reducedMotion()) { end(run); return; }
                    run.clearTimer?.();
                    run.clearTimer = schedule(() => end(run), duration + 600);
                    try {
                        run.animation = env.root.animate!([
                            { clipPath: `circle(0px at ${x}px ${y}px)` },
                            { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
                        ], { duration, easing, pseudoElement: '::view-transition-new(root)' });
                        void run.animation.finished.then(() => end(run), () => end(run));
                        if (run.removeWave) {
                            run.waveAnimation = env.root.animate!([
                                { clipPath: waveClip(x, y, 0), opacity: 0, offset: 0 },
                                { opacity: .65, offset: .12 },
                                { opacity: .5, offset: .75 },
                                { clipPath: waveClip(x, y, radius), opacity: 0, offset: 1 },
                            ], { duration, easing, pseudoElement: '::view-transition-new(deck-theme-wave)' });
                            void run.waveAnimation.finished.then(() => {}, () => end(run));
                        }
                    } catch { end(run); }
                }, () => end(run));
            } catch { end(run); }
            return true;
        },
        cancel,
        dispose() { cancel(); disposed = true; },
    };
}
