import React, { useId } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { ContextWindowProjection, sanitizeContextObservation } from '../../../packages/core/src/session/context-window';
import { isLeadEvent } from './event-source';

export type ContextWindowIndex = {
    readonly events: readonly SessionEvent[];
    readonly sessionId: string;
    get(taskId?: string): SessionEvent | undefined;
};

/** One pass per immutable event set/session. The workspace owns and memoizes
 * this value; Lead, cards and details only look up their task. No global cache. */
export function projectContextWindows(events: readonly SessionEvent[], sessionId: string): ContextWindowIndex {
    const projection = new ContextWindowProjection();
    let leadTask = 'lead';
    for (const event of events) {
        if (event.sessionId !== sessionId) continue;
        if (isLeadEvent(event) && ['task.created', 'task.continued', 'turn.started'].includes(event.kind)) leadTask = event.source.taskId ?? 'lead';
        projection.apply(event);
    }
    const tasks = new Map(projection.values().map(event => [event.source.taskId, event]));
    return { events, sessionId, get: (taskId = leadTask) => tasks.get(taskId) };
}

/** A stale index from another session or immutable event set is never reused. */
export function contextIndexForEvents(events: readonly SessionEvent[], sessionId: string, provided?: ContextWindowIndex): ContextWindowIndex {
    return provided?.events === events && provided.sessionId === sessionId ? provided : projectContextWindows(events, sessionId);
}

const basis = {
    'codex-last-total': 'last native total',
    'claude-aggregate-input': 'aggregate input',
    'opencode-message-input': 'last message input',
} as const;
const number = (value: number) => value.toLocaleString('en-US');

/** Native details stays discoverable on touch and keyboard, including when no
 * measurement is available. No progressbar: these are not occupancy ratios. */
export function ContextWindowIndicator({ observation }: { observation?: SessionEvent }) {
    const id = useId(), c = sanitizeContextObservation(observation?.data.context);
    const label = c ? `Context · ${c.tokens === null ? 'counter unavailable' : `${number(c.tokens)} ${basis[c.basis]}`} · last reported` : 'Context unavailable';
    return <details className="context-window"><summary aria-describedby={id}>{label}</summary><div id={id} className="context-window-details">
        <p>{c ? 'Last reported native counter. Current context used and percentage are unavailable; this counter does not measure current occupancy.' : 'The runner has not provided a compatible context observation for this attempt. Current context used, capacity and percentage are unavailable.'}</p>
        {c && <><p>Capacity: {c.capacity === null ? 'unavailable' : `${number(c.capacity)} tokens`}.</p><p>Basis: {basis[c.basis]}. Cached input is not added.{c.basis === 'claude-aggregate-input' ? ' Aggregate accounting may span calls or models.' : ''}</p><p>Model: {c.modelId ?? 'unavailable'}. Attempt {String(observation?.data.attempt)} · observed <time dateTime={observation?.ts}>{observation?.ts}</time>.</p></>}
    </div></details>;
}
