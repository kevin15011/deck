// Adapted from Quality r7-recovery/sidecars.ts; never imports its autorun script.
import { test, expect, beforeAll, afterEach, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
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
// Rejection cases never change the committed authority. Reuse that real disk
// baseline, removing only each test's hostile sidecar before the next case.
let rejectionPlan: Manifest;
let rejectionBytes: string[];
const hostilePaths: string[] = [];
beforeAll(() => {
    rejectionPlan = plan();
    rejectionBytes = databases.map(name => sha256(readFileSync(join(rejectionPlan.evalRoot, name))));
});
afterEach(() => {
    for (const path of hostilePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    expect(databases.map(name => sha256(readFileSync(join(rejectionPlan.evalRoot, name))))).toEqual(rejectionBytes);
});
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
            const m = rejectionPlan, path = join(m.evalRoot, database + suffix);
            hostilePaths.push(path);
            const sentinel = join(scratch.suite, m.run + '-external-synthetic-sentinel');
            privateWrite(sentinel, 'SYNTHETIC_ONLY_NEVER_REAL\n'.repeat(64));
            const before = unchanged(sentinel);
            if (kind === 'fifo') expect(spawnSync('mkfifo', ['-m', '600', path]).status).toBe(0);
            else if (kind === 'symlink' || kind === 'dangling-symlink') symlinkSync(kind === 'symlink' ? sentinel : sentinel + '-absent', path);
            else if (kind === 'hardlink') linkSync(sentinel, path);
            else if (kind === 'directory') mkdirSync(path, { mode: 0o600 });
            else { privateWrite(path, 'SYNTHETIC_SIDECAR'); chmodSync(path, kind === 'public-mode' ? 0o644 : 0o400); }
            if (kind === 'fifo') {
                // Keep a killable process for the potentially blocking open boundary.
                const result = child(m, 'acquire', database, suffix);
                expect(result.error?.message ?? null).toBeNull();
                expect(result.signal).toBeNull(); expect(result.status).toBe(0);
                expect(JSON.parse(result.stdout)).toEqual({ reason: 'run_authority_unsafe_file' });
            } else {
                // These real filesystem fixtures cannot block; exercise the same
                // authority rejection without starting a fresh runtime for each one.
                expect(() => { const authority = RunAuthority.acquire(m, 'cleanup'); authority.close(); }).toThrow('run_authority_unsafe_file');
            }
            expect(unchanged(sentinel)).toEqual(before);
            expect(existsSync(sentinel + '-absent')).toBe(false);
        }, 10000);
    }
    test(`${database}${suffix} rejects synthetic foreign-owner metadata`, () => {
        const m = rejectionPlan, path = join(m.evalRoot, database + suffix);
        hostilePaths.push(path);
        privateWrite(path, 'SYNTHETIC_SIDECAR');
        const before = unchanged(path), stat = fs.lstatSync;
        // Owner metadata is already synthetic in the child probe. This regular
        // file cannot block, so exercise the same rejection in this process.
        const foreignOwner = spyOn(fs, 'lstatSync').mockImplementation(((target: any, ...rest: any[]) => {
            const value = (stat as any)(target, ...rest);
            if (String(target) === path) value.uid = process.getuid!() + 1;
            return value;
        }) as any);
        try { expect(() => { const a = RunAuthority.acquire(m, 'cleanup'); a.close(); }).toThrow('run_authority_unsafe_file'); }
        finally { foreignOwner.mockRestore(); }
        expect(unchanged(path)).toEqual(before);
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
