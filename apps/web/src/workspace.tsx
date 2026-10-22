import { ProgressiveTranscript } from './progressive-transcript';
import { AutoApprovalMessage } from './approvals';
import { QuestionAnswerMessage } from './question-answer';
import { StatusIndicator, VisibleReply, indicatorState, replyForTask, type ReadMarkers } from './status-indicator';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { activityEvents, conversationEvents, type ViewState } from './state';
import { Markdown } from './markdown';
import { activityText, type HookActivity } from './activity';
import { isLeadEvent } from './event-source';
import { Avatar, agentProfile, FollowTranscript } from './subagent-parts';
import { ContextWindowIndicator, contextIndexForEvents, type ContextWindowIndex } from './context-window';

export type WorkspaceTab = 'chat' | 'activity' | 'subagents' | 'openspec';
export type Api = (path: string, init?: RequestInit) => Promise<any>;
const tabNames: Record<WorkspaceTab, string> = { chat: 'Chat', activity: 'Activity', subagents: 'Subagents', openspec: 'OpenSpec' };
/** Current projection only: replies/history and read markers never imply execution. */
export function hasWorkingSubagent(view: Pick<ViewState,'tasks'|'approvals'|'questions'>): boolean {
    const owners=(events: ViewState['approvals'])=>new Set(Object.values(events).map(event=>String(event.source.taskId??event.data.taskId??'')));
    const approvals=owners(view.approvals),questions=owners(view.questions);
    return Object.entries(view.tasks).some(([id,task])=>task.memberId!=='lead' && !/^lead(?:-g[1-9]\d*)?$/.test(id) && indicatorState(String(task.state??'created'),approvals.has(id)?1:0,questions.has(id)?1:0)==='working');
}
export function Tabs({ active, onChange, subagentsWorking = false }: { active: WorkspaceTab; onChange: (tab: WorkspaceTab) => void; subagentsWorking?: boolean }) {
    const statusId=useId();
    return <div className="workspace-tabs" role="tablist" aria-label="Workspace views" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.offsetParent !== null);
        const at = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
    }}>{(Object.keys(tabNames) as WorkspaceTab[]).map(tab => <button className={tab === 'chat' ? 'chat-tab' : undefined} key={tab} type="button" role="tab" id={`tab-${tab}`} aria-label={tab==='subagents'?'Subagents':undefined} aria-describedby={tab==='subagents'?statusId:undefined} aria-selected={active === tab} aria-controls={`panel-${tab}`} tabIndex={active === tab ? 0 : -1} onClick={() => onChange(tab)}>{tab==='subagents'?<><span className="subagents-tab-title">Subagents<span className="tab-working" aria-hidden="true">{subagentsWorking && <StatusIndicator state="running"/>}</span></span><span id={statusId} className="sr-only" role="status">{subagentsWorking?'Subagents working':'No subagents working'}</span></>:tabNames[tab]}</button>)}</div>;
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

type TaskEntry = [string, ViewState['tasks'][string]];
function taskModel(view: ViewState, id: string, task: TaskEntry[1], sessionId: string, readMarkers: ReadMarkers, context?: SessionEvent) {
    const reply = replyForTask(view.events, id), key = `${sessionId}:${id}:${reply?.attempt ?? task.attempt ?? 1}`;
    const messages = conversationEvents(view.events, id);
    return {
        id, task, reply, key, messages, context,
        member: String(task.memberId ?? id),
        questions: Object.values(view.questions).filter(event => event.source.taskId === id).length,
        approvals: Object.values(view.approvals).filter(event => event.source.taskId === id).length,
        unread: !!reply && reply.seq > (readMarkers[key] ?? 0),
        result: reply?.resultText,
        resultMatches: !!reply && displayValue(reply.resultText) === reply.text,
        signal: messages.map(event => `${event.seq}:${String(event.data.text ?? event.data.error ?? '').length}`).join(),
    };
}
type TaskModel = ReturnType<typeof taskModel>;

function TaskHeading({ model, onOpen }: { model: TaskModel; onOpen?: () => void }) {
    const { label } = agentProfile(model.member), state = String(model.task.state ?? 'created');
    return <div className="task-heading"><Avatar memberId={model.member} size={onOpen ? 40 : 64}/><div className="task-identity"><h3>{label}</h3><p className="runner">{String(model.task.runnerId ?? 'Runner pending')} <span>· {String(model.task.modelId ?? 'Model pending')} · Attempt {String(model.task.attempt ?? 1)}</span></p></div><StatusIndicator state={state} approvals={model.approvals} questions={model.questions} unread={model.unread}/><span className="status-chip">{state}</span>{onOpen && <button type="button" className="open-detail" onClick={onOpen}>Open full view<svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 8.5 7.5M6.5 3.5h-3v9h9v-3"/></svg></button>}<ContextWindowIndicator observation={model.context}/></div>;
}
function TaskResult({ model, visible, acknowledge, preview = false }: { model: TaskModel; visible: boolean; acknowledge: (key: string, seq: number) => void; preview?: boolean }) {
    if (model.result === undefined) return null;
    return <VisibleReply className={`task-result${preview ? ' task-result--preview' : ''}`} visible={visible} replyKey={model.key} seq={model.resultMatches ? model.reply!.seq : 0} acknowledge={acknowledge}>{!preview && <h4>Result</h4>}<Markdown text={displayValue(model.result)}/></VisibleReply>;
}
function TranscriptMessages({ model, visible, acknowledge }: { model: TaskModel; visible: boolean; acknowledge: (key: string, seq: number) => void }) {
    return <>{model.messages.map(event => event.autoApproval?<AutoApprovalMessage key={event.seq} detail={event.autoApproval} label={agentProfile(model.member).label}/>:event.questionResolution?<QuestionAnswerMessage key={event.seq} resolution={event.questionResolution} ts={event.ts} label={agentProfile(model.member).label}/>:<article key={event.seq}><p className="message-meta">{event.data.role === 'user' ? 'Delegation' : agentProfile(model.member).label}</p><VisibleReply visible={visible} replyKey={model.key} seq={model.reply?.seq === event.seq ? event.seq : 0} acknowledge={acknowledge}><Markdown text={displayValue(event.data.text ?? event.data.error)}/></VisibleReply></article>)}</>;
}

export function Subagents({ api,view, sessionId = '', visible = false, readMarkers = {}, acknowledge = () => {}, contexts }: { api?:Api;view: ViewState; sessionId?: string; visible?: boolean; readMarkers?: ReadMarkers; acknowledge?: (key: string, seq: number) => void; contexts?: ContextWindowIndex }) {
    const contextIndex = useMemo(() => contextIndexForEvents(view.events, sessionId, contexts), [view.events, sessionId, contexts]);
    const entries = Object.entries(view.tasks).filter(([id, task]) => id !== 'lead' && task.memberId !== 'lead') as TaskEntry[];
    // Compact reconnect history retains these lifecycle events as well as replies.
    const delegations = new Map<string, number>();
    for (const event of view.events) {
        if (event.kind !== 'task.created' && event.kind !== 'task.continued') continue;
        const id = event.source.taskId ?? event.data.taskId;
        if (typeof id === 'string') delegations.set(id, Math.max(delegations.get(id) ?? 0, event.seq));
    }
    const models = entries.map(([id, task]) => ({ ...taskModel(view, id, task, sessionId, readMarkers, contextIndex.get(id)), delegationSeq: delegations.get(id) ?? 0 }))
        .sort((a, b) => Math.max(b.delegationSeq, b.reply?.seq ?? 0) - Math.max(a.delegationSeq, a.reply?.seq ?? 0));
    const [openId, setOpenId] = useState('');
    useEffect(() => { setOpenId(''); }, [sessionId]);
    const detail = models.find(model => model.id === openId);
    if (detail) return <section className="subagent-content subagent-detail">
        <div className="detail-bar"><button type="button" className="quiet detail-back" onClick={() => setOpenId('')}>← Subagents</button><div className="detail-switch" role="group" aria-label="Switch subagent">{models.map(model => <button key={model.id} type="button" className="quiet detail-pick" aria-pressed={model.id === detail.id} aria-label={`${agentProfile(model.member).label} (${String(model.task.state ?? 'created')})`} title={agentProfile(model.member).label} onClick={() => setOpenId(model.id)}><Avatar memberId={model.member} size={28}/>{model.unread && <span className="pick-unread" aria-label="Unread reply"/>}</button>)}</div></div>
        <article className="task-card detail-card"><TaskHeading model={detail}/><TaskResult model={detail} visible={visible} acknowledge={acknowledge}/></article>
        <div className="detail-conversation"><h4>Conversation</h4>{api?<ProgressiveTranscript key={`${sessionId}:${detail.id}`} api={api} sessionId={sessionId} taskId={detail.id} active={visible} label={`${agentProfile(detail.member).label} conversation`}>{messages=><TranscriptMessages model={{...detail,messages}} visible={visible} acknowledge={acknowledge}/>}</ProgressiveTranscript>:<FollowTranscript className="task-transcript task-transcript--full" label={`${agentProfile(detail.member).label} conversation`} signal={detail.signal} active={visible}><TranscriptMessages model={detail} visible={visible} acknowledge={acknowledge}/></FollowTranscript>}</div>
    </section>;
    return <section className="subagent-content"><div className="panel-intro"><h2>Subagents</h2><p>Delegated work, actual assignments and results.</p></div>{!models.length && <p className="empty-note">No subagents yet. Delegated work will appear here.</p>}{models.map(model => <article className="task-card task-card--compact" data-activity={indicatorState(String(model.task.state ?? 'created'), model.approvals)} key={model.id}>
        <TaskHeading model={model} onOpen={() => setOpenId(model.id)}/>
        <TaskResult model={model} visible={visible} acknowledge={acknowledge} preview/>
    </article>)}</section>;
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
