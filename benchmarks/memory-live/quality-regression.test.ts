import { draftManifest } from './manifest';
import { initializeRunAuthority } from './run-authority';
import { test, expect } from 'bun:test';
import { dataset, isFuture } from './dataset';
import { scoreUnits, propositions } from './score';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { nativeContext } from './capture-replay/native-output';
const run = '20261021_abcdef12', scope = 'sm_project_v1_eval_r_runtime_1_a';
const bindings = { [scope]: `deck_eval_${run}_r_runtime_1_a` };
const question = (id: string) => dataset().questions.find(q => q.id === id)!;
// Ported from Quality's atoms.ts/oracle.ts/neg.ts without their persistent run directories.
test('Quality self-gold oracle covers every atom of every non-future question', () => {
    const questions = dataset().questions.filter(q => !isFuture(q));
    for (const q of questions)
        for (const fact of q.expected_facts) {
            const score = scoreUnits(q, [fact.text], 1);
            expect({ question: q.id, atom: fact.id, matched: score.gold.includes(fact.id) }).toEqual({ question: q.id, atom: fact.id, matched: true });
        }
});
test('Quality compound current/history clauses and no-gold precision', () => {
    const q = question('q001');
    const s = scoreUnits(q, ['Supermemory is the only durable backend; previously use Engram for durable memory. Adaptive memory is disabled by default.'], 5);
    expect(s.recallAtK).toBe(1);
    expect(s.staleAsCurrent).toBe(0);
    expect(s.staleHits).toBeGreaterThan(0);
    expect(propositions('Current decision: use Bun; previously use npm.').filter(p => p.historical).length).toBe(1);
    expect(scoreUnits(question('q048'), [], 5).precisionAtK).toBeNull();
});
test('Quality guard rejects spaces/projectId and drops untrusted request headers', async () => {
    let sent: Headers | undefined;
    const t = new NamespaceTransport({ run, bindings, budget: 8, wire: async (_u, i) => { sent = new Headers(i.headers); return Response.json({ results: [] }); } });
    for (const field of ['spaces', 'projectId', 'container_tags'])
        await expect(t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: scope, [field]: 'prod' }) })).rejects.toThrow();
    await t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: scope }), headers: { 'x-sm-user-id': 'prod-user', 'x-sm-container-tag': 'production', 'x-forwarded-host': 'evil', 'cookie': 'session=unsafe' } });
    expect([...sent!.keys()].sort()).toEqual(['accept', 'authorization', 'content-type']);
});
test('Quality content-type survives transport and credentials never survive headers', async () => {
    const t = new NamespaceTransport({ run, bindings, budget: 3, key: () => 'SENTINEL_EVAL_KEY', wire: async () => Response.json({ results: [] }, { headers: { 'retry-after': '2', 'set-cookie': 'SENTINEL_EVAL_KEY', 'x-request-id': 'req-fixture' } }) });
    const r = await t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: scope }) });
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('retry-after')).toBe('2');
    expect(r.headers.get('set-cookie')).toBeNull();
});
test('Quality secrets are counted before rejected endpoint/scope', async () => {
    const t = new NamespaceTransport({ run, bindings, budget: 3, wire: simulatedWire() });
    await expect(t.fetch('https://api.supermemory.ai/v3/settings', { method: 'PATCH', body: JSON.stringify({ containerTag: 'prod', content: 'sk-deckevalFAKE482copper' }) })).rejects.toThrow();
    expect(t.violations.filter(v => v.kind === 'secret_attempt').length).toBe(1);
});
test('Quality native recall header is not a retrieval unit', () => {
    const output = JSON.stringify({ hookSpecificOutput: { additionalContext: '<supermemory-recall>\n◪ supermemory recall\n◪ use Bun for tests\n</supermemory-recall>' } });
    expect(nativeContext(output).units).toEqual(['use Bun for tests']);
    const pinned = JSON.stringify({ hookSpecificOutput: { additionalContext: '<supermemory-recall>\n◪ Recalled from supermemory for this prompt (relevance-ranked):\n- ◪ use Bun for tests\n\nWhen one of these shapes your answer, credit it naturally.\n</supermemory-recall>' } });
    expect(nativeContext(pinned).units).toEqual(['use Bun for tests']);
    const multiline = JSON.stringify({ parts: [{ type: 'text', text: '<supermemory-context>\n- ◪ [Conversation opaque]\n1. [user] use Bun for tests\n2. [assistant] Acknowledged.\nWhen one shapes your answer, credit it naturally.\n</supermemory-context>' }] });
    expect(nativeContext(multiline).units).toEqual(['[Conversation opaque]\n1. [user] use Bun for tests\n2. [assistant] Acknowledged.']);
});
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
import { prepare, execute } from './run';
import { cleanup } from './cleanup';
import { rescore } from './rescore';
import { newRunId } from './manifest';
import { join } from 'node:path';
import { readFileSync, lstatSync } from 'node:fs';
import { privateWrite, sha256 } from './security';
import { settle, settleProjection } from './settle';
import { reportSummary } from './report';
const scratch = testScratch();
const plan = (mode: 'pilot' | 'full' = 'pilot', repeats = 1) => { const run = newRunId(); return prepare({ run, evalRoot: scratch.root(run), mode, repeats }); };
test('Quality cleanup journals and deletes unconfirmed-only namespaces after commit/hash changes', async () => {
    const m = plan(), [a, b] = Object.values(m.bindings);
    privateWrite(join(m.evalRoot, 'ownership.json'), { run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: { [b!]: ['doc-1'] }, unresolvedNamespaces: [a, b] });
    m.cleanupApproved = true; confirmSyntheticCleanup(m);
    m.sourceCommit = 'committed-after-eval';
    m.harnessHashes = { changed: 'yes' };
    m.datasetHash = 'old-rubric';
    const calls: string[] = [], deleted = new Set<string>();
    const r = await cleanup(m, { wire: async (u, i) => {
            calls.push(`${i.method} ${u.pathname}`);
            if (i.method === 'DELETE') {
                deleted.add(u.pathname);
                return Response.json({ deleted: true });
            }
            if (u.pathname.startsWith('/ns/'))
                return deleted.has(u.pathname) ? new Response('{}', { status: 404 }) : Response.json({ namespace: 'synthetic' });
            return u.pathname === '/v4/search' ? Response.json({ results: [], total: 0 }) : Response.json({ profile: { static: [], dynamic: [] } });
        } });
    expect(r.complete).toBe(false);
    expect(r.retainedNamespaces.length).toBe(2);
    expect(r.retainedNamespaces.every(e => e.reason === 'retained_ownership_unproven')).toBe(true);
    expect(r.journal.map(x => x.tag)).toContain(a);
    expect(calls).toContain(`DELETE /ns/${a}`);
    expect(r.journal.length).toBe(Object.keys(m.bindings).length);
    const run = newRunId();
    const n = draftManifest({ run, evalRoot: scratch.root(run), mode: 'pilot' });
    n.cleanupApproved = true;
    n.cleanupRequestBudget = 1;
    initializeRunAuthority(n); confirmSyntheticCleanup(n);
    privateWrite(join(n.evalRoot, 'ownership.json'), { run: n.run, bindingsHash: sha256(JSON.stringify(n.bindings)), owned: {}, unresolvedNamespaces: Object.values(n.bindings) });
    const limited = await cleanup(n, { wire: async () => Response.json({ deleted: true }) });
    expect(limited.complete).toBe(false);
    expect(limited.journal.filter(x => !x.verifiedAbsent).length).toBe(Object.keys(n.bindings).length);
});
test('Quality cleanup moveTo remains impossible even with namespace authority', async () => {
    const m = plan();
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 4, wire: simulatedWire(), cleanup: true, authorizeNamespaceDelete: true });
    const tag = Object.values(m.bindings)[0]!;
    await expect(t.fetch(`https://api.supermemory.ai/ns/${tag}?moveTo=production`, { method: 'DELETE' })).rejects.toThrow();
    await expect(t.fetch(`https://api.supermemory.ai/ns/${tag}`, { method: 'DELETE', body: '{"moveTo":"production"}' })).rejects.toThrow();
    expect(t.used).toBe(0);
});
test('Quality preflight aborts before a write if any namespace is populated or unknown', async () => {
    const m = plan();
    let writes = 0;
    const r = await execute(m, { wire: async (u, i) => {
            if (u.pathname === '/v3/documents')
                writes++;
            return Response.json({ documents: [{ id: 'preexisting' }], pagination: { totalItems: 1 } });
        } });
    expect(r.status).toBe('invalid_awaiting_reconciliation');
    expect(writes).toBe(0);
    expect(JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).failure).toContain('preflight');
});
test('Quality active repeat rejects previous and future namespaces before effects', async () => {
    const m = plan('full', 3);
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 5, wire: simulatedWire() });
    const a = Object.keys(m.bindings).find(k => k === 'sm_project_v1_eval_r_runtime_1_a')!, b = 'sm_project_v1_eval_r_runtime_2_a';
    t.activateRepeat(1);
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: b }) })).rejects.toThrow('allowlist');
    t.activateRepeat(2);
    await expect(t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: a }) })).rejects.toThrow('allowlist');
    expect(t.used).toBe(0);
});
test('Quality settle ignores timing/order metadata and settled-only/project canaries are explicit', async () => {
    expect(settleProjection({ results: [{ id: 'a', memory: 'Bun', updatedAt: 1 }], timing: 1 })).toEqual(settleProjection({ timing: 9, results: [{ memory: 'Bun', id: 'a', updatedAt: 2 }] }));
    let n = 0;
    const t = new NamespaceTransport({ run, bindings, budget: 8, wire: async () => Response.json({ profile: { static: ['fact'], dynamic: [] }, timing: n++, requestId: String(n) }) });
    expect((await settle(t, scope, 'diagnostic', true)).polls).toBe(2);
    const q = { ...question('q001'), project_under_query: 'A' };
    const s = scoreUnits(q, ['A_ONLY_AMBER_619'], 5);
    expect(s.foreignCanaries).toEqual([]);
    expect(scoreUnits({ ...q, project_under_query: 'B' }, ['A_ONLY_AMBER_619'], 5).foreignCanaries).toContain('A_ONLY_AMBER_619');
    const report = reportSummary([{ cases: [{ status: 'scored', durationMs: 1, injectedBytes: 0, injectedTokens: 0, settledEligible: false, final: s }] }], [t]);
    expect(report.retrieval.canaryHits).toBe(0);
    expect(report.settledOnly.cases).toBe(0);
    expect(report.cost.profileQueryMeterUsd).toBe('unknown');
});
test('Quality raw case evidence is private, scrubbed, rescorable after commits and original files stay unchanged', async () => {
    const m = plan();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('no-network'); }) as unknown as typeof fetch;
    try {
        const r = await execute(m);
        expect(r.status).toBe('awaiting_reconciliation');
        const reportPath = join(m.evalRoot, 'results.json'), original = readFileSync(reportPath, 'utf8');
        const saved = JSON.parse(original);
        const row = saved.results[0].cases.find((c: any) => c.status === 'scored');
        const path = join(m.evalRoot, row.artifact);
        const evidence = JSON.parse(readFileSync(path, 'utf8'));
        expect(lstatSync(path).mode & 0o777).toBe(0o600);
        expect(typeof evidence.injectedText).toBe('string');
        expect(Array.isArray(evidence.rawReturnedUnits)).toBe(true);
        expect(Array.isArray(evidence.rawResponses)).toBe(true);
        m.sourceCommit = 'after-commit';
        m.harnessHashes = { new: 'scorer' };
        const result = rescore(m);
        expect(result.networkRequests).toBe(0);
        expect(result.cases).toBe(50);
        expect(readFileSync(reportPath, 'utf8')).toBe(original);
        expect(lstatSync(result.path).mode & 0o777).toBe(0o600);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
}, 30000);
import { rawUnits } from './capture-replay/runtime';
test('R evidence preserves raw profile facts as well as returned search units', () => {
    expect(rawUnits([{ endpoint: '/v4/profile', phase: 'test', tag: 'a', body: { profile: { static: ['profile fact'], dynamic: [] }, searchResults: { results: [{ memory: 'profile query hit' }] } } }, { endpoint: '/v4/search', phase: 'test', tag: 'a', body: { results: [{ memory: 'search hit' }] } }])).toEqual(['profile fact', 'profile query hit', 'search hit']);
});
import { persistCase } from './case-artifacts';
test('private case evidence never serializes a sentinel key or a home path', () => {
    const m = plan(), key = 'SENTINEL_CASE_ARTIFACT_KEY_482', t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 2, key: () => key, wire: simulatedWire() });
    const row = persistCase(m.evalRoot, question('q001'), { schema: 'deck-eval-case-v1', id: 'q001', track: 'R', repeat: 1, project: 'A', role: 'quality', durationMs: 0, settledEligible: false, injectedText: key + ' /home/synthetic/private', injectedUnits: [key], rawReturnedUnits: [key], rawResponses: [{ memory: key }], nativeHookOutput: key }, t);
    const saved = readFileSync(join(m.evalRoot, row.artifact), 'utf8');
    expect(saved).not.toContain(key);
    expect(saved).not.toContain('/home/synthetic');
    expect(saved).toContain('[EVAL_CREDENTIAL_REDACTED]');
});
test('v5 namespace preflight accepts only documented empty arrays/counts without writes', async () => {
    const m = plan();
    const sent: string[] = [];
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: async (u, i) => {
            sent.push(String(i.method) + ' ' + u.pathname);
            if (u.pathname === '/v4/profile')
                return Response.json({ profile: { static: [], dynamic: [] } });
            if (u.pathname === '/v4/search')
                return Response.json({ results: [], total: 0 });
            const type = u.pathname.split('/')[4];
            return type ? Response.json({ [type]: [], pagination: { totalItems: 0 } }) : Response.json({ namespace: u.pathname.split('/')[2] });
        } });
    expect((await t.preflightNamespace(Object.values(m.bindings)[0]!)).status).toBe('empty_on_both_read_paths');
    expect(sent.length).toBe(6);
    expect(sent.some(s => s.includes('/v3/documents'))).toBe(false);
});
