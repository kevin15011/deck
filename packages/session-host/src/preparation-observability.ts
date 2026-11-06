import type { PreparationSnapshot } from '@deck/core/session/preparation';

// Only canonical component names and digests enter the audit trail. Never copy
// observation reasons, prompts, paths or tool arguments into diagnostic payloads.
const components = new Set(['openspec', 'retired-testing-policy', 'skill-registry', 'codebase-memory-index', 'codebase-memory', 'rtk', 'context7', 'web-search']);
export function activationAssessment(snapshot?: PreparationSnapshot) {
  const observations = snapshot?.observations ?? [];
  const eligible = [...new Set(observations.filter(o => o.scope === 'project' && o.status === 'degraded' && o.repair === 'project').map(o => o.component))].filter(c => components.has(c)).sort();
  const status = !snapshot ? 'unsupported' : eligible.length ? 'eligible'
    : !observations.length || observations.some(o => o.status === 'indeterminate') ? 'indeterminate'
    : observations.some(o => o.status === 'degraded') ? 'unsupported' : 'no-repair-needed';
  return { ...(snapshot && /^[a-f0-9]{64}$/.test(snapshot.snapshotId) ? { snapshotId: snapshot.snapshotId } : {}), status, eligible };
}

const reasons = new Set([
  'preparation-request-required', 'preparation-request-invalid', 'preparation-snapshot-stale',
  'preparation-authority-unavailable', 'preparation-authority-revoked', 'preparation-already-delegated',
  'preparation-component-unavailable', 'preparation-effect-uncertain', 'preparation-evidence-mismatch',
  'preparation-executor-revoked', 'preparation-executor-unavailable', 'preparation-finding-unavailable',
  'preparation-registry-exposure-unverified', 'preparation-source-changed',
]);
export function activationReason(code: string): string {
  return reasons.has(code) ? code : 'operation-rejected';
}
