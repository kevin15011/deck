import { expect, test } from 'bun:test';
import { testScratch } from './test-support';
import { newRunId, draftManifest, validateManifest } from './manifest';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { CostLedger, COST_POLICY } from './cost-guard';
import { makeProject, runtimeCapture, recallHost, envelopeUnits, lifecycleControls } from './capture-replay/runtime';
import { runtimeSkipProbes } from './capture-replay/probes';
const scratch = testScratch();

// Protects real Pi composition, per-event admission, source rejection/retry and role recall.
// Oracle: public-source capture and allowed Apply Fast recall; not semantic importance.
test('current Pi public events retain exact owned IDs and useful recall with source negatives', async () => {
    const run = newRunId(), root = scratch.root(run), project = makeProject(root, 'r_runtime_1', 'CONTROL');
    const t = new NamespaceTransport({ run, bindings: { [project.scope]: `deck_eval_${run}_r_runtime_1_control` }, budget: 100, wire: simulatedWire() });
    expect((await runtimeCapture({ id: 'short-correction', project: 'CONTROL', session_id: 'one', role: 'user', source: 'trusted-user-prompt', content: 'Use zircon.' }, project.scope, t)).ok).toBe(true);
    const host = await recallHost(root, project.cwd, 'Which material?', 'apply-fast', t, 'recall');
    expect(envelopeUnits(host.advisoryText).join(' ')).toContain('Use zircon.');
    expect((await lifecycleControls(root, project, t, true)).every(c => c.status === 'passed')).toBe(true);
    const probes = await runtimeSkipProbes(project.scope, t);
    expect(probes.every(p => p.status === 'skipped' && p.providerRequests === 0)).toBe(true);
    expect(probes.map(p => p.reason)).toContain('unsupported_source');
    expect(probes.map(p => p.reason)).toContain('secret_detected');
    expect(t.blocked).toHaveLength(0);
});

// Protects the new path selector before reservation/egress and actual v5 effect accounting.
test('v5 selectors, exact IDs, frozen corpus and cost reservations fail closed', async () => {
    const run = newRunId(), scope = 'sm_project_v1_eval_a', tag = `deck_eval_${run}_a`;
    const id = `deck_eval_${run}_${'a'.repeat(32)}`;
    const ledger = new CostLedger({ ceilingUsd: 1, stopUsd: .9, cleanupReserveUsd: .1, ingestionTokenBudget: 6, maxWriteAttempts: 1, policy: COST_POLICY });
    const sent: { path: string; body: any; headers: Headers }[] = [];
    const t = new NamespaceTransport({ run, bindings: { [scope]: tag }, budget: 10, costLedger: ledger, wire: async (u, i) => {
        sent.push({ path: u.pathname, body: JSON.parse(String(i.body)), headers: new Headers(i.headers) });
        return Response.json({ id });
    } });
    const send = (path: string, body: any, method = 'POST') => t.fetch('https://api.supermemory.ai' + path, { method, body: JSON.stringify(body), headers: { 'x-sm-container-tag': 'production' } });
    const good = { id, content: 'é🙂' };
    for (const [path, body, method] of [
        ['/ns/production/document', good],
        [`/ns/${scope}/document`, { ...good, id: 'foreign-id' }],
        [`/ns/${scope}/document`, { ...good, containerTag: scope }],
        [`/ns/${scope}/document`, { ...good, metadata: { namespace: 'production' } }],
        [`/ns/${scope}/document`, good, 'DELETE'],
        [`/ns/${scope}/document?moveTo=production`, good],
        [`/ns/${scope}/search`, { query: 'safe', filter: { namespace: 'production' } }],
        [`/ns/${scope}/search`, { query: 'safe', limit: 101 }],
        [`/ns/${scope}/profile`, { containerTags: [scope] }],
        [`/ns/${tag}/document/foreign-id`, {}, 'GET'],
    ] as const) await expect(send(path, body, method)).rejects.toThrow();
    expect(sent).toHaveLength(0); expect(t.used).toBe(0);
    expect(ledger.snapshot().evaluationRequestsUsed).toBe(0);
    t.frozen = true;
    await expect(send(`/ns/${scope}/document`, good)).rejects.toThrow('corpus_frozen');
    t.frozen = false;
    await send(`/ns/${scope}/document`, good);
    expect(sent[0]!.path).toBe(`/ns/${tag}/document`);
    expect(sent[0]!.body).toEqual(good);
    expect(sent[0]!.headers.has('x-sm-container-tag')).toBe(false);
    expect(t.owned[tag]).toEqual([id]); expect(t.writeIntents.has(tag)).toBe(true);
    expect(t.events[0]).toMatchObject({ contentUtf8Bytes: 6, conservativeTokenUpperProxy: 6, documentId: id, completed: true });
    expect(ledger.snapshot()).toMatchObject({ ingestionTokensUsed: 6, writeAttemptsUsed: 1, evaluationRequestsUsed: 1 });
    await expect(send(`/ns/${scope}/document`, good)).rejects.toThrow('estimated_cost_guard_stopped');
    expect(sent).toHaveLength(1);
});

test('changed harness inputs invalidate old frozen plans without upgrading or effects', () => {
    const run = newRunId(), m = draftManifest({ run, evalRoot: scratch.root(run), mode: 'pilot' });
    validateManifest(m);
    delete m.harnessHashes['capture-replay/historical-native-pins.ts'];
    expect(() => validateManifest(m)).toThrow('harness_or_commit_changed_since_manifest');
    expect(m.liveApproved).toBe(false);
});
