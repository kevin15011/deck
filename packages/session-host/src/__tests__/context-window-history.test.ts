import { afterEach, expect, test } from 'bun:test';
import { EventLog } from '../event-log';
import { ChatHistory } from '../chat-history';
import { cleanupTempDirs, tempDir } from './test-helpers';

const logs: EventLog[] = [];
afterEach(() => { for (const log of logs.splice(0)) log.close(); cleanupTempDirs(); });

test.each(['codex', 'claude', 'opencode'])('%s context snapshot is bounded, sanitized, completed and identical after disk reload', runnerId => {
    const dir = tempDir(), log = EventLog.open({ dir, sessionId: 's' }); logs.push(log);
    const history = new ChatHistory(log);
    const source = { taskId: 'lead', memberId: 'lead', runnerId, nativeSessionId: 'thread' };
    const append = (kind: Parameters<typeof log.append>[0]['kind'], data: Record<string, unknown>) => history.apply(log.append({ kind, source, data }));
    append('task.created', { taskId: 'lead', attempt: 1 });
    append('turn.started', { attempt: 1, nativeTurnId: 'turn' });
    for (let n = 1; n <= 150; n++) history.apply(log.append({ kind: 'usage', source, data: { attempt: 1, context: { basis: runnerId === 'codex' ? 'codex-last-total' : runnerId === 'claude' ? 'claude-last-request-input' : 'opencode-assistant-context', tokens: n, capacity: 200, nativeThreadId: 'thread', nativeTurnId: 'turn', modelId: 'model', raw: { private: 'SECRET' } }, unrelated: 'RAW_NATIVE' }, raw: { runnerId, protocol: 'codex-app-server', payload: { private: 'SECRET' }, truncated: false } }));
    append('turn.completed', { status: 'completed', attempt: 1 });
    const snapshot = history.page();
    expect(snapshot.events.filter(e => e.kind === 'usage')).toHaveLength(1);
    expect(snapshot.events.find(e => e.kind === 'usage')?.data.context).toMatchObject({ tokens: 150 });
    expect(JSON.stringify(snapshot.events)).not.toContain('SECRET');
    expect(JSON.stringify(snapshot.events)).not.toContain('RAW_NATIVE');
    expect(history.page({ before: 999 }).events).toEqual([]);
    log.flush(); log.close(); logs.pop();
    const reopened = EventLog.open({ dir, sessionId: 's' }); logs.push(reopened);
    const restored = new ChatHistory(reopened);
    expect(restored.page()).toEqual(snapshot);
    restored.apply(reopened.append({ kind: 'task.continued', source, data: { taskId: 'lead', attempt: 2 } }));
    expect(restored.page().events.some(e => e.kind === 'usage')).toBe(false);
});
