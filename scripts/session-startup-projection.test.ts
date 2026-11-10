import { expect, test } from 'bun:test';
import { projectTurn } from './session-startup-projection';

// Protects typed failure evidence and the metadata-only boundary.
test('failure projection retains typed evidence but excludes untrusted text', () => {
  const result = projectTurn([
    { kind: 'turn.completed', ts: '2026-01-01T00:00:02.000Z', data: { status: 'failed', error: 'secret', failure: { category: 'authentication', origin: 'provider', certainty: 'reported', code: 'unauthorized', provider: 'anthropic', extra: 'secret' } } },
    { kind: 'diagnostic', ts: '2026-01-01T00:00:01.000Z', data: { code: 'turn.startup-timing', versionSource: 'host-probe', queueWaitMs: 5, boundary: 'claude-validated-init', steps: [{ step: 'native-init', durationMs: 12 }], secret: 'secret' } },
  ], Date.parse('2026-01-01T00:00:00.000Z'));
  expect(result.failure).toEqual({ category: 'authentication', origin: 'provider', certainty: 'reported', code: 'unauthorized', provider: 'anthropic' });
  expect(result.diagnostics).toEqual([{ code: 'turn.startup-timing', versionSource: 'host-probe', queueWaitMs: 5, boundary: 'claude-validated-init', steps: [{ step: 'native-init', durationMs: 12 }] }]);
  expect(JSON.stringify(result)).not.toContain('secret');
});

// Protects partial timing evidence when a deadline prevents completion.
test('partial deadline evidence keeps timing and reports unknown failure', () => {
  const result = projectTurn([{ kind: 'diagnostic', ts: '2026-01-01T00:00:01.000Z', data: { code: 'turn.first-output-timing', elapsedMs: 30, evidence: 'message.completed' } }], Date.parse('2026-01-01T00:00:00.000Z'));
  expect(result.firstOutputMs).toBe(1000);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.failure).toEqual({ category: 'unknown', origin: 'unknown', certainty: 'inferred' });
});

// Protects readiness attribution and prevents native payloads from leaving the harness.
test('readiness projection retains only valid allowlisted metadata', () => {
  const result = projectTurn([{ kind: 'diagnostic', ts: '2026-01-01T00:00:01.000Z', data: {
    code: 'turn.mcp-readiness-timing', runner: 'codex', outcome: 'completed', attempt: 2,
    durationMs: 100, statusCallCount: 3, statusPageCount: 2, statusDurationMs: 70,
    pollCount: 2, sleepCount: 1, sleepDurationMs: 20,
    server: 'secret', cursor: 'secret', payload: 'secret', error: 'secret', scope: 'host',
  } }, { kind: 'diagnostic', ts: '2026-01-01T00:00:01.000Z', data: {
    code: 'turn.mcp-readiness-timing', runner: 'secret', outcome: 'secret', durationMs: -1,
    statusCallCount: Infinity, statusPageCount: NaN, statusDurationMs: -1, pollCount: -1,
    sleepCount: 'secret', sleepDurationMs: Infinity, attempt: -1,
  } }], 0);
  expect(result.diagnostics).toEqual([
    { code: 'turn.mcp-readiness-timing', runner: 'codex', outcome: 'completed', attempt: 2,
      durationMs: 100, statusCallCount: 3, statusPageCount: 2, statusDurationMs: 70,
      pollCount: 2, sleepCount: 1, sleepDurationMs: 20 },
    { code: 'turn.mcp-readiness-timing' },
  ]);
  expect(JSON.stringify(result)).not.toContain('secret');
});
