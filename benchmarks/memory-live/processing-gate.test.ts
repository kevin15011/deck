import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { prepare, newRunId } from './manifest';
import { execute } from './run';
import { cleanup } from './cleanup';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { privateWrite, sha256 } from './security';
import { testScratch } from './test-support';
const scratch = testScratch();
const plan = () => { const run = newRunId(); return prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', accountSharedWithProduction: true }); };
test('processing completion precedes quality and success retains all namespaces awaiting reconciliation', async () => {
    const m = plan(), fake = simulatedWire(); let deletes = 0, statusReads = 0;
    const result = await execute(m, { wire: async (u, i) => { if (i.method === 'DELETE') deletes++; if (u.pathname.includes('/document/')) statusReads++; return fake(u, i); } });
    expect(deletes).toBe(0); expect(statusReads).toBeGreaterThan(0);
    expect(result.status).toBe('awaiting_reconciliation');
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(saved.quality.validity).toBe('valid'); expect(saved.retention.namespaces).toHaveLength(4);
    expect(saved.availability.mode).toBe('capture_relative_next_turn');
}, 60000);
test('failed document processing invalidates quality instead of publishing retrieval scores', async () => {
    const m = plan(), fake = simulatedWire();
    await execute(m, { wire: async (u, i) => {
        const r = await fake(u, i);
        if (u.pathname.includes('/document/')) { const d = await r.json(); return Response.json({ ...d, system: { ...d.system, status: 'failed' } }); }
        return r;
    } });
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    expect(saved.quality.validity).toBe('invalid'); expect(saved.summary.retrieval.cases).toBe(0);
    expect(saved.retention.status).toBe('awaiting_reconciliation');
}, 60000);
test('shared-account and cleanupApproved cannot bypass explicit durable reconciliation authorization', async () => {
    const m = plan(); m.cleanupApproved = true;
    const tag = Object.values(m.bindings)[0]!;
    privateWrite(join(m.evalRoot, 'ownership.json'), { run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: { [tag]: ['owned'] } });
    let sends = 0;
    await expect(cleanup(m, { estimatedCleanupCeilingUsd: .05, wire: async () => { sends++; return Response.json({}); } })).rejects.toThrow('cleanup_requires_reconciliation_authorization');
    expect(sends).toBe(0);
});
test('only exact acknowledged document IDs get namespace-scoped status admission', async () => {
    const m = plan(), fake = simulatedWire(), tag = Object.values(m.bindings)[0]!, scope = Object.keys(m.bindings)[0]!;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: fake });
    const r = await t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: 'deck_eval_' + m.run + '_' + 'a'.repeat(32), content: 'Synthetic revision.' }) });
    const id = (await r.json()).id;
    const status = await t.fetch('https://api.supermemory.ai/ns/' + tag + '/document/' + id, { method: 'GET' });
    expect((await status.json()).system).toMatchObject({ status: 'done', dreamingStatus: 'done' });
});
