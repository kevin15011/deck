import { ClaudeStreamMapper } from '../../../packages/adapter-claude/src/session-driver/mapper';
import { fixtureLines } from '../../../packages/adapter-claude/src/session-driver/fixtures';
import React from 'react';
import { expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { CurrentEvents } from '../../../packages/core/src/session/chat-history';
import { ContextWindowProjection } from '../../../packages/core/src/session/context-window';
import { ContextWindowIndicator, ContextWindowContent, projectContextWindows } from './context-window';
import { LeadProgress } from './lead-progress';
import { Subagents } from './workspace';
import { snapshotView } from './chat-history';
import { emptyState, reduceEvent } from './state';

const e = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown> = {}, taskId = 'lead'): SessionEvent => ({ v: 1, sessionId: 's', seq, ts: '2026-10-22T00:00:00Z', kind, source: { taskId, memberId: taskId === 'lead' ? 'lead' : 'deck-apply-deep', runnerId: 'codex', nativeSessionId: `thread-${taskId}` }, data });
const usage = (seq: number, taskId = 'lead') => e(seq, 'usage', { attempt: 1, context: { basis: 'codex-last-total', tokens: 34794, capacity: 258400, nativeThreadId: `thread-${taskId}`, nativeTurnId: 'turn', modelId: 'model' } }, taskId);
const events = [e(1, 'task.created', { taskId: 'lead', attempt: 1 }), e(2, 'turn.started', { attempt: 1, nativeTurnId: 'turn' }), usage(3), e(4, 'task.created', { taskId: 'child', attempt: 1, state: 'running' }, 'child'), e(5, 'turn.started', { attempt: 1, nativeTurnId: 'turn' }, 'child'), usage(6, 'child')];

test('native context summary shows baseline-adjusted percent and full counts in the panel', () => {
    const html = renderToStaticMarkup(<ContextWindowContent observation={usage(3)}/>);
    expect(html).toContain('34,794'); expect(html).toContain('258,400');
    expect(html).toContain('≈9%'); expect(html).toContain('12,000');
    expect(html).toContain('Last observed'); expect(html).not.toContain('Unavailable');
    const trigger = renderToStaticMarkup(<ContextWindowIndicator observation={usage(3)}/>);
    expect(trigger).toContain('≈9% · 34.8k / 258k');
    expect(trigger).not.toContain('native total'); expect(trigger).not.toContain('<details');
    const unavailable = renderToStaticMarkup(<ContextWindowIndicator/>);
    expect(unavailable).toContain('Context unavailable'); expect(unavailable).not.toContain('0 tokens');
    expect(unavailable).toContain('aria-haspopup="dialog"');
});

test('partial and legacy observations never invent a percentage or zero', () => {
    const observation = (patch: object) => ({ ...usage(3), data: { attempt: 1, context: { ...(usage(3).data.context as object), ...patch } } });
    for (const [patch, label] of [[{ tokens: null }, '258k max'], [{ capacity: null }, '34.8k used'], [{ basis: 'claude-aggregate-input' }, '258k max'], [{ basis: 'opencode-message-input' }, '258k max']] as const) {
        const html = renderToStaticMarkup(<ContextWindowIndicator observation={observation(patch)}/>);
        expect(html).toContain(label); expect(html).not.toContain('%'); expect(html).not.toContain('progressbar');
    }
    for (const basis of ['claude-last-request-input', 'opencode-assistant-context']) {
        expect(renderToStaticMarkup(<ContextWindowIndicator observation={observation({ basis })}/>)).toContain('≈13% · 34.8k / 258k');
    }
});

test('real Lead and subagent render paths agree live, completed and reconnected', () => {
    let live = emptyState(); const current = new CurrentEvents();
    const check = () => {
        const snapshot = snapshotView(current.values(), live.seq);
        for (const view of [live, snapshot]) {
            const lead = renderToStaticMarkup(<LeadProgress events={view.events} sessionId="s"/>);
            const subagents = renderToStaticMarkup(<Subagents view={view} sessionId="s"/>);
            expect(lead).toContain('≈9% · 34.8k / 258k');
            expect(subagents).toContain('≈9% · 34.8k / 258k');
            expect(subagents).toContain('Apply Deep');
        }
    };
    for (const event of events) { live = reduceEvent(live, event); current.apply(event); }
    check();
    for (const task of ['lead', 'child']) {
        const event = e(live.seq + 1, 'turn.completed', { status: 'completed', attempt: 1 }, task);
        live = reduceEvent(live, event); current.apply(event);
    }
    check();
    const continued = e(live.seq + 1, 'task.continued', { attempt: 2 }, 'child');
    live = reduceEvent(live, continued); current.apply(continued);
    for (const view of [live, snapshotView(current.values(), live.seq)]) expect(renderToStaticMarkup(<Subagents view={view} sessionId="s"/>)).toContain('Context unavailable');
    expect(projectContextWindows(live.events, 'foreign').get()).toBeUndefined();
});

test('mobile and desktop Lead share the indicator and disclosure stays in existing typography', () => {
    for (const mobile of [true, false]) {
        const html = renderToStaticMarkup(<LeadProgress events={events} sessionId="s" mobile={mobile} progress={{ phase: 'tool', label: 'Using tool…' }}/>);
        expect(html).toContain('≈9% · 34.8k / 258k');
        expect(html).toContain('Using tool…');
        expect(html).toContain('aria-haspopup=');
        if (mobile) expect(html).toContain('mobile-progress');
    }
});

test.each(['codex', 'opencode', 'claude'])('%s late identity remains visible through actual Lead/cards after snapshot and rebuild', runnerId => {
    let seq = 0, live = emptyState(); const current = new CurrentEvents();
    const append = (taskId: string, kind: SessionEvent['kind'], data: Record<string, unknown>, native = false) => {
        const event = e(++seq, kind, data, taskId);
        event.source = { ...event.source, runnerId };
        if (!native) delete event.source.nativeSessionId;
        live = reduceEvent(live, event); current.apply(event);
    };
    const check = () => {
        const rebuilt = new CurrentEvents(); current.values().forEach(e => rebuilt.apply(e));
        for (const view of [live, snapshotView(current.values(), seq), snapshotView(rebuilt.values(), seq)]) {
            const label = '≈0% · 100 / 258k';
            expect(projectContextWindows(view.events, 's').get()?.data.context).toMatchObject({tokens:100});
            expect(renderToStaticMarkup(<LeadProgress events={view.events} sessionId="s"/>)).toContain(label);
            expect(renderToStaticMarkup(<Subagents view={view} sessionId="s"/>)).toContain(label);
        }
    };
    for (const taskId of ['lead', 'child']) {
        append(taskId, 'task.created', { taskId, attempt: 1, state: 'running' });
        append(taskId, 'task.state', { state: 'running', nativeSessionId: `thread-${taskId}` }, true);
        append(taskId, 'turn.started', { attempt: 1, nativeTurnId: 'turn' });
        append(taskId, 'usage', { attempt: 1, context: { ...(usage(1, taskId).data.context as object), basis: runnerId === 'codex' ? 'codex-last-total' : runnerId === 'claude' ? 'claude-last-request-input' : 'opencode-assistant-context', tokens: 100 } }, true);
        append(taskId, 'task.state', { state: 'running', attempt: 1 });
    }
    check();
    for (const taskId of ['lead', 'child']) {
        append(taskId, 'turn.completed', { status: 'completed', attempt: 1 }, true);
        append(taskId, 'task.state', { state: 'completed', attempt: 1 }, true);
    }
    check();
});

test('a 300-card roster projects context once, rather than replaying every task for every card', () => {
    const roster: SessionEvent[] = [];
    for (let n = 0; n < 300; n++) {
        const taskId = `child-${n}`;
        roster.push(e(roster.length + 1, 'task.created', { taskId, attempt: 1, state: 'running' }, taskId),
            e(roster.length + 2, 'turn.started', { attempt: 1, nativeTurnId: 'turn' }, taskId), usage(roster.length + 3, taskId));
    }
    const view = snapshotView(roster, roster.length), apply = spyOn(ContextWindowProjection.prototype, 'apply');
    try {
        const html = renderToStaticMarkup(<Subagents view={view} sessionId="s"/>);
        expect(html.match(/>≈9% · 34\.8k \/ 258k/g)).toHaveLength(300);
        expect(apply.mock.calls.length).toBe(roster.length);
    } finally { apply.mockRestore(); }
});

test('Lead/cards share one index, while new immutable events or another session reject a stale supplied index', () => {
    const view = snapshotView(events, events.length), apply = spyOn(ContextWindowProjection.prototype, 'apply');
    try {
        const contexts = projectContextWindows(view.events, 's');
        const html = renderToStaticMarkup(<><LeadProgress events={view.events} sessionId="s" contexts={contexts}/><LeadProgress events={view.events} sessionId="s" contexts={contexts} mobile/><Subagents view={view} sessionId="s" contexts={contexts}/></>);
        expect(html.match(/>≈9% · 34\.8k \/ 258k/g)).toHaveLength(3);
        for (let n = 0; n < 300; n++) expect(contexts.get('child')?.data.context).toMatchObject({ tokens: 34794 });
        expect(apply.mock.calls.length).toBe(events.length);
        const next = snapshotView([...events, e(7, 'task.continued', { attempt: 2 }, 'child')], 7);
        expect(renderToStaticMarkup(<Subagents view={next} sessionId="s" contexts={contexts}/>)).toContain('Context unavailable');
        const foreignLead = renderToStaticMarkup(<LeadProgress events={view.events} sessionId="another-session" contexts={contexts}/>);
        expect(foreignLead).toContain('Context unavailable');
        expect(foreignLead).not.toContain('34,794');
        // A native observation from a different immutable event set replaces,
        // rather than reusing, the old Lead value even when a caller supplies it.
        const updated = [...events, { ...usage(8), data: { attempt: 1, context: { ...(usage(8).data.context as object), tokens: 100 } } }];
        expect(projectContextWindows(updated, 's').get()?.data.context).toMatchObject({tokens:100});
        expect(renderToStaticMarkup(<LeadProgress events={updated} sessionId="s" contexts={contexts}/>)).toContain('≈0% · 100 / 258k');
    } finally { apply.mockRestore(); }
});

test('synthetic Claude API error cannot replace valid usage in live/result/rebuilt snapshot UI', () => {
    const mapper = new ClaudeStreamMapper(undefined, 'thread-lead', 'turn'), current = new CurrentEvents();
    const all: SessionEvent[] = [];
    const append = (kind: SessionEvent['kind'], data: Record<string, unknown>) => {
        const event = e(all.length + 1, kind, data); event.source.runnerId = 'claude'; all.push(event); current.apply(event);
    };
    append('task.created', { taskId: 'lead', attempt: 1 }); append('turn.started', { attempt: 1, nativeTurnId: 'turn' });
    const mapped = (message: unknown) => mapper.map(message).events.forEach(event => append(event.kind as SessionEvent['kind'], { ...event.data, attempt: 1 }));
    const check = () => {
        const rebuilt = new CurrentEvents(); current.values().forEach(event => rebuilt.apply(event));
        for (const events of [all, current.values(), rebuilt.values()]) {
            const observed = projectContextWindows(events, 's').get();
            expect(observed?.data.context).toMatchObject({ tokens: 148000, modelId: 'model' });
            const html = renderToStaticMarkup(<ContextWindowIndicator observation={observed}/>);
            expect(html).toContain('148k'); expect(html).not.toContain('0 used');
        }
    };
    mapped({ type: 'assistant', session_id: 'thread-lead', message: { model: 'model', usage: { input_tokens: 148000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }); check();
    const recorded = JSON.parse(fixtureLines('context-synthetic-api-error.jsonl')[0]!);
    mapped({ ...recorded, session_id: 'thread-lead' }); check();
    mapped({ type: 'result', session_id: 'thread-lead', subtype: 'error_during_execution', is_error: true, usage: { input_tokens: 0 }, modelUsage: { model: { contextWindow: 200000 } } }); check();
    append('turn.completed', { status: 'failed', attempt: 1 }); check();
});
