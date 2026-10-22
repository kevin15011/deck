import { afterAll } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { secureDir } from './security';
export function testScratch() { const suite = secureDir(join(homedir(), '.deck-eval/test-scratch', 'suite_' + randomBytes(8).toString('hex'))); afterAll(() => rmSync(suite, { recursive: true, force: true })); return { suite, root: (run: string) => join(suite, run) }; }

import type { Manifest } from './manifest';
import { authorizeCleanup } from './cleanup';
import { sha256 } from './security';
/** Synthetic tests only. Never manufactures confirmation for a real run. */
export function syntheticConfirmation(m: Manifest) {
    if (!m.evalRoot.includes('/test-scratch/')) throw new Error('synthetic_confirmation_requires_test_scratch');
    return { schema: 'deck-cleanup-confirmation-v1', run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), confirmedAt: new Date().toISOString(), consoleCostConfirmed: true, costSummary: 'SYNTHETIC zero-provider test', userConfirmationReference: 'SYNTHETIC test authorization only', authorizeCleanup: true, namespaceCosts: Object.values(m.bindings).map(namespace => ({ namespace, confirmed: true, costSummary: 'SYNTHETIC test meter' })) };
}
export function confirmSyntheticCleanup(m: Manifest) { authorizeCleanup(m, syntheticConfirmation(m)); }
