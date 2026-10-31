import React from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { ContextWindowProjection, sanitizeContextObservation, contextEstimate } from '../../../packages/core/src/session/context-window';
import { isLeadEvent } from './event-source';
import { SecondaryInfo } from './secondary-info';

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

const number = (value: number) => value.toLocaleString('en-US');
const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(value).toLowerCase();
const notes = {
    'codex-last-total': 'Codex estimate: the percentage reserves a 12,000-token baseline; counts show the full window.',
    'claude-last-request-input': 'Latest response input, including cache. Output is excluded.',
    'opencode-assistant-context': 'Latest assistant response, including output, reasoning and cache.',
    'claude-aggregate-input': 'Earlier aggregate accounting; context usage updates with the next compatible response.',
    'opencode-message-input': 'Earlier input-only accounting; context usage updates with the next compatible response.',
} as const;

export function contextSummary(value: unknown): string {
    const { used, max, percent } = contextEstimate(value);
    if (percent !== null && used !== null && max !== null) return `≈${percent}% · ${compact(used)} / ${compact(max)}`;
    if (used !== null) return `${compact(used)} used`;
    if (max !== null) return `${compact(max)} max`;
    return 'Context unavailable';
}

export function ContextWindowContent({ observation }: { observation?: SessionEvent }) {
    const c = sanitizeContextObservation(observation?.data.context);
    const { used, max, percent } = contextEstimate(c);
    const observed = observation?.ts && Number.isFinite(Date.parse(observation.ts)) ? new Date(observation.ts) : undefined;
    return <><p className="secondary-info-kicker">Context window</p>
        <p className="secondary-info-primary">{percent !== null ? <>≈{percent}%<span> used</span></> : used !== null ? <>{number(used)}<span> tokens used</span></> : max !== null ? <>{number(max)}<span> token maximum</span></> : 'Not reported yet'}</p>
        {percent !== null && used !== null && max !== null && <p className="secondary-info-caption context-window-counts">{number(used)} <span>/ {number(max)} tokens</span></p>}
        {c ? <><p className="secondary-info-note">{notes[c.basis]}</p>
            <dl className="secondary-info-facts">{c.modelId && <div><dt>Model</dt><dd>{c.modelId}</dd></div>}</dl>
            {observed && <p className="secondary-info-note">Last observed <time dateTime={observation?.ts} title={observed.toISOString()}>{observed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>{observation?.data.attempt ? ` · Attempt ${String(observation.data.attempt)}` : ''}</p>}</> : <p className="secondary-info-note">Updates when the runner reports context usage.</p>}
    </>;
}

/** The same compact summary is used beside Lead status and task headings. */
export function ContextWindowIndicator({ observation, owner = 'Agent' }: { observation?: SessionEvent; owner?: string }) {
    const summary = contextSummary(observation?.data.context);
    return <SecondaryInfo title={`${owner} context`} label={summary} accessibleLabel={`${owner} context details: ${summary === 'Context unavailable' ? 'unavailable' : summary}`} className="context-window" resetKey={`${observation?.source.taskId ?? owner}:${String(observation?.data.attempt ?? '')}`}><ContextWindowContent observation={observation}/></SecondaryInfo>;
}
