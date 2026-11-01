import { expect, test, spyOn } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { harnessHashes, newRunId } from './manifest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sha256 } from './security';
import * as security from './security';
import { smallCorpus } from './fixtures/small-corpus';
import { prepareGuarded } from './cost-guard';
import { execute, linuxBootTimeUpperMs } from './run';
import { realClock } from './processing';
import { NamespaceTransport } from './namespace-transport';

// QSUP-2: elapsed allowance cannot reopen, including rollback BEFORE the first
// expiry check. Only civil time and the network edge are synthetic; production
// realClock, monotonic timing and abort timers remain in use.
test('elapsed transport horizon survives wall clock rollback and forward jumps', async () => {
    let wall = Date.now();
    const time = spyOn(Date, 'now').mockImplementation(() => wall);
    const run = '20261031_abcdef', scope = 'sm_project_v1_eval_a';
    const request = (t: NamespaceTransport) => t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: scope }) });
    try {
        for (const mode of ['before-check', 'after-check', 'forward', 'before-send', 'body-wait']) {
            wall = 1800000000000;
            let sends = 0, signal: AbortSignal | undefined;
            const t = new NamespaceTransport({ run, bindings: { [scope]: `deck_eval_${run}_r_runtime_a` }, budget: 10,
                now: realClock.now, deadlineAtMs: wall + 25, requestTimeoutMs: 1000,
                changed: mode === 'before-send' ? () => {
                    wall -= 10000;
                    const until = performance.now() + 30;
                    while (performance.now() < until) { /* real synchronous reservation/receipt delay */ }
                } : undefined,
                wire: async (_u, init) => { sends++; signal = init.signal!;
                    return mode === 'body-wait' ? new Response(new ReadableStream({ start() {} })) : Response.json({});
                },
            });
            if (mode === 'before-send') {
                await expect(request(t)).rejects.toThrow();
                expect(sends).toBe(0);
                expect(t.used).toBe(1); // retained reservation, even though no wire send
            } else if (mode === 'body-wait') {
                wall -= 10000;
                const started = performance.now();
                await expect(request(t)).rejects.toThrow('egress_failed');
                expect(performance.now() - started).toBeLessThan(500);
                expect(signal!.aborted).toBe(true);
                expect(t.events[0]!.transportFailure).toBe('timeout');
                expect(t.used).toBe(1);
            } else {
                if (mode === 'forward') wall += 10000;
                else { wall -= 10000; await realClock.sleep(35); }
                if (mode !== 'before-check') await expect(request(t)).rejects.toThrow('evaluation_deadline');
                wall -= 10000;
                await expect(request(t)).rejects.toThrow('evaluation_deadline');
                expect(sends).toBe(0);
                expect(t.used).toBe(0);
            }
            wall -= 10000;
            await expect(request(t)).rejects.toThrow('evaluation_deadline');
            expect(sends).toBe(mode === 'body-wait' ? 1 : 0);
        }
    } finally { time.mockRestore(); }
});

// Protects attached lifetime, private receipts and fail-closed plan binding.
// The Python assertions exercise real OS processes; no provider or credential I/O.
test('attached supervisor process and authority boundaries', () => {
    const result = spawnSync('python3', ['-B', join(import.meta.dir, 'fixtures/supervision-probe.py')], { encoding: 'utf8', timeout: 1500 });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    expect(result.status).toBe(0);
});

// Protects the default live composition without real credentials or egress:
// an absolute supervisor deadline may shorten but never extend the run budget.
test('supervisor deadline caps the transport and leaves terminal retained receipts', async () => {
    const originalHome = process.env.HOME;
    const syntheticHome = mkdtempSync(join(tmpdir(), 'deck-supervision-'));
    process.env.HOME = syntheticHome;
    const corpus = smallCorpus();
    const key = spyOn(security, 'readEvalKey').mockImplementation(() => 'SYNTHETIC');
    const attempts: number[] = [];
    let now = Date.now(), expectedDeadline = now, boottimeDeadline = 0, rollback = false;
    const network = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => {
        attempts.push(now);
        if (rollback) {
            now -= 10000;
            await realClock.sleep(Math.max(0, boottimeDeadline - linuxBootTimeUpperMs()) + 10);
        } else now = expectedDeadline;
        return Response.json({ error: 'synthetic not found' }, { status: 404 });
    }, { preconnect: () => {} }));
    const roots: string[] = [];
    try {
        for (const mode of ['shorten', 'no-extension', 'rollback']) {
            const shorten = mode === 'shorten';
            rollback = mode === 'rollback';
            const m = await prepareGuarded({ mode: 'pilot', run: newRunId(), accountSharedWithProduction: true,
                processing: { runDeadlineMs: 1000, deadlineMs: 50, pollIntervalMs: 50 } }, { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 });
            roots.push(m.evalRoot);
            m.liveApproved = true; // synthetic HOME and fake credential/network edges only
            now = Date.now();
            const absolute = now + (shorten ? 100 : 10000);
            expectedDeadline = now + (shorten ? 100 : 1000);
            boottimeDeadline = Math.floor(linuxBootTimeUpperMs()) + (rollback ? 500 : 10000);
            attempts.length = 0;
            // Freeze the wall-clock edge, then advance exactly to the expected
            // deadline when the first fake response arrives. No real wait/network.
            const time = spyOn(Date, 'now').mockImplementation(() => now);
            let result;
            try { result = await execute(m, { live: true, supervisionDeadlineAtMs: absolute, supervisionBoottimeDeadlineMs: boottimeDeadline }); }
            finally { time.mockRestore(); }
            const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
            expect(saved.runDeadlineAtMs).toBe(expectedDeadline);
            expect(attempts.length).toBe(1);
            expect(attempts.every(t => t < saved.runDeadlineAtMs)).toBe(true);
            expect(result.exitCode).toBe(1);
            expect(saved.retention.status).toBe('awaiting_reconciliation');
        }
    } finally {
        network.mockRestore(); key.mockRestore(); corpus.mockRestore();
        for (const root of roots) rmSync(root, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        rmSync(syntheticHome, { recursive: true, force: true });
    }
});

test('Linux supervisor and evaluator share the boot clock with conservative resolution', () => {
    const before = linuxBootTimeUpperMs();
    const result = spawnSync('python3', ['-I', '-B', '-c', 'import time; print(time.clock_gettime_ns(time.CLOCK_BOOTTIME) // 1000000)'], { encoding: 'utf8', timeout: 1000 });
    const after = linuxBootTimeUpperMs();
    expect(result.status).toBe(0);
    expect(Number(result.stdout)).toBeGreaterThanOrEqual(Math.floor(before) - 10);
    expect(Number(result.stdout)).toBeLessThanOrEqual(after);
});

test('launcher bytes participate in frozen execution provenance', () => {
    expect(harnessHashes()['supervise.py']).toBe(sha256(readFileSync(join(import.meta.dir, 'supervise.py'))));
});
