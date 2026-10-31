import { beforeAll, afterAll, expect, spyOn, test } from 'bun:test';
import { manifestSources } from './manifest';
import { smallCorpus } from './fixtures/small-corpus';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { secureDir } from './security';
import * as security from './security';
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
