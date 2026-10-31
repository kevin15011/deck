import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { processingPlan, validateProcessingPlan, type ProcessingPlan } from './processing';
import { initializeRunAuthority } from './run-authority';
import { dataset } from './dataset';
import type { CostGuardPlan } from './cost-guard';
import { evalRoot, validRun, privateWrite, sha256, fail } from './security';
export type Manifest = {
    schema: 'deck-memory-live-run-v1';
    run: string;
    evalRoot: string;
    mode: 'pilot' | 'full';
    repeats: number;
    tracks: ('R' | 'N')[];
    requestBudget: number;
    liveApproved: boolean;
    cleanupApproved: boolean;
    accountSharedWithProduction?: boolean;
    cleanupRequestBudget?: number;
    costGuard?: CostGuardPlan;
    processing?: ProcessingPlan;
    datasetHash: string;
    sourceHashes: Record<string, string>;
    sourceCommit: string;
    harnessHashes: Record<string, string>;
    bindings: Record<string, string>;
};
const repo = resolve(import.meta.dir, '../..');
const sources = ['packages/core/src/memory/capture-eligibility.ts', 'packages/core/src/memory/canonical-supermemory-project.ts', 'packages/adapter-supermemory/src/runtime.ts', 'packages/adapter-supermemory/src/conversation.ts', 'apps/cli/src/supermemory-runtime-host.ts', 'packages/adapter-codex/src/supermemory-artifact.ts', 'packages/adapter-claude/src/supermemory-artifact.ts', 'packages/adapter-opencode/src/opencode-supermemory-plugin.ts'];
export const newRunId = () => new Date().toISOString().slice(0, 10).replaceAll('-', '') + '_' + randomBytes(8).toString('hex');
export function sourceCommit() {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0 || !/^[a-f0-9]{40}$/.test(r.stdout.trim()))
        fail('source_commit_unavailable');
    return r.stdout.trim();
}
function sourceHashes() {
    const paths = new Set(sources);
    for (const dir of ['apps/cli/src', ...readdirSync(join(repo, 'packages'), { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(repo, 'packages', d.name, 'src'))).map(d => 'packages/' + d.name + '/src')])
        for (const name of readdirSync(join(repo, dir), { recursive: true }))
            if (/\.(?:ts|json|mjs|cjs)$/.test(String(name)) && !String(name).endsWith('.test.ts')) paths.add(dir + '/' + name);
    for (const path of ['bun.lock', 'package.json']) if (existsSync(join(repo, path))) paths.add(path);
    return Object.fromEntries([...paths].sort().map(p => [p, sha256(readFileSync(join(repo, p)))]));
}
// External checkout read boundary; default reads and hashes every file on every call.
export const manifestSources = { readHashes: sourceHashes };
export function harnessHashes() { const paths = [...readdirSync(import.meta.dir).filter(n => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'test-support.ts'), ...readdirSync(join(import.meta.dir, 'capture-replay')).filter(n => /\.(?:ts|mjs|cjs)$/.test(n)).map(n => 'capture-replay/' + n), 'fixtures/scorer-calibration.json'].sort(); return Object.fromEntries(paths.map(p => [p, sha256(readFileSync(join(import.meta.dir, p)))])); }
export function bindingsFor(run: string, mode: string, repeats: number) {
    const bindings: Record<string, string> = {};
    for (let i = 1; i <= repeats; i++)
        for (const w of ['r_runtime', ...(mode === 'full' ? ['n_claude', 'n_codex', 'n_opencode'] : [])])
            for (const p of ['a', 'b', 'b_private', 'control'])
                bindings[`sm_project_v1_eval_${w}_${i}_${p}`] = `deck_eval_${run}_${w}_${i}_${p}`;
    return bindings;
}
export function draftManifest(input: {
    run?: string;
    evalRoot?: string;
    mode: 'pilot' | 'full';
    repeats?: number;
    budget?: number;
    accountSharedWithProduction?: boolean;
    processing?: Parameters<typeof processingPlan>[0];
}): Manifest {
    const run = input.run ?? newRunId();
    if (!validRun(run))
        fail('invalid_run_id');
    const root = evalRoot(input.evalRoot ?? join(homedir(), '.deck-eval/runs', run), run);
    const repeats = input.repeats ?? (input.mode === 'pilot' ? 1 : 3);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
        fail('repeats_must_be_1_to_5');
    if (input.mode === 'full' && repeats < 3) fail('full_baseline_requires_at_least_three_repeats');
    const processing = processingPlan(input.processing);
    const budget = input.budget ?? (input.mode === 'pilot' ? 822 : 3400 * repeats);
    if (!Number.isSafeInteger(budget) || budget < 1)
        fail('invalid_request_budget');
    if (input.accountSharedWithProduction !== undefined && typeof input.accountSharedWithProduction !== 'boolean')
        fail('invalid_account_declaration');
    const bindings = bindingsFor(run, input.mode, repeats);
    const m: Manifest = { processing, schema: 'deck-memory-live-run-v1', run, evalRoot: root, mode: input.mode, repeats, tracks: input.mode === 'pilot' ? ['R'] : ['R', 'N'], requestBudget: budget, liveApproved: false, cleanupApproved: false, ...(input.accountSharedWithProduction === undefined ? {} : { accountSharedWithProduction: input.accountSharedWithProduction }), cleanupRequestBudget: 7 * Object.keys(bindings).length, datasetHash: dataset().hash, sourceHashes: manifestSources.readHashes(), sourceCommit: sourceCommit(), harnessHashes: harnessHashes(), bindings };
    return m;
}
export function prepare(input: Parameters<typeof draftManifest>[0]): Manifest {
    const m = draftManifest(input);
    const path = join(m.evalRoot, 'plan.json');
    if (existsSync(path))
        fail('plan_already_exists');
    initializeRunAuthority(m);
    privateWrite(path, m);
    return m;
}
/** Namespace deletion and rescoring must survive commits and scorer revisions. */
export function validateManifestIdentity(m: Manifest) {
    if (!m || m.schema !== 'deck-memory-live-run-v1' || !validRun(m.run) || !['pilot', 'full'].includes(m.mode) || !Number.isInteger(m.repeats) || m.repeats < 1 || m.repeats > 5 || !Number.isSafeInteger(m.requestBudget) || m.requestBudget < 1)
        fail('manifest_identity_invalid');
    evalRoot(m.evalRoot, m.run);
    if (m.accountSharedWithProduction !== undefined && typeof m.accountSharedWithProduction !== 'boolean')
        fail('invalid_account_declaration');
    cleanupBudget(m);
    if (JSON.stringify(m.tracks) !== JSON.stringify(m.mode === 'pilot' ? ['R'] : ['R', 'N']))
        fail('manifest_tracks_invalid');
    const expected = bindingsFor(m.run, m.mode, m.repeats);
    if (Object.keys(expected).length !== Object.keys(m.bindings ?? {}).length || Object.entries(expected).some(([k, v]) => m.bindings[k] !== v))
        fail('manifest_bindings_invalid');
}
export function validateManifest(m: Manifest) {
    validateManifestIdentity(m);
    validateProcessingPlan(m.processing!);
    if (Object.hasOwn(m, 'dedicatedEvalAccount'))
        fail('obsolete_dedicated_account_declaration');
    if (m.datasetHash !== dataset().hash || JSON.stringify(m.sourceHashes) !== JSON.stringify(manifestSources.readHashes()))
        fail('manifest_or_frozen_inputs_invalid');
    if (m.sourceCommit !== sourceCommit() || JSON.stringify(m.harnessHashes) !== JSON.stringify(harnessHashes()))
        fail('harness_or_commit_changed_since_manifest');
}
export function assertLiveRoot(m: Manifest) {
    if (m.evalRoot !== join(homedir(), '.deck-eval/runs', m.run))
        fail('test_scratch_cannot_be_live');
}
export function assertAccountDeclaration(m: Manifest) {
    if (!Object.hasOwn(m, 'accountSharedWithProduction') || m.accountSharedWithProduction !== true)
        fail('live_requires_explicit_account_shared_with_production_true');
    if (Object.hasOwn(m, 'dedicatedEvalAccount'))
        fail('obsolete_dedicated_account_declaration');
}
export function cleanupBudget(m: Manifest) {
    const maximum = 7 * Object.keys(m.bindings ?? {}).length;
    const budget = m.cleanupRequestBudget ?? maximum;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > maximum)
        fail('invalid_cleanup_budget');
    return budget;
}
export function parseAccountDeclaration(args: string[]): boolean | undefined {
    if (args.some(a => a === '--dedicated-eval-account' || a.startsWith('--dedicated-eval-account=')))
        fail('obsolete_dedicated_account_declaration');
    const entries = args.map((arg, index) => ({ arg, index })).filter(({ arg }) => arg === '--account-shared-with-production' || arg.startsWith('--account-shared-with-production='));
    if (!entries.length)
        return undefined;
    if (entries.length !== 1)
        fail('duplicate_account_declaration');
    const { arg, index } = entries[0]!;
    const next = args[index + 1];
    if (arg !== '--account-shared-with-production' || next !== undefined && !next.startsWith('--'))
        fail('account_declaration_requires_bare_flag');
    return true;
}
