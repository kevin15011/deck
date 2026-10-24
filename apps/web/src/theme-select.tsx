import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { THEMES, type Theme } from './theme';
import { createThemeReveal } from './theme-reveal';

/** Owns one reveal controller; the circular reveal starts from the element that chose the theme. */
export function useThemeReveal(onChange: (theme: Theme) => void) {
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
    return useCallback((next: Theme, origin: Element) => {
        const motion = reveal.current ??= createThemeReveal();
        if (motion.select(next, origin.getBoundingClientRect())) onChange(next);
    }, [onChange]);
}

export function ThemeSwatch({ swatch }: { swatch: readonly [string, string] }) {
    return <svg className="theme-swatch" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill={swatch[0]} stroke="currentColor" strokeOpacity=".35"/>
        <path d="M8 1a7 7 0 0 1 0 14z" fill={swatch[1]}/>
    </svg>;
}

const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export function themeMatches(theme: { id: string; label: string }, query: string) {
    const needle = normalizeSearch(query);
    return normalizeSearch(theme.label).includes(needle) || normalizeSearch(theme.id).includes(needle);
}

/** Mounted outside navigation so closing the mobile drawer cannot hide the modal. */
export function ThemeDialog({ value, onChange, onClose }: { value: Theme; onChange: (theme: Theme) => void; onClose: () => void }) {
    const choose = useThemeReveal(onChange);
    const dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
    const id = useId(), [query, setQuery] = useState(''), [highlighted, setHighlighted] = useState<Theme>(value);
    const themes = THEMES.filter(theme => themeMatches(theme, query));
    const active = themes.find(theme => theme.id === highlighted)?.id ?? themes[0]?.id;
    useLayoutEffect(() => {
        const node = dialog.current!;
        node.showModal();
        search.current?.focus({ preventScroll: true });
        return () => node.close();
    }, []);
    useEffect(() => { list.current?.querySelector(`[data-theme-id="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
    const navigate = (event: React.KeyboardEvent) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.currentTarget === search.current && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key) || !themes.length) return;
        event.preventDefault();
        if (event.key === 'Enter') {
            const option = list.current?.querySelector<HTMLElement>(`[data-theme-id="${active}"]`);
            if (active && option) choose(active, option);
            return;
        }
        const index = themes.findIndex(theme => theme.id === active);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? themes.length - 1 :
            (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + themes.length) % themes.length;
        setHighlighted(themes[next]!.id);
    };
    return <dialog ref={dialog} className="workspace-dialog theme-dialog" aria-labelledby={`${id}-title`}
        onKeyDownCapture={event => {
            // Search inputs otherwise consume the first Escape just to clear their value.
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault(); event.stopPropagation(); onClose();
        }}
        onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
        }}>
        <div className="dialog-heading"><h2 id={`${id}-title`}>Theme</h2><button type="button" className="quiet" aria-label="Close theme picker" onClick={onClose}>✕</button></div>
        <input ref={search} autoFocus type="search" role="combobox" aria-label="Search themes" placeholder="Search themes"
            aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active ? `${id}-${active}` : undefined}
            value={query} onChange={event => setQuery(event.currentTarget.value)} onKeyDown={navigate}/>
        <div ref={list} id={`${id}-list`} className="theme-picker-list" role="listbox" aria-label="Themes" tabIndex={0}
            aria-activedescendant={active ? `${id}-${active}` : undefined} onKeyDown={navigate}>
            {themes.map(theme => <button key={theme.id} id={`${id}-${theme.id}`} data-theme-id={theme.id} type="button" role="option"
                tabIndex={-1} aria-selected={theme.id === value} className={`quiet theme-picker-option${theme.id === active ? ' highlighted' : ''}`}
                onFocus={() => setHighlighted(theme.id)} onClick={event => {
                    setHighlighted(theme.id);
                    // Keep keyboard focus on the composite so active-descendant changes are announced.
                    list.current?.focus({ preventScroll: true });
                    choose(theme.id, event.currentTarget);
                }}>
                <ThemeSwatch swatch={theme.swatch}/><span>{theme.label}</span>
                {theme.id === value && <svg className="theme-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>}
            </button>)}
        </div>
        {!themes.length && <p role="status" className="muted">No themes match</p>}
        <div className="dialog-actions"><button type="button" onClick={onClose}>Done</button></div>
    </dialog>;
}
