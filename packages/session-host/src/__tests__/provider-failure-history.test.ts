import { afterEach, expect, test } from 'bun:test';
import { CurrentEvents } from '@deck/core/session/chat-history';
import { EventLog } from '../event-log';
import { ChatHistory } from '../chat-history';
import { cleanupTempDirs, tempDir } from './test-helpers';

const logs: EventLog[] = [];
afterEach(() => { for (const log of logs.splice(0)) log.close(); cleanupTempDirs(); });
test('failure metadata, partial text and queue state survive live projection and disk reload', () => {
  const dir = tempDir(); const log = EventLog.open({ dir, sessionId: 's' }); logs.push(log);
  const history = new ChatHistory(log), current = new CurrentEvents();
  const failure = { category: 'provider-overloaded', origin: 'provider', certainty: 'reported', code: 'serverOverloaded' };
  const drafts = [
    { kind: 'turn.started' as const, data: {} },
    { kind: 'message.delta' as const, data: { text: 'Partial output' } },
    { kind: 'turn.completed' as const, data: { status: 'failed', failure } },
    { kind: 'prompt.queue' as const, data: { paused: true, reason: 'failed' } },
    { kind: 'turn.completed' as const, data: { status: 'failed', error: 'legacy error' } },
    { kind: 'turn.completed' as const, data: { status: 'interrupted' } },
  ];
  for (const draft of drafts) {
    const event = log.append({ ...draft, source: { taskId: 'lead', memberId: 'lead', runnerId: 'codex' } });
    history.apply(event); current.apply(event);
  }
  expect(history.page().messages.map(row => row.data)).toEqual([{ text: 'Partial output' }, { status: 'failed', failure }, { status: 'failed', error: 'legacy error' }]);
  expect(current.values().find(event => event.kind === 'prompt.queue')?.data.paused).toBe(true);
  log.flush(); log.close(); logs.pop();
  const reopened = EventLog.open({ dir, sessionId: 's' }); logs.push(reopened);
  const reloaded = new ChatHistory(reopened);
  expect(reloaded.page().messages).toEqual(history.page().messages);
  expect(reloaded.current.values()).toEqual(current.values());
});
