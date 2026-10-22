import { expect, test, spyOn } from 'bun:test';
import { prepare, validateManifest } from './manifest';
import { RunAuthority } from './run-authority';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
import { execute } from './run';
import * as security from './security';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const scratch = testScratch();
const input = (suffix: string) => ({ run: '20261021_' + suffix, evalRoot: scratch.root('20261021_' + suffix), mode: 'pilot' as const, repeats: 1, budget: 822, processing: { pollIntervalMs: 300000 }, accountSharedWithProduction: true });
const limits = { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 };
test('live rejects a missing cost guard before root or credential access; historical plans work offline', async () => {
    const m = prepare(input('bb0001')); m.liveApproved = true;
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('CREDENTIAL_READER_MUST_NOT_RUN'); });
    try {
        await expect(execute(m, { live: true })).rejects.toThrow('live_requires_valid_cost_guard');
        expect(reader).not.toHaveBeenCalled();
    } finally { reader.mockRestore(); }
    expect(await execute(m)).toMatchObject({ status: 'awaiting_reconciliation' });
    const { rescore } = await import('./rescore');
    const before = readFileSync(join(m.evalRoot, 'results.json'), 'utf8');
    m.sourceCommit = 'changed'; m.harnessHashes = {};
    expect(rescore(m)).toMatchObject({ cases: 50, networkRequests: 0 });
    expect(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).toBe(before);
}, 60000);
test('forecast serializes real R captures and controls, freezes inputs and retains 850 total', async () => {
    const { prepareGuarded, validateLiveCostGuard } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0002'), limits);
    const g = m.costGuard!;
    expect(g.forecast.writes.length).toBeGreaterThan(40);
    expect(g.forecast.contentUtf8Bytes).toBe(g.forecast.writes.reduce((n, w) => n + w.contentUtf8Bytes, 0));
    expect(g.forecast.writes.some(w => w.phase === 'controls')).toBe(true);
    expect(g.ingestionTokenBudget).toBe(2 * g.forecast.contentUtf8Bytes);
    expect(m.requestBudget + m.cleanupRequestBudget!).toBe(850);
    validateLiveCostGuard(m); validateManifest(m);
    expect(() => validateLiveCostGuard({ ...m, requestBudget: 823 })).toThrow();
    expect(() => validateLiveCostGuard({ ...m, costGuard: { ...g, stopUsd: NaN } })).toThrow();
    expect(JSON.parse(readFileSync(join(m.evalRoot, 'plan.json'), 'utf8')).costGuard).toEqual(g);
});
test('pre-egress projection latches stop, never refunds lost acknowledgements, cleanup remains independent', async () => {
    const { prepareGuarded, CostLedger } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0003'), limits);
    const ledger = new CostLedger(m.costGuard!);
    let sends = 0;
    const scope = Object.keys(m.bindings)[0]!;
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 822, costLedger: ledger, wire: async () => { sends++; throw new Error('lost acknowledgement'); } });
    const send = (content: string) => t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: 'deck_eval_' + m.run + '_' + 'a'.repeat(32), content }) });
    await expect(send('é🙂')).rejects.toThrow();
    expect(ledger.snapshot().ingestionTokensUsed).toBe(6);
    await expect(send('x'.repeat(m.costGuard!.ingestionTokenBudget))).rejects.toThrow('estimated_cost_guard_stopped');
    expect(sends).toBe(1);
    await expect(t.inspectNamespace(Object.values(m.bindings)[0]!)).rejects.toThrow('estimated_cost_guard_stopped');
    const cleanup = t.createCleanupTransport(28);
    await expect(cleanup.inspectNamespace(Object.values(m.bindings)[0]!)).rejects.toThrow('egress_failed');
    expect(sends).toBe(2);
    expect(ledger.snapshot()).toMatchObject({ stopped: true, stopReason: 'ingestion_token_budget', cleanupRequestsUsed: 1 });
});

test('all invalid guard shapes reject before credential read; plan approval alone cannot change limits', async () => {
    const { prepareGuarded } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0004'), limits);
    m.liveApproved = true;
    for (const value of [null, {}, { ...m.costGuard!, stopUsd: Infinity }, { ...m.costGuard!, cleanupReserveUsd: -.01 }, { ...m.costGuard!, ingestionTokenBudget: 1 }, { ...m.costGuard!, forecast: { ...m.costGuard!.forecast, contentUtf8Bytes: 0 } }, { ...m.costGuard!, frozenPlanHash: '0'.repeat(64) }]) {
        await expect(execute({ ...m, costGuard: value as any }, { live: true })).rejects.toThrow('live_requires_valid_cost_guard');
    }
    // A valid guard advances to the root gate, still before any credential access.
    await expect(execute(m, { live: true })).rejects.toThrow('test_scratch_cannot_be_live');
});
test('concurrent requests reserve synchronously; exact stop threshold blocks next effect including optional operations', async () => {
    const { prepareGuarded, CostLedger } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0005'), limits);
    const g = m.costGuard!;
    const ledger = new CostLedger(g);
    let sends = 0;
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: 822, costLedger: ledger, wire: async () => { sends++; await pending; return Response.json({ id: 'synthetic' }); } });
    const scope = Object.keys(m.bindings)[0]!;
    const request = () => t.fetch('https://api.supermemory.ai/v3/documents', { method: 'POST', body: JSON.stringify({ containerTag: scope, customId: 'deck_eval_' + m.run + '_' + 'a'.repeat(32), content: 'x'.repeat(g.ingestionTokenBudget / 2 + 1) }) });
    const first = request();
    await expect(request()).rejects.toThrow('estimated_cost_guard_stopped');
    expect(sends).toBe(1);
    release(); await first;
    expect(ledger.snapshot().ingestionTokensUsed).toBe(g.ingestionTokenBudget / 2 + 1);
    const exact = new CostLedger({ ...g, stopUsd: .000405 });
    expect(() => exact.reserve('/v4/search', { rerank: true, rewriteQuery: true, aggregate: true }, false)).toThrow('estimated_cost_guard_stopped');
    expect(exact.snapshot()).toMatchObject({ evaluationRequestsUsed: 0, stopReason: 'estimated_stop_threshold', stoppedEffectProjection: { evaluationUsd: .000405 } });
});
test('guarded simulation matches forecast content bytes and keeps failed writes charged through cleanup', async () => {
    const { prepareGuarded } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0006'), limits);
    const wire = simulatedWire();
    let writes = 0;
    // Exercise actual production composition: optional returned profile work cannot refund
    // a charged write; extra retries exhaust the ingestion proxy before further egress.
    const normal = await execute(m, { wire: async (u, i) => { if (u.pathname === '/v3/documents') writes++; return wire(u, i); } });
    expect(normal.status).toBe('awaiting_reconciliation');
    expect(writes).toBe(m.costGuard!.forecast.measuredWriteCount);
    expect(normal.costProgress).toMatchObject({ ingestionTokensUsed: m.costGuard!.forecast.contentUtf8Bytes, stopped: false, cleanupRequestsUsed: 0 });
    expect(normal.automaticCleanup.performed).toBe(false);
    const stopped = await prepareGuarded(input('bb0007'), limits);
    // A provider 503 may still have persisted data: charge all actual attempts and clean them.
    const fake = simulatedWire();
    const failed = await execute(stopped, { wire: async (u, i) => {
        const r = await fake(u, i);
        if (u.pathname === '/v3/documents') return Response.json({ error: 'retry' }, { status: 503 });
        return r;
    } });
    expect(failed.automaticCleanup.performed).toBe(false);
    expect(failed.costProgress!.ingestionTokensUsed).toBeGreaterThan(0);
    expect(failed.costProgress!.evaluationUsedUsd).toBeLessThan(.20);
}, 60000);

test('retention finalizer persists and signals a seeded cost stop without cleanup; no blocked write is sent', async () => {
    const { prepareGuarded, CostLedger } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0008'), limits);
    const reserve = CostLedger.prototype.reserve;
    let captures = 0, sentWrites = 0, stopObservedBeforeDelete = false;
    // Seed a near-exhausted history at the second capture without adding a production
    // testing API. All production validation, stop propagation, receipts and finalization run.
    const injected = spyOn(CostLedger.prototype, 'reserve').mockImplementation(function (this: InstanceType<typeof CostLedger>, endpoint, body, cleanup, commit) {
        if (endpoint === '/v3/documents' && ++captures === 2)
            return reserve.call(this, endpoint, { ...body, content: 'x'.repeat(m.costGuard!.ingestionTokenBudget) }, cleanup);
        return reserve.call(this, endpoint, body, cleanup, commit);
    });
    const notices: string[] = [];
    const stderr = spyOn(console, 'error').mockImplementation(value => { notices.push(String(value)); });
    const fake = simulatedWire();
    try {
        const result = await execute(m, { wire: async (u, i) => {
            if (u.pathname === '/v3/documents') sentWrites++;
            if (i.method === 'DELETE') stopObservedBeforeDelete = JSON.parse(readFileSync(join(m.evalRoot, 'cost-progress.json'), 'utf8')).stopped;
            return fake(u, i);
        } });
        expect(result).toMatchObject({ status: 'invalid_awaiting_reconciliation', exitCode: 1, evaluationStatus: 'invalid' });
        expect(result.costProgress).toMatchObject({ stopped: true, stopReason: 'ingestion_token_budget' });
        expect(result.automaticCleanup.performed).toBe(false);
        expect(sentWrites).toBe(1);
        expect(stopObservedBeforeDelete).toBe(false);
        expect(notices.filter(s => JSON.parse(s).event === 'estimated_cost_guard_stop')).toHaveLength(1);
        expect(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')).toContain('stoppedEffectProjection');
    } finally { injected.mockRestore(); stderr.mockRestore(); }
});

test('standalone live cleanup requires an explicit recovery estimate before key read, even for historical plans', async () => {
    const { cleanup } = await import('./cleanup');
    const m = prepare(input('bb0009')); m.liveApproved = true;
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('CREDENTIAL_READER_MUST_NOT_RUN'); });
    try {
        for (const value of [undefined, NaN, 0, -.05])
            await expect(cleanup(m, { live: true, estimatedCleanupCeilingUsd: value })).rejects.toThrow('explicit_cleanup_cost_guard_required');
        await expect(cleanup(m, { live: true, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow('test_scratch_cannot_be_live');
        expect(reader).not.toHaveBeenCalled();
    } finally { reader.mockRestore(); }
});

test('historical scoped recovery carries reservations across invocations and stops before the next delete', async () => {
    const { cleanup } = await import('./cleanup');
    const m = prepare(input('bb0010'));
    m.sourceCommit = 'historical'; m.sourceHashes = {}; m.harnessHashes = {};
    const tag = Object.values(m.bindings)[0]!;
    security.privateWrite(join(m.evalRoot, 'ownership.json'), { run: m.run, bindingsHash: security.sha256(JSON.stringify(m.bindings)), owned: { [tag]: ['synthetic-owned-id'] } });
    // A crash after the automatic ledger reservation but before cleanup.json was saved.
    const authority = RunAuthority.acquire(m, 'cleanup');
    authority.authorizeCleanup(syntheticConfirmation(m)); authority.configureCleanup(.00025);
    authority.reserve('/ns/' + tag, {}, true, tag);
    authority.close();
    let sends = 0;
    const wire = async (_u: URL, i: RequestInit) => { sends++; return Response.json({}, { status: i.method === 'DELETE' ? 503 : 200 }); };
    const stderr = spyOn(console, 'error').mockImplementation(() => {});
    try {
        const first = await cleanup(m, { wire, estimatedCleanupCeilingUsd: .00025 });
        expect(first.complete).toBe(false);
        expect(sends).toBe(1);
        expect(first.costProgress).toMatchObject({ cleanupUsedUsd: .0002, stopReason: 'cleanup_estimated_reserve' });
        await expect(cleanup(m, { wire, estimatedCleanupCeilingUsd: .00025 })).rejects.toThrow('cleanup_estimated_reserve_exhausted');
        expect(sends).toBe(1);
    } finally { stderr.mockRestore(); }
});

test('an explicit guarded request budget is unapproved configuration and never increases cleanup', async () => {
    const { prepareGuarded } = await import('./cost-guard');
    const m = await prepareGuarded({ ...input('bb0011'), budget: 850 }, limits);
    expect(m.requestBudget).toBe(850); expect(m.cleanupRequestBudget).toBe(28); expect(m.liveApproved).toBe(false);
});
test('forecast includes accepted-empty namespace preflight and bounds all revision monitoring', async () => {
    const { prepareGuarded } = await import('./cost-guard');
    const m = await prepareGuarded(input('bb0012'), limits), g = m.costGuard!;
    expect(g.executionForecast.preflightRequests).toBe(6 * Object.keys(m.bindings).length);
    expect(g.executionForecast.maximumPollsPerRevision).toBe(2);
    expect(g.executionForecast.monitoringStatusRequests).toBe(g.maxWriteAttempts * 2);
});
