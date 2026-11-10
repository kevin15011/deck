import { expect, test } from 'bun:test';
import type { DriverEvent } from './driver';
import { mcpReadinessTiming, startupTiming, type StartupBoundary, type StartupStep } from './startup-timing';

// Oracle: core's RunnerId contract is open to registered adapters. Timing must
// preserve a bounded synthetic ID without a built-in runner-name inventory.
test('timing supports adapter-defined runner identities', () => {
  const events: DriverEvent[] = [];
  startupTiming(e => events.push(e), { runner: 'synthetic-runner', scope: 'adapter', resume: false,
    boundary: 'synthetic-runner-validated-init' }).finish('completed');
  mcpReadinessTiming(e => events.push(e), 'synthetic-runner').finish('completed');
  expect(events.map(e => e.data.runner)).toEqual(['synthetic-runner', 'synthetic-runner']);
  expect(events[0]!.data.boundary).toBe('synthetic-runner-validated-init');
});

test('diagnostics omit untrusted boundaries and bound runner identifiers in both summaries', () => {
  const events: DriverEvent[] = [];
  for (const runner of ['SECRET_TOKEN', 'a'.repeat(65)]) {
    startupTiming(e => events.push(e), { runner, scope: 'adapter', resume: false,
      boundary: `${runner}-validated-init` }).finish('completed');
    mcpReadinessTiming(e => events.push(e), runner).finish('failed');
  }
  expect(events.every(e => e.data.runner === 'unknown' && !('boundary' in e.data))).toBe(true);
  for (const boundary of ['synthetic-runner-SECRET_PROMPT', 'other-runner-validated-init']) {
    startupTiming(e => events.push(e), { runner: 'synthetic-runner', scope: 'adapter', resume: false,
      boundary: boundary as StartupBoundary }).finish('completed');
  }
  expect(events.every(e => !('boundary' in e.data))).toBe(true);
  expect(JSON.stringify(events)).not.toContain('SECRET');
});

// Protects bounded, metadata-only observations. Oracle: sequential monotonic
// intervals, one terminal summary, fixed labels, and no effects from the sink.
test('startup timing freezes once, accumulates intervals and rejects untrusted labels', () => {
  const events: DriverEvent[] = [];
  let at = 10;
  const timing = startupTiming(e => events.push(e), { runner: 'codex', scope: 'adapter', resume: true, version: '0.162.1' }, () => at);
  timing.step('inventory-process'); at = 15;
  timing.step('inventory-config'); at = 20;
  timing.step('inventory-process'); at = 23;
  timing.step('SECRET_PROMPT' as StartupStep);
  timing.finish('failed'); at = 999;
  timing.step('turn-send'); timing.finish('completed');
  expect(events).toHaveLength(1);
  expect(events[0]!.data).toMatchObject({ outcome: 'failed', continuity: 'resume', version: '0.162.1', durationMs: 13,
    steps: [{ step: 'inventory-process', durationMs: 8 }, { step: 'inventory-config', durationMs: 5 }] });
  expect(JSON.stringify(events)).not.toContain('SECRET');
});

test('untrusted metadata is omitted and a failed sink cannot alter startup', () => {
  const events: DriverEvent[] = [];
  const timing = startupTiming(e => events.push(e), { runner: 'SECRET_TOKEN', scope: 'host', resume: false, version: 'SECRET_CONFIG' });
  for (let i = 0; i < 10000; i++) timing.step('probe');
  timing.finish('cancelled');
  expect(events[0]!.data).toMatchObject({ runner: 'unknown', continuity: 'new', outcome: 'cancelled' });
  expect(events[0]!.data.steps).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain('SECRET');
  expect(() => startupTiming(() => { throw new Error('sink'); }, { runner: 'claude', scope: 'adapter', resume: false }).finish('failed')).not.toThrow();
});

// Oracle: request and sleep time are disjoint local intervals; failed calls
// still count and retain duration but never retain their payload or error.
test('MCP readiness aggregates pages, polls and failed requests without payloads', async () => {
  let at = 0;
  const events: DriverEvent[] = [];
  const timing = mcpReadinessTiming(e => events.push(e), 'codex', () => at);
  timing.poll();
  expect(await timing.request(async () => { at += 7; return 'SECRET_CATALOG'; })).toBe('SECRET_CATALOG');
  await timing.sleep(async () => { at += 3; });
  timing.poll();
  await expect(timing.request(async () => { at += 5; throw new Error('SECRET_ERROR'); })).rejects.toThrow('SECRET_ERROR');
  timing.finish('failed'); timing.finish('completed'); timing.poll();
  expect(events).toHaveLength(1);
  expect(events[0]!.data).toMatchObject({ code: 'turn.mcp-readiness-timing', runner: 'codex', outcome: 'failed',
    durationMs: 15, statusCallCount: 2, statusPageCount: 1, statusDurationMs: 12, pollCount: 2, sleepCount: 1, sleepDurationMs: 3 });
  expect(JSON.stringify(events)).not.toContain('SECRET');
  const broken = mcpReadinessTiming(() => { throw new Error('sink'); }, 'opencode');
  expect(await broken.request(async () => 42)).toBe(42);
  expect(() => broken.finish('completed')).not.toThrow();
});
