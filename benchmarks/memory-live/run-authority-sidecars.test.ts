// Adapted from Quality r7-recovery/sidecars.ts; never imports its autorun script.
import { test, expect } from 'bun:test';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { draftManifest, prepare, newRunId, type Manifest } from './manifest';
import { privateWrite, sha256 } from './security';
import { RunAuthority } from './run-authority';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
const scratch = testScratch();
const databases = ['run-lock.sqlite', 'run-spend.sqlite'];
const suffixes = ['-journal', '-wal', '-shm'];
const childPath = join(import.meta.dir, 'fixtures/run-authority-sidecar-child.ts');
function plan(initialize = false) {
    const run = newRunId(), input = { run, evalRoot: scratch.root(run), mode: 'pilot' as const, budget: 822, accountSharedWithProduction: true };
    const m = initialize ? draftManifest(input) : prepare(input);
    privateWrite(join(m.evalRoot, 'plan.json'), m);
    return m;
}
function child(m: Manifest, operation: string, database: string, suffix = '') {
    return spawnSync(process.execPath, [childPath, join(m.evalRoot, 'plan.json'), operation, database, suffix], { env: { PATH: process.env.PATH!, HOME: homedir() }, encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL' });
}
function unchanged(path: string) {
    const s = lstatSync(path);
    return { hash: sha256(readFileSync(path)), ino: s.ino, size: s.size, mode: s.mode, mtimeMs: s.mtimeMs };
}
for (const database of databases) for (const suffix of suffixes) {
    for (const kind of ['fifo', 'symlink', 'dangling-symlink', 'hardlink', 'directory', 'public-mode', 'readonly-mode']) {
        test(`${database}${suffix} rejects ${kind} before open without hanging or changing an external sentinel`, () => {
            const m = plan(), path = join(m.evalRoot, database + suffix);
            const sentinel = join(scratch.suite, m.run + '-external-synthetic-sentinel');
            privateWrite(sentinel, 'SYNTHETIC_ONLY_NEVER_REAL\n'.repeat(64));
            const before = unchanged(sentinel);
            if (kind === 'fifo') expect(spawnSync('mkfifo', ['-m', '600', path]).status).toBe(0);
            else if (kind === 'symlink' || kind === 'dangling-symlink') symlinkSync(kind === 'symlink' ? sentinel : sentinel + '-absent', path);
            else if (kind === 'hardlink') linkSync(sentinel, path);
            else if (kind === 'directory') mkdirSync(path, { mode: 0o600 });
            else { privateWrite(path, 'SYNTHETIC_SIDECAR'); chmodSync(path, kind === 'public-mode' ? 0o644 : 0o400); }
            const result = child(m, 'acquire', database, suffix);
            expect(result.error?.message ?? null).toBeNull();
            expect(result.signal).toBeNull(); expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout)).toEqual({ reason: 'run_authority_unsafe_file' });
            expect(unchanged(sentinel)).toEqual(before);
            expect(existsSync(sentinel + '-absent')).toBe(false);
        }, 10000);
    }
    test(`${database}${suffix} rejects synthetic foreign-owner metadata`, () => {
        const m = plan(), path = join(m.evalRoot, database + suffix);
        privateWrite(path, 'SYNTHETIC_SIDECAR');
        const result = child(m, 'foreign-owner', database, suffix);
        expect(result.error?.message ?? null).toBeNull(); expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ reason: 'run_authority_unsafe_file' });
    });
}
for (const database of databases) {
    test(`initialization also rejects ${database}-journal FIFO without hanging`, () => {
        const m = plan(true);
        expect(spawnSync('mkfifo', ['-m', '600', join(m.evalRoot, database + '-journal')]).status).toBe(0);
        const result = child(m, 'initialize', database);
        expect(result.error?.message ?? null).toBeNull(); expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ reason: 'run_authority_unsafe_file' });
    }, 10000);
    test(`${database} recovers a real private hot rollback journal and preserves committed reservations`, () => {
        const m = plan(), path = join(m.evalRoot, database), tag = Object.values(m.bindings)[0]!;
        const a = RunAuthority.acquire(m, 'cleanup');
        a.authorizeCleanup(syntheticConfirmation(m)); a.configureCleanup(.0004); a.reserve('/ns/' + tag, {}, true, tag);
        const committed = a.receipt(); a.close();
        const before = sha256(readFileSync(path));
        const result = child(m, 'crash-journal', database);
        expect(result.error?.message ?? null).toBeNull(); expect(result.signal).toBe('SIGKILL');
        expect(result.stdout).toBe('journal_ready\n');
        const journal = lstatSync(path + '-journal');
        expect(journal.isFile()).toBe(true); expect(journal.mode & 0o777).toBe(0o600);
        expect(journal.nlink).toBe(1); expect(journal.uid).toBe(process.getuid!()); expect(journal.size).toBeGreaterThan(512);
        expect(sha256(readFileSync(path))).not.toBe(before); // Actual dirty-page spill, not a dummy journal.
        const recovered = RunAuthority.acquire(m, 'cleanup');
        try {
            expect(recovered.receipt()).toEqual(committed);
            recovered.configureCleanup(.0004);
            recovered.reserve('/ns/' + tag, {}, true, tag);
            expect(recovered.receipt()).toMatchObject({ cleanupRequests: 2, cleanupUsedUsd: .0002 });
        } finally { recovered.close(); }
        expect(existsSync(path + '-journal')).toBe(false);
    }, 10000);
}
