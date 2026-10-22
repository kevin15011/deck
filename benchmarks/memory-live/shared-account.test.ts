import { draftManifest } from './manifest';
import { initializeRunAuthority } from './run-authority';
import { test, expect, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { prepare, newRunId, assertAccountDeclaration, parseAccountDeclaration } from './manifest';
import { execute } from './run';
import { cleanup } from './cleanup';
import * as security from './security';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
const scratch = testScratch();
const plan = (shared?: boolean, budget?: number) => { const run = newRunId(); return prepare({ run, evalRoot: scratch.root(run), mode: 'pilot', budget, ...(shared === undefined ? {} : { accountSharedWithProduction: shared }) }); };
test('shared account live declaration must be exactly true and preparation accepts only the bare flag', async () => {
    const missing = plan(), declared = plan(true), denied = plan(false);
    for (const m of [missing, declared, denied])
        expect(Object.hasOwn(m, 'dedicatedEvalAccount')).toBe(false);
    expect(Object.hasOwn(missing, 'accountSharedWithProduction')).toBe(false);
    expect(() => assertAccountDeclaration(declared)).not.toThrow();
    for (const m of [missing, denied])
        expect(() => assertAccountDeclaration(m)).toThrow('explicit_account_shared_with_production_true');
    expect(parseAccountDeclaration(['--account-shared-with-production'])).toBe(true);
    expect(parseAccountDeclaration(['--account-shared-with-production', '--mode', 'pilot'])).toBe(true);
    expect(parseAccountDeclaration([])).toBeUndefined();
    for (const args of [
        ['--account-shared-with-production=false'],
        ['--account-shared-with-production=true'],
        ['--account-shared-with-production', 'true'],
        ['--account-shared-with-production', 'false'],
        ['--account-shared-with-production=maybe'],
        ['--account-shared-with-production', '--account-shared-with-production'],
        ['--dedicated-eval-account'],
    ]) expect(() => parseAccountDeclaration(args)).toThrow();
});
test('false and absent live declarations refuse run and cleanup before invoking the credential reader', async () => {
    const keyRead = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('TEST_CREDENTIAL_READER_MUST_NOT_RUN'); });
    try {
        for (const shared of [false, undefined]) {
            const m = plan(shared);
            m.liveApproved = true;
            m.cleanupApproved = true;
            await expect(execute(m, { live: true })).rejects.toThrow('explicit_account_shared_with_production_true');
            await expect(cleanup(m, { live: true })).rejects.toThrow('explicit_account_shared_with_production_true');
        }
        expect(keyRead).not.toHaveBeenCalled();
    } finally { keyRead.mockRestore(); }
});
test('cleanup deletion needs recorded writes or a complete absent-at-start preflight receipt', async () => {
    for (const kind of ['missing', 'unrecorded', 'existing_empty', 'incomplete', 'failed', 'owned', 'attempted', 'unresolved', 'absent_at_start']) {
        const m = plan(true), tag = Object.values(m.bindings)[0]!;
        const probe = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: simulatedWire() });
        const absent = await probe.preflightNamespace(tag);
        const ownership: any = { run: m.run, bindingsHash: security.sha256(JSON.stringify(m.bindings)), owned: {} };
        if (kind === 'existing_empty') ownership.preflight = [{ ...absent, status: 'empty_on_both_read_paths', v5Status: 200 }];
        if (kind === 'incomplete') ownership.preflight = [{ ...absent, legacy: { empty: true } }];
        if (kind === 'failed') { ownership.owned[tag] = ['synthetic-owned']; ownership.unownedNamespaces = [tag]; ownership.preflight = [{ tag, status: 'failed' }]; }
        if (kind === 'owned') ownership.owned[tag] = ['synthetic-owned'];
        if (kind === 'attempted') ownership.attemptedNamespaces = [tag];
        if (kind === 'unresolved') ownership.unresolvedNamespaces = [tag];
        if (kind === 'absent_at_start') ownership.preflight = [absent];
        if (kind !== 'missing') security.privateWrite(join(m.evalRoot, 'ownership.json'), ownership);
        confirmSyntheticCleanup(m);
        const deleted = new Set<string>();
        const r = await cleanup(m, { wire: async (u, i) => {
            if (i.method === 'DELETE') { deleted.add(u.pathname); return Response.json({ deleted: true }); }
            if (u.pathname.startsWith('/ns/')) return deleted.has(u.pathname) ? new Response('{}', { status: 404 }) : Response.json({ namespace: tag });
            return u.pathname === '/v4/search' ? Response.json({ results: [], total: 0 }) : Response.json({ profile: { static: [], dynamic: [] } });
        } });
        const allowed = ['owned', 'attempted', 'unresolved', 'absent_at_start'].includes(kind);
        expect({ kind, deleted: deleted.has('/ns/' + tag) }).toEqual({ kind, deleted: allowed });
        if (allowed) expect(r.deletedNamespaces).toEqual([tag]);
        else expect(r.retainedNamespaces).toContainEqual({ namespace: tag, reason: kind === 'failed' ? 'retained_preexisting_namespace' : 'retained_ownership_unproven' });
        expect(r.complete).toBe(false); // Other manifest tags have no ownership or preflight receipt.
        expect(r.retainedNamespaces.length).toBe(allowed ? 3 : 4);
    }
});
test('shared account denies every account/organization/auth/billing/connector/space/project endpoint before egress', async () => {
    const m = plan(true), scope = Object.keys(m.bindings)[0]!;
    let sent = 0;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 1000, wire: async () => { sent++; return Response.json({}); } });
    for (const path of ['/v3/settings', '/organization', '/organization/context', '/organizational-context', '/v3/auth/scoped-key', '/auth', '/billing', '/v3/auth/billing/usage', '/connectors', '/connections', '/spaces', '/projects', '/namespaces', '/ns'])
        for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
            await expect(t.fetch('https://api.supermemory.ai' + path, { method, ...(method === 'GET' ? {} : { body: JSON.stringify({ containerTag: scope }) }) })).rejects.toThrow();
        }
    expect(sent).toBe(0);
    expect(t.used).toBe(0);
    expect(t.events.length).toBe(0);
});
test('shared account keeps exact single-scope mapping and excludes account-wide and unowned bulk/forget/delete', async () => {
    const m = plan(true), scope = Object.keys(m.bindings)[0]!, tag = m.bindings[scope]!;
    const sent: any[] = [];
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 10, wire: async (u, i) => { const b = JSON.parse(String(i.body)); sent.push({ path: u.pathname, body: b, headers: Object.fromEntries(new Headers(i.headers)) }); return Response.json({ results: [] }); } });
    for (const body of [{}, { containerTag: 'production' }, { containerTags: [] }, { containerTags: [tag, tag] }, { containerTag: tag, containerTags: [tag] }, { containerTag: tag, namespace: 'production' }, { containerTag: `deck_eval_${m.run}_not_owned` }, { containerTag: tag, metadata: { containerTag: 'production' } }])
        await expect(t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow();
    for (const path of ['/v3/documents', '/v4/profile', '/v4/search'])
        for (const selector of [{}, { containerTags: [tag, tag] }, { containerTag: 'production' }])
            await expect(t.fetch('https://api.supermemory.ai' + path, { method: 'POST', body: JSON.stringify({ ...selector, ...(path === '/v3/documents' ? { content: 'synthetic', customId: `deck_eval_${m.run}_${'a'.repeat(32)}` } : {}) }) })).rejects.toThrow();
    for (const path of ['/v3/documents/batch', '/v3/documents/production-id', `/ns/${tag}/document`, `/ns/${tag}/memories`, `/ns/${tag}/memories/semantic`])
        await expect(t.fetch('https://api.supermemory.ai' + path, { method: 'DELETE', body: JSON.stringify({ containerTag: tag, ids: ['production-id'] }) })).rejects.toThrow();
    await t.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTags: [scope], q: 'synthetic' }), headers: { 'x-sm-container-tag': 'production' } });
    expect(sent.length).toBe(1);
    expect(sent[0].body.containerTags).toEqual([tag]);
    expect(tag).toStartWith('deck_eval_');
    expect(sent[0].headers['x-sm-container-tag']).toBeUndefined();
});
test('namespace supportingContext and bucket writes require run-owned deck_eval paths and exact bodies', async () => {
    const m = plan(true), tag = Object.values(m.bindings)[0]!, sent: any[] = [];
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 20, wire: async (u, i) => { sent.push({ path: u.pathname, method: i.method, body: JSON.parse(String(i.body)) }); return Response.json({ ok: true }); } });
    const configs = [{ method: 'PATCH', suffix: '', body: { supportingContext: 'Synthetic evaluation context' } }, { method: 'PUT', suffix: '/profile/buckets', body: { buckets: { decisions: 'Synthetic decisions' } } }, { method: 'DELETE', suffix: '/profile/buckets', body: { buckets: ['decisions'] } }];
    for (const config of configs) {
        for (const ns of ['production', 'default', `deck_eval_20200101_abcdef_a`, `deck_eval_${m.run}_not_owned`])
            await expect(t.fetch(`https://api.supermemory.ai/ns/${ns}${config.suffix}`, { method: config.method, body: JSON.stringify(config.body) })).rejects.toThrow();
        await t.fetch(`https://api.supermemory.ai/ns/${tag}${config.suffix}`, { method: config.method, body: JSON.stringify(config.body) });
    }
    expect(sent.length).toBe(3);
    expect(sent[2].body).toEqual({ buckets: ['decisions'] });
    expect(t.writeIntents.has(tag)).toBe(true);
    await expect(t.fetch(`https://api.supermemory.ai/ns/${tag}`, { method: 'PATCH', body: JSON.stringify({ supportingContext: 'synthetic', organizationalContext: 'production' }) })).rejects.toThrow();
    await expect(t.fetch(`https://api.supermemory.ai/ns/${tag}/profile/buckets`, { method: 'DELETE', body: JSON.stringify({ buckets: ['decisions'], moveTo: 'production' }) })).rejects.toThrow();
    t.frozen = true;
    await expect(t.fetch(`https://api.supermemory.ai/ns/${tag}`, { method: 'PATCH', body: '{"supportingContext":"synthetic"}' })).rejects.toThrow('corpus_frozen');
});
test('shared account retains successful and aborted pilots without auto-delete or cleanup failure', async () => {
    for (const budget of [undefined, 14, 1]) {
        const m = plan(true, budget), wire = simulatedWire(); let deletes = 0;
        const r = await execute(m, { wire: async (u, i) => { if (i.method === 'DELETE') deletes++; return wire(u, i); } });
        expect(r.status).toBe(budget ? 'invalid_awaiting_reconciliation' : 'awaiting_reconciliation');
        expect(r.automaticCleanup.performed).toBe(false); expect(deletes).toBe(0);
        expect(r.automaticCleanup.retainedNamespaces).toHaveLength(4);
        const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
        expect(saved.accountSettingsCaveat.settingsRead).toBe(false); expect(saved.accountSettingsCaveat.settingsChanged).toBe(false);
        expect(saved.budget.cleanupUsed).toBe(0);
        if (budget) expect(saved.budget.evaluationUsed).toBe(budget);
    }
}, 60000);
test('shared namespace configuration cannot use the next repeat even if it is in the run manifest', async () => {
    const run = newRunId(), m = prepare({ run, evalRoot: scratch.root(run), mode: 'full', repeats: 3, accountSharedWithProduction: true });
    let sent = 0;
    const t = new NamespaceTransport({ run, bindings: m.bindings, budget: 10, wire: async () => { sent++; return Response.json({}); } });
    t.activateRepeat(1);
    const future = m.bindings.sm_project_v1_eval_r_runtime_2_a!;
    await expect(t.fetch(`https://api.supermemory.ai/ns/${future}`, { method: 'PATCH', body: '{"supportingContext":"synthetic"}' })).rejects.toThrow('allowlist');
    expect(sent).toBe(0);
});
test('explicitly authorized cleanup retains unattempted namespaces when its own cumulative budget is exhausted', async () => {
    const run = newRunId(), m = draftManifest({ run, evalRoot: scratch.root(run), mode: 'pilot', accountSharedWithProduction: true });
    m.cleanupRequestBudget = 1; initializeRunAuthority(m);
    const wire = simulatedWire(); expect((await execute(m, { wire })).evaluationStatus).toBe('completed');
    confirmSyntheticCleanup(m);
    const r = await cleanup(m, { wire });
    expect(r.complete).toBe(false); expect(r.requests).toBe(1); expect(r.retainedNamespaces).toHaveLength(4);
    expect(r.retainedNamespaces.some(e => e.reason === 'retained_budget_exhausted')).toBe(true);
}, 60000);
