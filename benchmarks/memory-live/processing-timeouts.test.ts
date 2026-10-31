import { test, expect, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGuarded, validateLiveCostGuard } from './cost-guard';
import { processingPlan, validateProcessingPlan } from './processing';
import { newRunId, validateManifest } from './manifest';
import { execute } from './run';
import { simulatedWire } from './namespace-transport';
import * as security from './security';
import { testScratch, boundaryTest } from './test-support';
const scratch = testScratch();
async function candidate() {
    const run = newRunId();
    return prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } }, { ceilingUsd: 1, stopUsd: .95, cleanupReserveUsd: .05 });
}
// Drive real transport/controller logic with a deterministic external timer queue.
function manualClock() {
    let now = 0;
    const timers = new Set<{ at: number; callback(): void }>();
    const schedule = (ms: number, callback: () => void) => {
        const timer = { at: now + ms, callback }; timers.add(timer);
        return () => { timers.delete(timer); };
    };
    const flush = async () => { for (let n = 0; n < 12; n++) await new Promise<void>(resolve => setImmediate(resolve)); };
    return { now: () => now, schedule, sleep: (ms: number) => new Promise<void>(resolve => schedule(ms, resolve)),
        async run<T>(work: Promise<T>): Promise<T> {
            let done = false;
            void work.then(() => { done = true; }, () => { done = true; });
            for (let step = 0; !done && step < 1000; step++) {
                await flush(); if (done) break;
                const next = [...timers].sort((a, b) => a.at - b.at)[0];
                if (!next) throw new Error('virtual_work_stalled');
                now = next.at; timers.delete(next); next.callback();
            }
            if (!done) throw new Error('virtual_work_did_not_finish');
            return work;
        }, pending: () => timers.size,
    };
}
// Exercise the actual execute -> shared transport -> ProcessingGate composition.
// After one missing status observation, a later malformed response terminates this bounded check; no full replay.
for (const ordinary of ['ingestion', 'retrieval']) boundaryTest(`ordinary ${ordinary} keeps 5s while status ${ordinary === 'ingestion' ? 'headers' : 'body'} remains bounded at 2s`, async () => {
    const m = await candidate(), fake = simulatedWire(); let delayed = false, writes = 0, deletes = 0, selectedPath = '', statusPending = false, statusExpired = false;
    const clock = manualClock();
    await clock.run(execute(m, { clock, transportTiming: clock, wire: async (u, i) => {
        if (i.method === 'DELETE') deletes++;
        if (u.pathname === '/v3/documents') writes++;
        const selected = ordinary === 'ingestion' ? u.pathname === '/v3/documents' : writes > 0 && ['/v4/profile', '/v4/search'].includes(u.pathname) && !!JSON.parse(String(i.body ?? '{}')).q;
        if (selected && !delayed) { selectedPath = u.pathname; delayed = true; await clock.sleep(2200); }
        if (delayed && u.pathname.includes('/document/') && statusExpired) return Response.json({ malformed: true });
        if (delayed && u.pathname.includes('/document/') && !statusPending) {
            statusPending = true;
            i.signal!.addEventListener('abort', () => { statusExpired = true; }, { once: true });
            return ordinary === 'ingestion' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }));
        }
        return fake(u, i);
    } }));
    expect(clock.pending()).toBe(0);
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
