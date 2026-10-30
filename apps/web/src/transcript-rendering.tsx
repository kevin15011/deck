import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Markdown } from './markdown';

type Row = { historyId: number; kind: string; data: Record<string, unknown> };
type Job = { node: HTMLElement; render: () => void };

/** Only formatting is queued: the complete fetched text stays searchable and
 * copyable. At most two dense mounts per paint opportunity keep input usable. */
export function useTranscriptRendering(rows: Row[], session: string, active: boolean,
    viewport: RefObject<HTMLElement | null>, beforeChange: () => void, afterChange: () => void) {
    const settings = useRef({ session, active, beforeChange, afterChange });
    settings.current = { session, active, beforeChange, afterChange };
    const queue = useMemo(() => {
        const jobs = new Map<number, Job>();
        let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, running = false;
        const stop = () => { cancelAnimationFrame(frame); clearTimeout(timer); running = false; };
        const schedule = () => {
            if (running || settings.current.session !== session || !settings.current.active || !jobs.size) return;
            running = true;
            frame = requestAnimationFrame(() => { timer = setTimeout(() => {
                running = false;
                if (settings.current.session !== session || !settings.current.active) return;
                const selection = window.getSelection();
                const batch = [...jobs.entries()].reverse().filter(([, { node }]) => {
                    if (!node.isConnected || node.contains(document.activeElement)) return false;
                    for (let i = 0; selection && !selection.isCollapsed && i < selection.rangeCount; i++)
                        if (selection.getRangeAt(i).intersectsNode(node)) return false;
                    return true;
                }).slice(0, 2);
                if (!batch.length) return; // selectionchange/focusout resumes held rows.
                settings.current.beforeChange();
                for (const [id, job] of batch) { jobs.delete(id); job.render(); }
            }, 0); });
        };
        return {
            add(id: number, job: Job) { jobs.set(id, job); schedule(); return () => { if (jobs.get(id) === job) jobs.delete(id); }; },
            committed() { settings.current.afterChange(); schedule(); },
            schedule, stop,
        };
    }, [session]);
    const previous = useRef<{ queue: typeof queue; known: Set<number>; deferred: Set<number> } | undefined>(undefined);
    const plan = useMemo(() => {
        const prior = previous.current?.queue === queue ? previous.current : undefined;
        const known = new Set(rows.map(row => row.historyId));
        const deferred = new Set([...(prior?.deferred ?? [])].filter(id => known.has(id)));
        const added = rows.filter(row => !prior?.known.has(row.historyId));
        const expensive = added.filter(row => row.kind === 'message.completed' && String(row.data.text ?? row.data.delta ?? '').length > 2000);
        // Live single insertions and short prose stay on the normal path. For
        // history batches the latest dense answer is immediately formatted.
        if (expensive.length > 1) for (const row of expensive.slice(0, -1)) deferred.add(row.historyId);
        return { queue, known, deferred };
    }, [rows, queue]);
    useLayoutEffect(() => { previous.current = plan; queue.schedule(); }, [plan, queue]);
    useEffect(() => {
        if (!active) { queue.stop(); return; }
        queue.schedule();
        const root = viewport.current;
        document.addEventListener('selectionchange', queue.schedule);
        root?.addEventListener('focusout', queue.schedule);
        return () => { queue.stop(); document.removeEventListener('selectionchange', queue.schedule); root?.removeEventListener('focusout', queue.schedule); };
    }, [queue, active, viewport]);
    return { queue, deferred: plan.deferred };
}

/** Local state avoids rerendering the workspace on every formatting commit.
 * History hydration has no entrance animation; live user motion stays upstream. */
export function TranscriptMarkdown({ text, id, renderer }: { text: string; id: number; renderer: ReturnType<typeof useTranscriptRendering> }) {
    const [ready, setReady] = useState(!renderer.deferred.has(id));
    const node = useRef<HTMLDivElement>(null), filled = useRef(false);
    const queue = renderer.queue;
    useEffect(() => {
        if (ready || !node.current) return;
        return queue.add(id, { node: node.current, render: () => { filled.current = true; setReady(true); } });
    }, [queue, id, ready]);
    useLayoutEffect(() => { if (filled.current) { filled.current = false; queue.committed(); } }, [ready, queue]);
    return ready ? <Markdown text={text}/> : <div ref={node} className="markdown" data-markdown-pending="" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</div>;
}
