import { test, expect, spyOn } from 'bun:test';
import { ProcessingGate, processingPlan, type Clock } from './processing';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { prepare, newRunId } from './manifest';
import { testScratch } from './test-support';
const scratch = testScratch();
const fixture = (mutate: (body: any) => any = b => b, overrides = {}) => {
    const run = newRunId(), m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot' });
    let now = 1000; const clock: Clock = { now: () => now, sleep: async ms => { now += ms; } };
    const fake = simulatedWire(), p = processingPlan({ deadlineMs: 100, pollIntervalMs: 20, requestTimeoutMs: 20, ...overrides });
    const t = new NamespaceTransport({ run, bindings: m.bindings, budget: 100, now: clock.now, requestTimeoutMs: 20, wire: async (u, i) => { const r = await fake(u, i); return u.pathname.includes('/document/') ? Response.json(mutate(await r.json())) : r; } });
    const scope = Object.keys(m.bindings)[0]!, tag = m.bindings[scope]!;
    const write = (content = 'latest', id = 'a') => t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: 'deck_eval_' + run + '_' + id.repeat(32), content }) });
    return { m, t, write, tag, clock, gate: new ProcessingGate(t, p, clock) };
};
test('index completion alone is not memory readiness; censored documents never enter fast memory quantiles', async () => {
    const f = fixture(b => ({ ...b, system: { ...b.system, dreamingStatus: 'dreaming' } })); await f.write();
    const r = await f.gate.waitForAll();
    expect(r.validity).toBe('invalid'); expect(r.latency.timedOut).toBe(1);
    expect(r.latency.indexingFromAcceptance.observed).toBe(1); expect(r.latency.memoryFromAcceptance.observed).toBe(0);
    expect(r.documents[0]!.observations).toHaveLength(5); expect(f.clock.now()).toBe(1100);
});
test('all documents must finish; failure aborts without sleeping or polling unrelated pending peers', async () => {
    const f = fixture(b => ({ ...b, system: { ...b.system, status: 'failed' } })); await f.write(); await f.write('other', 'b');
    const r = await f.gate.waitForAll(); expect(r.validity).toBe('invalid'); expect(f.clock.now()).toBe(1000);
    expect(f.t.events.filter(e => e.method === 'GET')).toHaveLength(1);
});
for (const [name, mutate] of Object.entries({ unknown: (b: any) => ({ ...b, system: { ...b.system, status: 'unknown' } }), missingDreaming: (b: any) => ({ ...b, system: { status: 'done' } }), missingId: (b: any) => ({ ...b, id: undefined }), revision: (b: any) => ({ ...b, content: 'older revision' }), badTimestamp: (b: any) => ({ ...b, system: { ...b.system, updatedAt: 'yesterday' } }) })) {
    test('invalid status correspondence: ' + name, async () => { const f = fixture(mutate); await f.write(); const r = await f.gate.waitForAll(); expect(r.validity).toBe('invalid'); expect(r.completed).toBe(0); });
}
test('each accepted revision is recorded; later capture resets readiness and supersedes the old witness', async () => {
    const f = fixture(); await f.write('old'); expect((await f.gate.sample()).validity).toBe('valid');
    await f.clock.sleep(10); await f.write('new'); f.gate.refresh(); expect(f.gate.snapshot().validity).toBe('invalid');
    const r = await f.gate.waitForAll(); expect(r.validity).toBe('valid'); expect(r.writesAccountedFor).toBe(2); expect(r.supersededRevisions).toHaveLength(1);
});
test('unacknowledged writes invalidate without guessed status IDs', async () => {
    const f = fixture(); await f.write(); f.t.events[0]!.documentId = undefined;
    const r = await f.gate.waitForAll(); expect(r.invalidWrites).toHaveLength(1); expect(f.t.used).toBe(1);
});
test('a shared deadline bounds all documents rather than restarting for each', async () => {
    const f = fixture(b => ({ ...b, system: { ...b.system, status: 'queued' } })); await f.write(); await f.write('other', 'b');
    const r = await f.gate.waitForAll(1040); expect(f.clock.now()).toBe(1040); expect(r.latency.timedOut).toBe(2); expect(r.latency.memoryFromWriteStart.observed).toBe(2); expect(r.latency.indexingFromWriteStart.observed).toBe(0); expect(r.latency.bothStatesFromAcceptance.observed).toBe(0);
});
for (const stage of ['headers', 'body']) test('bounded wire timeout includes ' + stage + ' and retains the uncertain charge', async () => {
    const f = fixture(), start = performance.now();
    const t = new NamespaceTransport({ run: f.m.run, bindings: f.m.bindings, budget: 10, requestTimeoutMs: 20, wire: async () => stage === 'headers' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} })) });
    await expect(t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(f.m.bindings)[0], q: 'synthetic' }) })).rejects.toThrow('egress_failed');
    expect(performance.now() - start).toBeLessThan(1000); expect(t.used).toBe(1); expect(t.events[0]!.error).toBe('egress_failed');
}, 2000);
test('scoped status reads deny foreign IDs/tags, alternate encoding, queries, lists and bodies before egress', async () => {
    const f = fixture(); const id = (await (await f.write()).json()).id, before = f.t.used;
    for (const path of [`/ns/${f.tag}/document/foreign`, `/ns/${Object.values(f.m.bindings)[1]}/document/${id}`, `/ns/deck_eval_foreign_r_1_a/document/${id}`, `/ns/${f.tag}/document/%64${id.slice(1)}`, `/ns/${f.tag}/document/%252f`, `/ns/${f.tag}/document/${id}?x=1`, `/ns/${f.tag}/list/documents`]) await expect(f.t.fetch('https://api.supermemory.ai' + path)).rejects.toThrow();
    await expect(f.t.fetch(`https://api.supermemory.ai/ns/${f.tag}/document/${id}`, { body: '{"q":"no"}' })).rejects.toThrow();
    expect(f.t.used).toBe(before);
});
test('synchronous abort during wire invocation cannot evade the bounded wait', async () => {
    const f = fixture(), abort = new AbortController();
    const t = new NamespaceTransport({ run: f.m.run, bindings: f.m.bindings, budget: 1, requestTimeoutMs: 20, wire: () => { abort.abort(); return new Promise<Response>(() => {}); } });
    const outcome = t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', signal: abort.signal, body: JSON.stringify({ containerTag: Object.keys(f.m.bindings)[0] }) }).then(() => 'unexpected_success', () => 'bounded');
    expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('hung'), 100))])).toBe('bounded');
    expect(t.used).toBe(1);
});
import { parseProcessingArgs } from './processing';
test('timing flags reject missing/duplicate/equals/malformed values instead of silently using defaults', () => {
    for (const args of [['--poll-interval-ms'], ['--poll-interval-ms=300000'], ['--poll-interval-ms', '300000', '--poll-interval-ms', '120000'], ['--next-turn-delay-ms', '-1'], ['--request-timeout-ms', 'NaN']]) expect(() => parseProcessingArgs(args)).toThrow();
    expect(parseProcessingArgs(['--poll-interval-ms', '300000', '--next-turn-delay-ms', '0'])).toEqual({ pollIntervalMs: 300000, nextTurnDelayMs: 0 });
});
test('status polling shares the existing request ceiling and never renews it', async () => {
    const f = fixture(); await f.write();
    // Exhaust the original allowance, then require the status poll to fail before a send.
    for (let n = f.t.used; n < 100; n++) await f.t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(f.m.bindings)[0] }) });
    const r = await f.gate.waitForAll(); expect(r.validity).toBe('invalid'); expect(f.t.used).toBe(100); expect(r.documents[0]!.reason).toBe('budget_stop');
});
test('deadline is rechecked after durable reservation immediately before wire dispatch', async () => {
    const f = fixture(); let now = 0, sends = 0;
    // Advance after the reservation receipt, independent of constructor clock reads.
    const t = new NamespaceTransport({ run: f.m.run, bindings: f.m.bindings, budget: 1, now: () => now, changed: () => { now = 1001; }, deadlineAtMs: 1000, wire: async () => { sends++; return Response.json({}); } });
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(f.m.bindings)[0] }) })).rejects.toThrow();
    expect(sends).toBe(0); expect(t.used).toBe(1); // The uncertain reservation is not refunded.
});
test('an expired remaining wait cannot become a one-millisecond permission to dispatch', async () => {
    const f = fixture(); let calls = 0, sends = 0;
    const t = new NamespaceTransport({ run: f.m.run, bindings: f.m.bindings, budget: 1, now: () => [0, 999, 1001][Math.min(calls++, 2)]!, deadlineAtMs: 1000, wire: async () => { sends++; return Response.json({}); } });
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: Object.keys(f.m.bindings)[0] }) })).rejects.toThrow();
    expect(sends).toBe(0); expect(t.used).toBe(1);
});
