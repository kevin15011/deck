import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Api } from './workspace';
import { NavigationIcon } from './project-navigation';

type Directory = { name: string; path: string };
export function DirectoryInput({ value, onChange, api, disabled = false }: { value: string; onChange: (value: string) => void; api: Api; disabled?: boolean }) {
    const id = useId(), input = useRef<HTMLInputElement>(null), field = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null);
    const request = useRef(0), controller = useRef<AbortController | undefined>(undefined), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pointerGesture = useRef(false);
    const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
    const [directories, setDirectories] = useState<Directory[]>([]), [active, setActive] = useState(-1), [truncated, setTruncated] = useState(false);
    const invalidate = useCallback(() => { ++request.current; clearTimeout(timer.current); controller.current?.abort(); }, []);
    const close = useCallback(() => { invalidate(); setOpen(false); setLoading(false); setActive(-1); setDirectories([]); setError(''); }, [invalidate]);
    useEffect(() => () => invalidate(), [invalidate]);
    useEffect(() => { if (disabled) close(); }, [disabled, close]);
    useEffect(() => {
        if (!open) return;
        // Inline suggestions must stay put through pointerdown/focus transfer until click.
        // Otherwise closing them moves form buttons away before pointerup can activate them.
        const start = (event: Event) => { pointerGesture.current = true; if (event.target instanceof Node && !field.current?.contains(event.target)) invalidate(); }, end = (event: Event) => { pointerGesture.current = false; if (event.type === 'pointercancel' && event.target instanceof Node && !field.current?.contains(event.target)) close(); };
        const outside = (event: Event) => { if (event.target instanceof Node && !field.current?.contains(event.target)) close(); };
        for (const name of ['pointerdown', 'mousedown']) document.addEventListener(name, start, true);
        for (const name of ['pointerup', 'mouseup', 'pointercancel']) document.addEventListener(name, end, true);
        document.addEventListener('click', outside, true);
        return () => {
            pointerGesture.current = false;
            for (const name of ['pointerdown', 'mousedown']) document.removeEventListener(name, start, true);
            for (const name of ['pointerup', 'mouseup', 'pointercancel']) document.removeEventListener(name, end, true);
            document.removeEventListener('click', outside, true);
        };
    }, [open, close, invalidate]);
    useEffect(() => { if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
    async function lookup(path: string, select?: 'first' | 'last') {
        invalidate(); const version = request.current, abort = new AbortController(); controller.current = abort;
        setOpen(true); setLoading(true); setError(''); setDirectories([]); setActive(-1); setTruncated(false);
        const at = path.lastIndexOf('/'), directory = at >= 0 ? path.slice(0, at + 1) : '', prefix = at >= 0 ? path.slice(at + 1) : path;
        const query = new URLSearchParams({ prefix, limit: '30', ...(directory ? { path: directory } : {}) });
        try {
            const reply = await api(`/api/directories?${query}`, { signal: abort.signal });
            if (version !== request.current || abort.signal.aborted) return;
            const items: Directory[] = Array.isArray(reply.data.directories) ? reply.data.directories.filter((item: Directory) => typeof item.name === 'string' && typeof item.path === 'string') : [];
            setDirectories(items); setTruncated(reply.data.truncated === true); setLoading(false);
            setActive(select && items.length ? select === 'last' ? items.length - 1 : 0 : -1);
        } catch {
            if (version !== request.current || abort.signal.aborted) return;
            setLoading(false); setError('Could not load folders. Check the directory and try again.');
        }
    }
    function type(path: string) {
        invalidate(); onChange(path); setOpen(true); setLoading(true); setDirectories([]); setActive(-1); setError(''); setTruncated(false);
        timer.current = setTimeout(() => void lookup(path), 150);
    }
    function choose(directory: Directory) {
        const path = `${directory.path.replace(/\/$/, '')}/`;
        onChange(path); input.current?.focus(); void lookup(path);
        requestAnimationFrame(() => { if (input.current?.value === path) input.current.setSelectionRange(path.length, path.length); });
    }
    return <div ref={field} className="directory-field" onBlur={event => { if (!pointerGesture.current && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); input.current?.focus(); return; }
        if (event.target !== input.current) return;
        if (event.ctrlKey && !event.metaKey && !event.altKey && (event.code === 'Space' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); void lookup(value); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { void lookup(value, event.key === 'ArrowDown' ? 'first' : 'last'); return; }
            if (directories.length) setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % directories.length : (previous < 0 ? directories.length - 1 : (previous - 1 + directories.length) % directories.length));
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); event.stopPropagation(); if (directories[active]) choose(directories[active]!); }
    }}>
        <label htmlFor={`${id}-input`}>Directory</label>
        <div className="directory-entry"><input ref={input} id={`${id}-input`} required disabled={disabled} autoComplete="off" value={value} onChange={event => type(event.target.value)} placeholder="Choose a folder in your home directory" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open && active >= 0 && directories[active] ? `${id}-option-${active}` : undefined} aria-keyshortcuts="Control+Space" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={!!error || undefined}/><button type="button" className="quiet directory-show" disabled={disabled} aria-label="Show folders" title="Show folders (Ctrl+Space)" onClick={() => { input.current?.focus(); void lookup(value); }}><NavigationIcon kind="folder"/></button></div>
        {open && <div className="directory-popup">
            <ul ref={list} id={`${id}-list`} className="directory-options" role="listbox" aria-label="Folder suggestions" aria-busy={loading}>{directories.map((directory, index) => <li key={directory.path} id={`${id}-option-${index}`} role="option" tabIndex={-1} aria-selected={active === index} className={active === index ? 'active' : undefined} title={directory.path} onMouseDown={event => event.preventDefault()} onClick={() => choose(directory)}><NavigationIcon kind="folder"/><span>{directory.name}</span></li>)}</ul>
            {loading ? <p className="directory-state" role="status">Loading folders…</p> : error ? <div className="directory-state"><p id={`${id}-error`} role="alert">{error}</p><button type="button" className="quiet" onClick={() => { input.current?.focus(); void lookup(value); }}>Retry folders</button></div> : !directories.length ? <p className="directory-state" role="status">{value.endsWith('/') || !value ? 'No subfolders in this directory.' : 'No matching folders.'}</p> : truncated && <p className="directory-state">Keep typing to narrow the folders.</p>}
        </div>}
        <p id={`${id}-hint`} className="muted">Ctrl+Space shows folders, or use the folder button. Suggestions stay inside your home directory.</p>
    </div>;
}
