import { test, expect } from 'bun:test';
import { NamespaceTransport, BudgetExceeded, simulatedWire } from './namespace-transport';
import { scoreUnits } from './score';
const run = '20261021_abcdef';
const bindings = { sm_project_v1_eval_a: `deck_eval_${run}_r_runtime_a` };
function harness(budget = 20, wire = simulatedWire()) { return new NamespaceTransport({ run, bindings, budget, wire }); }
test('guard rejects unknown, default, production, plural/nested selectors and list-all before effects', async () => {
    let calls = 0;
    const t = harness(20, async () => { calls++; return Response.json({}); });
    for (const body of [{ containerTag: 'default' }, { containerTag: 'sm_project_v1_real_repo' }, { containerTags: ['sm_project_v1_eval_a', 'sm_project_v1_eval_a'] }, { containerTag: 'sm_project_v1_eval_a', metadata: { containerTags: ['prod'] } }, { containerTag: `deck_eval_${run}_other` }]) {
        await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow();
    }
    await expect(t.fetch('https://api.supermemory.ai/v3/documents/list', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(calls).toBe(0);
});
test('maps only exact scope, preserves serializer fields and never serializes sentinel credential', async () => {
    const sentinel = 'SENTINEL_DO_NOT_DISCLOSE_482';
    let seen: any;
    const t = new NamespaceTransport({ run, bindings, budget: 3, key: () => sentinel, wire: async (_url, init) => { seen = init; return Response.json({ echo: sentinel }); } });
    const r = await t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_a', q: 'hello', rerank: false }) });
    expect(JSON.parse(seen.body).containerTag).toBe(bindings.sm_project_v1_eval_a);
    expect(seen.redirect).toBe('error');
    expect(await r.text()).not.toContain(sentinel);
    expect(JSON.stringify(t)).not.toContain(sentinel);
});
test('transport errors and redirects do not disclose sentinel', async () => {
    const sentinel = 'SENTINEL_DO_NOT_DISCLOSE_482';
    const t = new NamespaceTransport({ run, bindings, budget: 3, key: () => sentinel, wire: async () => { throw new Error(sentinel); } });
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_a' }) })).rejects.toThrow('egress_failed');
    const redirect = harness(2, async () => new Response('', { status: 302, headers: { location: 'https://example.invalid' } }));
    await expect(redirect.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_a' }) })).rejects.toThrow('redirect');
});
test('hard budget aborts before an extra effect', async () => {
    const t = harness(1);
    const init = { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_a' }) };
    await t.fetch('https://api.supermemory.ai/v4/profile', init);
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', init)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(t.events.length).toBe(1);
    expect(t.aborted).toBe(true);
});
const atom = (id: string, pattern: string, text = 'Use Bun for tests.') => ({ id, text, match: { all_of_regex: [pattern], flags: 'i' } });
const question: any = { id: 'fixture', role: 'lead', category: 'superseded_decisions', expected_facts: [atom('bun', 'use bun')], forbidden_facts: [atom('npm', 'use npm', 'Use npm for tests.')] };
test('scorer handles missing slots, negation, temporal rejection, stale-as-current, duplicates and boundaries', () => {
    expect(scoreUnits(question, ['Use Bun for tests.'], 5).precisionAtK).toBe(0.2);
    expect(scoreUnits(question, ['Do not use Bun for tests.'], 5).recallAtK).toBe(0);
    expect(scoreUnits(question, ['Previously: use Bun for tests.'], 5).recallAtK).toBe(0);
    expect(scoreUnits(question, ['Use Bun for tests. Use npm for tests.'], 5).supersessionCorrect).toBe(false);
    expect(scoreUnits(question, ['Use Bun for tests.', 'Use Bun for tests.'], 5).precisionAtK).toBe(0.2);
    const q = { ...question, expected_facts: [{ ...atom('both', 'use bun'), match: { all_of_regex: ['use bun', 'fast'], flags: 'i' } }] };
    expect(scoreUnits(q, ['Use Bun. Something else is fast.'], 5).recallAtK).toBe(0);
});
test('scorer detects exact fake secrets and canaries even when negated', () => {
    const s = scoreUnits({ ...question, expected_facts: [] }, ['Do not expose sk-deckevalFAKE482copper or A_ONLY_AMBER_619.'], 3);
    expect(s.secrets).toBe(1);
    expect(s.canaries).toContain('A_ONLY_AMBER_619');
    expect(s.recallAtK).toBeNull();
});
test('mapping is bijective and rejects unrelated eval runs, unscoped reads, origin changes and cleanup without proof', async () => {
    expect(() => new NamespaceTransport({ run, bindings: { sm_project_v1_eval_a: `deck_eval_${run}_r_a`, sm_project_v1_eval_b: `deck_eval_${run}_r_a` }, budget: 3, wire: simulatedWire() })).toThrow('bijective');
    const t = harness();
    for (const [url, body] of [['https://api.supermemory.ai/v4/profile', {}], ['https://api.supermemory.ai/v4/profile', { containerTag: 'deck_eval_20261021_123abc_r_a' }], ['https://example.invalid/v4/profile', { containerTag: 'sm_project_v1_eval_a' }], ['http://api.supermemory.ai/v4/profile', { containerTag: 'sm_project_v1_eval_a' }], ['https://api.supermemory.ai/v4/profile?containerTag=default', { containerTag: 'sm_project_v1_eval_a' }]] as const)
        await expect(t.fetch(url, { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow();
    const cleanup = new NamespaceTransport({ run, bindings, budget: 3, wire: simulatedWire(), cleanup: true });
    await expect(cleanup.fetch(`https://api.supermemory.ai/ns/${bindings.sm_project_v1_eval_a}`, { method: 'DELETE' })).rejects.toThrow('cleanup_requires_reconciliation_authorization');
    expect(t.used).toBe(0);
});
test('OpenCode singleton originalContainerTags is mapped only when identical to the one allowed request scope', async () => {
    let mapped: any;
    const t = harness(10, async (_u, i) => { mapped = JSON.parse(String(i.body)); return Response.json({ id: 'receipt' }); });
    const body = { containerTags: ['sm_project_v1_eval_a'], content: 'safe synthetic fixture', customId: `deck_eval_${run}_${'a'.repeat(32)}`, metadata: { originalContainerTags: ['sm_project_v1_eval_a'] } };
    await t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify(body) });
    expect(mapped.metadata.originalContainerTags).toEqual([bindings.sm_project_v1_eval_a]);
    for (const tags of [['production'], ['sm_project_v1_eval_a', 'sm_project_v1_eval_a']])
        await expect(t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ ...body, metadata: { originalContainerTags: tags } }) })).rejects.toThrow();
    expect(t.used).toBe(1);
});
test('foreign canaries are detected in complete raw profiles before truncation', async () => {
    const t = new NamespaceTransport({ run, bindings: { sm_project_v1_eval_b: `deck_eval_${run}_r_runtime_b` }, budget: 2, wire: async () => Response.json({ profile: { static: ['Do not expose A_ONLY_AMBER_619.'], dynamic: [] } }) });
    await t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_b' }) });
    expect(t.violations.some(v => v.kind === 'cross_project_canary_return')).toBe(true);
});
test('abort signals propagate to the sole cloud effect without exposing errors', async () => {
    const controller = new AbortController();
    let aborted = false;
    const t = harness(2, async (_u, i) => new Promise((_resolve, reject) => { i.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('SENTINEL_DO_NOT_DISCLOSE_482')); }, { once: true }); }));
    const pending = t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: 'sm_project_v1_eval_a' }), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('egress_failed');
    expect(aborted).toBe(true);
    expect(t.used).toBe(1);
});
test('native hook JSON decodes into attributable injection units before scoring', async () => {
    const { nativeContext } = await import('./capture-replay/native-output');
    const context = nativeContext(JSON.stringify({ hookSpecificOutput: { additionalContext: '<supermemory-recall>\n- ◪ Use Bun for tests.\n</supermemory-recall>' } }));
    expect(context.units).toEqual(['Use Bun for tests.']);
    expect(scoreUnits(question, context.units, 5).recallAtK).toBe(1);
});
test('repeat statistics cluster by question and single-pilot intervals remain unknown', async () => {
    const { baselineStatistics } = await import('./statistics');
    const suite = { track: 'R', cases: [{ id: 'one', status: 'scored', final: { precisionAtK: 1, recallAtK: 1 } }] };
    expect(baselineStatistics([suite])[0]!.precision95).toBeNull();
    const statistics = baselineStatistics([suite, { ...suite, repeat: 2 }])[0]!;
    expect(statistics.precision.mean).toBe(1);
    expect(statistics.precision.sd).toBe(0);
    expect(statistics.precision95!.lower).toBe(1);
    expect(statistics.precision95!.upper).toBe(1);
});
test('cost estimates use frozen text, SuperRAG, query and operation meters', async () => {
    const { estimateCost } = await import('./score');
    const events = [{ endpoint: '/v3/documents', inputTokenEstimate: 1000, status: 200, operationEstimate: 1 }, { endpoint: '/v3/documents', inputTokenEstimate: 0, superRagTokenEstimate: 2000, status: 200 }, { endpoint: '/v4/search', inputTokenEstimate: 0, status: 200, operationEstimate: 1 }, { endpoint: '/v4/search', inputTokenEstimate: 0, status: 500 }, { endpoint: '/v4/profile', inputTokenEstimate: 0, status: 200 }];
    expect(estimateCost(events).usd).toBeCloseTo(.00721, 8);
});
test('native raw units include complete profile facts and query hits before plugin bounds', async () => {
    const { nativeRawUnits } = await import('./capture-replay/native-output');
    const units = nativeRawUnits([{ endpoint: '/v4/profile', body: { profile: { static: ['Use Bun for tests.'], dynamic: ['Old: use npm for tests.'] }, searchResults: { results: [{ memory: 'Use Bun for tests.' }] } } }]);
    expect(units).toEqual(['Use Bun for tests.', 'Old: use npm for tests.', 'Use Bun for tests.']);
    expect(scoreUnits(question, units, 5).precisionAtK).toBe(.2);
    expect(scoreUnits(question, units, 5).staleAsCurrent).toBe(0);
});
