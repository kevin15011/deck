import { expect, test } from 'bun:test';
import { createThemeReveal } from './theme-reveal';

function deferred() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture(options: { reduced?: boolean; supported?: boolean; startFails?: boolean; animateFails?: boolean; waveAnimateFails?: boolean } = {}) {
    const attributes = new Set<string>(), transitions: ReturnType<typeof transition>[] = [], animations: { frames: Keyframe[]; options: KeyframeAnimationOptions; done: ReturnType<typeof deferred>; cancelled: boolean }[] = [];
    const timers: { callback: () => void; delay: number; cancelled: boolean }[] = [];
    const waves: { color: string; removed: boolean }[] = [];
    function transition(update: () => void) {
        const ready = deferred(), updated = deferred(), finished = deferred();
        const item = { ready: ready.promise, updateCallbackDone: updated.promise, finished: finished.promise, skipped: false, skipTransition() { item.skipped = true; }, update, signals: { ready, updated, finished } };
        return item;
    }
    const root = { dataset: { theme: 'dark' }, setAttribute(name: string) { attributes.add(name); }, removeAttribute(name: string) { attributes.delete(name); }, animate(frames: Keyframe[], settings: KeyframeAnimationOptions) {
        if (options.animateFails || (options.waveAnimateFails && settings.pseudoElement === '::view-transition-new(deck-theme-wave)')) throw new Error('animation unsupported');
        const item = { frames, options: settings, done: deferred(), cancelled: false }; animations.push(item);
        return { finished: item.done.promise, cancel() { item.cancelled = true; } };
    } };
    const env = { root, reducedMotion: () => !!options.reduced, viewport: () => ({ width: 1000, height: 800 }),
        start: options.supported === false ? undefined : (update: () => void) => { if (options.startFails) throw new Error('capture unavailable'); const item = transition(update); transitions.push(item); return item; },
        createWave: (color: string) => { const wave = {color, removed: false}; waves.push(wave); return () => {wave.removed = true;}; },
        schedule: (callback: () => void, delay: number) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    };
    return { motion: createThemeReveal(env), root, attributes, transitions, animations, timers, waves, options };
}
const bounds = { left: 850, top: 10, width: 100, height: 40 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('same theme does nothing; unsupported and reduced motion apply immediately without snapshots', () => {
    const same = fixture(); expect(same.motion.select('dark', bounds)).toBe(false); expect(same.transitions).toHaveLength(0);
    for (const options of [{ reduced: true }, { supported: false }]) {
        const f = fixture(options); expect(f.motion.select('green', bounds)).toBe(true);
        expect(f.root.dataset.theme).toBe('green'); expect(f.transitions).toHaveLength(0); expect(f.attributes.size).toBe(0);
    }
});

test('capture applies theme and reveals once from selector center to the furthest corner', async () => {
    const f = fixture(); f.motion.select('light', bounds);
    expect(f.root.dataset.theme).toBe('dark');
    const t = f.transitions[0]!; t.update(); t.signals.updated.resolve(); t.signals.ready.resolve(); await flush();
    expect(f.root.dataset.theme).toBe('light'); expect(f.animations).toHaveLength(1);
    const a = f.animations[0]!;
    expect(a.frames[0]!.clipPath).toBe('circle(0px at 900px 30px)');
    expect(a.frames[1]!.clipPath).toBe(`circle(${Math.hypot(900, 770)}px at 900px 30px)`);
    expect(a.options).toMatchObject({ duration: 1000, pseudoElement: '::view-transition-new(root)' });
    a.done.resolve(); await flush();
    expect(f.attributes.size).toBe(0); expect(t.skipped).toBe(true); expect(f.timers.every(timer => timer.cancelled)).toBe(true);
});

test('latest choice wins even when old capture callbacks, rejection and cleanup arrive late', async () => {
    const f = fixture(); f.motion.select('light', bounds); const old = f.transitions[0]!;
    f.motion.select('green', bounds); const current = f.transitions[1]!;
    expect(old.skipped).toBe(true); expect(f.motion.select('green', bounds)).toBe(false);
    current.update(); current.signals.updated.resolve(); current.signals.ready.resolve(); await flush();
    old.update(); old.signals.ready.reject(new Error('superseded')); old.signals.finished.resolve(); await flush();
    expect(f.root.dataset.theme).toBe('green'); expect(f.attributes.has('data-theme-reveal')).toBe(true); expect(f.animations).toHaveLength(1);
    f.animations[0]!.done.resolve(); await flush(); expect(f.attributes.size).toBe(0);
});

test('synchronous capture/animation failures leave the requested theme with no overlay marker', async () => {
    for (const options of [{ startFails: true }, { animateFails: true }]) {
        const f = fixture(options); f.motion.select('light', bounds);
        if (f.transitions[0]) { f.transitions[0].update(); f.transitions[0].signals.ready.resolve(); }
        await flush(); expect(f.root.dataset.theme).toBe('light'); expect(f.attributes.size).toBe(0);
    }
});

test('all rejected transition promises and animation rejection are handled', async () => {
    for (const branch of ['ready', 'updated', 'finished'] as const) {
        const f = fixture(); f.motion.select('green', bounds); f.transitions[0]!.signals[branch].reject(new Error(branch)); await flush();
        expect(f.root.dataset.theme).toBe('green'); expect(f.attributes.size).toBe(0);
        f.transitions[0]!.update(); expect(f.root.dataset.theme).toBe('green');
    }
    const f = fixture(); f.motion.select('light', bounds); f.transitions[0]!.signals.ready.resolve(); await flush();
    f.animations[0]!.done.reject(new Error('cancelled')); await flush(); expect(f.attributes.size).toBe(0);
});

test('interaction/resize cancellation and disposal invalidate pending updates and release snapshots', async () => {
    const f = fixture(); f.motion.select('light', bounds); const old = f.transitions[0]!;
    f.motion.cancel(); expect(f.root.dataset.theme).toBe('light'); expect(old.skipped).toBe(true); expect(f.attributes.size).toBe(0);
    f.motion.select('green', bounds); const current = f.transitions[1]!; f.motion.dispose();
    current.update(); old.update(); current.signals.ready.resolve(); await flush();
    expect(f.root.dataset.theme).toBe('green'); expect(f.animations).toHaveLength(0); expect(f.motion.select('dark', bounds)).toBe(false);
});

test('capture watchdog and a changed reduced-motion preference safely skip', async () => {
    const f = fixture(); f.motion.select('light', bounds); f.timers[0]!.callback();
    expect(f.root.dataset.theme).toBe('light'); expect(f.attributes.size).toBe(0); expect(f.transitions[0]!.skipped).toBe(true);
    const g = fixture(); g.motion.select('green', bounds); g.options.reduced = true; g.transitions[0]!.signals.ready.resolve(); await flush();
    expect(g.root.dataset.theme).toBe('green'); expect(g.animations).toHaveLength(0); expect(g.attributes.size).toBe(0);
});

test('late animation rejection, watchdog and finished callbacks cannot clean a newer running reveal', async () => {
    const f = fixture(); f.motion.select('light', bounds); const old = f.transitions[0]!;
    old.update(); old.signals.ready.resolve(); await flush(); const oldAnimation = f.animations[0]!;
    f.motion.select('green', bounds); const current = f.transitions[1]!;
    current.update(); current.signals.ready.resolve(); await flush();
    oldAnimation.done.reject(new Error('cancelled old animation')); old.signals.finished.reject(new Error('old capture ended'));
    for (const timer of f.timers.slice(0, 2)) timer.callback();
    await flush();
    expect(f.root.dataset.theme).toBe('green'); expect(f.attributes.has('data-theme-reveal')).toBe(true);
    expect(f.animations[1]!.cancelled).toBe(false);
    f.animations[1]!.done.resolve(); await flush(); expect(f.attributes.size).toBe(0);
});


test('only dark/green pairs have a destination accent wave, captured once and removed on completion/cancellation', async () => {
    for (const [source, target, color] of [['dark', 'green', '#93c9b1'], ['green', 'dark', '#ff7040'], ['dark', 'light', null], ['light', 'dark', null], ['light', 'green', null], ['green', 'light', null]] as const) {
        const f = fixture();
        if (source !== 'dark') { f.motion.select(source, bounds); f.motion.cancel(); }
        f.motion.select(target, bounds); const t = f.transitions.at(-1)!;
        t.update(); t.signals.ready.resolve(); await flush();
        const waveAnimations = f.animations.filter(a => a.options.pseudoElement === '::view-transition-new(deck-theme-wave)');
        expect(waveAnimations).toHaveLength(color ? 1 : 0);
        expect(f.waves).toHaveLength(color ? 1 : 0);
        if (color) {
            expect(f.waves[0]).toEqual({ color, removed: false });
            expect(waveAnimations[0]!.options).toMatchObject({ duration: 1000, easing: 'cubic-bezier(.22,.61,.36,1)' });
            expect(waveAnimations[0]!.frames[0]!.clipPath).toStartWith('polygon(evenodd,');
            expect(waveAnimations[0]!.frames[1]!.opacity).toBeGreaterThan(.4);
        }
        expect(f.timers.at(-1)!.delay).toBeGreaterThan(1000);
        f.motion.cancel();expect(f.animations.every(a => a.cancelled)).toBe(true);expect(f.waves.every(w => w.removed)).toBe(true);expect(f.attributes.size).toBe(0);
    }
});

test('wave capture and animation are removed on interruption, failure, reduced motion and stale callbacks', async () => {
    for (const action of ['cancel', 'dispose', 'reject', 'reduce'] as const) {
        const f = fixture(); f.motion.select('green', bounds);const t = f.transitions[0]!;t.update();
        expect(f.waves[0]!.removed).toBe(false);
        if(action==='cancel')f.motion.cancel();
        if(action==='dispose')f.motion.dispose();
        if(action==='reject')t.signals.ready.reject(new Error('capture failed'));
        if(action==='reduce'){f.options.reduced=true;t.signals.ready.resolve();}
        await flush();expect(f.waves[0]!.removed).toBe(true);expect(f.attributes.size).toBe(0);
    }
    const f=fixture();f.motion.select('green',bounds);const old=f.transitions[0]!;old.update();old.signals.ready.resolve();await flush();
    const oldWave=f.animations.find(a=>a.options.pseudoElement==='::view-transition-new(deck-theme-wave)')!;
    f.motion.select('dark',bounds);const current=f.transitions[1]!;current.update();current.signals.ready.resolve();await flush();
    oldWave.done.reject(new Error('old wave cancelled'));await flush();expect(f.attributes.has('data-theme-reveal')).toBe(true);
    expect(f.root.dataset.theme).toBe('dark');f.motion.cancel();expect(f.waves.every(w=>w.removed)).toBe(true);expect(f.animations.every(a=>a.cancelled)).toBe(true);
});


test('wave failure and natural reveal completion both cancel all animations and remove its surface', async () => {
    for(const action of ['throw', 'reject', 'complete'] as const) {
        const f=fixture({waveAnimateFails:action==='throw'});f.motion.select('green',bounds);const t=f.transitions[0]!;t.update();t.signals.ready.resolve();await flush();
        if(action==='reject')f.animations[1]!.done.reject(new Error('wave failed'));
        if(action==='complete')f.animations[0]!.done.resolve();
        await flush();expect(f.attributes.size).toBe(0);expect(f.waves.every(w=>w.removed)).toBe(true);expect(f.animations.every(a=>a.cancelled)).toBe(true);
    }
});
