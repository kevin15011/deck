import { test, expect, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGuarded, validateLiveCostGuard, executionForecast } from './cost-guard';
import { newRunId, validateManifest, type Manifest } from './manifest';
import { execute } from './run';
import { RunAuthority } from './run-authority';
import * as security from './security';
import { testScratch, syntheticConfirmation, boundaryTest } from './test-support';
const scratch = testScratch();
const defaults = { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 };
const input = (budget?: number, pollIntervalMs = 30000) => { const run = newRunId(); return { run, evalRoot: scratch.root(run), mode: 'pilot' as const, accountSharedWithProduction: true, ...(budget === undefined ? {} : { budget }), processing: { pollIntervalMs, nextTurnDelayMs: 30000 } }; };
const proposals = [
    { budget: 3200, poll: 30000, limits: { ceilingUsd: .50, stopUsd: .45, cleanupReserveUsd: .05 }, effects: 3138, forecast: .411880, allRequests: .418390 },
    { budget: 1800, poll: 60000, limits: { ceilingUsd: .35, stopUsd: .30, cleanupReserveUsd: .05 }, effects: 1778, forecast: .269080, allRequests: .271390 },
];
// Only read-only proposal checks share immutable prepared inputs. Each caller
// gets a deep copy; effectful cleanup below always prepares its own authority.
const preparedProposals = new Map<number, Promise<Manifest>>();
async function proposalManifest(p: typeof proposals[number]) {
    let prepared = preparedProposals.get(p.budget);
    if (!prepared) { prepared = prepareGuarded(input(p.budget, p.poll), p.limits); preparedProposals.set(p.budget, prepared); }
    return structuredClone(await prepared);
}
// Tests can deliberately rehash malformed synthetic fixtures to isolate intrinsic validation
// from mutation detection. Never write a modified plan or use a real run.
function rehashSynthetic(m: Manifest) {
    expect(m.evalRoot.includes('/test-scratch/')).toBe(true);
    const { liveApproved, cleanupApproved, costGuard, ...inputs } = m;
    const { frozenPlanHash, ...guard } = costGuard!;
    costGuard!.frozenPlanHash = security.sha256(JSON.stringify({ inputs, guard }));
    return m;
}
test('budget defaults remain unchanged and an infeasible default never upgrades itself', async () => {
    const m = await prepareGuarded(input(), defaults);
    expect(m.requestBudget).toBe(822); expect(m.cleanupRequestBudget).toBe(28);
    expect(m.liveApproved).toBe(false); expect(m.costGuard).toMatchObject(defaults);
    validateLiveCostGuard(m, false);
    expect(() => validateLiveCostGuard(m)).toThrow('processing_forecast_exceeds_authorized_budget');
    expect(m.requestBudget).toBe(822); expect(m.costGuard!.stopUsd).toBe(.20);
});
for (const p of proposals) test(`explicit ${p.budget}-request proposal validates as unapproved configuration, never before-approval execution`, async () => {
    const m = await proposalManifest(p);
    validateManifest(m); validateLiveCostGuard(m);
    expect(m).toMatchObject({ liveApproved: false, cleanupApproved: false, requestBudget: p.budget, cleanupRequestBudget: 28, tracks: ['R'], mode: 'pilot', repeats: 1 });
    expect(m.costGuard!.executionForecast).toMatchObject({ evaluationRequests: p.effects, evaluationEstimatedUsd: p.forecast, fitsRequestBudget: true });
    expect(m.costGuard!.forecastEvaluationUpperEstimateUsd).toBe(p.allRequests);
    expect(JSON.parse(readFileSync(join(m.evalRoot, 'plan.json'), 'utf8'))).toEqual(m);
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('NO_KEY_ACCESS'); });
    try { await expect(execute(m, { live: true })).rejects.toThrow('live_requires_explicit_approved_manifest'); expect(reader).not.toHaveBeenCalled(); }
    finally { reader.mockRestore(); }
    const a = RunAuthority.acquire(m, 'evaluation');
    try { expect(a.receipt()).toMatchObject({ evaluationRequests: 0, cleanupRequests: 0, evaluationLimit: p.budget, cleanupLimit: 28 }); }
    finally { a.close(); }
});
boundaryTest('missing, malformed and unsafe request/cost configurations reject even with a matching synthetic hash', async () => {
    const m = await prepareGuarded(input(822, 300000), defaults);
    for (const budget of [undefined, null, '822', NaN, Infinity, -1, 0, 1.5, 3201, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
        const bad = structuredClone(m); bad.requestBudget = budget as any; bad.costGuard!.evaluationRequestBudget = budget as any;
        expect(() => validateLiveCostGuard(rehashSynthetic(bad), false)).toThrow('live_requires_valid_cost_guard');
    }
    for (const field of ['ceilingUsd', 'stopUsd', 'cleanupReserveUsd'] as const) for (const value of [undefined, null, '0.25', NaN, Infinity, 0, -.1, .0000001, Number.MAX_SAFE_INTEGER]) {
        const bad = structuredClone(m); bad.costGuard![field] = value as any;
        expect(() => validateLiveCostGuard(rehashSynthetic(bad), false)).toThrow('live_requires_valid_cost_guard');
    }
    for (const patch of [{ mode: 'full' }, { repeats: 2 }, { tracks: ['N'] }, { cleanupRequestBudget: 29 }, { cleanupRequestBudget: 27 }]) {
        expect(() => validateLiveCostGuard(rehashSynthetic({ ...structuredClone(m), ...patch } as Manifest), false)).toThrow('live_requires_valid_cost_guard');
    }
    expect(() => validateLiveCostGuard({ ...m, costGuard: undefined })).toThrow('live_requires_valid_cost_guard');
    await expect(prepareGuarded(input(3201), proposals[0]!.limits)).rejects.toThrow('live_requires_valid_cost_guard');
    await expect(prepareGuarded(input(3200), defaults)).rejects.toThrow('live_requires_valid_cost_guard');
    await expect(prepareGuarded(input(), { ...defaults, stopUsd: .21 })).rejects.toThrow('invalid_estimated_cost_limits');
});
test('a consistent request-budget amendment still breaks the frozen hash; cost and timing amendments also reject', async () => {
    const p = proposals[0]!, m = await proposalManifest(p), amended = structuredClone(m);
    amended.requestBudget = 3199;
    const g = amended.costGuard!;
    g.evaluationRequestBudget = 3199; g.executionForecast = executionForecast(amended, g.forecast);
    g.forecastEvaluationUpperEstimateUsd = (g.ingestionTokenBudget * 5 + 3199 * 105) / 1e6;
    g.forecastTotalWithProtectedReserveUsd = (g.ingestionTokenBudget * 5 + 3199 * 105 + 50000) / 1e6;
    expect(() => validateLiveCostGuard(amended)).toThrow('live_requires_valid_cost_guard');
    validateLiveCostGuard(rehashSynthetic(amended)); // Configuration itself is admissible, old hash is not.
    for (const patch of [{ stopUsd: .44 }, { ceilingUsd: .49 }, { cleanupReserveUsd: .04 }]) expect(() => validateLiveCostGuard({ ...m, costGuard: { ...m.costGuard!, ...patch } })).toThrow('live_requires_valid_cost_guard');
    expect(() => validateLiveCostGuard({ ...m, processing: { ...m.processing!, nextTurnDelayMs: 31000 } })).toThrow('live_requires_valid_cost_guard');
    expect(JSON.parse(readFileSync(join(m.evalRoot, 'plan.json'), 'utf8'))).toEqual(m);
});
boundaryTest('larger evaluation configuration retains the cumulative 28-request cleanup allowance across authorities', async () => {
    const p = proposals[0]!, m = await prepareGuarded(input(p.budget), p.limits), tag = Object.values(m.bindings)[0]!;
    const first = RunAuthority.acquire(m, 'cleanup');
    try { first.authorizeCleanup(syntheticConfirmation(m)); first.configureCleanup(.05); for (let i = 0; i < 27; i++) first.reserve('/ns/' + tag, {}, true, tag); }
    finally { first.close(); }
    const second = RunAuthority.acquire(m, 'cleanup');
    try {
        second.configureCleanup(.05); second.reserve('/ns/' + tag, {}, true, tag);
        expect(() => second.reserve('/ns/' + tag, {}, true, tag)).toThrow('request_budget_exhausted');
        expect(second.receipt()).toMatchObject({ evaluationRequests: 0, cleanupRequests: 28, cleanupLimit: 28, evaluationLimit: 3200 });
    } finally { second.close(); }
    const third = RunAuthority.acquire(m, 'cleanup');
    try { expect(() => third.configureCleanup(.05)).toThrow('cleanup_request_budget_exhausted'); }
    finally { third.close(); }
});
