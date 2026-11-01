import { isDocumentWrite, isMemoryProfile, isMemorySearch } from './request-policy';
import { test, expect } from 'bun:test';
import { ProcessingGate, processingPlan } from './processing';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { prepare, newRunId } from './manifest';
import { execute } from './run';
import { prepareGuarded } from './cost-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testScratch } from './test-support';
const scratch = testScratch();
const flush = async () => { for (let n = 0; n < 12; n++) await new Promise<void>(r => setImmediate(r)); };
function manualClock() {
    let now = 0, sleepers = 0; const timers = new Set<{ at: number; fn(): void }>();
    const schedule = (ms: number, fn: () => void) => { const t = { at: now + ms, fn }; timers.add(t); return () => { timers.delete(t); }; };
    return { now: () => now, schedule, sleep: (ms: number) => { sleepers++; return new Promise<void>(r => { schedule(ms, () => { sleepers--; r(); }); }); }, sleeping: () => sleepers,
        advance: async (ms: number) => { const end = now + ms; await flush(); while (true) { const next = [...timers].sort((a,b) => a.at-b.at)[0]; if (!next || next.at > end) break; now = next.at; timers.delete(next); next.fn(); await flush(); } now = end; await flush(); }, timers: () => timers.size };
}
function fixture(deadlineMs = 10000) {
    const clock = manualClock(), run = newRunId(), m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot' });
    let gate: ProcessingGate, failNext = false, httpNext = 0, writeDelay = 0, pollDelay = 100, content = 'old', status = 'indexing', dreamingStatus = 'dreaming';
    let active = 0, peak = 0; const starts: number[] = [];
    const t = new NamespaceTransport({ run, bindings: m.bindings, budget: 100, now: clock.now, changed: () => (gate as any)?.notify?.(), wire: async (u,i) => {
        if (isDocumentWrite(u.pathname)) { if (writeDelay) await clock.sleep(writeDelay); content = JSON.parse(String(i.body)).content; return Response.json({ id: 'owned' }); }
        starts.push(clock.now()); active++; peak = Math.max(peak, active);
        const saved = { content, status, dreamingStatus };
        try { if (httpNext) { const status = httpNext; httpNext = 0; return new Response('synthetic unavailable', { status }); } if (failNext) { failNext = false; throw new Error('synthetic-network-secret-MUST-NOT-LEAK'); } await clock.sleep(pollDelay); return Response.json({ id: 'owned', content: saved.content, system: { status: saved.status, dreamingStatus: saved.dreamingStatus, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' } }); }
        finally { active--; }
    } });
    gate = new ProcessingGate(t, processingPlan({ schedule: 'adaptive-v1', deadlineMs, pollIntervalMs: 2500, requestTimeoutMs: 5000 }), clock);
    const write = (content = 'old') => t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(m.bindings)[0], customId: `deck_eval_${run}_${'a'.repeat(32)}`, content }) });
    return { gate, t, clock, starts, write, fail: () => { failNext = true; }, http: (status: number) => { httpNext = status; }, delay: (ms: number) => { pollDelay = ms; }, holdWrites: (ms: number) => { writeDelay = ms; }, done: () => { status = dreamingStatus = 'done'; }, peak: () => peak };
}
test('transient status transport failure is missing data; next frozen slot can establish readiness', async () => {
    const f = fixture(); await f.write(); f.fail(); await f.gate.sample();
    expect(f.gate.snapshot().documents[0]!.status).toBe('pending');
    expect(JSON.stringify(f.t.events)).not.toContain('MUST-NOT-LEAK');
    expect((f.t.events[1] as any).transportFailure).toBe('network');
    f.done(); const wait = f.gate.waitForAll(); await f.clock.advance(10000); const r = await wait;
    expect(r.validity).toBe('valid'); expect(f.starts).toEqual([0,2500]);
    expect(r.documents[0]!.observations[0].missing).toBe(true);
    expect(r.documents[0]!.processingDeadlineAtMs).toBe(10000);
});
test('background observations run during ordinary waiting and superseded in-flight results cannot complete the latest revision', async () => {
    const f = fixture(); f.gate.startMonitoring(10000); await f.write(); await f.clock.advance(100);
    expect(f.starts).toEqual([0]);
    f.delay(3100); f.done(); await f.clock.advance(2400); // Old revision's slow request starts at2500.
    await f.write('new'); await f.clock.advance(3200);
    const r = f.gate.snapshot();
    expect(r.supersededRevisions).toHaveLength(1);
    expect(r.supersededRevisions[0]!.observations.some((o: any) => o.discarded === 'superseded_revision')).toBe(true);
    expect(r.documents[0]!.observations.every((o: any) => !o.identityWitness || o.identityWitness.writeAttempt === r.documents[0]!.latestAttempt)).toBe(true);
    expect(r.latency.bands[0]!.precisionValidity).toBe('invalid');
    await f.gate.stopMonitoring(); const used = f.t.used; await f.clock.advance(20000); expect(f.t.used).toBe(used);
});
test('all missing observations exhaust the original deadline without extra retries', async () => {
    const f = fixture(7500); await f.write();
    for (let n = 0; n < 3; n++) { f.fail(); await f.gate.sample(); await f.clock.advance(2500); }
    const r = await f.gate.waitForAll();
    expect(r.documents[0]!.status).toBe('timed_out'); expect(f.starts).toEqual([0,2500,5000]);
    expect(r.latency.memoryFromAcceptance.observed).toBe(0); expect(r.latency.quantitativeValidity).toBe('invalid');
});
for (const status of [429,503]) test(`HTTP${status} consumes one original slot even with a non-JSON error body`, async () => {
    const f = fixture(); await f.write(); f.http(status); await f.gate.sample();
    expect(f.gate.snapshot().documents[0]!.status).toBe('pending');
    expect(f.gate.snapshot().documents[0]!.observations[0]).toMatchObject({ missing: true, httpStatus: status });
    f.done(); const wait = f.gate.waitForAll(); await f.clock.advance(10000);
    expect((await wait).validity).toBe('valid'); expect(f.starts).toEqual([0,2500]); expect(f.t.used).toBe(3);
});
test('status timeout remains charged, later scheduled success is valid readiness but invalid precision', async () => {
    const f = fixture(); f.delay(6000); f.gate.startMonitoring(10000); await f.write();
    await f.clock.advance(5000); expect(f.gate.snapshot().documents[0]!.status).toBe('pending');
    expect(f.t.events[1]!.transportFailure).toBe('timeout');
    f.delay(100); f.done(); await f.clock.advance(3000);
    const r = f.gate.snapshot(); expect(r.validity).toBe('valid'); expect(r.latency.quantitativeValidity).toBe('invalid');
    expect(f.starts).toEqual([0,7500]); expect(r.documents[0]!.monitoring.missedScheduledSlotsMs).toEqual([2500,5000]); expect(f.t.events[1]!.responseHash).toBeUndefined();
    expect(f.t.observations.filter(o => o.endpoint.includes('/document/'))).toHaveLength(1);
    await f.gate.stopMonitoring(); expect(f.t.used).toBe(3);
});
test('stopping background cancels/drains requests and ignores a late response', async () => {
    const f = fixture(); f.delay(9000); f.gate.startMonitoring(10000); await f.write(); await flush();
    await f.gate.stopMonitoring(); await f.t.drain(); const bytes = JSON.stringify(f.t.events);
    expect(f.t.events[1]!.transportFailure).toBe('abort');
    expect(f.gate.snapshot().documents[0]!.observations[0].discarded).toBe('monitor_stopped');
    await f.clock.advance(20000); expect(JSON.stringify(f.t.events)).toBe(bytes); expect(f.t.used).toBe(2);
});
test('a concurrent pending overwrite prevents an old in-flight done response becoming readiness', async () => {
    const f = fixture(); f.gate.startMonitoring(20000); await f.write(); await f.clock.advance(100);
    f.done(); f.delay(1000); await f.clock.advance(2500); f.holdWrites(4000);
    const writing = f.write('new'); await f.clock.advance(1000);
    const old = f.gate.snapshot().documents[0]!;
    expect(old.status).toBe('pending'); expect(old.indexingObservedAtMs).toBeUndefined();
    expect(old.observations.at(-1).discarded).toBe('write_in_flight');
    await f.clock.advance(3000); await writing; await f.clock.advance(1000);
    expect(f.gate.snapshot().validity).toBe('valid'); expect(f.gate.snapshot().supersededRevisions).toHaveLength(1);
    await f.gate.stopMonitoring();
});
test('background retry slots and in-flight waits cannot extend the original whole-run deadline', async () => {
    const f = fixture(); f.gate.startMonitoring(6000); await f.write(); await f.clock.advance(2600); f.delay(6000);
    await f.clock.advance(3400); const r = f.gate.snapshot();
    expect(r.documents[0]!.status).toBe('timed_out'); expect(r.documents[0]!.processingDeadlineAtMs).toBe(10000);
    expect(f.starts).toEqual([0,2500,5000]); expect(f.t.events.at(-1)!.transportFailure).toBe('timeout');
    const used = f.t.used; await f.clock.advance(10000); expect(f.t.used).toBe(used); await f.gate.stopMonitoring();
});
test('twelve pending documents retain honest 3s precision while ordinary retrieval takes 4s', async () => {
    const clock = manualClock(), run = newRunId(), m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot' }), fake = simulatedWire();
    let gate: ProcessingGate, active = 0, peak = 0;
    const t = new NamespaceTransport({ run, bindings: m.bindings, budget: 500, now: clock.now, changed: () => gate?.notify(), wire: async (u,i) => {
        const r = await fake(u,i);
        if (u.pathname.includes('/document/')) {
            active++; peak = Math.max(peak,active); const age = clock.now();
            const b = await r.json(); await clock.sleep(200); active--;
            return Response.json({ ...b, system: { ...b.system, status: age >= 15000 ? 'done' : 'indexing', dreamingStatus: age >= 30000 ? 'done' : 'dreaming' } });
        }
        if (isMemorySearch(u.pathname)) await clock.sleep(4000);
        return r;
    } });
    gate = new ProcessingGate(t, processingPlan({ schedule: 'adaptive-v1', requestTimeoutMs: 5000 }), clock); gate.startMonitoring(600000);
    for (let n = 0; n < 12; n++) await t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(m.bindings)[0], customId: `deck_eval_${run}_${n.toString(16).repeat(32)}`, content: 'content'+n }) });
    await clock.advance(5000);
    t.phase = 'availability_synthetic'; const before = t.used;
    const query = t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(m.bindings)[0], q: 'synthetic' }) });
    await clock.advance(4000); await query; expect(t.used).toBeGreaterThan(before+1);
    await clock.advance(22000); const s = gate.snapshot();
    expect(s.completed).toBe(12); expect(peak).toBe(4);
    expect(s.latency.bands[0]!.precisionValidity).toBe('valid'); expect(s.latency.bands[0]!.maximumObservationGapMs).toBeLessThanOrEqual(3000);
    expect(s.latency.memoryFromAcceptance.p95).toBeLessThanOrEqual(33000);
    expect(t.events.filter(e => e.endpoint.includes('/document/')).every(e => e.phase === 'processing_monitor')).toBe(true);
    await gate.stopMonitoring();
});
test('execute observes through slow capture and query I/O with one authority, fixed prefixes and clean retrieval receipts', async () => {
    const run = newRunId(), clock = manualClock(), fake = simulatedWire();
    const m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 5000, nextTurnDelayMs: 5000 } }, { ceilingUsd: .83, stopUsd: .78, cleanupReserveUsd: .05 });
    let writes = 0, missing = true, querying = false, queryDone = false, finished = false, deletes = 0, active = 0, peak = 0;
    let captureWindow: number[] = [], queryWindow: number[] = [], queryPrefix = 0;
    const pollStarts: number[] = [], accepted = new Map<string, number>();
    const execution = execute(m, { clock, wire: async (u,i) => {
        if (i.method === 'DELETE') deletes++;
        if (isDocumentWrite(u.pathname)) {
            writes++;
            if (writes === 2) { captureWindow = [clock.now()]; await clock.sleep(4000); captureWindow.push(clock.now()); }
            const r = await fake(u,i); accepted.set((await r.clone().json()).id,clock.now()); return r;
        }
        if (u.pathname.includes('/document/')) {
            pollStarts.push(clock.now()); active++; peak = Math.max(peak,active);
            try {
                if (missing) { missing = false; throw new Error('synthetic transient transport failure'); }
                const b = await (await fake(u,i)).json(); await clock.sleep(100);
                // Deliberately finish this bounded composition test after one actual query.
                if (queryDone) return Response.json({ ...b, id: 'unrelated' });
                const age = clock.now() - accepted.get(b.id)!;
                return Response.json({ ...b, system: { ...b.system, status: age >= 15000 ? 'done' : 'indexing', dreamingStatus: age >= 30000 ? 'done' : 'dreaming' } });
            } finally { active--; }
        }
        if (writes && !querying && (isMemoryProfile(u.pathname) || isMemorySearch(u.pathname)) && (JSON.parse(String(i.body ?? '{}')).q ?? JSON.parse(String(i.body ?? '{}')).query)) {
            querying = true; queryPrefix = writes; queryWindow = [clock.now()]; await clock.sleep(4000); queryWindow.push(clock.now()); expect(writes).toBe(queryPrefix); queryDone = true;
        }
        return fake(u,i);
    } }).finally(() => { finished = true; });
    for (let n = 0; !finished && n < 3000; n++) { await flush(); if (clock.sleeping()) await clock.advance(100); }
    expect(finished).toBe(true); await execution;
    const saved = JSON.parse(readFileSync(join(m.evalRoot,'results.json'),'utf8')), { events } = JSON.parse(readFileSync(join(m.evalRoot,'events.json'),'utf8'));
    expect(pollStarts.some(at => at > captureWindow[0]! && at < captureWindow[1]!)).toBe(true);
    expect(pollStarts.some(at => at > queryWindow[0]! && at < queryWindow[1]!)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4); expect(peak).toBeGreaterThan(1);
    expect(saved.availability.cases.length).toBeGreaterThan(0);
    const row = saved.availability.timeline[0]; expect(row.capturedSeedIds.length).toBe(queryPrefix);
    expect(row.driftMs).toBeLessThan(500); expect(row.capturedSeedIds.at(-1)).toBe(row.anchorSeed);
    expect(saved.availability.cases[0].reason).not.toBe('recall_request_failed');
    for (const ref of saved.availability.cases) {
        const artifact = JSON.parse(readFileSync(join(m.evalRoot,ref.artifact),'utf8'));
        expect(artifact.rawResponses.every((o: any) => !o.endpoint.includes('/document/'))).toBe(true);
    }
    expect(saved.processing.documents.some((d: any) => d.observations.some((o: any) => o.missing && o.transportFailure === 'network'))).toBe(true);
    expect(saved.durableReservations.evaluationRequests).toBe(events.length); expect(saved.costProgress.evaluationRequestsUsed).toBe(events.length);
    expect(saved.retention.status).toBe('awaiting_reconciliation'); expect(deletes).toBe(0);
    const before = JSON.stringify(events); await clock.advance(100000); expect(readFileSync(join(m.evalRoot,'events.json'),'utf8')).toContain('processing_monitor');
    expect(JSON.stringify(JSON.parse(readFileSync(join(m.evalRoot,'events.json'),'utf8')).events)).toBe(before);
}, 60000);
