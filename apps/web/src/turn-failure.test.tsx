import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnFailureMessage } from './turn-failure';
import { mergeHistory } from './chat-history';
import type { HistoryMessage } from '../../../packages/core/src/session/chat-history';
import { classifyOpenCodeFailure } from '../../../packages/adapter-opencode/src/session-driver/failure';

const failed: HistoryMessage = { v: 1, sessionId: 's', seq: 3, ts: '2026-10-22T00:00:00Z', kind: 'turn.completed', historyId: 3,
  source: { taskId: 'lead', runnerId: 'codex' }, data: { status: 'failed', error: 'PRIVATE_NATIVE_PROSE', failure: { category: 'provider-overloaded', origin: 'provider', certainty: 'reported', code: 'serverOverloaded', message: 'PRIVATE_SENTINEL', headers: { authorization: 'PRIVATE_SENTINEL' } } } };
const render = (row: HistoryMessage) => renderToStaticMarkup(<TurnFailureMessage data={row.data}/>);

test('live and reloaded failure rows render the same safe provider explanation with a manual next step', () => {
  const live = mergeHistory([], [failed], 'live')[0]!;
  const reloaded = mergeHistory([], JSON.parse(JSON.stringify([failed])), 'newer')[0]!;
  expect(render(live)).toBe(render(reloaded));
  expect(render(live)).toContain('Model provider at capacity');
  expect(render(live)).toContain('manually retry');
  expect(render(live)).toContain('Partial work may remain');
  expect(render(live)).toContain('role="alert"');
  expect(render(live)).not.toContain('PRIVATE');
  expect(render(live)).not.toContain('Codex provider');
});
test('unknown origin stays explicit; metadata never guesses a provider from the runner', () => {
  const html = render({ ...failed, data: { failure: { category: 'network', origin: 'unknown', certainty: 'inferred' } } });
  expect(html).toContain('source of this failure could not be confirmed');
  expect(html).toContain('Check your connection'); expect(html).not.toContain('OpenAI');
});
test('OpenCode local compaction overflow reaches the UI as a context limit with unknown origin', () => {
  const message = 'Session too large to compact - context exceeds model limit even after stripping media';
  const failure = classifyOpenCodeFailure({ name: 'ContextOverflowError', data: { message } });
  expect(failure.category).toBe('context-limit'); expect(failure.origin).toBe('unknown');
  const html = render({ ...failed, source: { taskId: 'lead', runnerId: 'opencode' }, data: { status: 'failed', failure } });
  expect(html).toContain('source of this failure could not be confirmed');
  expect(html).toContain('Reduce the context');
  expect(html).not.toContain('The model provider reported a failure');
  expect(html).not.toContain('The failure came from the runner');
  expect(html).not.toContain(message);
});
test('inferred causes use tentative wording and unknown origins never blame a provider or Deck', () => {
  const provider = render({ ...failed, data: { failure: { category: 'provider-unavailable', origin: 'provider', certainty: 'inferred' } } });
  expect(provider).toContain('may be unavailable'); expect(provider).not.toContain('reported a failure');
  const deck = render({ ...failed, data: { failure: { category: 'deck', origin: 'deck', certainty: 'inferred' } } });
  expect(deck).toContain('may be in Deck'); expect(deck).not.toContain('failure occurred in');
  for (const certainty of ['reported', 'inferred']) {
    const unknown = render({ ...failed, data: { failure: { category: 'provider-overloaded', origin: 'unknown', certainty } } });
    expect(unknown).toContain('source of this failure could not be confirmed');
    expect(unknown).not.toContain('Model provider at capacity'); expect(unknown).not.toContain('reported a failure');
  }
});
test('legacy and invalid metadata preserve the existing error/fallback rendering', () => {
  for (const failure of [undefined, null, 'secret', { category: 'constructor', origin: 'provider', certainty: 'reported' }]) {
    expect(render({ ...failed, data: { error: 'Legacy safe error', failure } })).toContain('Legacy safe error');
    expect(render({ ...failed, data: { failure } })).toContain('The runner could not complete this turn. Try again.');
  }
});
test('structured reset time is shown only for rate and quota limits; arbitrary times and codes stay hidden', () => {
  const limit = { category: 'quota', origin: 'provider', certainty: 'reported', resetAt: '2026-10-22T04:30:00.000Z', code: 'sk-secret' };
  const html = render({ ...failed, data: { failure: limit } });
  expect(html).toContain('Usage limit reached'); expect(html).toContain('2026-10-22T04:30:00.000Z'); expect(html).not.toContain('sk-secret');
  expect(render({ ...failed, data: { failure: { ...limit, resetAt: 'PRIVATE_SENTINEL' } } })).not.toContain('PRIVATE_SENTINEL');
});
