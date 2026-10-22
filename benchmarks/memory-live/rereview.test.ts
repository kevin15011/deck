import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { prepare, newRunId } from './manifest';
import { execute } from './run';
import { cleanup } from './cleanup';
import { dataset } from './dataset';
import { scoreUnits } from './score';
import { privateWrite, sha256 } from './security';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
const scratch = testScratch();
const plan = () => { const run = newRunId(); return prepare({ run, evalRoot: scratch.root(run), mode: 'pilot' }); };
const empty = (u: URL) => u.pathname === '/v4/search' ? Response.json({ results: [], total: 0 }) : Response.json({ profile: { static: [], dynamic: [] }, searchResults: { results: [], total: 0 } });
const written = (m: ReturnType<typeof prepare>) => { const tag = Object.values(m.bindings)[0]!; m.cleanupApproved = true; confirmSyntheticCleanup(m); privateWrite(join(m.evalRoot, 'ownership.json'), { run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: { [tag]: ['owned'] }, attemptedNamespaces: [tag] }); return tag; };
test('re-review preflight rejects v5 404 with populated, denied, or malformed legacy reads', async () => {
    for (const mode of ['populated', 'denied', 'malformed']) {
        const m = plan(), t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: async (u) => u.pathname.startsWith('/ns/') ? new Response('{}', { status: 404 }) : mode === 'denied' ? new Response('{}', { status: 403 }) : mode === 'malformed' ? Response.json({}) : Response.json({ profile: { static: ['legacy ghost'], dynamic: [] }, results: [{ memory: 'legacy ghost' }], total: 1 }) });
        await expect(t.preflightNamespace(Object.values(m.bindings)[0]!)).rejects.toThrow('legacy');
        expect(t.events.some(e => e.endpoint === '/v3/documents')).toBe(false);
    }
});
test('re-review cleanup refuses written v5-invisible namespaces without DELETE', async () => {
    const m = plan(), tag = written(m), calls: string[] = [];
    const r = await cleanup(m, { wire: async (u, i) => { calls.push(`${i.method} ${u.pathname}`); return u.pathname.startsWith('/ns/') ? new Response('{}', { status: 404 }) : empty(u); } });
    expect(r.complete).toBe(false);
    expect(r.journal.find(e => e.tag === tag).status).toBe('retained_visibility_unknown');
    expect(calls).not.toContain(`DELETE /ns/${tag}`);
});
test('re-review cleanup needs v5 visibility before DELETE and empty legacy profile AND search afterwards', async () => {
    for (const ghost of [true, false]) {
        const m = plan(), tag = written(m), deleted = new Set<string>(), calls: string[] = [];
        const r = await cleanup(m, { wire: async (u, i) => {
                calls.push(`${i.method} ${u.pathname}`);
                const ns = u.pathname.split('/')[2]!;
                if (i.method === 'DELETE') {
                    deleted.add(ns);
                    return Response.json({ deleted: true });
                }
                if (u.pathname.startsWith('/ns/'))
                    return deleted.has(ns) ? new Response('{}', { status: 404 }) : Response.json({ namespace: ns });
                if (ghost && u.pathname === '/v4/search')
                    return Response.json({ results: [{ memory: 'legacy ghost' }], total: 1 });
                return empty(u);
            } });
        expect(calls.indexOf(`GET /ns/${tag}`)).toBeLessThan(calls.indexOf(`DELETE /ns/${tag}`));
        expect(calls).toContain('POST /v4/profile');
        expect(calls).toContain('POST /v4/search');
        expect(r.complete).toBe(false);
        expect(r.retainedNamespaces.length).toBe(ghost ? 4 : 3);
        expect(r.journal.find(e => e.tag === tag).status).toBe(ghost ? 'retained_visibility_unknown' : 'verified_absent');
    }
});
test('re-review pilot aborts after first write if v5 cannot see it and persists visibility receipt', async () => {
    const m = plan(), wire = simulatedWire();
    let writes = 0;
    const r = await execute(m, { wire: async (u, i) => {
            if (u.pathname === '/v3/documents')
                writes++;
            return u.pathname.startsWith('/ns/') ? new Response('{}', { status: 404 }) : wire(u, i);
        } });
    expect(r.status).toBe('invalid_awaiting_reconciliation');
    expect(writes).toBe(1);
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(saved.failure).toBe('namespace_visibility_unknown');
    expect(saved.namespaceVisibility[0].status).toBe('retained_visibility_unknown');
});
test('re-review eval key bytes in bodies or caller headers fail before effects and never enter receipts', async () => {
    const m = plan(), key = 'SENTINEL_REREVIEW_KEY_531', scope = Object.keys(m.bindings)[0]!;
    let sent = 0;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, key: () => key, wire: async () => { sent++; return Response.json({}); } });
    for (const init of [
        { body: JSON.stringify({ containerTag: scope, q: key }) },
        { body: '{"containerTag":"' + scope + '","q":"' + key.replace('S', '\\u0053') + '"}' },
        { body: JSON.stringify({ containerTag: 'production', q: 'safe' }), headers: { 'x-leaked-key': key } },
        { body: '{}', headers: { authorization: 'Bearer ' + key } },
        { body: JSON.stringify({ containerTag: scope }), headers: { [key]: 'safe' } },
    ] as RequestInit[])
        await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', ...init })).rejects.toThrow('credential');
    expect(sent).toBe(0);
    expect(t.violations.filter(v => v.kind === 'credential_attempt').length).toBe(5);
    expect(JSON.stringify(t)).not.toContain(key);
});
test('re-review rejected or past stale ideas are not current assertions; q008 rejection remains gold', () => {
    const q = dataset().questions.find(q => q.id === 'q001')!;
    for (const unit of ['Rejected: use Engram for durable memory.', 'The team rejected the idea to use Engram for durable memory.', 'We used to use Engram for durable memory but now Supermemory is the only durable backend.']) {
        const s = scoreUnits(q, [unit], 5);
        expect(s.staleAsCurrent).toBe(0);
        expect(s.staleHits).toBe(1);
    }
    const compound = scoreUnits(q, ['We used to use Engram for durable memory but now Supermemory is the only durable backend. Adaptive memory defaults to disabled.'], 5);
    expect(compound.recallAtK).toBe(1);
    const q8 = dataset().questions.find(q => q.id === 'q008')!;
    expect(scoreUnits(q8, q8.expected_facts.map(f => f.text), 5).recallAtK).toBe(1);
    expect(scoreUnits(q, ['The team rejected the idea to use Engram, but use Engram for durable memory now.'], 5).staleAsCurrent).toBe(1);
});
test('re-review live requires an explicit truthful account-sharing declaration before credential access', async () => {
    const m = plan();
    expect(Object.hasOwn(m, 'accountSharedWithProduction')).toBe(false);
    expect(Object.hasOwn(m, 'dedicatedEvalAccount')).toBe(false);
    m.liveApproved = true;
    await expect(execute(m, { live: true })).rejects.toThrow('explicit_account_shared_with_production');
});
test('re-review custom IDs are run-owned and filter values are selector-free strings', async () => {
    const m = plan(), scope = Object.keys(m.bindings)[0]!, t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: simulatedWire() });
    for (const customId of ['production-document', 'deck_conversation_0123456789abcdef', 'opencode:capture:' + 'a'.repeat(64), '11111111-1111-4111-8111-111111111111', `deck_eval_20200101_abcdef_${'a'.repeat(32)}`])
        await expect(t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, content: 'safe fixture', customId }) })).rejects.toThrow('custom_id');
    for (const value of [{ containerTag: 'production' }, ['personal'], 17, 'containerTag=production', 'scopes:prod', `deck_eval_${m.run}_r_runtime_1_a`])
        await expect(t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: scope, q: 'safe', filters: { AND: [{ key: 'sm_scope', value, filterType: 'metadata' }] } }) })).rejects.toThrow('filter');
    await t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: scope, q: 'safe', filters: { AND: [{ key: 'sm_scope', value: 'personal', filterType: 'metadata' }] } }) });
    expect(t.used).toBe(1);
});
test('re-review scorer calibration corpus is frozen as explicit assertions', () => {
    const fixtures = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/scorer-calibration.json'), 'utf8'));
    for (const fixture of fixtures.cases) {
        const q = dataset().questions.find(q => q.id === fixture.question)!;
        const score = scoreUnits(q, [fixture.text], 5);
        for (const field of ['staleAsCurrent', 'staleHits', 'recallAtK'])
            if (field in fixture)
                expect(score[field as keyof typeof score]).toBe(fixture[field]);
    }
});
test('re-review lost write acknowledgement still gets a visibility receipt and stops if v5 is invisible', async () => {
    const m = plan();
    let attempts = 0;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 5, verifyWriteVisibility: true, visibilityWait: async () => { }, wire: async (u) => {
            if (u.pathname === '/v3/documents') {
                attempts++;
                throw new Error('simulated_lost_ack');
            }
            return new Response('{}', { status: 404 });
        } });
    const scope = Object.keys(m.bindings)[0]!;
    await expect(t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: `deck_eval_${m.run}_${'a'.repeat(32)}`, content: 'safe fixture' }) })).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(t.namespaceVisibility[0]!.status).toBe('retained_visibility_unknown');
    expect(t.writeIntents.size).toBe(1);
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: scope }) })).rejects.toThrow('namespace_visibility_unknown');
});
test('third review first-write visibility retries at 2/4/8 seconds and stops at the first 200', async () => {
    for (const statuses of [[404, 200], [404, 503, 200]]) {
        const m = plan(), scope = Object.keys(m.bindings)[0]!, waits: number[] = [];
        let gets = 0;
        const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, verifyWriteVisibility: true, visibilityWait: async (ms) => { waits.push(ms); }, wire: async (u) => u.pathname === '/v3/documents' ? Response.json({ id: 'owned' }) : new Response('{}', { status: statuses[gets++]! }) });
        await t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: `deck_eval_${m.run}_${'a'.repeat(32)}`, content: 'safe synthetic fixture' }) });
        expect(gets).toBe(statuses.length);
        expect(t.used).toBe(1 + statuses.length);
        expect(waits).toEqual([2000, 4000, 8000].slice(0, statuses.length));
        expect(t.namespaceVisibility[0]!.status).toBe('visible_v5_200');
        expect(t.namespaceVisibility[0]!.attempts.map(a => a.v5Status)).toEqual(statuses);
        expect(t.visibilityUnknown).toBe(false);
    }
});
test('third review visibility retries are bounded, fail closed, and cannot exceed the request budget', async () => {
    for (const budget of [10, 2]) {
        const m = plan(), scope = Object.keys(m.bindings)[0]!, waits: number[] = [];
        let gets = 0;
        const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget, verifyWriteVisibility: true, visibilityWait: async (ms) => { waits.push(ms); }, wire: async (u) => { if (u.pathname === '/v3/documents')
                return Response.json({ id: 'owned' }); gets++; return new Response('{}', { status: 404 }); } });
        await expect(t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: `deck_eval_${m.run}_${'a'.repeat(32)}`, content: 'safe synthetic fixture' }) })).rejects.toThrow('namespace_visibility_unknown');
        const expected = budget === 2 ? 1 : 3;
        expect(gets).toBe(expected);
        expect(t.used).toBe(1 + expected);
        expect(waits).toEqual([2000, 4000, 8000].slice(0, expected));
        expect(t.namespaceVisibility[0]!.attempts.length).toBe(expected);
        expect(t.visibilityUnknown).toBe(true);
        expect(t.aborted).toBe(budget === 2);
        await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: scope }) })).rejects.toThrow('namespace_visibility_unknown');
        expect(gets).toBe(expected);
    }
});
