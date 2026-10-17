import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { emptyState } from './state';
import { Subagents } from './workspace';
import { CurrentEvents } from '../../../packages/core/src/session/chat-history';
import { snapshotView } from './chat-history';
import { reduceEvent } from './state';

test('creation and continuation promote immediately in live and compact reconnect views', () => {
    const event = (seq: number, taskId: string, kind: SessionEvent['kind'], data: Record<string, unknown> = {}): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data: { taskId, ...data }, source: { taskId }, ts: '2026-01-01T00:00:00Z' });
    let view = emptyState();
    const current = new CurrentEvents();
    const append = (...events: SessionEvent[]) => {
        for (const event of events) { view = reduceEvent(view, event); current.apply(event); }
    };
    const expectOrder = (expected: string[]) => {
        for (const state of [view, snapshotView(current.values(), view.seq)]) {
            const html = renderToStaticMarkup(<Subagents view={state} sessionId="s"/>);
            expect([...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1])).toEqual(expected);
        }
    };
    append(event(1, 'reused', 'task.created'), event(2, 'reused', 'message.completed', { role: 'assistant', text: 'Old reply' }), event(3, 'prior', 'task.created'), event(4, 'prior', 'message.completed', { role: 'assistant', text: 'Prior reply' }));
    expectOrder(['prior', 'reused']);
    append(event(5, 'fresh', 'task.created'));
    expectOrder(['fresh', 'prior', 'reused']);
    append(event(6, 'reused', 'task.continued', { attempt: 2 }));
    expectOrder(['reused', 'fresh', 'prior']);
    append(event(7, 'prior', 'tool.started', { name: 'Read' }), event(8, 'fresh', 'message.delta', { text: 'Streaming' }), event(9, 'prior', 'task.state', { state: 'running' }));
    expectOrder(['reused', 'fresh', 'prior']);
    append(event(10, 'fresh', 'message.completed', { role: 'assistant', text: 'Fresh reply' }));
    expectOrder(['fresh', 'reused', 'prior']);
    append(event(11, 'prior', 'task.continued', { attempt: 2 }));
    expectOrder(['prior', 'fresh', 'reused']);
});

test('subagents render newest public reply first with stable unanswered ordering', () => {
    const view = emptyState();
    const ids = ['unanswered-a', 'older', 'newer', 'fallback', 'tied', 'unanswered-b'];
    view.tasks = Object.fromEntries(ids.map(id => [id, { memberId: id, state: 'running' }]));
    const event = (seq: number, taskId: string, kind: SessionEvent['kind'], data: Record<string, unknown>): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data, source: { taskId }, ts: '2026-01-01T00:00:00Z' });
    view.events = [
        event(2, 'older', 'message.completed', { role: 'assistant', text: 'Older reply' }),
        event(4, 'newer', 'message.completed', { role: 'assistant', text: 'Newer reply' }),
        event(4, 'tied', 'message.completed', { role: 'assistant', text: 'Tied reply' }),
        event(6, 'fallback', 'task.result', { summary: 'Fallback reply' }),
        event(8, 'older', 'task.result', { summary: 'Older reply' }),
    ];
    const order = () => [...renderToStaticMarkup(<Subagents view={view} sessionId="s"/>).matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]);
    const expected = ['fallback', 'newer', 'tied', 'older', 'unanswered-a', 'unanswered-b'];
    expect(order()).toEqual(expected);
    view.events.push(
        event(9, 'unanswered-a', 'tool.started', { name: 'Read' }),
        event(10, 'older', 'message.delta', { text: 'Streaming' }),
        event(11, 'unanswered-b', 'task.state', { state: 'completed' }),
        event(12, 'unanswered-a', 'message.completed', { role: 'assistant', text: 'Internal', internal: true }),
    );
    expect(order()).toEqual(expected);
    view.events.push(event(13, 'older', 'message.completed', { role: 'assistant', text: 'Latest reply' }));
    expect(order()).toEqual(['older', 'fallback', 'newer', 'tied', 'unanswered-a', 'unanswered-b']);
});
