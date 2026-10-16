import React, { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChatHistory } from './chat-history';
import { conversationEvents, type ConversationEvent } from './state';
import type { Api } from './workspace';
const ignore = () => { };
/** Task details use the same bounded transport as the main conversation, while
 * the parent's compact snapshot continues to own current controls and task state. */
export function ProgressiveTranscript({ api, sessionId, taskId, active, label, children }: {
    api: Api;
    sessionId: string;
    taskId: string;
    active: boolean;
    label: string;
    children: (messages: ConversationEvent[]) => ReactNode;
}) {
    const [connection,setConnection]=useState('Connecting'),[error,setError]=useState(''),[revision,setRevision]=useState(0);
    const viewport = useRef<HTMLDivElement>(null), following = useRef(true), gesture = useRef(false), touch = useRef<number | undefined>(undefined);
    const anchor = useRef<{
        id: string;
        offset: number;
    } | undefined>(undefined), restored = useRef(false);
    const capture = () => { const element = viewport.current; if (!element?.clientHeight || following.current)
        return; const top = element.getBoundingClientRect().top; const row = [...element.querySelectorAll<HTMLElement>('[data-history-id]')].find(row => row.getBoundingClientRect().bottom > top); if (row)
        anchor.current = { id: row.dataset.historyId!, offset: row.getBoundingClientRect().top - top }; };
    const restore = () => { const element = viewport.current, saved = anchor.current; if (!element?.clientHeight || !saved || following.current)
        return; const row = element.querySelector<HTMLElement>(`[data-history-id="${saved.id}"]`); if (row)
        element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset; };
    const history = useChatHistory({ api, sessionId, taskId, enabled: active, revision, beforeChange: capture, isFollowing: () => following.current, onEvent: ignore, onView: ignore, onConnection:setConnection,onError:setError,onHydrated:()=>setError('') });
    useLayoutEffect(() => { if (active) {
        restored.current = false;
        following.current = true;
        anchor.current = undefined;
    } }, [active]);
    const messages = useMemo(() => history.messages.map(event => ({ id: event.historyId, messages: conversationEvents([...(event.request ? [event.request] : []), event], taskId) })), [history.messages, taskId]);
    useLayoutEffect(() => { const element = viewport.current; if (!element || !active)
        return; if (!restored.current && messages.length) {
        restored.current = true;
        following.current = true;
    } if (following.current)
        element.scrollTop = element.scrollHeight;
    else
        restore(); }, [messages, active]);
    useLayoutEffect(() => { const element = viewport.current; if (!element || !active)
        return; const observer = new ResizeObserver(() => { if (following.current)
        element.scrollTop = element.scrollHeight;
    else
        restore(); }); observer.observe(element); if (element.firstElementChild)
        observer.observe(element.firstElementChild); return () => observer.disconnect(); }, [active]);
    function navigate(older: boolean) { const element = viewport.current; if (!element)
        return; const bottom = element.scrollHeight - element.scrollTop - element.clientHeight; if (!older && !history.after && bottom < 24) {
        following.current = true;
        anchor.current = undefined;
        return;
    } following.current = false; gesture.current = true; if (older && element.scrollTop < 200) {
        gesture.current = false;
        void history.older();
    }
    else if (!older && history.after && bottom < 200) {
        gesture.current = false;
        void history.newer();
    } }
    return <div className="transcript-frame"><div ref={viewport} className="task-transcript task-transcript--full progressive-transcript" tabIndex={0} role="log" aria-live="off" aria-label={label} onWheelCapture={event => navigate(event.deltaY < 0)} onKeyDownCapture={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key))
        navigate(true); if (['ArrowDown', 'PageDown', 'End'].includes(event.key))
        navigate(false); }} onTouchStartCapture={event => { touch.current = event.touches[0]?.clientY; }} onTouchMoveCapture={event => { const y = event.touches[0]?.clientY; if (y !== undefined && touch.current !== undefined)
        navigate(y > touch.current); touch.current = y; }} onPointerDownCapture={() => { gesture.current = true; }} onScroll={() => { const element = viewport.current; if (!element || history.loading)
        return; following.current = !history.after && element.scrollHeight - element.scrollTop - element.clientHeight < 24; if (following.current)
        anchor.current = undefined;
    else
        capture(); if (gesture.current) {
        if (element.scrollTop < 200) {
            gesture.current = false;
            void history.older();
        }
        else if (history.after && element.scrollHeight - element.scrollTop - element.clientHeight < 200) {
            gesture.current = false;
            void history.newer();
        }
    } }}><div><div className="history-navigation">{history.before && <button className="quiet" type="button" disabled={history.loading} onClick={() => { following.current = false; void history.older(); }}>Older messages</button>}{(history.error||error)&&<p role="alert">{history.error||error}<button className="quiet" type="button" onClick={()=>setRevision(value=>value+1)}>Retry history</button></p>}{connection!=='Connected'&&<span role="status">Loading conversation…</span>}</div>{messages.map(row => <div key={row.id} data-history-id={row.id}>{children(row.messages)}</div>)}{history.after && <button className="quiet" type="button" disabled={history.loading} onClick={() => void history.newer()}>Newer messages</button>}</div></div>{history.after && <button className="transcript-latest" type="button" onClick={() => { following.current = true; anchor.current = undefined; void history.latest(); }}>New messages ↓</button>}</div>;
}
