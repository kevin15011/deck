import React, { useEffect, useRef } from 'react';
import { THEMES, resolveTheme, type Theme } from './theme';
import { createThemeReveal } from './theme-reveal';

export function ThemeSelect({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
    const reveal = useRef<ReturnType<typeof createThemeReveal> | null>(null);
    useEffect(() => {
        const cancel = () => reveal.current?.cancel();
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        // Live input/scroll takes precedence over a decorative frozen snapshot.
        const events = ['pointerdown', 'keydown', 'beforeinput', 'wheel', 'resize'] as const;
        for (const event of events) window.addEventListener(event, cancel, { capture: true, passive: true });
        document.addEventListener('visibilitychange', cancel);
        motion.addEventListener('change', cancel);
        return () => {
            for (const event of events) window.removeEventListener(event, cancel, true);
            document.removeEventListener('visibilitychange', cancel);
            motion.removeEventListener('change', cancel);
            reveal.current?.dispose();
            reveal.current = null;
        };
    }, []);
    return <select className="theme-select" aria-label="Theme" value={value} onChange={event => {
        const next = resolveTheme(event.currentTarget.value);
        const motion = reveal.current ??= createThemeReveal();
        if (motion.select(next, event.currentTarget.getBoundingClientRect())) onChange(next);
    }}>
        {THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
    </select>;
}
