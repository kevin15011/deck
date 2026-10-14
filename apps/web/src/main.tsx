import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { conversationEvents, emptyState, pairingToken, reduceEvent, type ViewState } from './state';
import { Markdown } from './markdown';
import { MessageInput } from './message-input';
import { Activity, OpenSpec, Subagents, Tabs, type WorkspaceTab } from './workspace';
import './style.css';
const initialToken = pairingToken(window.location, window.history);
type Theme = 'dark' | 'light';
function savedTheme(): Theme {
    try { return window.localStorage.getItem('deck.theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
}
const initialTheme = savedTheme();
document.documentElement.dataset.theme = initialTheme;
type Session = {
    id?: string;
    sessionId?: string;
    projectRoot?: string;
    state?: string;
    changeId?: string;
};
export function App() {
    const [theme, setTheme] = useState<Theme>(initialTheme);
    useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme;
        try { window.localStorage.setItem('deck.theme', theme); } catch { /* Switching still works when storage is unavailable. */ }
    }, [theme]);
    const [paired, setPaired] = useState(false), [sessions, setSessions] = useState<Session[]>([]), [selected, setSelected] = useState(''), [view, setView] = useState<ViewState>(emptyState), [error, setError] = useState(''), [connection, setConnection] = useState('Connecting'), [busy, setBusy] = useState(false), [code, setCode] = useState(''), [connecting, setConnecting] = useState(true);
    const commandInFlight = useRef(false);
    const seq = useRef(0), conversation = useRef<HTMLElement>(null), drawer = useRef<HTMLDialogElement>(null);
    const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('deck.sidebar-collapsed') === 'true'; } catch { return false; } });
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1000px)').matches), [drawerOpen, setDrawerOpen] = useState(false);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('activity'), [mobileTab, setMobileTab] = useState<WorkspaceTab>('chat'), [drafts, setDrafts] = useState<Record<string, string>>({}), [unseen, setUnseen] = useState(false);
    const following = useRef(true), scrollPositions = useRef(new Map<string, number>()), restored = useRef('');
    const text = drafts[selected] ?? '';
    const setText = (value: string) => setDrafts(previous => ({ ...previous, [selected]: value }));
    useEffect(() => { const media = window.matchMedia('(max-width: 1000px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    useEffect(() => { if (narrow && drawerOpen) drawer.current?.showModal(); else drawer.current?.close(); }, [narrow, drawerOpen]);
    useEffect(() => { try { localStorage.setItem('deck.sidebar-collapsed', String(collapsed)); } catch { /* Preferences are optional. */ } }, [collapsed]);
    const api = useCallback(async (path: string, init?: RequestInit) => { const r = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } }); if (r.status === 401) {
        setPaired(false);
        throw new Error('Pair this browser to continue.');
    } const data = await r.json(); if (!r.ok || data.ok === false)
        throw new Error(data.message ?? data.error?.message ?? data.error ?? data.code ?? 'Request failed. Try again.'); return data; }, []);
    async function load() { try {
        const d = await api('/api/sessions');
        setSessions(d.data.sessions);
        setPaired(true);
        setError('');
    }
    catch (e) {
        setError(String((e as Error).message));
    } }
    useEffect(() => { void (async () => {
        try {
            if (initialToken) await api('/pair', { method: 'POST', body: JSON.stringify({ token: initialToken, name: 'Desktop browser' }) });
            else if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) await api('/api/local-access', { method: 'POST', body: JSON.stringify({ name: 'Local browser' }) });
            await load();
        } catch (e) { setError((e as Error).message); }
        finally { setConnecting(false); }
    })(); }, []);
    useEffect(() => { if (!paired)
        return; const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [paired]);
    useEffect(() => {
        if (!selected || !paired)
            return;
        let closed = false, socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout>;
        seq.current = 0;
        setView(emptyState());
        const apply = (event: any) => { if (closed || event.sessionId !== selected)
            return; seq.current = Math.max(seq.current, event.seq); setView(s => reduceEvent(s, event)); };
        async function connect() { try {
            setConnection('Reconnecting');
            let more = true;
            while (more && !closed) {
                const d = await api(`/api/sessions/${encodeURIComponent(selected)}/events?after=${seq.current}`);
                for (const e of d.events)
                    apply(e);
                more = d.hasMore === true;
            }
            if (closed)
                return;
            const u = new URL(`/api/sessions/${encodeURIComponent(selected)}/events?after=${seq.current}`, location.href);
            u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(u);
            socket.onopen = () => setConnection('Connected');
            socket.onmessage = m => { try {
                const d = JSON.parse(m.data);
                if (d.type === 'event')
                    apply(d.event);
                if (d.type === 'resync')
                    socket?.close();
            }
            catch {
                setError('Could not read a session update. Reconnect to retry.');
            } };
            socket.onclose = () => { if (!closed) {
                setConnection('Reconnecting');
                timer = setTimeout(() => void connect(), 1000);
            } };
            socket.onerror = () => socket?.close();
        }
        catch (e) {
            if (!closed) {
                setConnection('Disconnected');
                setError((e as Error).message);
                timer = setTimeout(() => void connect(), 2000);
            }
        } }
        void connect();
        return () => { closed = true; clearTimeout(timer); socket?.close(); };
    }, [selected, paired]);
    const messages = useMemo(() => conversationEvents(view.events).slice(-500), [view.events]);
    const content = messages.map(event => `${event.seq}:${String(event.data.text ?? event.data.error ?? '')}`).join('\n');
    useLayoutEffect(() => {
        const element = conversation.current;
        if (!element || !selected || (narrow && mobileTab !== 'chat')) return;
        if (restored.current !== selected) {
            if (!messages.length) return;
            const saved = scrollPositions.current.get(selected);
            element.scrollTop = saved ?? element.scrollHeight;
            following.current = saved === undefined || element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            restored.current = selected;
        } else if (following.current) element.scrollTop = element.scrollHeight;
        else setUnseen(true);
    }, [content, selected, narrow, mobileTab]);
    function selectSession(id: string) {
        if (conversation.current && selected) scrollPositions.current.set(selected, conversation.current.scrollTop);
        if (id !== selected) { setView(emptyState()); restored.current = ''; following.current = true; setUnseen(false); }
        setSelected(id); setDrawerOpen(false);
    }
    function changeTab(tab: WorkspaceTab) { setMobileTab(tab); if (tab !== 'chat') setWorkspaceTab(tab); }
    const activeTab = narrow ? mobileTab : workspaceTab;
    const currentSession = sessions.find(session => (session.sessionId ?? session.id) === selected);
    const lead = view.tasks.lead;
    const approvals = Object.values(view.approvals);
    const sessionButtons = <><div className="sidebar-title"><h2>Sessions</h2><button className="quiet" type="button" aria-label="Refresh sessions" title="Refresh sessions" onClick={() => void load()}>↻</button></div><ul className="session-list">{sessions.map(session => { const id = session.sessionId ?? session.id ?? ''; const name = session.changeId ?? session.projectRoot?.split('/').pop() ?? id.slice(0, 12); return <li key={id}><button title={name} className={selected === id ? 'session selected' : 'session'} aria-current={selected === id ? 'page' : undefined} onClick={() => selectSession(id)}><span className="session-monogram" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><span className="session-label"><strong>{name}</strong><small>{session.state ?? 'Session'} · {id.slice(0, 8)}</small></span></button></li>; })}</ul>{!sessions.length && <p className="empty-note">No sessions yet. Start one with <code>deck cross developer</code> in your terminal.</p>}</>;
    async function command(body: Record<string, unknown>) { if (commandInFlight.current) return false; commandInFlight.current = true; setBusy(true); setError(''); try {
        await api('/api/commands', { method: 'POST', body: JSON.stringify({ sessionId: selected, command: { v: 1, commandId: crypto.randomUUID(), ...body } }) });
        return true;
    }
    catch (e) {
        setError((e as Error).message);
        return false;
    }
    finally {
        commandInFlight.current = false; setBusy(false);
    } }
    async function pair(e: React.FormEvent) { e.preventDefault(); setBusy(true); try {
        await api('/pair', { method: 'POST', body: JSON.stringify(code.trim() ? { code, name: 'Desktop browser' } : { token: initialToken, name: 'Desktop browser' }) });
        await load();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    if (connecting) return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1 role="status">Opening your workspace…</h1></main>;
    if (!paired && ['127.0.0.1', 'localhost'].includes(window.location.hostname))
        return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1>Could not open your workspace</h1><p role="alert">{error || 'Local access is unavailable.'}</p><button onClick={() => window.location.reload()}>Retry</button></main>;
    if (!paired)
        return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1>Pair this browser</h1><p>Use the pairing code from your Deck terminal to open your sessions.</p><form onSubmit={pair}><label htmlFor="code">Pairing code</label><input id="code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required={!initialToken} aria-describedby={error ? 'pair-error' : undefined}/><button disabled={busy}>{busy ? 'Pairing…' : 'Pair browser'}</button></form>{error && <p id="pair-error" role="alert">{error}</p>}</main>;
    return <div className={`workbench ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <a className="skip" href="#conversation">Skip to conversation</a>
        <nav className="sidebar" aria-label="Sessions"><div className="brand"><span className="brand-mark" aria-hidden="true">d</span><span className="brand-word">deck<small>Workspace</small></span></div>{sessionButtons}<div className="sidebar-footer">Local workspace</div></nav>
        <dialog ref={drawer} className="session-drawer" aria-labelledby="drawer-title" onClose={() => setDrawerOpen(false)}><div className="drawer-heading"><h2 id="drawer-title">Your sessions</h2><button className="quiet" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close sessions">✕</button></div><nav aria-label="Mobile sessions">{sessionButtons}</nav></dialog>
        <div className="app-body"><header className="app-header"><button className="sidebar-toggle quiet" type="button" aria-label={narrow ? 'Open sessions' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={narrow ? drawerOpen : !collapsed} onClick={() => narrow ? setDrawerOpen(true) : setCollapsed(value => !value)}><span aria-hidden="true">☰</span></button><div className="session-identity"><h1>{selected ? currentSession?.changeId ?? currentSession?.projectRoot?.split('/').pop() ?? 'Session conversation' : 'Choose a session'}</h1>{lead && <p className="lead-identity">Lead <strong>{String(lead.runnerId ?? 'Runner pending')}</strong><span title={String(lead.modelId ?? 'Model pending')}>{String(lead.modelId ?? 'Model pending')}</span></p>}</div><div className="connection"><span className="connection-dot" aria-hidden="true"/><span>{selected ? connection : 'Ready'}</span><small>{selected ? view.state : 'Local'}</small></div><button type="button" className="theme-toggle quiet" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></> : <path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z"/>}</svg></button></header>
        {error && <p className="error app-error" role="alert">{error}</p>}
        <section className={`approvals ${approvals.length ? 'pending' : ''}`} aria-label="Approvals"><div className="approval-heading" role="status" aria-live="polite" aria-atomic="true"><strong>{approvals.length ? `${approvals.length} ${approvals.length === 1 ? 'request needs' : 'requests need'} your approval` : 'No pending approvals'}</strong></div>{approvals.length > 0 && <div className="approval-requests">{approvals.map(event => <article className="approval" key={String(event.data.approvalId)}><div><h2>{String(event.data.toolName ?? event.data.tool ?? event.data.title ?? 'Tool request')}</h2><p>{String(event.data.description ?? event.data.summary ?? event.data.reason ?? event.data.command ?? 'Review this tool request before allowing it.')}</p><details><summary>Request details</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details></div><div className="approval-actions"><button type="button" className="quiet" disabled={busy} onClick={() => void command({ type: 'approval.respond', approvalId: event.data.approvalId, decision: 'deny' })}>Deny</button><button type="button" disabled={busy} onClick={() => void command({ type: 'approval.respond', approvalId: event.data.approvalId, decision: 'allow-once' })}>Allow once</button></div></article>)}</div>}</section>
        <div className="view-nav"><span className="chat-label">Conversation <small>You and the Lead</small></span><Tabs active={activeTab} onChange={changeTab}/></div>
        <div className="panes"><main id="panel-chat" className="chat-pane" hidden={narrow && mobileTab !== 'chat'} aria-labelledby="tab-chat"><section id="conversation" ref={conversation} tabIndex={-1} className="conversation" aria-label="Conversation" onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; scrollPositions.current.set(selected, element.scrollTop); if (following.current) setUnseen(false); }}>
        {!messages.length && <div className="empty"><span className="empty-mark" aria-hidden="true">d</span><h2>{selected ? 'What are we working on?' : 'Your work, across runners'}</h2><p>{selected ? 'Send a message to the Lead. Follow the tools, delegated work and documents in the workspace alongside it.' : 'Choose a session to continue the conversation and see its work.'}</p></div>}
        {messages.map(event => event.kind === 'turn.completed' ? <article key={event.seq} className="message failed-message" role="alert"><p className="message-meta">Turn failed</p><p>{typeof event.data.error === 'string' && event.data.error ? event.data.error : 'The runner could not complete this turn. Try again.'}</p></article> : <article key={event.seq} className={`message ${event.data.role === 'user' ? 'user' : 'lead'}`}><div className="message-meta"><strong>{event.data.role === 'user' ? 'You' : 'Lead'}</strong>{event.data.role !== 'user' && <span>{event.source.runnerId ?? lead?.runnerId as string ?? ''}</span>}<time dateTime={event.ts}>{new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><Markdown text={String(event.data.text ?? event.data.delta ?? '')}/></article>)}
        </section>
        <form className="composer" onSubmit={async event => { event.preventDefault(); const session = selected, prompt = text; if (prompt.trim() && await command({ type: 'prompt.send', text: prompt })) setDrafts(previous => previous[session] === prompt ? { ...previous, [session]: '' } : previous); }}>{unseen && <button type="button" className="jump-latest" onClick={() => { if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight; following.current = true; setUnseen(false); }}>Jump to latest ↓</button>}<label htmlFor="prompt">Message the lead</label><MessageInput id="prompt" value={text} onChange={event => setText(event.target.value)} disabled={!selected || view.state === 'ended'} placeholder="Describe the next step…" aria-describedby="composer-help" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/><div className="composer-actions"><span id="composer-help">{selected ? view.state === 'ended' ? 'This session has ended.' : 'Enter to send · Shift + Enter for a new line' : 'Choose a session to send a message.'}</span><button type="button" className="quiet" aria-label="Interrupt" title="Interrupt" disabled={!selected || busy || view.state === 'ended'} onClick={() => void command({ type: 'turn.interrupt', taskId: 'lead' })}><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button><button aria-label="Send prompt" title="Send prompt" disabled={!selected || !text.trim() || busy || view.state === 'ended'}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div></form></main>
        <aside className="workspace-pane" aria-label="Session workspace" hidden={narrow && mobileTab === 'chat'}><div className="workspace-panel" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={workspaceTab !== 'activity'} tabIndex={0}><Activity events={view.events}/></div><div className="workspace-panel" id="panel-subagents" role="tabpanel" aria-labelledby="tab-subagents" hidden={workspaceTab !== 'subagents'} tabIndex={0}><Subagents view={view}/></div><div className="workspace-panel" id="panel-openspec" role="tabpanel" aria-labelledby="tab-openspec" hidden={workspaceTab !== 'openspec'} tabIndex={0}><OpenSpec key={selected} sessionId={selected} visible={paired && (narrow ? mobileTab === 'openspec' : workspaceTab === 'openspec')} api={api}/></div></aside></div>
        </div></div>;
}
if (typeof document !== 'undefined')
    createRoot(document.getElementById('root')!).render(<App />);
