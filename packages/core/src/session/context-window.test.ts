import { expect, test } from 'bun:test';
import type { SessionEvent } from './events';
import { CurrentEvents } from './chat-history';
import { ContextWindowProjection, sanitizeContextObservation, contextEstimate, contextTokenSum } from './context-window';

const observation = { basis: 'codex-last-total' as const, tokens: 34794, capacity: 258400, nativeThreadId: 'thread', nativeTurnId: 'turn', modelId: 'model' };
const event = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown> = {}, taskId = 'lead'): SessionEvent => ({ v: 1, sessionId: 's', seq, ts: '2026-10-22T00:00:00Z', kind, source: { taskId, memberId: taskId, runnerId: 'codex', nativeSessionId: 'thread' }, data });
const start = [event(1, 'task.created', { taskId: 'lead', attempt: 1, modelId: 'model' }), event(2, 'turn.started', { attempt: 1, nativeTurnId: 'turn', nativeThreadId: 'thread' })];
const usage = (seq = 3, patch = {}) => event(seq, 'usage', { attempt: 1, context: { ...observation, ...patch } });

test.each(['codex', 'opencode', 'claude'])('late-discovered %s thread survives running/completed snapshots and rebuilding CurrentEvents', runnerId => {
    const source = { taskId: 'lead', memberId: 'lead', runnerId };
    const e = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown>, native = false): SessionEvent => ({ ...event(seq, kind, data), source: { ...source, ...(native ? { nativeSessionId: 'thread' } : {}) } });
    const current = new CurrentEvents(), live = new ContextWindowProjection();
    const append = (...events: SessionEvent[]) => events.forEach(e => { current.apply(e); live.apply(e); });
    const check = (tokens: number | undefined) => {
        const snapshot = current.values(), replay = new ContextWindowProjection(), rebuilt = new CurrentEvents();
        snapshot.forEach(e => { replay.apply(e); rebuilt.apply(e); });
        if (tokens === undefined) expect(live.values()).toHaveLength(0);
        else expect(live.values()[0]?.data.context).toMatchObject({ tokens });
        expect(replay.values()).toEqual(live.values());
        expect(rebuilt.values()).toEqual(snapshot);
        expect(rebuilt.values().filter(e => e.kind === 'usage')).toEqual(live.values());
        expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_DISCOVERY');
        return rebuilt;
    };
    const basis = runnerId === 'codex' ? 'codex-last-total' : runnerId === 'claude' ? 'claude-last-request-input' : 'opencode-assistant-context';
    const usage = (seq: number, attempt = 1, turn = 'turn') => e(seq, 'usage', { attempt, context: { ...observation, basis, tokens: 100, nativeTurnId: turn } }, true);
    append(e(1, 'task.created', { taskId: 'lead', attempt: 1 }),
        { ...e(2, 'task.state', { state: 'running', nativeSessionId: 'thread', private: 'PRIVATE_DISCOVERY' }, true), raw: { runnerId, protocol: 'test', payload: 'PRIVATE_DISCOVERY', truncated: false } },
        e(3, 'turn.started', { attempt: 1, nativeTurnId: 'turn' }), usage(4),
        e(5, 'task.state', { state: 'running', attempt: 1 }));
    check(100);
    append(e(6, 'turn.completed', { status: 'completed', attempt: 1 }, true), e(7, 'task.state', { state: 'completed', attempt: 1 }, true));
    check(100);
    append(e(8, 'task.continued', { attempt: 2 }), usage(9));
    check(undefined);
    append(e(10, 'task.state', { state: 'running', nativeSessionId: 'thread', attempt: 2 }, true), e(11, 'turn.started', { attempt: 2, nativeTurnId: 'next' }), usage(12, 2, 'next'));
    check(100);
    append(e(13, 'diagnostic', { code: 'context.compaction', state: 'started', itemId: 'compact', nativeThreadId: 'thread', nativeTurnId: 'next', attempt: 2 }, true),
        e(14, 'task.state', { state: 'running', attempt: 2 }));
    const rebuilt = check(undefined);
    // Reconnect must retain the compaction fence even while no counter exists.
    for (const projection of [current, rebuilt]) {
        projection.apply(e(15, 'task.state', { state: 'running', nativeSessionId: 'thread', attempt: 2 }, true));
        projection.apply(usage(16, 2, 'next'));
        expect(projection.values().some(e => e.kind === 'usage')).toBe(false);
    }
});

test('only finite nonnegative integer counters and positive capacity survive normalization', () => {
    expect(sanitizeContextObservation(observation)).toEqual(observation);
    for (const value of [NaN, Infinity, -1, 1.5, '2', null, undefined]) {
        expect(sanitizeContextObservation({ ...observation, tokens: value })?.tokens).toBeNull();
        expect(sanitizeContextObservation({ ...observation, capacity: value })?.capacity).toBeNull();
    }
    expect(sanitizeContextObservation({ ...observation, capacity: 0 })?.capacity).toBeNull();
    expect(sanitizeContextObservation({ ...observation, tokens: 0 })?.tokens).toBe(0);
    expect(sanitizeContextObservation({ ...observation, nativeThreadId: 'x'.repeat(257) })).toBeUndefined();
    expect(sanitizeContextObservation({ ...observation, basis: 'occupancy' })).toBeUndefined();
});

test('latest observation only, raw stripped, terminal retained and snapshot/live agree', () => {
    const p = new ContextWindowProjection(), current = new CurrentEvents();
    const events = [...start, ...Array.from({ length: 500 }, (_, n) => ({ ...usage(n + 3, { tokens: n }), raw: { runnerId: 'codex', protocol: 'test', payload: 'PRIVATE', truncated: false } })), event(503, 'turn.completed', { status: 'completed', attempt: 1 })];
    for (const e of events) { p.apply(e); current.apply(e); }
    expect(p.values()).toHaveLength(1);
    expect(p.attributionEvents().length).toBeLessThanOrEqual(2);
    expect(current.values().length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(current.values())).not.toContain('PRIVATE');
    const replay = new ContextWindowProjection();
    for (const e of current.values()) replay.apply(e);
    expect(replay.values()).toEqual(p.values());
    expect(p.values()[0].data.context).toMatchObject({ tokens: 499 });
    p.apply(usage(504, { tokens: 999 }));
    expect(p.values()[0].data.context).toMatchObject({ tokens: 499 });
});

test('foreign sessions, threads, turns, attempts and old sequences cannot overwrite', () => {
    const p = new ContextWindowProjection();
    [...start, usage()].forEach(e => p.apply(e));
    for (const e of [usage(4, { nativeThreadId: 'foreign' }), usage(5, { nativeTurnId: 'old' }), { ...usage(6), sessionId: 'foreign' }, { ...usage(7), data: { attempt: 2, context: observation } }, usage(2, { tokens: 0 })]) p.apply(e);
    expect(p.values()[0].data.context).toEqual(observation);
    p.apply(event(8, 'task.continued', { attempt: 2 }));
    p.apply(usage(9));
    expect(p.values()).toHaveLength(0);
});

test('foreign terminal boundaries cannot close an active observation', () => {
    const p = new ContextWindowProjection();
    [...start, usage()].forEach(e => p.apply(e));
    p.apply({ ...event(4, 'turn.completed', { status: 'completed' }), source: { taskId: 'lead', runnerId: 'codex', nativeSessionId: 'foreign' } });
    p.apply(event(5, 'turn.completed', { status: 'completed', nativeTurnId: 'old' }));
    p.apply(event(6, 'turn.completed', { status: 'completed', attempt: 2 }));
    p.apply(usage(7, { tokens: 42 }));
    expect(p.values()[0].data.context).toMatchObject({ tokens: 42 });
});

test('model/native context changes invalidate observations until the next attributed turn', () => {
    for (const patch of [{ modelId: 'new-model' }, { nativeSessionId: 'new-thread' }, { runnerId: 'claude' }]) {
        const p = new ContextWindowProjection(); [...start, usage()].forEach(e => p.apply(e));
        const changed = event(4, 'task.state', { state: 'running', attempt: 1, ...patch });
        if ('nativeSessionId' in patch) changed.source.nativeSessionId = patch.nativeSessionId;
        if ('runnerId' in patch) changed.source.runnerId = patch.runnerId;
        p.apply(changed); p.apply(usage(5));
        expect(p.values()).toHaveLength(0);
    }
});

test('compaction blocks late same-turn usage even after end; new turn and model clear fences', () => {
    const p = new ContextWindowProjection();
    [...start, usage()].forEach(e => p.apply(e));
    p.apply(event(4, 'diagnostic', { code: 'context.compaction', state: 'started', nativeThreadId: 'thread', nativeTurnId: 'turn', itemId: 'compact' }));
    p.apply(event(5, 'diagnostic', { code: 'context.compaction', state: 'completed', nativeThreadId: 'thread', nativeTurnId: 'turn', itemId: 'compact' }));
    p.apply(usage(6));
    expect(p.values()).toHaveLength(0);
    p.apply(event(7, 'turn.started', { attempt: 1, nativeTurnId: 'next', nativeThreadId: 'thread' }));
    p.apply(usage(8, { nativeTurnId: 'next' }));
    expect(p.values()).toHaveLength(1);
    p.apply(event(9, 'session.assignment', { memberId: 'lead', assignment: { runnerId: 'codex', modelId: 'other' } }));
    expect(p.values()).toHaveLength(0);
    p.apply(usage(10, { nativeTurnId: 'next' }));
    expect(p.values()).toHaveLength(0);
    p.apply(event(11, 'session.ended'));
    p.apply(usage(12));
    expect(p.values()).toHaveLength(0);
});

test('session-scoped late compaction invalidates a completed counter and cannot cross attempts', () => {
    const p = new ContextWindowProjection(), current = new CurrentEvents();
    const events = [...start, usage(), event(4, 'turn.completed', { status: 'completed', attempt: 1 }), event(5, 'diagnostic', { code: 'context.invalidated', reason: 'compaction', nativeThreadId: 'thread', attempt: 1 })];
    for (const e of events) { p.apply(e); current.apply(e); }
    expect(p.values()).toHaveLength(0);
    expect(current.values().some(e => e.kind === 'usage')).toBe(false);
    const replay = new ContextWindowProjection(); current.values().forEach(e => replay.apply(e)); expect(replay.values()).toEqual(p.values());
    for (const e of [event(6, 'task.continued', { attempt: 2 }), event(7, 'turn.started', { attempt: 2, nativeTurnId: 'next' }), { ...usage(8, { nativeTurnId: 'next' }), data: { attempt: 2, context: { ...observation, nativeTurnId: 'next' } } }]) p.apply(e);
    p.apply(event(9, 'diagnostic', { code: 'context.invalidated', reason: 'compaction', nativeThreadId: 'thread', attempt: 1 }));
    expect(p.values()).toHaveLength(1);
});

test('native context estimates use distinct arithmetic and preserve old ledger semantics', () => {
    const measure = (patch = {}) => contextEstimate({ ...observation, ...patch });
    expect(measure()).toEqual({ used: 34794, max: 258400, percent: 9 });
    expect(measure({ tokens: 18060, capacity: 24000 })).toMatchObject({ percent: 50 });
    expect(measure({ tokens: 148000 })).toMatchObject({ percent: 55 });
    expect(measure({ tokens: 0 })).toMatchObject({ percent: 0 });
    expect(measure({ tokens: 258401 })).toMatchObject({ percent: 100 });
    expect(measure({ tokens: 0, capacity: 12000 })).toMatchObject({ percent: 100 });
    expect(measure({ tokens: 1, capacity: 12001 })).toMatchObject({ percent: 0 });
    expect(measure({ basis: 'claude-last-request-input', tokens: 3868, capacity: 1000000 })).toMatchObject({ used: 3868, percent: 0 });
    expect(measure({ basis: 'opencode-assistant-context', tokens: 215, capacity: 1000 })).toMatchObject({ used: 215, percent: 22 });
    // Native OpenCode rounds the ratio; it does not clamp it to 100.
    expect(measure({ basis: 'opencode-assistant-context', tokens: 1200, capacity: 1000 })).toMatchObject({ percent: 120 });
    for (const basis of ['claude-aggregate-input', 'opencode-message-input']) expect(measure({ basis })).toEqual({ used: null, max: 258400, percent: null });
    for (const invalid of [null, undefined, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(measure({ tokens: invalid })).toEqual({ used: null, max: 258400, percent: null });
        expect(measure({ capacity: invalid })).toEqual({ used: 34794, max: null, percent: null });
    }
    expect(measure({ capacity: 0 })).toMatchObject({ max: null, percent: null });
    expect(contextTokenSum(2, 381, 3485)).toBe(3868);
    for (const invalid of [null, undefined, -1, NaN, Infinity, 1.5]) expect(contextTokenSum(2, invalid)).toBeNull();
    expect(contextTokenSum(Number.MAX_SAFE_INTEGER, 1)).toBeNull();
});
