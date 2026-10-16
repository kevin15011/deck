import React, { useCallback, useSyncExternalStore, type ReactNode } from 'react';
/** Only the active composer subscribes. Async submissions can clear their own
 * session's draft even if the user switched away and back during the request. */
export class DraftStore extends Map<string, string> {
    private listeners = new Map<string, Set<() => void>>();
    override set(sessionId: string, text: string) {
        if (this.get(sessionId) === text)
            return this;
        super.set(sessionId, text);
        this.listeners.get(sessionId)?.forEach(listener => listener());
        return this;
    }
    subscribe(sessionId: string, listener: () => void) {
        let listeners = this.listeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(sessionId, listeners);
        }
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (!listeners.size)
                this.listeners.delete(sessionId);
        };
    }
}
/** Keystrokes stay below the workspace and history render boundary. */
export function DraftBoundary({ sessionId, drafts, children }: {
    sessionId: string;
    drafts: DraftStore;
    children: (text: string, setText: (value: string) => void) => ReactNode;
}) {
    const subscribe = useCallback((listener: () => void) => drafts.subscribe(sessionId, listener), [drafts, sessionId]);
    const read = () => drafts.get(sessionId) ?? '';
    const text = useSyncExternalStore(subscribe, read, read);
    return children(text, value => drafts.set(sessionId, value));
}
