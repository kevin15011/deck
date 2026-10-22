import { test, expect, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGuarded, validateLiveCostGuard } from './cost-guard';
import { processingPlan, validateProcessingPlan } from './processing';
import { newRunId, validateManifest } from './manifest';
import { execute } from './run';
import { simulatedWire } from './namespace-transport';
import * as security from './security';
import { testScratch } from './test-support';
const scratch = testScratch();
async function candidate() {
    const run = newRunId();
    return prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } }, { ceilingUsd: 1, stopUsd: .95, cleanupReserveUsd: .05 });
}
// Exercise the actual execute -> shared transport -> ProcessingGate composition.
// After one missing status observation, a later malformed response terminates this bounded check; no full replay.
for (const ordinary of ['ingestion', 'retrieval']) test(`ordinary ${ordinary} keeps 5s while status ${ordinary === 'ingestion' ? 'headers' : 'body'} remains bounded at 2s`, async () => {
    const m = await candidate(), fake = simulatedWire(); let delayed = false, writes = 0, deletes = 0, selectedPath = '', statusAttempts = 0, now = Date.now(); 
    await execute(m, { clock: { now: () => now, sleep: async ms => { now += ms; } }, wire: async (u, i) => {
        if (i.method === 'DELETE') deletes++;
        if (u.pathname === '/v3/documents') writes++;
        const selected = ordinary === 'ingestion' ? u.pathname === '/v3/documents' : writes > 0 && ['/v4/profile', '/v4/search'].includes(u.pathname) && !!JSON.parse(String(i.body ?? '{}')).q;
        if (selected && !delayed) { selectedPath = u.pathname; delayed = true; await new Promise(resolve => setTimeout(resolve, 2200)); }
        if (delayed && u.pathname.includes('/document/') && ++statusAttempts > 1) return Response.json({ malformed: true });
        if (delayed && u.pathname.includes('/document/')) return ordinary === 'ingestion' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }));
        return fake(u, i);
    } });
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    const { events } = JSON.parse(readFileSync(join(m.evalRoot, 'events.json'), 'utf8'));
    const ordinaryEvent = events.find((e: any) => e.endpoint === selectedPath && e.durationMs >= 1800);
    console.log(JSON.stringify({ ordinary, ordinaryElapsedMs: ordinaryEvent?.durationMs, ordinaryStatus: ordinaryEvent?.status ?? null, ordinaryError: ordinaryEvent?.error ?? null, statusTimeoutMs: events.find((e: any) => e.endpoint.includes('/document/') && e.error)?.durationMs ?? null, reservations: saved.durableReservations.evaluationRequests }));
    expect(delayed).toBe(true); expect(ordinaryEvent).toBeDefined();
    expect(ordinaryEvent.status).toBe(200); expect(ordinaryEvent.error).toBeUndefined();
    expect(ordinaryEvent.durationMs).toBeGreaterThanOrEqual(2100);
    const status = events.find((e: any) => e.endpoint.includes('/document/') && e.error);
    expect(status).toBeDefined(); expect(status.error).toBe('egress_failed');
    expect(status.durationMs).toBeGreaterThanOrEqual(1800); expect(status.durationMs).toBeLessThan(4000);
    expect(status.transportFailure).toBe('timeout');
    expect(saved.processing.documents.some((d: any) => d.observations.some((o: any) => o.missing && o.transportFailure === 'timeout'))).toBe(true);
    expect(saved.durableReservations.evaluationRequests).toBe(events.length);
    expect(saved.costProgress.evaluationRequestsUsed).toBe(events.length);
    expect(saved.retention.status).toBe('awaiting_reconciliation'); expect(deletes).toBe(0);
}, 30000);
test('ordinary allowance is explicit, fixed at 5s, validated and hash-bound independently from status timing', async () => {
    expect(processingPlan()).toMatchObject({ ordinaryIoTimeoutMs: 5000, requestTimeoutMs: 5000 });
    const m = await candidate(); validateManifest(m); validateLiveCostGuard(m);
    expect(m.processing).toMatchObject({ ordinaryIoTimeoutMs: 5000, requestTimeoutMs: 2000 });
    expect(m.costGuard!.executionForecast).toMatchObject({ evaluationRequests: 5994, maximumPollsPerRevision: 41, evaluationEstimatedUsd: .711760 });
    expect(m.costGuard!.forecastTotalWithProtectedReserveUsd).toBe(.761760);
    for (const value of [undefined, null, '5000', 0, -1, 2000, 5001, Infinity, NaN]) {
        const bad = structuredClone(m); (bad.processing as any).ordinaryIoTimeoutMs = value;
        expect(() => validateProcessingPlan(bad.processing!)).toThrow('invalid_processing_plan');
        expect(() => validateLiveCostGuard(bad)).toThrow('live_requires_valid_cost_guard');
        const { liveApproved, cleanupApproved, costGuard, ...inputs } = bad;
        const { frozenPlanHash, ...guard } = costGuard!;
        costGuard!.frozenPlanHash = security.sha256(JSON.stringify({ inputs, guard }));
        expect(() => validateLiveCostGuard(bad)).toThrow('live_requires_valid_cost_guard');
    }
    // A still-valid status timeout amendment cannot reuse the frozen hash.
    const changed = { ...m, processing: { ...m.processing!, requestTimeoutMs: 1900 } };
    validateProcessingPlan(changed.processing); expect(() => validateLiveCostGuard(changed)).toThrow('live_requires_valid_cost_guard');
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('NO_KEY_ACCESS'); });
    try { await expect(execute(m, { live: true })).rejects.toThrow('live_requires_explicit_approved_manifest'); expect(reader).not.toHaveBeenCalled(); }
    finally { reader.mockRestore(); }
});
