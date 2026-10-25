import type { RunnerAdapter, RunnerLaunchInput, RunnerLaunchResult } from '@deck/core';
import { buildReviewedInteractiveLaunch } from './interactive-search-review';

/** Reuse immutable plugin publication when only launch-time search selection became stale. */
export async function prepareClaudeInteractiveLaunch(adapter: RunnerAdapter, input: RunnerLaunchInput): Promise<RunnerLaunchResult> {
  const launch = await buildReviewedInteractiveLaunch(adapter, input);
  if (launch.status !== 'blocked' || launch.code !== 'claude-web-search-selection-stale') return launch;
  const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: input.projectRoot, environmentId: adapter.environmentIds[0]!, deckConfig: input.deckConfig });
  if (plan.blocked) return { ...launch, diagnostics: [...launch.diagnostics, { code: 'claude-search-preparation-required', severity: 'error',
    message: 'Current search selection needs a verified fallback tool/provider or has a plugin conflict. Review the Claude installation before reopening.' }] };
  try {
    await adapter.applyDeveloperTeamInstall({ projectRoot: input.projectRoot, environmentId: adapter.environmentIds[0]!, plan });
    const verified = await adapter.verifyDeveloperTeamInstall(plan);
    if (!verified.valid) throw new Error('verification');
    return buildReviewedInteractiveLaunch(adapter, input);
  } catch {
    return { status: 'blocked', code: 'claude-search-publication-failed', diagnostics: [{ code: 'claude-search-publication-failed', severity: 'error',
      message: 'The current search plugin selection could not be published and verified. Existing generations were preserved; review installation recovery before reopening.' }] };
  }
}
