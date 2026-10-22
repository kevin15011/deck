import { test, expect, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepare, newRunId } from './manifest';
import * as manifest from './manifest';
import * as security from './security';
import { cleanup, authorizeCleanup } from './cleanup';
import { RunAuthority } from './run-authority';
import { execute } from './run';
import { rescore } from './rescore';
import { prepareGuarded, validateLiveCostGuard, executionForecast } from './cost-guard';
import { simulatedWire, NamespaceTransport } from './namespace-transport';
import { testScratch, syntheticConfirmation, confirmSyntheticCleanup } from './test-support';
const scratch = testScratch();
const plan = (processing = {}) => { const run = newRunId(); return prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', accountSharedWithProduction: true, processing }); };
test('cleanup confirmation requires exact run/bindings and every namespace; historical approval flags cannot authorize key read', async () => {
    const m = plan(); m.liveApproved = true; m.cleanupApproved = true;
    const root = spyOn(manifest, 'assertLiveRoot').mockImplementation(() => {});
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('MOCK_KEY_READER'); });
    try {
        for (const bad of [null, {}, { ...syntheticConfirmation(m), run: newRunId() }, { ...syntheticConfirmation(m), bindingsHash: 'wrong' }, { ...syntheticConfirmation(m), namespaceCosts: [] }, { ...syntheticConfirmation(m), authorizeCleanup: false }, { ...syntheticConfirmation(m), consoleCostConfirmed: false }]) expect(() => authorizeCleanup(m, bad)).toThrow('cleanup_requires_reconciliation_authorization');
        await expect(cleanup(m, { live: true, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow('cleanup_requires_reconciliation_authorization');
        expect(reader).not.toHaveBeenCalled();
        confirmSyntheticCleanup(m);
        await expect(cleanup(m, { live: true, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow('MOCK_KEY_READER');
        expect(reader).toHaveBeenCalledTimes(1);
    } finally { reader.mockRestore(); root.mockRestore(); }
});
test('an active evaluator cannot authorize/delete; authorization prevents a subsequent evaluation from writing new unreconciled data', async () => {
    const m = plan(), a = RunAuthority.acquire(m, 'evaluation'); a.startEvaluation();
    try { expect(() => authorizeCleanup(m, syntheticConfirmation(m))).toThrow('run_in_use'); expect(() => a.authorizeCleanup(syntheticConfirmation(m))).toThrow('run_in_use'); }
    finally { a.close(); }
    confirmSyntheticCleanup(m);
    await expect(execute(m)).rejects.toThrow('run_already_has_receipts_use_new_run');
    const fresh = plan(); confirmSyntheticCleanup(fresh);
    await expect(execute(fresh)).rejects.toThrow('run_already_has_receipts_use_new_run');
});
test('a directly constructed cleanup transport cannot bypass reconciliation for DELETE', async () => {
    const m = plan(); let sends = 0;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 28, cleanup: true, authorizeNamespaceDelete: true, wire: async () => { sends++; return Response.json({}); } });
    await expect(t.fetch('https://api.supermemory.ai/ns/' + Object.values(m.bindings)[0], { method: 'DELETE' })).rejects.toThrow('cleanup_requires_reconciliation_authorization'); expect(sends).toBe(0);
});
test('useful polling forecast rejects before credentials; a coarse offline option fits the unchanged limits', async () => {
    const run = newRunId(), m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', accountSharedWithProduction: true }, { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 });
    expect(m.costGuard!.executionForecast.fitsRequestBudget).toBe(false);
    expect(() => validateLiveCostGuard(m)).toThrow('processing_forecast_exceeds_authorized_budget');
    const option = executionForecast(m, m.costGuard!.forecast, 300000);
    expect(option.fitsRequestBudget).toBe(true); expect(option.evaluationEstimatedUsd).toBeLessThan(.20);
    expect(option.evaluationEstimatedUsd + .05).toBeLessThan(.25);
    m.liveApproved = true;
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('MOCK_KEY_READER'); });
    try { await expect(execute(m, { live: true })).rejects.toThrow('processing_forecast_exceeds_authorized_budget'); expect(reader).not.toHaveBeenCalled(); }
    finally { reader.mockRestore(); }
    expect(() => validateLiveCostGuard({ ...m, processing: { ...m.processing!, nextTurnDelayMs: 17 } })).toThrow('live_requires_valid_cost_guard');
});
test('capture-relative availability runs while memory is pending, preserves captured prefixes and drift, then quality waits for all documents', async () => {
    const m = plan({ nextTurnDelayMs: 30 }), fake = simulatedWire(); let now = 1000, captureStarts: number[] = [], statusReads = 0, qualityCalls = 0;
    const result = await execute(m, { clock: { now: () => now, sleep: async ms => { now += ms; } }, wire: async (u, i) => {
        if (u.pathname === '/v3/documents') { captureStarts.push(now); now += 40; }
        const r = await fake(u, i);
        if (u.pathname.includes('/document/')) { statusReads++; const b = await r.json(); return Response.json({ ...b, system: { ...b.system, dreamingStatus: captureStarts.length < 68 ? 'dreaming' : 'done' } }); }
        return r;
    } });
    expect(result.quality.validity).toBe('valid'); expect(statusReads).toBeGreaterThan(64);
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(saved.availability.observedCases).toBe(saved.availability.expectedCases);
    expect(saved.availability.timeline[0].actualAtMs).toBeLessThan(saved.processing.gateStartedAtMs);
    for (const row of saved.availability.timeline) {
        expect(row.actualDelayMs).toBeGreaterThanOrEqual(30); expect(row.driftMs).toBe(row.actualDelayMs - 30);
        expect(row.capturedSeedIds.at(-1)).toBe(row.anchorSeed);
        const future = saved.results[0].captures.find((c: any) => !row.capturedSeedIds.includes(c.id));
        if (future) expect(future.startedAtMs).toBeGreaterThanOrEqual(row.completedAtMs);
    }
    expect(saved.availability.timeline.some((r: any) => r.driftMs > 0)).toBe(true);
    expect(saved.summary.settledOnly.cases).toBeGreaterThan(0);
    const original = readFileSync(join(m.evalRoot, 'results.json'), 'utf8');
    const rescored = rescore(m); expect(rescored.availabilityCases).toBe(saved.availability.expectedCases);
    expect(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).toBe(original);
    // Historical/invalid evidence can be diagnosed, but rescoring cannot invent readiness.
    delete saved.quality; delete saved.processing; security.privateWrite(join(m.evalRoot, 'results.json'), saved);
    const historicalBytes = readFileSync(join(m.evalRoot, 'results.json'), 'utf8');
    const old = JSON.parse(readFileSync(rescore(m).path, 'utf8'));
    expect(old.quality.validity).toBe('invalid'); expect(old.summary.retrieval.cases).toBe(0);
    expect(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).toBe(historicalBytes);
}, 60000);
test('a never-ready document exhausts its acceptance deadline and retains data with invalid quality', async () => {
    const m = plan({ deadlineMs: 100, pollIntervalMs: 25, requestTimeoutMs: 10, nextTurnDelayMs: 0 }), fake = simulatedWire(); let deletes = 0, pendingId: string | undefined;
    await execute(m, { wire: async (u, i) => { if (i.method === 'DELETE') deletes++; const r = await fake(u, i); if (u.pathname.includes('/document/')) { const b = await r.json(); pendingId ??= b.id; return Response.json({ ...b, system: { ...b.system, dreamingStatus: b.id === pendingId ? 'dreaming' : 'done' } }); } return r; } });
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(saved.quality.validity).toBe('invalid'); expect(saved.summary.retrieval.cases).toBe(0); expect(saved.processing.latency.timedOut).toBeGreaterThan(0);
    expect(saved.processing.latency.memoryFromAcceptance.observed).toBe(saved.processing.requiredLatestDocuments - 1); expect(saved.retention.status).toBe('awaiting_reconciliation'); expect(deletes).toBe(0);
}, 60000);
