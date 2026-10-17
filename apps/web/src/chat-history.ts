import { useEffect, useRef, useState } from 'react';
import { CurrentEvents, HISTORY_WINDOW_SIZE, type HistoryMessage, type HistoryPage } from '../../../packages/core/src/session/chat-history';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { emptyState, reduceEvent, reduceCurrentEvent, type ViewState } from './state';
import type { Api } from './workspace';
export function mergeHistory(old: HistoryMessage[], incoming: HistoryMessage[], direction: 'older' | 'newer' | 'live'): HistoryMessage[] {
    const rows = new Map(old.map(row => [row.historyId, row]));
    for (const row of incoming) {
        const previous = rows.get(row.historyId);
        if (!previous || row.seq > previous.seq || direction !== 'live' && row.seq === previous.seq)
            rows.set(row.historyId, direction === 'live' && previous?.kind === 'message.delta' && row.kind === 'message.delta' && row.seq > previous.seq ? { ...row, ts: previous.ts, data: { ...row.data, text: String(previous.data.text ?? previous.data.delta ?? '') + String(row.data.text ?? row.data.delta ?? '') } } : row);
    }
    const ordered = [...rows.values()].sort((a, b) => a.historyId - b.historyId);
    return direction === 'older' ? ordered.slice(0, HISTORY_WINDOW_SIZE) : ordered.slice(-HISTORY_WINDOW_SIZE);
}
export function snapshotView(events: SessionEvent[], seq: number): ViewState {
    return { ...events.reduce<ViewState>((state, event) => reduceEvent(state, event), { ...emptyState(), grants: [] }), grantsSeq: seq, seq, events };
}
/** Owns a single session generation. Abort and identity checks cover HTTP, live
 * frames and queued React updates; historical pages never reduce current state. */
export function useChatHistory({ api, sessionId, taskId, enabled, revision, onEvent, beforeChange, isFollowing, onHydrated, onView, onConnection, onError }: {
    api: Api;
    sessionId: string;
    taskId?: string;
    enabled: boolean;
    revision: number;
    onEvent: (event: SessionEvent) => void;
    beforeChange: () => void;
    isFollowing: () => boolean;
    onHydrated: (id: string) => void;
    onView: React.Dispatch<React.SetStateAction<ViewState>>;
    onConnection: (value: string) => void;
    onError: (value: string) => void;
}) {
    const [messages, setMessages] = useState<HistoryMessage[]>([]), [loading, setLoading] = useState(false), [historyError, setHistoryError] = useState(''), [bounds, setBounds] = useState<{
        before?: number;
        after?: number;
    }>({});
    const owner = useRef<{
        id: string;
        scope: string;
        controller: AbortController;
        seq: number;
        current: CurrentEvents;
        loading: boolean;
        latestRequested: boolean;
        live: HistoryMessage[];
        floor: number;
        pageRequest?: AbortController;
    } | undefined>(undefined);
    const rows = useRef(messages);
    rows.current = messages;
    const callbacks = useRef({ onEvent, beforeChange, isFollowing, onHydrated, onView, onConnection, onError });
    callbacks.current = { onEvent, beforeChange, isFollowing, onHydrated, onView, onConnection, onError };
    const scope = JSON.stringify([sessionId, taskId]);
    const historySession = useRef('');
    const selectedSession = useRef(scope);
    selectedSession.current = scope;
    useEffect(() => {
        if (historySession.current !== scope || !enabled) {
            historySession.current = scope;
            rows.current = [];
            setMessages([]);
            setBounds({});
            boundsRef.current = {};
        }
        setHistoryError('');
        setLoading(false);
        if (!sessionId || !enabled)
            return;
        const run = { id: sessionId, scope, controller: new AbortController(), seq: 0, current: new CurrentEvents(), loading: false, latestRequested: false, live: [] as HistoryMessage[], floor: 0, pageRequest: undefined as AbortController | undefined };
        owner.current = run;
        let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, attempt = 0;
        const active = () => owner.current === run && selectedSession.current === run.scope && !run.controller.signal.aborted;
        const url = `/api/sessions/${encodeURIComponent(sessionId)}`;
        async function connect() {
            if (!active()) return;
            const generation = ++attempt;
            clearTimeout(timer);
            clearTimeout(deadline);
            request?.abort();
            if (run.pageRequest) {
                run.pageRequest.abort();
                run.pageRequest = undefined;
                run.loading = false;
                run.latestRequested = false;
                setLoading(false);
            }
            socket?.close();
            socket = undefined;
            const controller = new AbortController();
            request = controller;
            const current = () => active() && attempt === generation && !controller.signal.aborted;
            const retry = (delay: number) => {
                if (!current()) return;
                controller.abort();
                clearTimeout(deadline);
                socket?.close();
                callbacks.current.onConnection('Reconnecting');
                timer = setTimeout(() => void connect(), delay);
            };
            deadline = setTimeout(() => {
                if (!current()) return;
                callbacks.current.onError('Connection timed out. Retrying…');
                void connect();
            }, 10000);
            try {
                callbacks.current.onConnection('Reconnecting');
                const page: HistoryPage = await api(`${url}/history${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`, { signal: controller.signal });
                if (!current())
                    return;
                run.seq = page.seq;
                run.live = [];
                run.floor = page.seq;
                run.current = new CurrentEvents();
                for (const event of page.events)
                    run.current.apply(event);
                callbacks.current.onView(snapshotView(page.events, page.seq));
                // Reconnect refreshes controls without moving a reader's historical window.
                if (!rows.current.length || callbacks.current.isFollowing()) {
                    callbacks.current.beforeChange();
                    rows.current = page.messages;
                    setMessages(page.messages);
                    boundsRef.current = { before: page.before, after: page.after };
                    setBounds(boundsRef.current);
                }
                else {
                    callbacks.current.beforeChange();
                    const incoming = new Map(page.messages.map(row => [row.historyId, row]));
                    // Refresh the bounded visible window as well as the tail. A
                    // stream can complete offline long after its first row left
                    // the recent page. Never reduce these historical responses.
                    const visible = rows.current;
                    let before = visible.at(-1)?.historyId;
                    if (before !== undefined) {
                        before++;
                        for (let count = 0; count < Math.ceil(HISTORY_WINDOW_SIZE / 40); count++) {
                            const refreshed: HistoryPage = await api(`${url}/history?before=${before}${taskId ? `&taskId=${encodeURIComponent(taskId)}` : ''}`, { signal: controller.signal });
                            if (!current())
                                return;
                            for (const row of refreshed.messages)
                                incoming.set(row.historyId, row);
                            if (!refreshed.before || refreshed.before <= (visible[0]?.historyId ?? 0))
                                break;
                            before = refreshed.before;
                        }
                    }
                    callbacks.current.beforeChange();
                    const updated = rows.current.map(row => { const fresh = incoming.get(row.historyId); return fresh && fresh.seq >= row.seq ? fresh : row; });
                    rows.current = updated;
                    setMessages(updated);
                    const last = updated.at(-1)?.historyId;
                    if (last !== page.messages.at(-1)?.historyId) {
                        boundsRef.current = { ...boundsRef.current, after: last };
                        setBounds(boundsRef.current);
                    }
                }
                callbacks.current.onHydrated(sessionId);
                const stream = new URL(`${url}/events?after=${run.seq}&view=chat${taskId ? `&taskId=${encodeURIComponent(taskId)}` : ''}`, location.href);
                stream.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                socket = new WebSocket(stream);
                socket.onopen = () => {
                    if (current()) {
                        clearTimeout(deadline);
                        callbacks.current.onError('');
                        callbacks.current.onConnection('Connected');
                    }
                };
                socket.onmessage = message => {
                    if (!current())
                        return;
                    try {
                        const frame = JSON.parse(message.data);
                        if (frame.type === 'resync') {
                            retry(0);
                            return;
                        }
                        const event = frame.event as SessionEvent;
                        if (frame.type !== 'event' || event.sessionId !== sessionId || event.seq <= run.seq)
                            return;
                        if (event.seq !== run.seq + 1) {
                            retry(0);
                            return;
                        }
                        run.seq = event.seq;
                        run.current.apply(event);
                        const evidence = run.current.values();
                        callbacks.current.onView(previous => current() ? reduceCurrentEvent(previous, event, evidence) : previous);
                        callbacks.current.onEvent(event);
                        if (frame.message) {
                            const row = frame.message as HistoryMessage;
                            run.live.push(row);
                            if (run.live.length > 1000)
                                run.floor = run.live.shift()!.seq;
                            const previous = rows.current;
                            if (previous.length && row.historyId < previous[0]!.historyId)
                                return;
                            if (previous.length > 0 && !callbacks.current.isFollowing() && !previous.some(item => item.historyId === row.historyId)) {
                                boundsRef.current = { ...boundsRef.current, after: previous.at(-1)?.historyId };
                                setBounds(boundsRef.current);
                                return;
                            }
                            callbacks.current.beforeChange();
                            if (previous.some(item => item.historyId === row.historyId) || !boundsRef.current.after) {
                                const next = mergeHistory(previous, [row], 'live');
                                rows.current = next;
                                setMessages(next);
                                if (previous[0]?.historyId !== next[0]?.historyId) {
                                    boundsRef.current = { ...boundsRef.current, before: next[0]?.historyId };
                                    setBounds(boundsRef.current);
                                }
                            }
                        }
                    }
                    catch {
                        callbacks.current.onError('Could not read a session update. Reconnect to retry.');
                        retry(1000);
                    }
                };
                socket.onclose = () => retry(1000);
                socket.onerror = () => retry(1000);
            }
            catch (error) {
                if (current()) {
                    retry(2000);
                    callbacks.current.onConnection('Disconnected');
                    callbacks.current.onError((error as Error).message);
                }
            }
        }
        const resume = () => {
            if (document.visibilityState === 'visible' && active()) {
                clearTimeout(timer);
                timer = setTimeout(() => void connect(), 0);
            }
        };
        document.addEventListener('visibilitychange', resume);
        window.addEventListener('online', resume);
        window.addEventListener('focus', resume);
        window.addEventListener('pageshow', resume);
        void connect();
        return () => {
            document.removeEventListener('visibilitychange', resume);
            window.removeEventListener('online', resume);
            window.removeEventListener('focus', resume);
            window.removeEventListener('pageshow', resume);
            run.controller.abort();
            run.pageRequest?.abort();
            request?.abort();
            clearTimeout(deadline);
            clearTimeout(timer);
            socket?.close();
            if (owner.current === run)
                owner.current = undefined;
        };
    }, [api, sessionId, taskId, enabled, revision]);
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;
    async function page(direction: 'older' | 'newer' | 'latest') {
        const run = owner.current;
        if (!run)
            return;
        if (run.loading) {
            if (direction === 'latest')
                run.latestRequested = true;
            return;
        }
        const cursor = direction === 'older' ? boundsRef.current.before : boundsRef.current.after;
        if (direction !== 'latest' && !cursor)
            return;
        const controller = new AbortController();
        run.pageRequest = controller;
        let timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
        run.loading = true;
        setLoading(true);
        setHistoryError('');
        try {
            const query = direction === 'latest' ? '' : `?${direction === 'older' ? 'before' : 'after'}=${cursor}`;
            const result: HistoryPage = await api(`/api/sessions/${encodeURIComponent(run.id)}/history${query}${taskId ? `${query ? '&' : '?'}taskId=${encodeURIComponent(taskId)}` : ''}`, { signal: controller.signal });
            if (owner.current !== run || selectedSession.current !== run.scope || run.controller.signal.aborted || controller.signal.aborted)
                return;
            callbacks.current.beforeChange();
            if ((direction === 'latest' || direction === 'newer' && !result.after) && result.seq < run.floor)
                throw new Error('History changed too quickly. Try again.');
            const previous = rows.current;
            let next = direction === 'latest' ? result.messages : mergeHistory(previous, result.messages, direction);
            if (direction === 'latest' || direction === 'newer' && !result.after) {
                for (const row of run.live) {
                    if (row.seq > result.seq && (!next.length || row.historyId >= next[0]!.historyId))
                        next = mergeHistory(next, [row], 'live');
                }
            }
            setMessages(next);
            rows.current = next;
            const nextBounds = direction === 'latest' ? { before: result.before, after: result.after } : direction === 'older' ? { before: result.before, after: next.at(-1)?.historyId !== previous.at(-1)?.historyId ? next.at(-1)?.historyId : boundsRef.current.after } : { before: next[0]?.historyId !== previous[0]?.historyId ? next[0]?.historyId : boundsRef.current.before, after: result.after };
            boundsRef.current = nextBounds;
            setBounds(nextBounds);
        }
        catch (error) {
            if (owner.current === run && run.pageRequest === controller && selectedSession.current === run.scope && !run.controller.signal.aborted && (!controller.signal.aborted || timedOut))
                setHistoryError(timedOut ? 'History request timed out. Try again.' : (error as Error).message);
        }
        finally {
            clearTimeout(deadline);
            if (owner.current === run && run.pageRequest === controller) {
                run.pageRequest = undefined;
                run.loading = false;
                setLoading(false);
                if (run.latestRequested) {
                    run.latestRequested = false;
                    void page('latest');
                }
            }
        }
    }
    return { messages: historySession.current === scope ? messages : [], loading, error: historyError, ...(historySession.current === scope ? bounds : {}), older: () => page('older'), newer: () => page('newer'), latest: () => page('latest') };
}
