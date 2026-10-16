import React, { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
export type LeadActivity = { taskId?: string; state: string; pendingApprovals: number; lastReplySeq: number };
export function indicatorState(state: string, approvals = 0) {
    if (approvals) return 'approval';
    if (state === 'running') return 'working';
    if (['failed', 'ownership-unsettled'].includes(state)) return 'error';
    if (['queued', 'preparing', 'created'].includes(state)) return 'waiting';
    if (state === 'completed') return 'completed';
    if (['cancelled', 'interrupted'].includes(state)) return 'stopped';
    return 'idle';
}
export function leadActivityFromEvents(events: SessionEvent[], taskId: string): LeadActivity {
    let state = 'idle', preparing = false, lastReplySeq = 0;
    const approvals = new Set<string>();
    for (const event of events) {
        const owner = String(event.source.taskId ?? event.data.taskId ?? '');
        const lead = /^lead(?:-g[1-9]\d*)?$/.test(owner) && (event.source.memberId === undefined || event.source.memberId === 'lead');
        if (lead && event.kind === 'message.completed' && !event.data.internal && event.data.role === 'assistant' && typeof event.data.text === 'string' && event.data.text.trim()) lastReplySeq = event.seq;
        if (event.kind === 'diagnostic' && event.data.code === 'session.preparation' && Number(event.data.generation ?? 0) === (taskId === 'lead' ? 0 : Number(taskId.slice(6)))) { preparing = event.data.status === 'preparing'; }
        if (event.kind === 'approval.resolved') approvals.delete(String(event.data.approvalId));
        if (owner !== taskId) continue;
        if (event.kind === 'task.state') state = String(event.data.state ?? state);
        if (event.kind === 'approval.requested') approvals.add(String(event.data.approvalId));
        if (event.kind === 'approval.resolved') approvals.delete(String(event.data.approvalId));
    }
    return { taskId, state: preparing ? 'preparing' : state, pendingApprovals: approvals.size, lastReplySeq };
}
export function replyForTask(events: SessionEvent[], taskId: string) {
    let attempt = 1, assistant: { seq: number; text: string; attempt: number } | undefined, result: typeof assistant;
    for (const event of events) {
        if ((event.source.taskId ?? event.data.taskId) !== taskId || event.data.internal === true) continue;
        if (event.kind === 'task.created' || event.kind === 'task.continued') { attempt = Number(event.data.attempt ?? (event.kind === 'task.continued' ? attempt + 1 : 1)); assistant = result = undefined; }
        if (event.kind === 'message.completed' && (event.data.role === undefined || event.data.role === 'assistant') && typeof event.data.text === 'string' && event.data.text.trim()) assistant = { seq: event.seq, text: event.data.text, attempt };
        if (event.kind === 'task.result' && typeof event.data.summary === 'string' && event.data.summary.trim()) result = { seq: event.seq, text: event.data.summary, attempt };
    }
    const reply = assistant ?? result;
    return reply ? { ...reply, resultText: result?.text } : undefined;
}
export type ReadMarkers = Record<string, number>;
export function advanceRead(markers: ReadMarkers, key: string, seq: number): ReadMarkers {
    return Number.isSafeInteger(seq) && seq > (markers[key] ?? 0) ? { ...markers, [key]: seq } : markers;
}
export function useReadMarkers() {
    const [markers, setMarkers] = useState<ReadMarkers>(() => {
        try { const value = JSON.parse(localStorage.getItem('deck.read-replies') ?? '{}'); return Object.fromEntries(Object.entries(value).filter(([key, seq]) => key.length < 300 && Number.isSafeInteger(seq) && Number(seq) >= 0)) as ReadMarkers; } catch { return {}; }
    });
    useEffect(() => { try { const stored = JSON.parse(localStorage.getItem('deck.read-replies') ?? '{}'); const merged = Object.entries(stored).reduce((next, [key, seq]) => advanceRead(next, key, Number(seq)), markers); localStorage.setItem('deck.read-replies', JSON.stringify(merged)); if (merged !== markers) setMarkers(merged); } catch { /* Read feedback still works without persistence. */ } }, [markers]);
    useEffect(() => { const changed = (event: StorageEvent) => { if (event.key !== 'deck.read-replies') return; try { const incoming = JSON.parse(event.newValue ?? '{}'); setMarkers(old => Object.entries(incoming).reduce((next, [key, seq]) => advanceRead(next, key, Number(seq)), old)); } catch { } }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, []);
    return { markers, acknowledge: (key: string, seq: number) => setMarkers(old => advanceRead(old, key, seq)) };
}
const labels = { working: 'Working', approval: 'Waiting for approval', waiting: 'Waiting', error: 'Error', completed: 'Completed', stopped: 'Stopped', idle: 'Idle' };
export const indicatorLabel = (state: string, approvals = 0, unread = false) => `${labels[indicatorState(state, approvals)]}${unread ? ' · Unread reply' : ''}`;
export function StatusIndicator({ state, approvals = 0, unread = false }: { state: string; approvals?: number; unread?: boolean }) {
    const kind = indicatorState(state, approvals), ref = useRef<HTMLSpanElement>(null), [onscreen, setOnscreen] = useState(false), [pageVisible, setPageVisible] = useState(typeof document !== 'undefined' && document.visibilityState === 'visible');
    useEffect(() => { const observer = new IntersectionObserver(([entry]) => setOnscreen(!!entry?.isIntersecting)); if (ref.current) observer.observe(ref.current); const show = () => setPageVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', show); return () => { observer.disconnect(); document.removeEventListener('visibilitychange', show); }; }, []);
    const label = indicatorLabel(state, approvals, unread);
    return <span ref={ref} className={`agent-indicator agent-indicator--${kind}`} data-state={kind} data-unread={unread || undefined} data-animate={kind === 'working' && onscreen && pageVisible || undefined} role="img" aria-label={label} title={label}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{kind === 'working' ? <path key="working" className="work-orbit" d="M8 2a6 6 0 1 1-6 6"/> : kind === 'completed' ? <path key="completed" d="m3 8 3 3 7-7"/> : kind === 'error' ? <><path d="m8 2 6 11H2Z"/><path d="M8 6v3m0 2h.01"/></> : kind === 'approval' ? <><path d="M5 2h6v3L8 8l3 3v3H5v-3l3-3-3-3Z"/></> : kind === 'waiting' ? <><circle cx="8" cy="8" r="5.5"/><path d="M8 4v4l2 1"/></> : kind === 'stopped' ? <rect x="4" y="4" width="8" height="8" rx="1"/> : <circle cx="8" cy="8" r="3"/>}</svg>{unread && <svg className="unread-dot" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>}</span>;
}
/** A read acknowledgement is tied to this exact rendered response, never to a newer poll cursor. */
export function VisibleReply({ children, visible, replyKey, seq, acknowledge, className }: { children: React.ReactNode; visible: boolean; replyKey: string; seq: number; acknowledge: (key: string, seq: number) => void; className?: string }) {
    const ref = useRef<HTMLDivElement>(null), callback = useRef(acknowledge); callback.current = acknowledge;
    useEffect(() => {
        if (!visible || !seq || !ref.current) return;
        const element = ref.current;
        let intersecting = false;
        const check = () => {
            if (!intersecting || element.closest('details:not([open])') || document.visibilityState !== 'visible' || !document.hasFocus() || document.querySelector('dialog[open]')) return;
            const bounds = element.getBoundingClientRect(), viewport = element.closest('.conversation, .workspace-panel')?.getBoundingClientRect();
            if (!viewport || bounds.width <= 0 || bounds.height <= 0) return;
            if (Math.min(bounds.bottom, viewport.bottom, innerHeight) > Math.max(bounds.top, viewport.top, 0) && Math.min(bounds.right, viewport.right, innerWidth) > Math.max(bounds.left, viewport.left, 0)) callback.current(replyKey, seq);
        };
        const observer = new IntersectionObserver(([entry]) => { intersecting = !!entry?.isIntersecting; check(); }, { root: element.closest('.conversation, .workspace-panel') }); observer.observe(element);
        const mutations = new MutationObserver(check); mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
        document.addEventListener('visibilitychange', check); window.addEventListener('focus', check); element.closest('.conversation, .workspace-panel')?.addEventListener('scroll', check, { passive: true }); check();
        return () => { observer.disconnect(); mutations.disconnect(); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); element.closest('.conversation, .workspace-panel')?.removeEventListener('scroll', check); };
    }, [visible, replyKey, seq]);
    return <div ref={ref} className={className} data-reply-seq={seq || undefined}>{children}</div>;
}
