import React, { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { activityEvents, conversationEvents, type ViewState } from './state';
import { Markdown } from './markdown';

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
export function Activity({ events }: { events: SessionEvent[] }) {
    const rows = activityEvents(events);
    const titles: Record<string, string> = { 'turn.started': 'Turn started', 'turn.completed': 'Turn finished', 'task.created': 'Task created', 'task.continued': 'Task resumed', 'task.state': 'Task status changed', 'task.result': 'Task completed', 'session.state': 'Session status changed', 'session.created': 'Session created', 'session.bound': 'Change linked', 'session.ended': 'Session ended', 'session.recovered': 'Session recovered', 'approval.requested': 'Approval requested', 'approval.resolved': 'Approval resolved', 'diagnostic': 'Session notice', 'rate-limit': 'Rate limit reached', 'runner.unmapped': 'Runner update', 'memory.recalled': 'Memory recalled', 'memory.proposed': 'Memory proposed', 'memory.written': 'Memory saved', 'client.attached': 'Client connected', 'client.detached': 'Client disconnected' };
    return <section className="activity-content"><div className="panel-intro"><h2>Session activity</h2><p>Tools, progress and task updates from this session.</p></div>{!rows.length && <p className="empty-note">Activity will appear as the Lead starts working.</p>}<ol className="activity-list">{rows.slice(-500).map(event => {
        const tool = event.kind.startsWith('tool.');
        const title = tool ? `${String(event.data.toolName ?? event.data.name ?? 'Tool')} · ${event.kind === 'tool.started' ? 'started' : 'finished'}` : titles[event.kind] ?? event.kind.replaceAll('.', ' ');
        const status = String(event.data.status ?? event.data.state ?? '');
        const summary = event.kind === 'task.result' ? 'Result available in Subagents.' : displayValue(event.data.description ?? event.data.summary ?? event.data.message ?? event.data.error);
        return <li key={event.seq} className={status === 'failed' ? 'activity-row failed' : 'activity-row'}><span className="activity-mark" aria-hidden="true">{status === 'failed' ? '!' : tool ? '⌘' : '·'}</span><div><div className="activity-heading"><strong>{title}</strong><time dateTime={event.ts}>{time(event.ts)}</time></div><p className="activity-meta">{event.source.memberId ?? event.source.taskId ?? 'lead'}{event.source.runnerId ? ` · ${event.source.runnerId}` : ''}{status ? ` · ${status}` : ''}</p>{summary && <p className="activity-summary">{summary.length > 220 ? summary.slice(0, 220) + '…' : summary}</p>}<details><summary>View details</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details></div></li>;
    })}</ol></section>;
}
export function Subagents({ view }: { view: ViewState }) {
    const tasks = Object.entries(view.tasks).filter(([id]) => id !== 'lead');
    return <section className="subagent-content"><div className="panel-intro"><h2>Subagents</h2><p>Delegated work, actual assignments and results.</p></div>{!tasks.length && <p className="empty-note">No subagents yet. Delegated work will appear here.</p>}{tasks.map(([id, task]) => <article className="task-card" key={id}><div className="task-heading"><h3>{String(task.memberId ?? id)}</h3><span className="status-chip">{String(task.state ?? 'created')}</span></div><p className="runner">{String(task.runnerId ?? 'Runner pending')} <span>· {String(task.modelId ?? 'Model pending')}</span></p><p className="muted">Attempt {String(task.attempt ?? 1)}</p>{(task.result ?? task.summary) !== undefined && <div className="task-result"><h4>Result</h4><Markdown text={displayValue(task.result ?? task.summary)}/></div>}<details><summary>Task conversation</summary><div className="task-transcript">{conversationEvents(view.events, id).map(event => <article key={event.seq}><p className="message-meta">{event.data.role === 'user' ? 'Delegation' : String(task.memberId ?? id)}</p><Markdown text={displayValue(event.data.text ?? event.data.error)}/></article>)}</div></details></article>)}</section>;
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
