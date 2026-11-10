/** Metadata-only projection of the direct-host canary's event ledger. */
import { sanitizeTurnFailure } from '../packages/core/src/session/failure';

const allowedSteps = new Set('probe credentials credential-issue delegated-diff resolver availability native-role runtime-evidence reconciliation registry-evidence context-and-input launch-validation inventory-process inventory-config inventory-hooks inventory-stop runtime-process runtime-config runtime-hooks thread-start thread-resume mcp-wait turn-send launch-build process-spawn stdin-write native-init endpoint-ready dependencies config-attestation agent-policy session-start session-resume event-subscribe pending-interactions'.split(' '));
const enums: Record<string, string[]> = {
  scope: ['host', 'adapter'], runner: ['codex', 'claude', 'opencode', 'pi', 'unknown'], continuity: ['new', 'resume'],
  outcome: ['completed', 'failed', 'cancelled'], evidence: ['message.delta', 'message.completed', 'reasoning.delta', 'tool.started'],
  versionSource: ['host-probe'], boundary: ['driver-start-call', 'codex-turn-start-reply', 'claude-validated-init', 'opencode-prompt-dispatched'],
};
type Event = { kind: string; ts: string; data: Record<string, unknown> };
function diagnostic(data: Record<string, unknown>): Record<string, unknown> | undefined {
  if (data.code === 'turn.mcp-readiness-timing') {
    const result: Record<string, unknown> = { code: data.code };
    for (const key of ['durationMs', 'statusCallCount', 'statusPageCount', 'statusDurationMs', 'pollCount', 'sleepCount', 'sleepDurationMs', 'attempt']) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0) result[key] = data[key];
    }
    for (const key of ['runner', 'outcome']) if (typeof data[key] === 'string' && enums[key].includes(data[key])) result[key] = data[key];
    return result;
  }
  if (data.code !== 'turn.startup-timing' && data.code !== 'turn.first-output-timing') return;
  const result: Record<string, unknown> = { code: data.code };
  for (const key of ['durationMs', 'elapsedMs', 'sinceDriverStartMs', 'attempt', 'queueWaitMs']) if (typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0) result[key] = data[key];
  for (const [key, values] of Object.entries(enums)) if (typeof data[key] === 'string' && values.includes(data[key])) result[key] = data[key];
  if (typeof data.version === 'string' && data.version.length <= 64 && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.version)) result.version = data.version;
  if (Array.isArray(data.steps)) result.steps = data.steps.slice(0, 40).flatMap((step: unknown) => {
    if (!step || typeof step !== 'object') return [];
    const s = step as Record<string, unknown>;
    return typeof s.step === 'string' && allowedSteps.has(s.step) && typeof s.durationMs === 'number' && Number.isFinite(s.durationMs) && s.durationMs >= 0 ? [{ step: s.step, durationMs: s.durationMs }] : [];
  });
  return result;
}
export function projectTurn(events: Event[], submittedAt: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const native = events.find(e => e.kind === 'turn.started');
  const first = events.find(e => e.kind === 'diagnostic' && e.data.code === 'turn.first-output-timing');
  for (const [key, event] of [['nativeBoundaryMs', native], ['firstOutputMs', first]] as const) {
    if (event) { const time = Date.parse(event.ts) - submittedAt; if (Number.isFinite(time)) result[key] = Math.max(0, time); }
  }
  result.diagnostics = events.filter(e => e.kind === 'diagnostic').flatMap(e => { const d = diagnostic(e.data); return d ? [d] : []; }).slice(0, 10);
  const completed = events.find(e => e.kind === 'turn.completed');
  const status = completed?.data.status;
  if (typeof status === 'string' && ['completed', 'failed', 'interrupted', 'interrupted-forced'].includes(status)) result.outcome = status;
  if (status !== 'completed') result.failure = sanitizeTurnFailure(completed?.data.failure) ?? { category: 'unknown', origin: 'unknown', certainty: 'inferred' };
  return result;
}
