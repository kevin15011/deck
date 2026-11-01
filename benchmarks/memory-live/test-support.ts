import { beforeAll, afterAll, expect, spyOn, test } from 'bun:test';
import { manifestSources } from './manifest';
import { smallCorpus } from './fixtures/small-corpus';
import { homedir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rmSync, readFileSync } from 'node:fs';
import { secureDir } from './security';
import * as security from './security';
import { Database } from 'bun:sqlite';
import { runAuthorityStorage } from './run-authority';
import { reportArtifacts } from './report-artifacts';
import type { ExecuteOptions } from './run';
// Read the real immutable checkout once per file, validate it again at teardown.
// No cache is used by evaluator entrypoints or subprocess durability probes.
const readSourceHashes = manifestSources.readHashes;
const writeArtifact = security.privateWrite;
export function testScratch(options: { smallCorpus?: boolean | number } = {}) {
    const suite = secureDir(join(homedir(), '.deck-eval/test-scratch', 'suite_' + randomBytes(8).toString('hex')));
    let sourceSnapshot: Record<string, string>;
    let sourceReader: ReturnType<typeof spyOn>;
    let artifactWriter: ReturnType<typeof spyOn>;
    let corpus: ReturnType<typeof smallCorpus> | undefined;
    beforeAll(() => {
        // Formatting is not an artifact oracle. Keep every real write, permission
        // check and serialized value; avoid repeated indentation of large reports.
        artifactWriter = spyOn(security, 'privateWrite').mockImplementation((path, value) => writeArtifact(path, typeof value === 'string' ? value : JSON.stringify(value) + '\n'));
        sourceSnapshot = readSourceHashes();
        sourceReader = spyOn(manifestSources, 'readHashes').mockImplementation(() => ({ ...sourceSnapshot }));
        if (options.smallCorpus) corpus = smallCorpus(typeof options.smallCorpus === 'number' ? options.smallCorpus : 1);
    });
    afterAll(() => {
        sourceReader?.mockRestore(); artifactWriter?.mockRestore(); corpus?.mockRestore();
        try { expect(readSourceHashes()).toEqual(sourceSnapshot); }
        finally { rmSync(suite, { recursive: true, force: true }); }
    });
    return { suite, root: (run: string) => join(suite, run) };
}

import type { Manifest } from './manifest';
import { authorizeCleanup } from './cleanup';
import { sha256 } from './security';
/** Synthetic tests only. Never manufactures confirmation for a real run. */
export function syntheticConfirmation(m: Manifest) {
    if (!m.evalRoot.includes('/test-scratch/')) throw new Error('synthetic_confirmation_requires_test_scratch');
    return { schema: 'deck-cleanup-confirmation-v1', run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), confirmedAt: new Date().toISOString(), consoleCostConfirmed: true, costSummary: 'SYNTHETIC zero-provider test', userConfirmationReference: 'SYNTHETIC test authorization only', authorizeCleanup: true, namespaceCosts: Object.values(m.bindings).map(namespace => ({ namespace, confirmed: true, costSummary: 'SYNTHETIC test meter' })) };
}
export function confirmSyntheticCleanup(m: Manifest) { authorizeCleanup(m, syntheticConfirmation(m)); }

/** Boundary checks still execute the real pipeline with all four namespaces.
 * Full-corpus quality/forecast tests use test() directly. Restore even on failure. */
export function boundaryTest(name: string, check: () => void | Promise<void>, timeout?: number) {
    test(name, async () => {
        const corpus = smallCorpus();
        try { await check(); }
        finally { corpus.mockRestore(); }
    }, timeout);
}

/** In-process composition contracts only. SQL, reservation policy and disk report
 * files remain real; database persistence is a deterministic connection snapshot.
 * This does NOT prove disk durability, locking or process recovery. Those tests
 * must use test()/boundaryTest() and the default storage, including child probes.
 */
export function ledgerContractTest(name: string, check: () => void | Promise<void>, timeout?: number) {
    test(name, async () => {
        const snapshots = new Map<string, Uint8Array>();
        const connections = new Set<Database>();
        const activePaths = new Set<string>();
        const opener = spyOn(runAuthorityStorage, 'open').mockImplementation(path => {
            if (!path.includes('/test-scratch/')) throw new Error('volatile_ledger_requires_test_scratch');
            // A test needing simultaneous connections must use the real lock.
            if (activePaths.has(path)) throw new Error('volatile_ledger_cannot_prove_concurrent_exclusion');
            const bytes = snapshots.get(path);
            const db = bytes ? Database.deserialize(bytes) : new Database(':memory:');
            connections.add(db);
            activePaths.add(path);
            const close = db.close.bind(db);
            db.close = () => {
                if (!connections.delete(db)) return;
                // The exclusive lock transaction has no writes. Its lifetime ends
                // with this connection, exactly as the caller's close requires.
                if (db.inTransaction) db.exec('ROLLBACK');
                snapshots.set(path, db.serialize());
                close();
                activePaths.delete(path);
            };
            return db;
        });
        try { await check(); }
        finally {
            opener.mockRestore();
            for (const db of connections) db.close();
            snapshots.clear();
        }
    }, timeout);
}

/** Same pre-existing boundary corpus, with only the ledger storage effect replaced. */
export function ledgerBoundaryTest(name: string, check: () => void | Promise<void>, timeout?: number) {
    ledgerContractTest(name, async () => {
        const corpus = smallCorpus();
        try { await check(); }
        finally { corpus.mockRestore(); }
    }, timeout);
}

let activeReports: { bytes: Map<string, string> } | undefined;
const mutableReports = new Set(['ownership.json', 'cost-progress.json', 'events.json', 'results.json']);
/** Read an intermediate composition snapshot, or the real file outside the effect.
 * A missing snapshot is a missing file, never an empty fabricated report. */
export function readReportingArtifact(path: string): string {
    if (activeReports?.bytes.has(path)) return activeReports.bytes.get(path)!;
    return readFileSync(path, 'utf8');
}

/** Test-only report overwrite effect, deliberately separate from ledger storage.
 * Every write serializes now (including JSON failure), so later object mutation
 * cannot change an observed snapshot. No writes are deferred or coalesced in the
 * logical store. Final snapshots are exported through the real secure writer for
 * ordinary file readers/rescore, even if the composition throws. This cannot
 * prove intermediate disk visibility, filesystem safety, or crash durability.
 */
export async function withReportingArtifacts<T>(root: string, check: () => T | Promise<T>): Promise<T> {
    const rel = relative(join(homedir(), '.deck-eval/test-scratch'), root);
    if (resolve(root) !== root || !/^[a-z0-9_-]+\/\d{8}_[a-f0-9]{6,16}(?:_[1-5])?$/.test(rel)) throw new Error('report_effect_requires_test_scratch');
    if (activeReports) throw new Error('report_effect_cannot_prove_concurrent_visibility');
    const bytes = new Map<string, string>();
    activeReports = { bytes };
    const writer = spyOn(reportArtifacts, 'write').mockImplementation((path, value) => {
        if (resolve(path) !== path || !mutableReports.has(relative(root, path))) throw new Error('report_effect_path_outside_run');
        // privateWrite truncates before serialization. Preserve that failure state.
        bytes.set(path, '');
        bytes.set(path, typeof value === 'string' ? value : JSON.stringify(value) + '\n');
    });
    try { return await check(); }
    finally {
        writer.mockRestore(); activeReports = undefined;
        try { for (const [path, value] of bytes) reportArtifacts.write(path, value); }
        finally { bytes.clear(); }
    }
}

/** Explicit opt-in for offline composition tests only. Live validation calls use
 * execute directly; production has no option/env/manifest switch for this effect. */
export async function executeReportingContract(m: Manifest, options: ExecuteOptions = {}) {
    if (options.live) throw new Error('report_effect_is_offline_only');
    const { execute } = await import('./run');
    return withReportingArtifacts(m.evalRoot, () => execute(m, options));
}
