import { StatusIndicator, VisibleReply, replyForTask, type ReadMarkers } from './status-indicator';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { activityEvents, conversationEvents, type ViewState } from './state';
import { Markdown } from './markdown';
import { activityText, type HookActivity } from './activity';
import { isLeadEvent } from './event-source';

export type WorkspaceTab = 'chat' | 'activity' | 'subagents' | 'openspec';
export type Api = (path: string, init?: RequestInit) => Promise<any>;
const tabNames: Record<WorkspaceTab, string> = { chat: 'Chat', activity: 'Activity', subagents: 'Subagents', openspec: 'OpenSpec' };
export function Tabs({ active, onChange }: { active: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
    return <div className="workspace-tabs" role="tablist" aria-label="Workspace views" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.offsetParent !== null);
        const at = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
    }}>{(Object.keys(tabNames) as WorkspaceTab[]).map(tab => <button className={tab === 'chat' ? 'chat-tab' : undefined} key={tab} type="button" role="tab" id={`tab-${tab}`} aria-selected={active === tab} aria-controls={`panel-${tab}`} tabIndex={active === tab ? 0 : -1} onClick={() => onChange(tab)}>{tabNames[tab]}</button>)}</div>;
}
function displayValue(value: unknown): string {
    return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);
}
function time(value: string): string { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function HookDetails({ row }: { row: HookActivity }) {
    return <><p className="activity-summary">{activityText(row.hookEvent, 128)}</p><p className="activity-meta">Native hook{row.provider === 'supermemory' ? ' · Supermemory runner plugin' : ''}</p>{row.orphan && <p className="activity-meta">Start details unavailable.</p>}<details className="activity-details"><summary>View hook details<span className="sr-only"> for {activityText(row.name, 256)}</span></summary><div><section><h3>Reported lifecycle</h3><pre>{activityText({ hookId: row.hookId, event: row.hookEvent, provenance: row.provenance, executionMode: row.executionMode, handlerType: row.handlerType })}</pre></section>{row.exitCode !== undefined && <p className="activity-meta">Exit code: {row.exitCode}</p>}</div></details></>;
}
export function Activity({ events, sessionId = events[0]?.sessionId ?? '', visible = true }: { events: SessionEvent[]; sessionId?: string; visible?: boolean }) {
    const rows = useMemo(() => activityEvents(events), [events]);
    const viewport = useRef<HTMLElement>(null), content = useRef<HTMLDivElement>(null), following = useRef(true), restored = useRef(''), wasVisible = useRef(false);
    const measured = useRef({ height: 0, viewport: 0 });
    const touchY = useRef<number | undefined>(undefined);
    const positions = useRef(new Map<string, { top: number; following: boolean }>()), [paused, setPaused] = useState(false);
    const revision = events.reduce((seq, event) => event.data.internal !== true && isLeadEvent(event) && ['tool.started', 'tool.completed', 'hook.started', 'hook.completed', 'reasoning.delta', 'turn.completed', 'task.continued', 'session.ended', 'session.assignment'].includes(event.kind) ? event.seq : seq, 0);
    function remember() {
        const element = viewport.current;
        if (!element) return;
        measured.current = { height: element.scrollHeight, viewport: element.clientHeight };
        positions.current.set(sessionId, { top: element.scrollTop, following: following.current });
        setPaused(!following.current && element.scrollHeight - element.scrollTop - element.clientHeight > 80);
    }
    useLayoutEffect(() => {
        const element = viewport.current;
        if (!visible) { wasVisible.current = false; return; }
        if (!element || !rows.length) { restored.current = ''; setPaused(false); return; }
        if (restored.current !== sessionId || !wasVisible.current) {
            const saved = positions.current.get(sessionId);
            following.current = saved?.following ?? true;
            element.scrollTop = following.current ? element.scrollHeight : saved?.top ?? 0;
            restored.current = sessionId; wasVisible.current = true;
        } else if (following.current) element.scrollTop = element.scrollHeight;
        remember();
    }, [sessionId, visible, revision, rows.length]);
    useEffect(() => {
        if (!visible || !content.current) return;
        const observer = new ResizeObserver(() => {
            if (!viewport.current || restored.current !== sessionId) return;
            if (following.current) viewport.current.scrollTop = viewport.current.scrollHeight;
            remember();
        });
        observer.observe(content.current);
        if (viewport.current) observer.observe(viewport.current);
        return () => observer.disconnect();
    }, [sessionId, visible]);
    function pauseFollowing() {
        if (!visible || restored.current !== sessionId) return;
        following.current = false; remember();
    }
    function pauseDetails(event: { target: EventTarget | null }) {
        if (event.target instanceof Element && event.target.closest('summary, details')) pauseFollowing();
    }
    const statuses = { running: 'Running', completed: 'Completed', failed: 'Failed', interrupted: 'Interrupted', unfinished: 'No completion reported', blocked: 'Blocked', stopped: 'Stopped', unknown: 'Outcome unknown' };
    return <div className="activity-view"><section ref={viewport} className="activity-content" aria-label="Lead activity timeline" tabIndex={0} onClickCapture={pauseDetails} onWheelCapture={event => { if (event.deltaY < 0) pauseFollowing(); }} onKeyDownCapture={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pauseFollowing(); }} onTouchStartCapture={event => { touchY.current = event.touches[0]?.clientY; }} onTouchMoveCapture={event => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchY.current !== undefined && y > touchY.current) pauseFollowing();
        touchY.current = y;
    }} onTouchEndCapture={() => { touchY.current = undefined; }} onTouchCancelCapture={() => { touchY.current = undefined; }} onPointerDownCapture={event => {
        const element = event.currentTarget;
        if (event.target === element && event.clientX >= element.getBoundingClientRect().right - (element.offsetWidth - element.clientWidth) - 4) pauseFollowing();
    }} onScroll={event => {
        if (!visible || restored.current !== sessionId) return;
        const element = event.currentTarget;
        // Browser scroll anchoring can fire before ResizeObserver during reflow.
        const reflow = measured.current.height !== element.scrollHeight || measured.current.viewport !== element.clientHeight;
        if (following.current && reflow) element.scrollTop = element.scrollHeight;
        else following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        remember();
    }}><div ref={content}><div className="panel-intro"><h2>Lead activity</h2><p>Tools, native hooks, and reasoning when the runner provides them.</p></div>{!rows.length && <div className="empty-note"><h3>No Lead details yet</h3><p>Tool inputs and results appear here as the Lead works. Native hooks, reasoning and explicit skill calls appear only when the runner provides them.</p></div>}<ol className="activity-list">{rows.slice(-500).map(row => <li key={row.key} className={`activity-row${(row.kind === 'tool' || row.kind === 'hook') && ['failed', 'blocked'].includes(row.status) ? ' failed' : ''}`}>
        <span className="activity-mark" aria-hidden="true">{row.kind === 'reasoning' ? '·' : row.kind === 'transition' ? '↔' : row.status === 'failed' || row.status === 'blocked' ? '!' : row.kind === 'hook' ? '↳' : '⌘'}</span>
        <div className="activity-body"><div className="activity-heading"><strong>{row.kind === 'reasoning' ? row.summary ? 'Reasoning summary' : 'Runner reasoning' : row.kind === 'transition' ? activityText(row.title, 256) : row.kind === 'hook' ? `Hook · ${activityText(row.name, 256)}` : row.skill ? `Skill · ${activityText(row.skill, 256)}` : activityText(row.name, 256)}</strong><time dateTime={row.ts}>{time(row.ts)}</time></div>
            <p className="activity-meta">{row.kind === 'transition' ? 'Session · Recorded change' : 'Lead'}{row.runner ? ` · ${activityText(row.runner, 256)}` : ''}{row.kind === 'tool' && row.server ? ` · ${activityText(row.server, 256)}` : ''}{row.kind === 'reasoning' ? ' · Runner-reported' : row.kind === 'transition' ? '' : ` · ${statuses[row.status]}`}{(row.kind === 'tool' || row.kind === 'hook') && row.durationMs !== undefined ? ` · ${row.durationMs < 1000 ? Math.round(row.durationMs) + ' ms' : (row.durationMs / 1000).toFixed(1) + ' s'}` : ''}</p>
            {row.kind === 'reasoning' ? <div className="activity-reasoning"><Markdown text={activityText(row.text)}/></div> : row.kind === 'transition' ? <p className="activity-summary">{activityText(row.text)}</p> : row.kind === 'hook' ? <HookDetails row={row}/> : <>
                {row.summary && <p className="activity-summary">{row.summary}</p>}
                {row.error !== undefined && <p className="activity-error">{activityText(row.error, 1000)}</p>}
                {row.orphan && <p className="activity-meta">Start details unavailable.</p>}
                {(row.input !== undefined || row.output !== undefined || row.error !== undefined || row.exitCode !== undefined) && <details className="activity-details"><summary>View tool details<span className="sr-only"> for {activityText(row.name, 256)}</span></summary><div>
                    {row.input !== undefined && <section><h3>Input</h3><pre>{activityText(row.input)}</pre></section>}
                    {row.output !== undefined && <section><h3>Output</h3><pre>{activityText(row.output)}</pre></section>}
                    {row.error !== undefined && <section><h3>Error</h3><pre>{activityText(row.error)}</pre></section>}
                    {row.exitCode !== undefined && <p className="activity-meta">Exit code: {row.exitCode}</p>}
                </div></details>}
            </>}
        </div>
    </li>)}</ol>{rows.length > 500 && <p className="empty-note">Showing the latest 500 Lead activity entries.</p>}</div></section>{paused && <button type="button" className="activity-jump" onClick={() => {
        following.current = true;
        if (viewport.current) { viewport.current.scrollTop = viewport.current.scrollHeight; viewport.current.focus({ preventScroll: true }); }
        remember();
    }}>Jump to latest activity ↓</button>}</div>;
}

export function Subagents({ view, sessionId = '', visible = false, readMarkers = {}, acknowledge = () => {} }: { view: ViewState; sessionId?: string; visible?: boolean; readMarkers?: ReadMarkers; acknowledge?: (key: string, seq: number) => void }) {
    const tasks = Object.entries(view.tasks).filter(([id, task]) => id !== 'lead' && task.memberId !== 'lead');
    return <section className="subagent-content"><div className="panel-intro"><h2>Subagents</h2><p>Delegated work, actual assignments and results.</p></div>{!tasks.length && <p className="empty-note">No subagents yet. Delegated work will appear here.</p>}{tasks.map(([id, task]) => {
        const reply = replyForTask(view.events, id), key = `${sessionId}:${id}:${reply?.attempt ?? task.attempt ?? 1}`;
        const approvals = Object.values(view.approvals).filter(event => event.source.taskId === id).length;
        const result = reply?.resultText;
        const resultMatches = reply && displayValue(result) === reply.text;
        return <article className="task-card" key={id}><div className="task-heading"><h3>{String(task.memberId ?? id)}</h3><StatusIndicator state={String(task.state ?? 'created')} approvals={approvals} unread={!!reply && reply.seq > (readMarkers[key] ?? 0)}/><span className="status-chip">{String(task.state ?? 'created')}</span></div><p className="runner">{String(task.runnerId ?? 'Runner pending')} <span>· {String(task.modelId ?? 'Model pending')}</span></p><p className="muted">Attempt {String(task.attempt ?? 1)}</p>{result !== undefined && <VisibleReply className="task-result" visible={visible} replyKey={key} seq={resultMatches ? reply.seq : 0} acknowledge={acknowledge}><h4>Result</h4><Markdown text={displayValue(result)}/></VisibleReply>}<details><summary>Task conversation</summary><div className="task-transcript">{conversationEvents(view.events, id).map(event => <article key={event.seq}><p className="message-meta">{event.data.role === 'user' ? 'Delegation' : String(task.memberId ?? id)}</p><VisibleReply visible={visible} replyKey={key} seq={reply?.seq === event.seq ? event.seq : 0} acknowledge={acknowledge}><Markdown text={displayValue(event.data.text ?? event.data.error)}/></VisibleReply></article>)}</div></details></article>;
    })}</section>;
}

type Artifact = { path: string; sizeBytes: number; updatedAt: string };
type Catalog = { boundChangeId?: string; changes: { changeId: string; artifacts: Artifact[] }[] };
type Document = { changeId: string; path: string; markdown: string; updatedAt: string };
export function OpenSpec({ sessionId, visible, api }: { sessionId: string; visible: boolean; api: Api }) {
    const [catalog, setCatalog] = useState<Catalog>({ changes: [] }), [change, setChange] = useState(''), [path, setPath] = useState(''), [document, setDocument] = useState<Document>(), [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
    const request = useRef(0);
    useEffect(() => { setCatalog({ changes: [] }); setChange(''); setPath(''); setDocument(undefined); setError(''); }, [sessionId]);
    useEffect(() => {
        if (!sessionId || !visible) return;
        const controller = new AbortController(), version = ++request.current;
        let active = true, polling = false;
        async function refresh() {
            if (polling || window.document.visibilityState === 'hidden') return;
            polling = true; setLoading(true);
            try {
                const reply = await api(`/api/sessions/${encodeURIComponent(sessionId)}/openspec`, { signal: controller.signal });
                if (!active || request.current !== version) return;
                const next = reply.data as Catalog;
                setCatalog(next);
                const selectedChange = next.boundChangeId ?? (change || next.changes[0]?.changeId || '');
                const artifacts = next.changes.find(item => item.changeId === selectedChange)?.artifacts ?? [];
                const selectedPath = path || artifacts[0]?.path || '';
                setChange(selectedChange); setPath(selectedPath);
                if (!selectedChange || !selectedPath) { setDocument(undefined); setError(''); return; }
                if (!next.changes.some(item => item.changeId === selectedChange) || !artifacts.some(item => item.path === selectedPath)) {
                    setDocument(undefined); setError('The selected OpenSpec document or change is no longer available. Choose another document or refresh.'); return;
                }
                const doc = await api(`/api/sessions/${encodeURIComponent(sessionId)}/openspec/artifact?${new URLSearchParams({ changeId: selectedChange, path: selectedPath })}`, { signal: controller.signal });
                if (active && request.current === version) { setDocument(doc.data); setError(''); }
            } catch (cause) {
                if (active && request.current === version && !controller.signal.aborted) { setDocument(undefined); setError((cause as Error).message); }
            } finally { if (active && request.current === version) setLoading(false); polling = false; }
        }
        void refresh(); const timer = setInterval(() => void refresh(), 5000);
        const show = () => { if (window.document.visibilityState === 'visible') void refresh(); };
        window.document.addEventListener('visibilitychange', show);
        return () => { active = false; ++request.current; controller.abort(); clearInterval(timer); window.document.removeEventListener('visibilitychange', show); };
    }, [sessionId, visible, change, path, revision]);
    const artifacts = catalog.changes.find(item => item.changeId === change)?.artifacts ?? [];
    return <section className="openspec-content"><div className="panel-intro"><div className="panel-heading"><h2>OpenSpec</h2><button type="button" className="quiet" disabled={!sessionId || loading} onClick={() => setRevision(value => value + 1)}>Refresh documents</button></div><p>Read the documents as this work takes shape.</p></div>{!sessionId ? <p className="empty-note">Choose a session to view its OpenSpec documents.</p> : <><div className="document-controls"><label>Change<select aria-label="Change" value={change} disabled={!!catalog.boundChangeId || (!change && !catalog.changes.length)} onChange={event => { setDocument(undefined); setChange(event.target.value); setPath(''); }}>{change && !catalog.changes.some(item => item.changeId === change) && <option value={change}>{change} (unavailable)</option>}{catalog.changes.map(item => <option key={item.changeId} value={item.changeId}>{item.changeId}</option>)}</select></label><label>Document<select aria-label="Document" value={path} disabled={!artifacts.length} onChange={event => { setDocument(undefined); setPath(event.target.value); }}>{path && !artifacts.some(item => item.path === path) && <option value={path}>{path} (unavailable)</option>}{artifacts.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}</select></label></div><p className="document-status" role="status">{loading ? 'Checking documents…' : document ? `Updated ${new Date(document.updatedAt).toLocaleString()}` : 'Read only'}{catalog.boundChangeId ? ' · Linked to this session' : ' · Viewing does not change the session'}</p>{error && <p className="error" role="alert">{error}</p>}{!loading && !error && !artifacts.length && <div className="empty-note"><h3>No documents yet</h3><p>Markdown artifacts will appear here when they are created in an active OpenSpec change.</p></div>}{document && document.changeId === change && document.path === path && <article className="document-reading"><Markdown text={document.markdown} artifactPaths={artifacts.map(item => item.path)} basePath={path} onArtifactLink={setPath}/></article>}</>}</section>;
}
