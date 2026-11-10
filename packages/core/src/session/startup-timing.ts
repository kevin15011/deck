import type { DriverEvent } from './driver';
import type { RunnerId } from '../runner-adapter';

// Runner identities come from the host's registered adapter contract, never
// native payloads. Bound their diagnostic representation without a runner catalog.
const diagnosticRunner = (runner: RunnerId) => /^[a-z][a-z0-9-]{0,63}$/.test(runner) ? runner : 'unknown';
type AdapterBoundary = 'turn-start-reply' | 'validated-init' | 'prompt-dispatched';
export type StartupBoundary = 'driver-start-call' | `${RunnerId}-${AdapterBoundary}`;
function diagnosticBoundary(runner: RunnerId, boundary: StartupBoundary | undefined): StartupBoundary | undefined {
  if (boundary === 'driver-start-call') return boundary;
  if (diagnosticRunner(runner) !== runner) return undefined;
  return (['turn-start-reply', 'validated-init', 'prompt-dispatched'] as const)
    .some(suffix => boundary === `${runner}-${suffix}`) ? boundary : undefined;
}

// Static labels only. Never accept native messages, paths, config or error text.
const STEPS = [
  'probe', 'credentials', 'credential-issue', 'delegated-diff', 'resolver', 'availability', 'native-role', 'runtime-evidence',
  'reconciliation', 'registry-evidence', 'context-and-input', 'launch-validation',
  'inventory-process', 'inventory-config', 'inventory-hooks', 'inventory-stop',
  'runtime-process', 'runtime-config', 'runtime-hooks', 'thread-start', 'thread-resume',
  'mcp-wait', 'turn-send', 'launch-build', 'process-spawn', 'stdin-write', 'native-init',
  'endpoint-ready', 'dependencies', 'config-attestation', 'agent-policy',
  'session-start', 'session-resume', 'event-subscribe', 'pending-interactions',
] as const;
export type StartupStep = typeof STEPS[number];
export type StartupOutcome = 'completed' | 'failed' | 'cancelled';

/** One bounded summary, monotonic local durations, no I/O beyond the existing sink.
 * Steps are sequential wall intervals, not CPU cost. Finish freezes the collector.
 * Runner-specific labels deliberately preserve different admission semantics. */
export function startupTiming(
  emit: (event: DriverEvent) => void,
  metadata: { runner: RunnerId; scope: 'host' | 'adapter'; resume: boolean; version?: string; boundary?: StartupBoundary },
  now: () => number = () => performance.now(),
) {
  const started = now();
  let last = started, active: StartupStep | undefined, finished = false;
  const steps = new Map<StartupStep, number>();
  const duration = (a: number, b: number) => Number.isFinite(a - b) ? Math.max(0, a - b) : 0;
  const record = (at: number) => {
    if (active) steps.set(active, (steps.get(active) ?? 0) + duration(at, last));
    last = at;
  };
  return {
    step(step: StartupStep) {
      if (finished || !STEPS.includes(step)) return;
      record(now()); active = step;
    },
    finish(outcome: StartupOutcome) {
      if (finished) return;
      finished = true;
      const at = now(); record(at);
      const boundary = diagnosticBoundary(metadata.runner, metadata.boundary);
      try { emit({ kind: 'diagnostic', data: {
        code: 'turn.startup-timing', scope: metadata.scope,
        runner: diagnosticRunner(metadata.runner),
        continuity: metadata.resume ? 'resume' : 'new',
        ...(metadata.version && metadata.version.length <= 64 && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(metadata.version) ? { version: metadata.version, versionSource: "host-probe" } : {}),
        ...(outcome === "completed" && boundary ? { boundary } : {}),
        outcome, durationMs: duration(at, started),
        steps: [...steps].map(([step, durationMs]) => ({ step, durationMs })),
      } }); } catch { /* Observation must not change startup or containment. */ }
    },
  };
}

/** One metadata-only summary for existing MCP verification. Requests include
 * transport and decoding; pages count fulfilled status responses, even invalid
 * payloads. Polls count verification passes, including the first. No payloads
 * or errors are retained, and failed requests still contribute elapsed time. */
export function mcpReadinessTiming(
  emit: (event: DriverEvent) => void,
  runner: RunnerId,
  now: () => number = () => performance.now(),
) {
  const started = now();
  let finished = false, statusCallCount = 0, statusPageCount = 0, statusDurationMs = 0;
  let pollCount = 0, sleepCount = 0, sleepDurationMs = 0;
  const elapsed = (from: number) => { const value = now() - from; return Number.isFinite(value) ? Math.max(0, value) : 0; };
  return {
    poll() { if (!finished) pollCount++; },
    async request<T>(operation: () => Promise<T>): Promise<T> {
      if (finished) return operation();
      statusCallCount++;
      const at = now();
      try { const result = await operation(); if (!finished) statusPageCount++; return result; }
      finally { if (!finished) statusDurationMs += elapsed(at); }
    },
    async sleep(operation: () => Promise<unknown>): Promise<void> {
      if (finished) { await operation(); return; }
      sleepCount++;
      const at = now();
      try { await operation(); } finally { if (!finished) sleepDurationMs += elapsed(at); }
    },
    finish(outcome: StartupOutcome) {
      if (finished) return;
      finished = true;
      try { emit({ kind: 'diagnostic', data: {
        code: 'turn.mcp-readiness-timing', runner: diagnosticRunner(runner), outcome, durationMs: elapsed(started),
        statusCallCount, statusPageCount, statusDurationMs, pollCount, sleepCount, sleepDurationMs,
      } }); } catch { /* Observation cannot change admission or cleanup. */ }
    },
  };
}
