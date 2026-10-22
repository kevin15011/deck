import { test, expect } from 'bun:test';
import { ProcessingGate, processingPlan, type Clock } from './processing';
import { NamespaceTransport } from './namespace-transport';
import { prepare, newRunId } from './manifest';
import { sha256 } from './security';
import { testScratch } from './test-support';

const scratch = testScratch();
const alias = 'deck_conversation_c2b687093695b839', newerAlias = 'deck_conversation_0123456789abcdef';
const ackId = 'SyntheticAcknowledgedId';
// Shape verified against the sealed v5 HTTP200 receipt, with synthetic content/metadata.
const queued = (id: unknown = alias) => ({ id, title: null, type: 'text', summary: null, content: null as string | null, metadata: { role: 'user', source: 'trusted-user-prompt' }, system: { status: 'queued', dreamingStatus: 'dreaming', createdAt: '2026-10-21T23:26:57.024Z', updatedAt: '2026-10-21T23:26:57.024Z', filepath: null } });
function fixture() {
    const run = newRunId(), m = prepare({ run, evalRoot: scratch.root(run), mode: 'pilot' });
    let now = 1000, body = queued(); const paths: string[] = [];
    const clock: Clock = { now: () => now, sleep: async ms => { now += ms; } };
    const t = new NamespaceTransport({ run, bindings: m.bindings, budget: 100, now: clock.now, wire: async (u, i) => {
        if (u.pathname === '/v3/documents' && i.method === 'POST') return Response.json({ id: ackId });
        paths.push(u.pathname); return Response.json(body);
    } });
    const scope = Object.keys(m.bindings)[0]!, tag = m.bindings[scope]!;
    t.registerCustomIds(scope, [alias, newerAlias]);
    const gate = new ProcessingGate(t, processingPlan({ schedule: 'adaptive-v1', deadlineMs: 10000, pollIntervalMs: 2500, requestTimeoutMs: 2000 }), clock);
    const write = (customId = alias, content = 'latest') => t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId, content }) });
    return { t, tag, gate, clock, paths, write, set: (value: ReturnType<typeof queued>) => { body = value; } };
}
test('v5 queued custom-ID alias progresses to independent indexing and memory completion via exact ACK path', async () => {
    const f = fixture(); await f.write();
    expect(f.t.events[0]!.customIdHash).toBe(sha256(alias));
    let r = await f.gate.sample();
    expect(r.documents[0]!.status).toBe('pending'); expect(r.completed).toBe(0);
    expect(r.documents[0]!.observations[0].revisionMatches).toBe(false);
    expect(r.documents[0]!.observations[0].identityWitness).toEqual({ kind: 'submitted_custom_id_sha256', writeAttempt: 0, responseIdHash: sha256(alias) });
    const indexing = queued(); indexing.content = 'latest'; indexing.system.status = 'done'; f.set(indexing);
    await f.clock.sleep(2500); r = await f.gate.sample();
    expect(r.documents[0]!.status).toBe('pending'); expect(r.latency.indexingFromAcceptance.observed).toBe(1); expect(r.latency.memoryFromAcceptance.observed).toBe(0);
    indexing.system.dreamingStatus = 'done'; f.set(indexing);
    await f.clock.sleep(2500); r = await f.gate.sample();
    expect(r.validity).toBe('valid'); expect(r.completed).toBe(1);
    expect(r.latency.memoryFromAcceptance.observed).toBe(1);
    expect(f.paths).toEqual(Array(3).fill(`/ns/${f.tag}/document/${ackId}`));
    const used = f.t.used;
    await expect(f.t.fetch(`https://api.supermemory.ai/ns/${f.tag}/document/${alias}`)).rejects.toThrow();
    expect(f.t.used).toBe(used);
});
for (const [name, id, missingHash] of [
    ['unrelated', newerAlias, false], ['missing ID', null, false], ['unsafe ID', '../outside', false], ['missing hash', alias, true],
] as const) test('alias identity rejects ' + name, async () => {
    const f = fixture(); await f.write(); f.set(queued(id));
    if (missingHash) delete f.t.events[0]!.customIdHash;
    if (name === 'unsafe ID') f.t.events[0]!.customIdHash = sha256(id!);
    const r = await f.gate.sample();
    expect(r.documents[0]!.reason).toBe('malformed_or_unresolvable_document_status'); expect(r.completed).toBe(0);
});
test('exact acknowledged ID still works without an alias hash', async () => {
    const f = fixture(); await f.write(); delete f.t.events[0]!.customIdHash;
    const body = queued(ackId); body.content = 'latest'; body.system.status = body.system.dreamingStatus = 'done'; f.set(body);
    const r = await f.gate.sample(); expect(r.validity).toBe('valid');
    expect(r.documents[0]!.observations[0].identityWitness.kind).toBe('acknowledged_id');
});
for (const responseAlias of [alias, newerAlias]) test('later revision binds alias to latest acknowledged attempt: ' + responseAlias, async () => {
    const f = fixture(); await f.write(); await f.gate.sample(); await f.clock.sleep(2500);
    await f.write(newerAlias, 'new revision');
    const body = queued(responseAlias); body.content = 'new revision'; body.system.status = body.system.dreamingStatus = 'done'; f.set(body);
    const r = await f.gate.sample();
    expect(r.writesAccountedFor).toBe(2); expect(r.supersededRevisions).toHaveLength(1);
    if (responseAlias === alias) expect(r.documents[0]!.reason).toBe('malformed_or_unresolvable_document_status');
    else { expect(r.validity).toBe('valid'); expect(r.documents[0]!.observations[0].identityWitness.writeAttempt).toBe(2); }
});
test('latest revision cannot borrow an older acknowledged alias hash', async () => {
    const f = fixture(); await f.write(); await f.gate.sample(); await f.write(alias, 'new revision');
    delete f.t.events.at(-1)!.customIdHash;
    const r = await f.gate.sample(); expect(r.documents[0]!.reason).toBe('malformed_or_unresolvable_document_status');
});
for (const content of [null, 'older revision']) test('matching alias never bypasses done content witness: ' + content, async () => {
    const f = fixture(); await f.write(); const body = queued(); body.content = content; body.system.status = body.system.dreamingStatus = 'done'; f.set(body);
    const r = await f.gate.sample(); expect(r.documents[0]!.reason).toBe('latest_revision_unresolved'); expect(r.completed).toBe(0);
});
