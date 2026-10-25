import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoContributionSymlink, contributionHash, canonicalContributionJson, nativeSearchEvidence, type NormalizedDeckConfig, type RunnerAdapter, type RunnerDiagnostic, type RunnerLaunchInput, type RunnerLaunchResult } from '@deck/core';
import { getDeckStateDir } from './runtime/paths';

type Review = { runnerId: string; projectRoot: string; modelId?: string; fingerprint: string; pid?: number };
type Options = { stateRoot?: string; getAdapter?: (runnerId: string) => RunnerAdapter };
const supported = (id: string) => ['codex', 'claude', 'opencode'].includes(id);
const warning = (id: string): RunnerDiagnostic => ({ code: 'interactive-search-reopen-required', severity: 'warning',
  message: `Effective ${id} search configuration changed. Please reopen any existing ${id} CLI session to use the current configuration. Newly opened sessions use current settings.` });
const directory = (options: Options) => join(options.stateRoot ?? getDeckStateDir(), 'interactive-search');
async function snapshot(adapter: RunnerAdapter, projectRoot: string, config: NormalizedDeckConfig, modelId?: string): Promise<Review> {
  const selectedModel = modelId ?? adapter.readModelAssignments(projectRoot)['deck-lead'];
  const evidence = await adapter.inspectNativeSearch?.({ projectRoot, modelId: adapter.runnerId === 'opencode' ? modelId : selectedModel })
    ?? nativeSearchEvidence('unknown', 'effective-config', { runner: adapter.runnerId });
  return { runnerId: adapter.runnerId, projectRoot: resolve(projectRoot), ...(modelId ? { modelId } : {}),
    fingerprint: contributionHash(canonicalContributionJson({ native: evidence.configFingerprint, webAllowed: evidence.webAllowed,
      selectedModel, ownedFallbacks: evidence.ownedFallbackServerIds, unresolvedFallbacks: evidence.unresolvedFallbackServerIds, enabled: config.webSearch.enabled, provider: config.webSearch.provider })) };
}
function read(path: string): Review | undefined {
  assertNoContributionSymlink(path);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!supported(value.runnerId) || typeof value.projectRoot !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || value.modelId !== undefined && typeof value.modelId !== 'string') throw new Error('Invalid interactive search review');
  return value;
}
function reviews(options: Options): Review[] {
  const root = directory(options);
  assertNoContributionSymlink(root);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => /^[a-f0-9]{64}(?:\.[a-f0-9-]+\.active)?\.json$/.test(name)).sort().flatMap(name => {
    const previous = read(join(root, name));
    if (!previous) return [];
    if (previous.pid !== undefined) {
      try { process.kill(previous.pid, 0); } catch { return []; }
    }
    return [previous];
  });
}
/** Planning only. The selected fingerprint is persisted by the process executor, never by this reader. */
export async function buildReviewedInteractiveLaunch(adapter: RunnerAdapter, input: RunnerLaunchInput, options: Options = {}): Promise<RunnerLaunchResult> {
  const result = await adapter.buildLaunchPlan!(input);
  if (result.status !== 'ready' || input.mode !== 'interactive' || !supported(adapter.runnerId)) return result;
  const review = await snapshot(adapter, input.projectRoot, input.deckConfig, input.modelId);
  const path = join(directory(options), `${contributionHash(`${review.runnerId}\0${review.projectRoot}`)}.json`);
  let diagnostics: RunnerDiagnostic[] = [];
  try {
    for (const previous of reviews(options).filter(entry => entry.runnerId === review.runnerId && entry.projectRoot === review.projectRoot)) {
      const current = await snapshot(adapter, previous.projectRoot, input.deckConfig, previous.modelId);
      if (previous.fingerprint !== current.fingerprint) { diagnostics = [warning(review.runnerId)]; break; }
    }
  }
  catch { diagnostics = [{ code: 'interactive-search-review-unreadable', severity: 'warning', message: 'Previous interactive search selection could not be reviewed; reopen existing CLI sessions after configuration changes.' }]; }
  return { ...result, plan: { ...result.plan, interactiveSearchReview: { path, ...review } }, diagnostics: [...result.diagnostics, ...diagnostics] };
}
/** Runtime bookkeeping only: no configuration, installation, manifest, trust or capability effects. */
export function recordInteractiveSearchLaunch(review: NonNullable<import('@deck/core').RunnerLaunchPlan['interactiveSearchReview']>): () => void {
  assertNoContributionSymlink(review.path);
  const parent = resolve(review.path, '..');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${review.path}.${randomUUID()}.tmp`;
  const active = review.path.replace(/\.json$/, `.${randomUUID()}.active.json`);
  try {
    const { path: _, ...value } = review;
    writeFileSync(active, JSON.stringify({ ...value, pid: process.pid }), { mode: 0o600, flag: 'wx' });
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    assertNoContributionSymlink(review.path);
    renameSync(temporary, review.path);
  } catch (error) { if (existsSync(active)) unlinkSync(active); throw error; }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return () => { assertNoContributionSymlink(active); unlinkSync(active); };
}
/** Doctor reuses the same effective inspector as launch; no state is acknowledged or written here. */
export async function reviewInteractiveSearchSessions(config: NormalizedDeckConfig, projectRoot?: string, options: Options = {}): Promise<RunnerDiagnostic[]> {
  const diagnostics: RunnerDiagnostic[] = [];
  const previousReviews = reviews(options);
  if (!previousReviews.length) return diagnostics;
  const lookup = options.getAdapter ?? (await import('./runner-adapters')).getAdapter;
  for (const previous of previousReviews) {
    try {
      if (!previous || projectRoot && previous.projectRoot !== resolve(projectRoot)) continue;
      const current = await snapshot(lookup(previous.runnerId), previous.projectRoot, config, previous.modelId);
      if (previous.fingerprint !== current.fingerprint) diagnostics.push(warning(previous.runnerId));
    } catch { diagnostics.push({ code: 'interactive-search-review-unreadable', severity: 'warning', message: 'An interactive search selection could not be reviewed; reopen existing CLI sessions after configuration changes.' }); }
  }
  return diagnostics.filter((item, index) => diagnostics.findIndex(other => other.message === item.message) === index);
}
