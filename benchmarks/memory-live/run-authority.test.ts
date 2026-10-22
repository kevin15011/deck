// Adapted assertions from Quality r6-cost/probes.test.ts and recovery.test.ts.
// No Quality script is imported: these fixtures only create self-cleaning test scratch.
import { test, expect, spyOn } from 'bun:test';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { prepareGuarded } from './cost-guard';
import { newRunId } from './manifest';
import * as manifest from './manifest';
import { RunAuthority } from './run-authority';
import { cleanup } from './cleanup';
import { execute } from './run';
import { simulatedWire } from './namespace-transport';
import * as security from './security';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
const scratch = testScratch();
const limits = { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 };
const plan = () => { const run = newRunId(); return prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', repeats: 1, budget: 822, processing: { pollIntervalMs: 300000 }, accountSharedWithProduction: true }, limits); };
const ownership = (m: any, all = true) => security.privateWrite(join(m.evalRoot, 'ownership.json'), { run: m.run, bindingsHash: security.sha256(JSON.stringify(m.bindings)), owned: Object.fromEntries((Object.values(m.bindings) as string[]).slice(0, all ? 4 : 1).map(tag => [tag, ['synthetic-owned']])) });
const failingWire = async (_u: URL, i: RequestInit) => Response.json({}, { status: i.method === 'DELETE' ? 503 : 200 });
test('r6 sequential cleanup has one cumulative 28-request allowance', async () => {
    const m = await plan(); ownership(m); confirmSyntheticCleanup(m); let sends = 0;
    const wire = async (u: URL, i: RequestInit) => { sends++; return failingWire(u, i); };
    const a = await cleanup(m, { wire, estimatedCleanupCeilingUsd: .05 });
    const b = await cleanup(m, { wire, estimatedCleanupCeilingUsd: .05 });
    expect(a.requests).toBe(16); expect(sends).toBe(28); expect(b.requests).toBe(12);
    expect(b.costProgress!.cleanupRequestsUsed).toBe(28);
    expect(b.costProgress!.cleanupUsedUsd).toBe(.0028);
    expect(b.complete).toBe(false);
});
test('r6 simultaneous cleanup callers cannot share or overwrite an allowance', async () => {
    const m = await plan(); ownership(m, false); confirmSyntheticCleanup(m); let sends = 0;
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(r => release = r), firstSent = new Promise<void>(r => entered = r);
    const wire = async (u: URL, i: RequestInit) => { if (++sends === 1) { entered(); await wait; } return failingWire(u, i); };
    const first = cleanup(m, { wire, estimatedCleanupCeilingUsd: .0004 }); await firstSent;
    let reason = 'accepted';
    try { await cleanup(m, { wire, estimatedCleanupCeilingUsd: .0004 }); } catch (e) { reason = (e as Error).message; }
    finally { release(); }
    const result = await first;
    expect(reason).toBe('run_in_use'); expect(sends).toBe(4);
    expect(result.costProgress!.cleanupUsedUsd).toBe(.0004);
});
test('r6 absent or schema-corrupt spend receipts never override corroborating spent results', async () => {
    for (const scenario of ['absent', 'schema_corrupt', 'syntax_corrupt']) {
        const m = await plan(); ownership(m, false); confirmSyntheticCleanup(m);
        security.privateWrite(join(m.evalRoot, 'results.json'), { run: m.run, costProgress: { cleanupUsedUsd: .05, cleanupRequestsUsed: 28 }, automaticCleanup: { complete: false } });
        if (scenario === 'schema_corrupt') for (const n of ['cleanup.json', 'cost-progress.json', 'cleanup-cost-progress.json']) security.privateWrite(join(m.evalRoot, n), { run: m.run });
        if (scenario === 'syntax_corrupt') security.privateWrite(join(m.evalRoot, 'cost-progress.json'), '{');
        let sends = 0;
        await expect(cleanup(m, { wire: async (u, i) => { sends++; return failingWire(u, i); }, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow();
        expect(sends).toBe(0);
    }
});
test('r6 cleanup cannot delete while evaluation is pending', async () => {
    const m = await plan(); let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(r => release = r), atWrite = new Promise<void>(r => entered = r);
    const fake = simulatedWire(); let held = false;
    const running = execute(m, { wire: async (u, i) => { if (u.pathname === '/v3/documents' && !held) { held = true; entered(); await wait; } return fake(u, i); } });
    await atWrite; let sends = 0, reason = 'accepted';
    try { await cleanup(m, { wire: async (u, i) => { sends++; return failingWire(u, i); }, estimatedCleanupCeilingUsd: .05 }); } catch (e) { reason = (e as Error).message; }
    finally { release(); }
    const result = await running;
    expect(reason).toBe('run_in_use'); expect(sends).toBe(0); expect(result.status).toBe('awaiting_reconciliation');
}, 30000);
test('r6 losing ownership cannot restart a spent evaluation or trust old clean results', async () => {
    const m = await plan(); const fake = simulatedWire(); let sends = 0;
    const wire = async (u: URL, i: RequestInit) => { sends++; return fake(u, i); };
    expect((await execute(m, { wire })).status).toBe('awaiting_reconciliation');
    renameSync(join(m.evalRoot, 'ownership.json'), join(m.evalRoot, 'ownership.preserved'));
    const before = sends;
    await expect(execute(m, { wire })).rejects.toThrow('run_already_has_receipts_use_new_run');
    expect(sends).toBe(before);
    confirmSyntheticCleanup(m);
    const retained = await cleanup(m, { wire, estimatedCleanupCeilingUsd: .05 });
    expect(retained.complete).toBe(false); expect(retained.retainedNamespaces).toHaveLength(4);
    expect(sends).toBe(before);
}, 30000);

test('r6 separate process exclusion and killed-owner recovery preserve uncertain reservations', async () => {
    const m = await plan(); ownership(m, false); confirmSyntheticCleanup(m);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/run-authority-child.ts'), join(m.evalRoot, 'plan.json'), 'cleanup'], { env: { PATH: process.env.PATH!, HOME: homedir() }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const reader = child.stdout.getReader();
    try {
        const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain('effect_reserved');
        let sends = 0;
        await expect(cleanup(m, { wire: async (u, i) => { sends++; return failingWire(u, i); }, estimatedCleanupCeilingUsd: .0004 })).rejects.toThrow('run_in_use');
        expect(sends).toBe(0);
    } finally { child.kill('SIGKILL'); await child.exited; reader.releaseLock(); }
    let sends = 0;
    const result = await cleanup(m, { wire: async (u, i) => { sends++; return failingWire(u, i); }, estimatedCleanupCeilingUsd: .0004 });
    expect(sends).toBe(3); expect(result.costProgress!.cleanupRequestsUsed).toBe(4); expect(result.costProgress!.cleanupUsedUsd).toBe(.0004);
}, 30000);

const preserve = (m: any, names: string[]) => { for (const name of names) if (existsSync(join(m.evalRoot, name))) renameSync(join(m.evalRoot, name), join(m.evalRoot, name + '.preserved')); };
test('spent cleanup stays spent after all reporting journals disappear; schema corruption rejects', async () => {
    for (const corrupt of [false, true]) {
        const m = await plan(); ownership(m, false); confirmSyntheticCleanup(m); let sends = 0;
        const wire = async (u: URL, i: RequestInit) => { sends++; return failingWire(u, i); };
        await cleanup(m, { wire, estimatedCleanupCeilingUsd: .0004 });
        expect(sends).toBe(4);
        preserve(m, ['cleanup.json', 'cleanup-cost-progress.json', 'cost-progress.json']);
        if (corrupt) security.privateWrite(join(m.evalRoot, 'cleanup-cost-progress.json'), { run: m.run });
        await expect(cleanup(m, { wire, estimatedCleanupCeilingUsd: .0004 })).rejects.toThrow(corrupt ? 'run_spend_receipt_invalid' : 'cleanup_estimated_reserve_exhausted');
        expect(sends).toBe(4);
    }
});
test('missing or corrupt durable authority rejects before credential access even when reports are absent', async () => {
    // Keep production credential ordering while permitting only this test's scratch root.
    const root = spyOn(manifest, 'assertLiveRoot').mockImplementation(() => {});
    const reader = spyOn(security, 'readEvalKey').mockImplementation(() => { throw new Error('SYNTHETIC_READER_REACHED'); });
    try {
        for (const name of ['run-authority.json', 'run-lock.sqlite', 'run-spend.sqlite', 'corrupt_state', 'corrupt_progress']) {
            const m = await plan(); ownership(m, false); confirmSyntheticCleanup(m); m.liveApproved = true;
            await cleanup(m, { wire: failingWire, estimatedCleanupCeilingUsd: .0004 });
            preserve(m, ['cleanup.json', 'cleanup-cost-progress.json', 'cost-progress.json']);
            if (name === 'corrupt_state') {
                const { Database } = await import('bun:sqlite');
                const db = new Database(join(m.evalRoot, 'run-spend.sqlite'));
                db.exec("UPDATE state SET value='{}'"); db.close();
            } else if (name === 'corrupt_progress') security.privateWrite(join(m.evalRoot, 'cleanup-cost-progress.json'), { run: m.run });
            else preserve(m, [name]);
            await expect(cleanup(m, { live: true, estimatedCleanupCeilingUsd: .0004 })).rejects.toThrow(name === 'corrupt_state' ? 'run_spend_state_invalid' : name === 'corrupt_progress' ? 'run_spend_receipt_invalid' : 'run_authority_missing_or_corrupt');
            await expect(execute(m, { live: true })).rejects.toThrow();
        }
        expect(reader).not.toHaveBeenCalled();
        // Positive instrumentation control: an untouched authority advances to the mock only.
        const fresh = await plan(); fresh.liveApproved = true;
        await expect(execute(fresh, { live: true })).rejects.toThrow('SYNTHETIC_READER_REACHED');
        expect(reader).toHaveBeenCalledTimes(1);
    } finally { reader.mockRestore(); root.mockRestore(); }
}, 30000);
test('retention then authorized manual cleanup shares the same 28 reservations and retains unverified data', async () => {
    const m = await plan(), fake = simulatedWire();
    let deletes = 0;
    const result = await execute(m, { wire: async (u, i) => { if (i.method === 'DELETE') { deletes++; return Response.json({}, { status: 503 }); } return fake(u, i); } });
    expect(result.automaticCleanup.requests).toBe(0); expect(deletes).toBe(0);
    confirmSyntheticCleanup(m);
    const first = await cleanup(m, { estimatedCleanupCeilingUsd: .05, wire: failingWire });
    expect(first.requests).toBe(16);
    let sends = 0;
    const retry = await cleanup(m, { estimatedCleanupCeilingUsd: .05, wire: async (u, i) => { sends++; return failingWire(u, i); } });
    expect(deletes).toBe(0); expect(sends).toBe(12); expect(retry.costProgress!.cleanupRequestsUsed).toBe(28);
    expect(retry.complete).toBe(false);
    expect(retry.durableReservations!.cleanupRequests).toBe(28);
    preserve(m, ['ownership.json', 'events.json', 'results.json', 'cleanup.json', 'cost-progress.json', 'cleanup-cost-progress.json']);
    await expect(cleanup(m, { wire: failingWire, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow('cleanup_request_budget_exhausted');
    await expect(execute(m)).rejects.toThrow('run_already_has_receipts_use_new_run');
}, 30000);
test('separate active evaluation process excludes deletion; killed write remains reserved and cannot restart', async () => {
    const m = await plan();
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/run-authority-child.ts'), join(m.evalRoot, 'plan.json'), 'evaluation'], { env: { PATH: process.env.PATH!, HOME: homedir() }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const reader = child.stdout.getReader();
    try {
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('effect_reserved');
        await expect(cleanup(m, { wire: failingWire, estimatedCleanupCeilingUsd: .05 })).rejects.toThrow('run_in_use');
    } finally { child.kill('SIGKILL'); await child.exited; reader.releaseLock(); }
    preserve(m, ['cost-progress.json', 'results.json', 'events.json']);
    const authority = RunAuthority.acquire(m, 'cleanup');
    const before = authority.totals(); authority.close();
    expect(before.evaluationStarted).toBe(true); expect(before.tokens).toBeGreaterThan(0);
    confirmSyntheticCleanup(m);
    const recovered = await cleanup(m, { wire: failingWire, estimatedCleanupCeilingUsd: .05 });
    expect(recovered.requests).toBeGreaterThan(0); expect(recovered.complete).toBe(false);
    const after = RunAuthority.acquire(m, 'cleanup');
    try { expect(after.totals().evaluationMicros).toBe(before.evaluationMicros); expect(after.totals().evaluationRequests).toBe(before.evaluationRequests); }
    finally { after.close(); }
    await expect(execute(m)).rejects.toThrow('run_already_has_receipts_use_new_run');
}, 30000);

test('held evaluation authority cannot open its cleanup transport before evaluation is sealed', async () => {
    const m = await plan(), a = RunAuthority.acquire(m, 'evaluation');
    try {
        a.startEvaluation();
        expect(() => a.reserve('/ns/' + Object.values(m.bindings)[0], {}, true, Object.values(m.bindings)[0]!)).toThrow('cleanup_requires_reconciliation_authorization');
        expect(a.receipt().totalRequests).toBe(0);
        a.finishEvaluation();
        expect(() => a.reserve('/ns/' + Object.values(m.bindings)[0], {}, true, Object.values(m.bindings)[0]!)).toThrow('cleanup_requires_reconciliation_authorization');
        expect(a.receipt().cleanupRequests).toBe(0);
    } finally { a.close(); }
});
