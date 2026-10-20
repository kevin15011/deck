import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Decision, DecisionTarget, DecisionReadModel } from '../../../packages/core/src/session/decisions';
import { unresolvedDecision } from '../../../packages/core/src/session/decisions';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import type { Api } from './workspace';
import { Markdown } from './markdown';
import type { DecisionSource } from '../../../packages/core/src/session/decisions';
export type DecisionView = Omit<DecisionReadModel,'omittedReplies'> & {omittedReplies?:number};
export type DecisionSelection = DecisionTarget & { sessionId: string; questionRevision: number; question: string };
export function replySelectionStale(selection: DecisionSelection | undefined, sessionId: string, decisions: DecisionView[]): boolean {
    if (!selection) return false;
    const current = decisions.find(d => d.decisionId === selection.decisionId);
    return selection.sessionId !== sessionId || !current || !unresolvedDecision(current) || selection.questionRevision !== current.questionRevision;
}
export function decisionReplyStatus(decision: DecisionView): string {
    if (decision.queuedReplies.length) return 'Reply queued · not yet delivered';
    const reply = decision.replies.at(-1);
    if (reply?.stale) return 'Stale reply delivered · clarification needed';
    if (!unresolvedDecision(decision)) return decision.state === 'answered' ? 'Answered by Lead' : decision.state === 'cancelled' ? 'Cancelled' : 'Superseded';
    return reply ? 'Delivered · awaiting Lead resolution' : 'Awaiting answer';
}
export function useDecisions(api: Api, sessionId: string, connected: boolean, events: SessionEvent[]) {
    const [snapshot, setSnapshot] = useState<{sessionId: string; decisions: DecisionView[]; omittedTerminal?: number}>({sessionId: '', decisions: []});
    const [failure, setFailure] = useState({sessionId: '', text: ''}), [refreshKey, setRefreshKey] = useState(0), [loadingSession, setLoadingSession] = useState('');
    const request = useRef(0);
    const eventKey = events.reduce((seq, event) => event.kind.startsWith('decision.') || event.kind.startsWith('prompt.') || event.kind === 'session.released' ? event.seq : seq, 0);
    useEffect(() => {
        if (!sessionId || !connected) return;
        const controller = new AbortController(), version = ++request.current;
        setLoadingSession(sessionId);
        void api(`/api/sessions/${encodeURIComponent(sessionId)}/decisions`, {signal: controller.signal}).then(reply => {
            if (!controller.signal.aborted && request.current === version) { setSnapshot({sessionId, decisions: reply.data.decisions, omittedTerminal: reply.data.omittedTerminal}); setFailure({sessionId, text: ''}); }
        }).catch(error => { if (!controller.signal.aborted && request.current === version) setFailure({sessionId, text: (error as Error).message}); })
        .finally(() => { if (request.current === version) setLoadingSession(''); });
        return () => { ++request.current; controller.abort(); };
    }, [api, sessionId, connected, eventKey, refreshKey]);
    return { decisions: snapshot.sessionId === sessionId ? snapshot.decisions : [], omittedTerminal: snapshot.sessionId === sessionId ? snapshot.omittedTerminal ?? 0 : 0, error: failure.sessionId === sessionId ? failure.text : '', loading: loadingSession === sessionId, refresh: () => setRefreshKey(k => k + 1) };
}
export function Decisions({ decisions, connected, busy, error, loading, omittedTerminal = 0, selection, stale, onReply, onClear, onAction, onOrigin, onRefresh }: {
    decisions: DecisionView[]; connected: boolean; busy: boolean; error?: string; loading?: boolean; omittedTerminal?: number; selection?: DecisionSelection; stale?: boolean;
    onReply(d: DecisionView): void; onClear(): void; onAction(d: DecisionView, type: 'decision.defer' | 'decision.cancel' | 'decision.reopen'): void; onOrigin(d: DecisionView): void; onRefresh(): void;
}) {
    const panel=useRef<HTMLElement>(null), focusedInside=useRef(false), toggle=useRef<HTMLButtonElement>(null);
    const [expanded,setExpanded]=useState(false), contentId=useId();
    useLayoutEffect(()=>{
        if(focusedInside.current && document.activeElement===document.body){
            (toggle.current ?? panel.current?.querySelector<HTMLButtonElement>('.decisions-heading button') ?? document.getElementById('prompt'))?.focus({preventScroll:true});
        }
    },[decisions,busy,loading,connected,error]);
    const unresolved = decisions.filter(unresolvedDecision), terminal = decisions.filter(d => !unresolvedDecision(d));
    const hasRecords=decisions.length>0 || omittedTerminal>0;
    if(!hasRecords && !selection && !error)return null;
    const row = (d: DecisionView) => <li key={d.decisionId} className="decision-row"><div className="decision-question"><p>{d.question}</p><span className="decision-state">{d.state === 'pending' ? 'Pending' : d.state === 'deferred' ? 'Deferred' : d.state === 'answered' ? 'Answered by Lead' : d.state === 'cancelled' ? 'Cancelled' : 'Superseded'}</span></div><p className="decision-progress">{(unresolvedDecision(d) || d.replies.at(-1)?.stale || d.queuedReplies.length > 0) && decisionReplyStatus(d)}</p>{d.note && <p className="decision-note">{d.note}</p>}<div className="decision-actions"><a href="#conversation" onClick={event => {event.preventDefault(); onOrigin(d);}}>View origin<span className="sr-only"> for {d.question}</span></a>{unresolvedDecision(d) && <><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onReply(d)}>Reply<span className="sr-only"> to {d.question}</span></button><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onAction(d, d.state === 'deferred' ? 'decision.reopen' : 'decision.defer')}>{d.state === 'deferred' ? 'Reopen' : 'Defer'}<span className="sr-only"> {d.question}</span></button><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onAction(d, 'decision.cancel')}>Cancel<span className="sr-only"> decision: {d.question}</span></button></>}</div></li>;
    return <section ref={panel} onFocusCapture={()=>{focusedInside.current=true;}} onBlurCapture={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))focusedInside.current=false;}} className="decisions-panel" aria-label="Decisions" aria-busy={loading || undefined}>
        <div className="decisions-heading"><h2 className="sr-only">Decisions</h2>{hasRecords && <button ref={toggle} className="quiet decisions-toggle" type="button" aria-label={unresolved.length ? `Decisions: ${unresolved.length} open` : 'Decision history'} aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}><span aria-hidden="true">{expanded?'▾':'▸'}</span><span>{unresolved.length?'Decisions':'Decision history'}</span>{unresolved.length>0 && <span className="decisions-count">{unresolved.length} open</span>}</button>}{(expanded||error) && <button className="quiet" type="button" disabled={!connected || busy || loading} onClick={onRefresh}>Refresh<span className="sr-only"> decisions</span></button>}</div>
        {selection && <div id="decision-target-status" className="decision-target" role="status" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClear();}}}><span>{stale ? 'Question changed or closed. Select the current question, or clear this reply target.' : 'Replying to:'} <strong title={selection.question}>{selection.question.length > 128 ? selection.question.slice(0,128)+'…' : selection.question}</strong></span><button type="button" className="quiet" onClick={onClear}>Clear reply target</button></div>}
        {error && <p className="queue-error" role="alert">{error}</p>}
        <div id={contentId} className="decisions-scroll" hidden={!expanded} tabIndex={0} aria-label="Decision list"><ul>{unresolved.map(row)}</ul>{(terminal.length>0||omittedTerminal>0) && <details><summary>Resolved decisions</summary><ul>{terminal.map(row)}</ul>{omittedTerminal > 0 && <p className="decision-note">Earlier decisions remain in session history.</p>}</details>}</div>
    </section>;
}

/** An incomplete history is unavailable; another attempt is never a substitute. */
export function decisionSourceEvent(events: SessionEvent[], source: DecisionSource): SessionEvent | undefined {
    if ('promptId' in source) return events.find(e => e.kind === 'message.completed' && e.data.role === 'user' && e.data.promptId === source.promptId);
    const start = events.find(e => (e.kind === 'task.created' || e.kind === 'task.continued') && (e.source.taskId ?? e.data.taskId) === source.taskId && (e.data.attempt ?? (e.kind === 'task.created' ? 1 : undefined)) === source.attempt);
    if (!start) return undefined;
    const end = events.find(e => e.seq > start.seq && e.kind === 'task.continued' && (e.source.taskId ?? e.data.taskId) === source.taskId)?.seq ?? Infinity;
    return events.find(e => e.seq >= start.seq && e.seq < end && e.kind === 'task.result' && e.source.taskId === source.taskId);
}
export function DecisionOrigin({decision, events, onClose}: {decision: DecisionView; events: SessionEvent[]; onClose():void}) {
    const region = useRef<HTMLElement>(null);
    useLayoutEffect(()=>{region.current?.scrollIntoView({block:'nearest'});region.current?.focus({preventScroll:true});},[decision.decisionId]);
    const source = decision.source, event = decisionSourceEvent(events, source);
    const text = event?.data.text ?? event?.data.summary ?? event?.data.result;
    return <article ref={region} className="task-card decision-origin" tabIndex={-1} aria-label="Decision origin"><div className="decisions-heading"><h3>{'taskId' in source ? `Task ${source.taskId} · Attempt ${source.attempt}` : 'Original user prompt'}</h3><button type="button" className="quiet" onClick={onClose}>Close origin</button></div>{event ? <Markdown text={typeof text === 'string' ? text : 'This outcome has no report text.'}/> : <p role="status">This exact origin is unavailable in the loaded history.</p>}</article>;
}
