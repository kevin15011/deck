import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessingGate, processingPlan } from './processing';
import { sha256 } from './security';
import { prepare, newRunId } from './manifest';
import { execute } from './run';
import { simulatedWire } from './namespace-transport';
import { testScratch } from './test-support';
const scratch = testScratch();
// Ported from Quality R9's blind-gap.ts; no reviewer script import or persistent side effects.
for (const pollIntervalMs of [30000, 60000, 120000, 1000]) test(`execute observes older pending revisions during later turns (${pollIntervalMs}ms)`, async () => {
    let now = 1700000000000, chosen: string | undefined, accepted = 0, deletes = 0;
    const fake = simulatedWire(), run = newRunId();
    const m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', accountSharedWithProduction: true, processing: { pollIntervalMs } });
    const result = await execute(m, { clock: { now: () => now, sleep: async ms => { now += ms; } }, wire: async (u, i) => {
        if (i.method === 'DELETE') deletes++;
        const r = await fake(u, i);
        if (u.pathname === '/v3/documents' && !chosen) { chosen = (await r.clone().json()).id; accepted = now; }
        if (u.pathname.includes('/document/')) { const b = await r.json(); return Response.json({ ...b, system: { ...b.system, dreamingStatus: b.id === chosen && now < accepted + 60000 ? 'dreaming' : 'done' } }); }
        return r;
    } });
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    const d = saved.processing.documents.find((d: any) => d.id === chosen);
    expect(result.quality.validity).toBe('valid'); expect(deletes).toBe(0);
    expect(d.memoryObservedAtMs - accepted).toBeGreaterThanOrEqual(60000);
    expect(d.memoryObservedAtMs - accepted).toBeLessThanOrEqual(60000 + pollIntervalMs);
    expect(d.memoryObservedAtMs).toBeLessThan(saved.processing.gateStartedAtMs);
    expect(saved.processing.latency.quantitativeValidity).toBe('valid');
    expect(saved.availability.timeline).toHaveLength(42);
    for (const row of saved.availability.timeline) { expect(row.driftMs).toBe(0); expect(row.capturedSeedIds.at(-1)).toBe(row.anchorSeed); }
}, 60000);
function fixture(pollIntervalMs = 30000, pollDuration = 0) {
    let now = 0; const events: any[] = [], versions = new Map<string, { content: string; at: number }>(), polls: number[] = [];
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    const gate = new ProcessingGate({ events, aborted: false, fetch: async (url: string) => {
        const id = url.split('/').at(-1)!, v = versions.get(id)!, done = now >= v.at + 60000;
        polls.push(now); now += pollDuration;
        return Response.json({ id, content: v.content, system: { status: done ? 'done' : 'indexing', dreamingStatus: done ? 'done' : 'dreaming', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' } });
    } } as any, processingPlan({ pollIntervalMs }), clock);
    const write = (id: string, content = id) => { versions.set(id, { content, at: now }); events.push({ endpoint: '/v3/documents', documentId: id, contentHash: sha256(content), writeStartedAtMs: now, acceptedAtMs: now, status: 200, tag: 'deck_eval_synthetic' }); };
    return { gate, clock, polls, write };
}
// Quality's quantile-gap-v2.ts: all 40 revisions truly finish at acceptance +60s.
for (const interval of [1000, 30000, 60000, 120000]) test(`40-turn latency distribution has no capture-loop blind gap (${interval}ms)`, async () => {
    const f = fixture(interval);
    for (let turn = 0; turn < 40; turn++) { f.write('doc' + turn); await f.gate.monitorUntil(f.clock.now() + 30000); await f.gate.sample(); }
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('valid'); expect(s.latency.quantitativeValidity).toBe('valid');
    expect(s.latency.memoryFromAcceptance.p50).toBeGreaterThanOrEqual(60000);
    expect(s.latency.memoryFromAcceptance.p95).toBeLessThanOrEqual(60000 + interval);
    expect(s.latency.memoryFromAcceptance.observed).toBe(40);
});
test('slow status polls respect the next-turn horizon; missed resolution is explicit instead of waiting for readiness', async () => {
    const f = fixture(30000, 5000);
    for (let n = 0; n < 12; n++) f.write('d' + n);
    await f.gate.monitorUntil(30000);
    expect(f.clock.now()).toBe(30000); expect(f.polls.length).toBe(6);
    // A due query now runs, without another status request or future capture.
    const queryStarted = f.clock.now(); await f.clock.sleep(4000);
    await f.gate.monitorUntil(60000);
    expect(queryStarted).toBe(30000); expect(f.clock.now()).toBe(60000);
    const s = f.gate.snapshot();
    expect(s.latency.quantitativeValidity).toBe('invalid');
    expect(s.latency.resolutionMisses).toBeGreaterThan(0);
    expect(s.latency.maximumObservationGapMs).toBeGreaterThan(35000);
});
test('a changed revision gets its own acceptance deadline without renewing peers or final-gate allowance', async () => {
    const f = fixture(); f.write('old');
    await f.gate.monitorUntil(30000); f.write('old', 'changed');
    await f.gate.monitorUntil(60000); await f.gate.sample();
    expect(f.gate.snapshot().completed).toBe(0);
    await f.gate.waitForAll(); const s = f.gate.snapshot();
    expect(s.completed).toBe(1); expect(s.supersededRevisions).toHaveLength(1);
    expect(s.documents[0]!.revision).toBe(sha256('changed'));
    expect(s.documents[0]!.memoryObservedAtMs).toBe(90000);
    expect(s.documents[0]!.processingDeadlineAtMs).toBe(630000);
});
test('late entry to final gate cannot renew a revision deadline or poll expired data', async () => {
    const f = fixture(); f.write('expired'); await f.clock.sleep(600001);
    const s = await f.gate.waitForAll();
    expect(s.validity).toBe('invalid'); expect(s.latency.timedOut).toBe(1);
    expect(f.polls).toHaveLength(0); expect(f.clock.now()).toBe(600001);
});
test('an overdue polling round keeps servicing pending revisions while idle time remains', async () => {
    const f = fixture(10000, 5000);
    for (let n = 0; n < 5; n++) f.write('d' + n);
    await f.gate.monitorUntil(90000);
    expect(f.clock.now()).toBe(90000);
    expect(f.polls.length).toBeGreaterThan(5);
    expect(f.gate.snapshot().completed).toBeGreaterThan(0);
});
test('actual execute with slow polls preserves availability targets and captured prefixes', async () => {
    let now = 1700000000000; const accepted = new Map<string, number>(), fake = simulatedWire(), run = newRunId();
    const m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', processing: { pollIntervalMs: 30000 } });
    const result = await execute(m, { clock: { now: () => now, sleep: async ms => { now += ms; } }, wire: async (u, i) => {
        const r = await fake(u, i);
        if (u.pathname === '/v3/documents') accepted.set((await r.clone().json()).id, now);
        if (u.pathname.includes('/document/')) { const b = await r.json(), done = now >= accepted.get(b.id)! + 60000; now += 4000; return Response.json({ ...b, system: { ...b.system, dreamingStatus: done ? 'done' : 'dreaming' } }); }
        return r;
    } });
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(result.quality.validity).toBe('valid'); expect(saved.availability.timeline).toHaveLength(42);
    for (const row of saved.availability.timeline) {
        expect(row.driftMs).toBe(0);
        const future = [...saved.results[0].captures, ...saved.results[0].poolControls].find((c: any) => !row.capturedSeedIds.includes(c.id));
        if (future) expect(future.startedAtMs).toBeGreaterThanOrEqual(row.completedAtMs);
    }
    expect(saved.processing.latency.maximumObservationGapMs).toBeGreaterThan(0);
}, 60000);
