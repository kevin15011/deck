import {expect, test} from 'bun:test';
import {mergeAssignments, restoreAssignments} from './last-assignments';

const runners = [
  {runnerId: 'claude', available: true, models: [{modelId: 'opus', thinkingLevels: ['high', 'max']}]},
  {runnerId: 'codex', available: true, models: [{modelId: 'gpt-6.2-sol', thinkingLevels: ['low', 'medium']}]},
  {runnerId: 'opencode', available: false, models: [{modelId: 'x', thinkingLevels: []}]},
];

// Protects "remember the last assignment" for new sessions.
// Oracle: only assignments the current inventory still offers are restored;
// retired models, unavailable runners and stale reasoning levels are dropped.
test('restores the last assignments that are still offered', () => {
  const saved = JSON.stringify({
    lead: {runnerId: 'claude', modelId: 'opus', thinking: 'high'},
    'apply-deep': {runnerId: 'codex', modelId: 'gpt-6.2-sol', thinking: 'xhigh'},
    investigate: {runnerId: 'codex', modelId: 'gpt-5-retired'},
    quality: {runnerId: 'opencode', modelId: 'x'},
  });
  expect(restoreAssignments(saved, runners)).toEqual({
    lead: {runnerId: 'claude', modelId: 'opus', thinking: 'high'},
    'apply-deep': {runnerId: 'codex', modelId: 'gpt-6.2-sol'},
  });
  expect(restoreAssignments(JSON.stringify({investigate: {runnerId: 'codex', modelId: 'gpt-6.2-sol'}}), runners)).toBeUndefined();
  expect(restoreAssignments('', runners)).toBeUndefined();
  expect(JSON.parse(mergeAssignments(saved, 'lead', {runnerId: 'codex', modelId: 'gpt-6.2-sol'})).lead.runnerId).toBe('codex');
  expect(JSON.parse(mergeAssignments('not json', 'lead', {runnerId: 'codex', modelId: 'gpt-6.2-sol'}))).toEqual({lead: {runnerId: 'codex', modelId: 'gpt-6.2-sol'}});
});
