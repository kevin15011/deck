import { test, expect, spyOn } from 'bun:test';
import { ProcessingGate, processingPlan, parseProcessingArgs, type Clock } from './processing';
import { sha256 } from './security';
import { prepareGuarded, validateLiveCostGuard, CostLedger, COST_POLICY } from './cost-guard';
import { newRunId, prepare, validateManifest } from './manifest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from './run';
import { rescore } from './rescore';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { RunAuthority } from './run-authority';
import * as security from './security';
import { testScratch } from './test-support';
const scratch = testScratch();
// One deterministic event clock: parallel requests consume overlapping time, not additive time.
function eventClock() {
    let now = 0, scheduled = false; const timers: { at: number; resolve(): void }[] = [];
    const pump = () => { if (scheduled || !timers.length) return; scheduled = true; setImmediate(() => {
        scheduled = false; now = Math.max(now, Math.min(...timers.map(t => t.at)));
        for (const t of timers.filter(t => t.at <= now)) { timers.splice(timers.indexOf(t), 1); t.resolve(); }
        pump();
    }); };
    return { now: () => now, sleep: (ms: number) => new Promise<void>(resolve => { timers.push({ at: now + ms, resolve }); pump(); }) };
}
function fixture(indexAt = 15000, memoryAt = 5000, duration: number | ((age: number) => number) = 0, count = 1, overrides = {}) {
    const clock = eventClock(), events: any[] = [], polls: number[] = []; let active = 0, peak = 0;
    const plan = processingPlan({ schedule: 'adaptive-v1', requestTimeoutMs: 2000, ...overrides });
    const gate = new ProcessingGate({ events, aborted: false, fetch: async (url: string) => {
        active++; peak = Math.max(peak, active); const id = url.split('/').at(-1)!;
        const revision = [...events].reverse().find(e => e.documentId === id)!;
        const age = clock.now() - revision.acceptedAtMs;
        polls.push(clock.now()); const wait = typeof duration === 'function' ? duration(age) : duration; if (wait) await clock.sleep(wait); active--;
        return Response.json({ id, content: revision.content, system: { status: age >= indexAt ? 'done' : 'indexing', dreamingStatus: age >= memoryAt ? 'done' : 'dreaming', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' } });
    } } as any, plan, clock);
    const write = (id: string, content = id) => events.push({ endpoint: '/v3/documents', documentId: id, content, contentHash: sha256(content), writeStartedAtMs: clock.now() - 200, acceptedAtMs: clock.now(), status: 200, tag: 'deck_eval_synthetic' });
    for (let n = 0; n < count; n++) write('doc' + n);
    return { clock, plan, gate, events, polls, write, peak: () => peak };
}
test('frozen adaptive schedule includes all checkpoints and exactly 41 polls per ten-minute lifetime', async () => {
    const f = fixture(Infinity, Infinity);
    const s = await f.gate.waitForAll();
    expect(f.polls).toEqual([...Array.from({ length: 25 }, (_, n) => n * 2500), 70000, 80000, 90000, 100000, 110000, 120000, 150000, 180000, 210000, 240000, 270000, 300000, 360000, 420000, 480000, 540000]);
    expect(f.clock.now()).toBe(600000); expect(s.latency.timedOut).toBe(1);
    expect(s.latency.memoryFromAcceptance.observed).toBe(0);
    expect(parseProcessingArgs(['--processing-schedule', 'adaptive-v1'])).toMatchObject({ schedule: 'adaptive-v1' });
    for (const args of [['--processing-schedule'], ['--processing-schedule=adaptive-v1'], ['--processing-schedule', 'other'], ['--processing-schedule', 'adaptive-v1', '--poll-interval-ms', '3000']]) expect(() => parseProcessingArgs(args)).toThrow();
});
test('indexing and dreaming completion are independent and curves never interpolate a straddling interval', async () => {
    const f = fixture(15000, 5000, 200); const s = await f.gate.waitForAll(); const d = s.documents[0]!;
    expect(d.memoryObservedAtMs).toBe(5200); expect(d.indexingObservedAtMs).toBe(15200); expect(d.readyObservedAtMs).toBe(15200);
    expect(s.latency.memoryFromAcceptance.p50).toBe(5200); expect(s.latency.indexingFromAcceptance.p95).toBe(15200);
    expect(s.latency.acknowledgement.p50).toBe(200);
    const rows = s.statusAvailability.curves;
    expect(rows.find(r => r.horizonMs === 5000)!.memories).toMatchObject({ ready: 0, notReady: 0, uncertain: 1, denominator: 1 });
    expect(rows.find(r => r.horizonMs === 15000)!.fragments).toMatchObject({ ready: 0, notReady: 0, uncertain: 1 });
    expect(rows.find(r => r.horizonMs === 30000)!.memories.ready).toBe(1);
    expect(s.statusAvailability.measurement).toBe('document_status_completion_not_retrieval');
    expect(s.statusAvailability.scenarios.handoff5s.horizonMs).toBe(5000);
});
test('four bounded concurrent slots measure twelve nonzero-latency documents without serial head-of-line gaps', async () => {
    const f = fixture(15000, 30000, 200, 12);
    await f.gate.monitorUntil(30000);
    expect(f.clock.now()).toBe(30000); expect(f.peak()).toBe(4);
    const s = await f.gate.waitForAll();
    expect(s.completed).toBe(12); expect(s.latency.bands[0]!.cadenceValidity).toBe('valid');
    expect(s.latency.bands[0]!.precisionValidity).toBe('valid');
    expect(s.latency.bands[0]!.maximumObservationGapMs).toBeLessThanOrEqual(3000);
});
test('slow source/queueing yields to query horizons and marks early-band precision invalid', async () => {
    const f = fixture(60000, 60000, 4000, 12, { requestTimeoutMs: 5000 });
    await f.gate.monitorUntil(30000); expect(f.clock.now()).toBe(30000); expect(f.peak()).toBe(4);
    const before = f.polls.length; await f.clock.sleep(1000); // Actual next-turn request occupies this slot.
    expect(f.polls.length).toBe(before);
    await f.gate.monitorUntil(60000); expect(f.clock.now()).toBe(60000);
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('valid'); expect(s.latency.bands[0]!.precisionValidity).toBe('invalid');
    expect(s.latency.bands[0]!.maximumObservationGapMs).toBeGreaterThan(3000);
    expect(s.statusAvailability.curves[0]!.memories.notReady).toBe(12);
    expect(s.statusAvailability.curves[3]!.memories.uncertain).toBeGreaterThan(0);
});
test('late scheduler calls skip elapsed slots, never burst catch up or renew changed-revision peer deadlines', async () => {
    const f = fixture(Infinity, Infinity, 0, 2); await f.clock.sleep(590000); await f.gate.sample();
    expect(f.polls).toHaveLength(2); await f.gate.sample(); expect(f.polls).toHaveLength(2);
    f.write('doc0', 'changed'); const s = await f.gate.waitForAll();
    expect(f.clock.now()).toBe(600000); expect(s.documents.find(d => d.id === 'doc1')!.status).toBe('timed_out');
    expect(s.supersededRevisions).toHaveLength(1); expect(s.documents.find(d => d.id === 'doc0')!.revision).toBe(sha256('changed')); expect(s.latency.bands[0]!.precisionValidity).toBe('invalid');
});
test('all adaptive polling and retries fit the explicit USD1 plan without increasing defaults', async () => {
    const run = newRunId();
    const m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } }, { ceilingUsd: 1, stopUsd: .95, cleanupReserveUsd: .05 });
    validateManifest(m); validateLiveCostGuard(m); expect(m.liveApproved).toBe(false); expect(m.cleanupRequestBudget).toBe(28);
    expect(m.costGuard!.executionForecast).toMatchObject({ maximumPollsPerRevision: 41, monitoringStatusRequests: 5576, evaluationRequests: 5994, evaluationEstimatedUsd: .711760, fitsRequestBudget: true });
    expect(m.costGuard!.forecast).toMatchObject({ contentUtf8Bytes: 8239, serializedBodyUtf8Bytes: 26879, ingestionTokenEstimate: 2084 });
    expect(m.costGuard!.ingestionTokenBudget).toBe(16478); expect(m.costGuard!.forecastTotalWithProtectedReserveUsd).toBe(.761760);
    for (const patch of [{ schedule: 'fixed' }, { statusConcurrency: 5 }, { pollOffsetsMs: [0] }, { deadlineMs: 600001 }]) {
        const bad = { ...structuredClone(m), processing: { ...m.processing!, ...patch } } as typeof m;
        expect(() => validateLiveCostGuard(bad)).toThrow();
        // Intrinsic schedule validation also rejects a rehashed synthetic fixture.
        const { liveApproved, cleanupApproved, costGuard, ...inputs } = bad;
        const { frozenPlanHash, ...guard } = costGuard!;
        costGuard!.frozenPlanHash = sha256(JSON.stringify({ inputs, guard }));
        expect(() => validateLiveCostGuard(bad)).toThrow();
    }
    expect(() => validateLiveCostGuard({ ...m, requestBudget: 5995 })).toThrow();
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('NO_KEY_ACCESS'); });
    try { await expect(execute(m, { live: true })).rejects.toThrow('live_requires_explicit_approved_manifest'); expect(reader).not.toHaveBeenCalled(); }
    finally { reader.mockRestore(); }
});

test('40 actual-age turns preserve early quantiles and checkpoints', async () => {
    const f = fixture(15000, 60000, 200, 0);
    for (let turn = 0; turn < 40; turn++) { f.write('doc' + turn); await f.gate.monitorUntil(f.clock.now() + 30000); }
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('valid'); expect(s.completed).toBe(40);
    expect(s.latency.indexingFromAcceptance.p95).toBeLessThanOrEqual(18000);
    expect(s.latency.memoryFromAcceptance.p50).toBeGreaterThanOrEqual(60000);
    expect(s.latency.memoryFromAcceptance.p95).toBeLessThanOrEqual(63000);
    expect(s.latency.bands[0]!.precisionValidity).toBe('valid');
    expect(s.statusAvailability.curves[0]!.fragments.notReady).toBe(40);
    expect(s.statusAvailability.curves[4]!.memories.ready).toBe(40);
});
for (const bound of ['request', 'USD']) test(`concurrent adaptive wave shares one cumulative ${bound} reservation authority`, async () => {
    const run = newRunId(), clock = eventClock();
    const m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: bound === 'request' ? 6 : 100, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } });
    const ledger = new CostLedger({ ceilingUsd: 1, stopUsd: bound === 'USD' ? .00073 : .95, cleanupReserveUsd: .05, ingestionTokenBudget: 16478, maxWriteAttempts: 136, policy: COST_POLICY });
    const a = RunAuthority.acquire(m, 'evaluation'); a.startEvaluation();
    try {
        let statuses = 0; const fake = simulatedWire();
        const t = new NamespaceTransport({ run, bindings: m.bindings, budget: m.requestBudget, costLedger: ledger, authority: a, now: clock.now, wire: async (u, i) => {
            const r = await fake(u, i);
            if (u.pathname.includes('/document/')) { statuses++; await clock.sleep(200); const b = await r.json(); return Response.json({ ...b, system: { ...b.system, status: 'indexing', dreamingStatus: 'dreaming' } }); }
            return r;
        } });
        for (let n = 0; n < 4; n++) await t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(m.bindings)[0], customId: 'deck_eval_' + run + '_' + String(n).repeat(32), content: 'doc' + n }) });
        const gate = new ProcessingGate(t, m.processing!, clock); const s = await gate.sample(); await t.drain();
        expect(statuses).toBe(2); expect(t.used).toBe(6); expect(s.validity).toBe('invalid'); expect(t.aborted).toBe(true);
        expect(a.receipt()).toMatchObject({ evaluationRequests: 6, cleanupRequests: 0, cleanupLimit: 28 });
        expect(ledger.snapshot()).toMatchObject({ evaluationRequestsUsed: 6, evaluationUsedUsd: .00068, cleanupRequestsUsed: 0 });
        await gate.sample(); expect(statuses).toBe(2);
    } finally { a.finishEvaluation(); a.close(); }
});
test('adaptive production composition keeps capture-relative retrieval separate and rescores without rewriting measurements', async () => {
    const run = newRunId(), clock = eventClock(), fake = simulatedWire(), accepted = new Map<string, number>(); let deletes = 0;
    const m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } }, { ceilingUsd: 1, stopUsd: .95, cleanupReserveUsd: .05 });
    const result = await execute(m, { clock, wire: async (u, i) => {
        if (i.method === 'DELETE') deletes++;
        if (u.pathname === '/v3/documents') await clock.sleep(100);
        const r = await fake(u, i);
        if (u.pathname === '/v3/documents' && r.ok) accepted.set((await r.clone().json()).id, clock.now());
        if (u.pathname.includes('/document/')) { const b = await r.json(), age = clock.now() - accepted.get(b.id)!; await clock.sleep(100); return Response.json({ ...b, system: { ...b.system, status: age >= 15000 ? 'done' : 'indexing', dreamingStatus: age >= 60000 ? 'done' : 'dreaming' } }); }
        return r;
    } });
    const bytes = readFileSync(join(m.evalRoot, 'results.json'), 'utf8'), saved = JSON.parse(bytes);
    expect(result.quality.validity).toBe('valid'); expect(deletes).toBe(0); expect(saved.retention.status).toBe('awaiting_reconciliation');
    expect(saved.processing.statusAvailability.curves).toHaveLength(6);
    expect(saved.processing.latency.indexingFromAcceptance.p95).toBeLessThanOrEqual(18000);
    expect(saved.processing.latency.memoryFromAcceptance.p95).toBeLessThanOrEqual(63000);
    expect(saved.availability.timeline).toHaveLength(42);
    for (const row of saved.availability.timeline) {
        expect(row.driftMs).toBe(0); expect(row.capturedSeedIds.at(-1)).toBe(row.anchorSeed);
        const future = [...saved.results[0].captures, ...saved.results[0].poolControls].find((c: any) => !row.capturedSeedIds.includes(c.id));
        if (future) expect(future.startedAtMs).toBeGreaterThanOrEqual(row.completedAtMs);
    }
    expect(saved.budget.evaluationUsed).toBeLessThanOrEqual(5994);
    expect(saved.durableReservations.evaluationRequests).toBe(saved.costProgress.evaluationRequestsUsed);
    expect(saved.costProgress.evaluationUsedUsd).toBeLessThan(.95); expect(saved.costProgress.cleanupRequestsUsed).toBe(0);
    const rescored = JSON.parse(readFileSync(rescore(m).path, 'utf8'));
    expect(rescored.processing).toEqual(saved.processing); expect(rescored.availability.timeline).toEqual(saved.availability.timeline);
    expect(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).toBe(bytes);
}, 180000);

test('unresolved write obligations stay in curve and quantile denominators without fabricated fast completions', async () => {
    const f = fixture(); f.events.push({ endpoint: '/v3/documents', writeStartedAtMs: 0, error: 'lost_ack', tag: 'deck_eval_synthetic' });
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('invalid'); expect(s.statusAvailability.unresolvedWriteObligations).toBe(1);
    for (const row of s.statusAvailability.curves) for (const metric of [row.fragments, row.memories]) expect(metric).toMatchObject({ denominator: 2, ready: 0, uncertain: 2 });
    expect(s.latency.memoryFromAcceptance).toMatchObject({ observed: 0, denominator: 2, censoredOrFailed: 2, p50: null, p95: null });
    expect(f.polls).toHaveLength(0);
});

test('a slow response spanning the 60-second band boundary cannot claim early 3-second precision', async () => {
    const f = fixture(60000, 60000, age => age >= 60000 ? 4000 : 0, 1, { requestTimeoutMs: 5000 });
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('valid'); expect(s.documents[0]!.memoryObservedAtMs).toBe(64000);
    expect(s.latency.bands[0]!.maximumObservationGapMs).toBe(6500);
    expect(s.latency.bands[0]!.precisionValidity).toBe('invalid');
    expect(s.latency.quantitativeValidity).toBe('invalid');
});
