import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { emptyState } from './state';
import { Subagents } from './workspace';

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
