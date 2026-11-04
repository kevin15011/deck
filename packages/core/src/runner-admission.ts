import type { NativeRoleDescriptor } from './session/driver';
export type RemediationId = 'replace-with-deck-version' | 'keep-custom-disable-capability' | 'run-review-install' | 'restart-daemon-when-idle' | 'install-node' | 'upgrade-deck' | 'clean-reinstall-with-backup';
export type RunnerAdmissionResult = {
  verdict: 'admit' | 'degraded' | 'blocked';
  checks: { id: string; status: 'pass' | 'warn' | 'fail'; required: boolean; remediation: RemediationId }[];
  generation?: string;
};
export const PREPARATION_REASON_CODES = [
  'codebase-memory-unavailable', 'codebase-memory-unsupported', 'codebase-memory-cancelled',
  'web-search-credential-missing', 'web-search-provider-unconfigured',
  'codex-session-preparation-blocked', 'opencode-session-preparation-blocked',
  'claude-session-skills-unverified', 'codex-session-skills-unverified', 'opencode-session-skills-unverified', 'pi-session-skills-unverified',
  'claude-codebase-memory-selection-stale', 'claude-web-search-selection-stale',
  'personal-mcp-managed-exclusive', 'personal-mcp-remote-config-isolation-unavailable', 'personal-mcp-auth-config-unavailable',
] as const;
export function publishablePreparationCode(message: string): string | undefined {
  return PREPARATION_REASON_CODES.find(code => message === code || message.startsWith(`${code}:`));
}
export const isPublishablePreparationCode = (code: string): boolean => (PREPARATION_REASON_CODES as readonly string[]).includes(code);
/** Adapter details are identifiers only. Never serialize a raw filesystem or provider error. */
export function admissionFailure(error: unknown): RunnerAdmissionResult {
  const value = error as { detail?: unknown; check?: unknown } | undefined;
  const id = [value?.detail, value?.check].find(v => typeof v === 'string' && /^[a-z0-9][a-z0-9:._-]{0,80}$/.test(v)) as string | undefined;
  return { verdict: 'blocked', checks: [{ id: id ?? 'installed-state-unverified', status: 'fail', required: true, remediation: 'run-review-install' }] };
}
export async function evaluateRoleAdmission(read: () => NativeRoleDescriptor | Promise<NativeRoleDescriptor>): Promise<RunnerAdmissionResult> {
  try {
    const role = await read();
    const checks: RunnerAdmissionResult['checks'] = (role.preparation ?? []).map(f => ({ id: f.code, status: f.kind === 'B' ? 'fail' : 'warn', required: f.kind === 'B', remediation: 'run-review-install' }));
    return { verdict: checks.some(c => c.required && c.status === 'fail') ? 'blocked' : checks.length ? 'degraded' : 'admit', generation: role.generation, checks };
  } catch (error) { return admissionFailure(error); }
}
export const REMEDIATION_MESSAGES: Record<RemediationId, string> = {
  'replace-with-deck-version': 'Review the conflicting item and replace it with the Deck version.',
  'keep-custom-disable-capability': 'Keep the custom item and explicitly disable the optional capability.',
  'run-review-install': 'Review the preserved conflicting item in Review & Install, then retry.',
  'restart-daemon-when-idle': 'Restart the daemon after active work finishes.',
  'install-node': 'Install a supported Node.js runtime and retry.',
  'upgrade-deck': 'Upgrade Deck to a compatible build.',
  'clean-reinstall-with-backup': 'Back up the installation before reinstalling.',
};
/** Install verification checks every supported role; preparation may select just one. */
export async function evaluateInstalledRoles(roleIds: readonly string[], read: (roleId: string) => NativeRoleDescriptor | Promise<NativeRoleDescriptor>): Promise<RunnerAdmissionResult> {
 const results = await Promise.all(roleIds.map(id=>evaluateRoleAdmission(()=>read(id))));
 const checks = [...new Map(results.flatMap(r=>r.checks).map(c=>[c.id,c])).values()];
 return {verdict:results.some(r=>r.verdict==='blocked')?'blocked':results.some(r=>r.verdict==='degraded')?'degraded':'admit',checks,generation:results.find(r=>r.generation)?.generation};
}
