import { isDocumentWrite } from '../request-policy';
// Executed only by isolated tests with a synthetic HOME, never a live entrypoint.
import { readFileSync } from 'node:fs';
import { cleanup } from '../cleanup';
import { execute } from '../run';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { simulatedWire } from '../namespace-transport';
import { smallCorpus } from './small-corpus';
if (process.argv[4] === 'small-corpus') smallCorpus();
const m = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const evaluation = process.argv[3] === 'evaluation', fake = simulatedWire();
let held = false, wireRequests = 0;
const wire = async (u: URL, i: RequestInit) => {
    wireRequests++;
    if (!held && (!evaluation || isDocumentWrite(u.pathname))) {
        // A separate connection must see committed spend before the wire is entered.
        const db = new Database(join(m.evalRoot, 'run-spend.sqlite'), { readonly: true });
        try {
            const state = JSON.parse((db.query('SELECT value FROM state').get() as { value: string }).value);
            assert.equal(state[evaluation ? 'evaluationRequests' : 'cleanupRequests'], wireRequests);
            assert.equal(state.evaluationRequests + state.cleanupRequests, wireRequests);
            if (evaluation) {
                const effect = JSON.parse((db.query('SELECT value FROM effects ORDER BY seq DESC LIMIT 1').get() as { value: string }).value);
                assert.equal(state.evaluationStarted, true);
                assert.equal(state.evaluationFinished, false);
                assert.equal(i.method, 'POST');
                assert.equal(effect.write, true); assert.equal(effect.cleanup, false);
                assert.ok(effect.tokens > 0); assert.ok(effect.micros > 0);
                assert.ok(state.tokens > 0);
            }
        } finally { db.close(); }
        held = true; console.log(JSON.stringify({ event: 'effect_reserved', wireRequests })); await Bun.stdin.stream().getReader().read();
    }
    return evaluation ? fake(u, i) : Response.json({}, { status: i.method === 'DELETE' ? 503 : 200 });
};
if (evaluation) await execute(m, { wire });
else await cleanup(m, { estimatedCleanupCeilingUsd: .0004, wire });
