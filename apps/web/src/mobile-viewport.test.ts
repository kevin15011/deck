import { expect, test } from 'bun:test';
import { installMobileViewport } from './mobile-viewport';

function fixture(supported = true) {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    const media = Object.assign(new EventTarget(), { matches: true });
    const host = Object.assign(new EventTarget(), {
        visualViewport: supported ? viewport : null,
        matchMedia: () => media,
        requestAnimationFrame(callback: FrameRequestCallback) { pending.set(++next, callback); return next; },
        cancelAnimationFrame(id: number) { pending.delete(id); },
    });
    let next = 0;
    const pending = new Map<number, FrameRequestCallback>(), values = new Map<string, string>();
    const root = { style: { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) } };
    const dispose = installMobileViewport(root as unknown as HTMLElement, host as unknown as Window);
    const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(0)); };
    return { viewport, media, host, values, pending, flush, dispose };
}

test('keyboard resize and browser pan keep the mobile shell inside the visible area, including while idle', () => {
    const f = fixture();
    expect(f.values.get('--mobile-viewport-height')).toBe('844px');
    f.viewport.height = 420; f.viewport.offsetTop = 48;
    f.viewport.dispatchEvent(new Event('resize')); f.viewport.dispatchEvent(new Event('scroll'));
    expect(f.pending.size).toBe(1); f.flush();
    expect(f.values.get('--mobile-viewport-height')).toBe('420px');
    expect(f.values.get('--mobile-viewport-top')).toBe('48px');
    f.flush(); expect(f.values.get('--mobile-viewport-height')).toBe('420px');
    f.viewport.height = 844; f.viewport.offsetTop = 0; f.viewport.dispatchEvent(new Event('resize')); f.flush();
    expect(f.values.get('--mobile-viewport-height')).toBe('844px');
    expect(f.values.get('--mobile-viewport-top')).toBe('0px'); f.dispose();
});

test('desktop and pinch zoom retain native sizing; returning to mobile resynchronizes', () => {
    const f = fixture();
    f.media.matches = false; f.media.dispatchEvent(new Event('change')); f.flush(); expect(f.values.size).toBe(0);
    f.media.matches = true; f.media.dispatchEvent(new Event('change')); f.flush(); expect(f.values.size).toBe(2);
    f.viewport.scale = 2; f.viewport.dispatchEvent(new Event('resize')); f.flush(); expect(f.values.size).toBe(0);
    f.viewport.scale = 1; f.viewport.height = 390; f.host.dispatchEvent(new Event('resize')); f.flush();
    expect(f.values.get('--mobile-viewport-height')).toBe('390px'); f.dispose();
});

test('unavailable or transient invalid viewport measurements retain CSS fallback', () => {
    const missing = fixture(false); expect(missing.values.size).toBe(0); missing.dispose();
    const f = fixture(); f.viewport.height = 0; f.viewport.dispatchEvent(new Event('resize')); f.flush(); expect(f.values.size).toBe(0);
    f.viewport.height = NaN; f.viewport.dispatchEvent(new Event('resize')); f.flush(); expect(f.values.size).toBe(0);
    f.viewport.height = 420; f.viewport.offsetTop = -5; f.viewport.dispatchEvent(new Event('resize')); f.flush();
    expect(f.values.get('--mobile-viewport-top')).toBe('0px'); f.dispose();
});

test('cleanup cancels queued work and removes listeners and sizing overrides', () => {
    const f = fixture(); f.viewport.dispatchEvent(new Event('resize')); expect(f.pending.size).toBe(1);
    f.dispose(); expect(f.pending.size).toBe(0); expect(f.values.size).toBe(0);
    f.viewport.dispatchEvent(new Event('scroll')); f.host.dispatchEvent(new Event('resize')); f.media.dispatchEvent(new Event('change')); f.flush();
    expect(f.pending.size).toBe(0); expect(f.values.size).toBe(0);
});
