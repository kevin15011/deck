import { test, expect, spyOn } from 'bun:test';
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from './run';
import { prepareGuarded } from './cost-guard';
import { newRunId } from './manifest';
import { simulatedWire } from './namespace-transport';
import { FAKE_SECRETS, sha256 } from './security';
import { testScratch } from './test-support';
const scratch = testScratch({ smallCorpus: true });
for (const status of [200, 503]) test(`first malformed scoped HTTP ${status} response is private, scrubbed and durable before gate validation`, async () => {
    const run = newRunId(), m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', budget: 5994, accountSharedWithProduction: true, processing: { schedule: 'adaptive-v1', requestTimeoutMs: 2000 } }, { ceilingUsd: .94, stopUsd: .89, cleanupReserveUsd: .05 });
    const fake = simulatedWire(), dir = join(m.evalRoot, 'processing-responses'); let beforeValidation = false, deletes = 0, statuses = 0;
    const marker = 'synthetic-status-shape', original = Response.prototype.json;
    const json = spyOn(Response.prototype, 'json').mockImplementation(async function(this: Response) {
        const parsed = await original.call(this);
        if (parsed?.diagnostic === marker) beforeValidation ||= existsSync(dir) && readdirSync(dir).length >= 1;
        return parsed;
    });
    try {
        await execute(m, { wire: async (u, i) => {
            if (i.method === 'DELETE') deletes++;
            if (u.pathname.includes('/document/')) {
                // The transport's fake bearer is synthetic, never a real credential.
                const body = JSON.stringify({ id: u.pathname.split('/').at(-1), diagnostic: marker, error: { code: 'synthetic_shape_error' }, system: { status: 'done' }, note: FAKE_SECRETS[0], home: '/home/synthetic-user/private', echo: 'NONFUNCTIONAL_OFFLINE_EGRESS' }).replace('NONFUNCTIONAL_OFFLINE_EGRESS', 'NONFUNCTIONAL_\\u004fFFLINE_EGRESS');
                return new Response(body, { status: statuses++ === 0 ? status : 200, headers: { 'content-type': 'application/json' } });
            }
            return fake(u, i);
        } });
    } finally { json.mockRestore(); }
    const saved = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8')), { events } = JSON.parse(readFileSync(join(m.evalRoot, 'events.json'), 'utf8'));
    expect(beforeValidation).toBe(true);
    const eventIndex = events.findIndex((e: any) => e.endpoint.includes('/document/')), event = events[eventIndex];
    expect(saved.processingResponseReceipts.length).toBeGreaterThanOrEqual(1); expect(event.processingResponse).toEqual(saved.processingResponseReceipts[0]);
    const ref = event.processingResponse, bytes = readFileSync(join(m.evalRoot, ref.artifact), 'utf8'), receipt = JSON.parse(bytes);
    expect(sha256(bytes)).toBe(ref.artifactSha256);
    expect(lstatSync(dir).mode & 0o777).toBe(0o700); expect(lstatSync(join(m.evalRoot, ref.artifact)).mode & 0o777).toBe(0o600);
    expect(receipt).toMatchObject({ schema: 'deck-processing-response-v1', run, eventIndex, endpoint: event.endpoint, tag: event.tag, phase: event.phase, httpStatus: status, responseHash: event.responseHash, requestHash: event.requestHash, bindingsHash: sha256(JSON.stringify(m.bindings)), bodyJsonParsed: true });
    expect(receipt.body).toMatchObject({ diagnostic: marker, system: { status: 'done' }, error: { code: 'synthetic_shape_error' } });
    expect(receipt.body.system.dreamingStatus).toBeUndefined();
    for (const secret of [...FAKE_SECRETS, 'NONFUNCTIONAL_OFFLINE_EGRESS', '/home/synthetic-user/private']) expect(bytes).not.toContain(secret);
    expect(receipt.body.echo).toBe('[EVAL_CREDENTIAL_REDACTED]');
    expect(saved.quality.validity).toBe('invalid'); expect(saved.processing.documents.some((d: any) => d.reason === 'malformed_or_unresolvable_document_status')).toBe(true);
    expect(saved.results[0].cases).toHaveLength(0); expect(saved.availability.cases).toHaveLength(0);
    expect(event.status).toBe(status); expect(event.error).toBeUndefined();
    expect(saved.durableReservations.evaluationRequests).toBe(events.length); expect(saved.costProgress.evaluationRequestsUsed).toBe(events.length);
    expect(saved.retention.status).toBe('awaiting_reconciliation'); expect(deletes).toBe(0);
}, 30000);
