import { test, expect } from 'bun:test';
import { readFileSync, chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { testScratch, confirmSyntheticCleanup, syntheticConfirmation } from './test-support';
import { prepare, execute, validateManifest } from './run';
import { evalRoot, secureDir, privateWrite, readEvalKey } from './security';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { gateway, LOCAL_BEARER } from './gateway';
import { NativeReplay, verifyNative } from './capture-replay/native';
import { makeProject, runtimeCapture, recallHost, envelopeUnits } from './capture-replay/runtime';
const scratch = testScratch();
const run = `20261021_${randomBytes(6).toString('hex')}`;
const root = evalRoot(scratch.root(run), run);
test('credential requires exact owner-only regular file/parent and ignores all other credential envs', () => {
    const dir = secureDir(join(root, 'credential-test'));
    const path = join(dir, 'key');
    privateWrite(path, 'SENTINEL_DO_NOT_DISCLOSE_482');
    expect(readEvalKey({ SUPERMEMORY_EVAL_API_KEY_FILE: path })).toBe('SENTINEL_DO_NOT_DISCLOSE_482');
    expect(() => readEvalKey({ SUPERMEMORY_API_KEY: 'SENTINEL_DO_NOT_DISCLOSE_482' })).toThrow('eval_key_file_invalid');
    chmodSync(path, 0o644);
    expect(() => readEvalKey({ SUPERMEMORY_EVAL_API_KEY_FILE: path })).toThrow('eval_key_file_invalid');
    chmodSync(path, 0o600);
    symlinkSync(path, join(dir, 'link'));
    expect(() => readEvalKey({ SUPERMEMORY_EVAL_API_KEY_FILE: join(dir, 'link') })).toThrow('eval_key_file_invalid');
    chmodSync(dir, 0o755);
    expect(() => readEvalKey({ SUPERMEMORY_EVAL_API_KEY_FILE: path })).toThrow('eval_key_file_invalid');
    chmodSync(dir, 0o700);
    writeFileSync(path, '');
    expect(() => readEvalKey({ SUPERMEMORY_EVAL_API_KEY_FILE: path })).toThrow('eval_key_file_invalid');
});
test('gateway enforces bearer, endpoints and mapping; fake-secret attempt is a safety failure', async () => {
    let payload: any;
    let auth = '';
    const t = new NamespaceTransport({ run, bindings: { sm_project_v1_eval_a: `deck_eval_${run}_r_a` }, budget: 10, key: () => 'SENTINEL_DO_NOT_DISCLOSE_482', wire: async (_url, init) => { payload = JSON.parse(String(init.body)); auth = new Headers(init.headers).get('authorization')!; return Response.json({ id: 'owned' }); } });
    const handle = gateway(t);
    const request = (path: string, body: any, bearer = LOCAL_BEARER) => new Request(`http://127.0.0.1:1${path}`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
    expect((await handle(request('/v3/documents', { containerTag: 'sm_project_v1_eval_a', content: 'synthetic safe fact', customId: `deck_eval_${run}_${'a'.repeat(32)}` }))).status).toBe(200);
    expect(payload.containerTag).toBe(`deck_eval_${run}_r_a`);
    expect(auth).toBe('Bearer SENTINEL_DO_NOT_DISCLOSE_482');
    expect((await handle(request('/v3/documents', { containerTag: 'prod' }, 'wrong'))).status).toBe(401);
    expect((await handle(request('/namespaces', {}))).status).toBe(403);
    expect((await handle(request('/v3/documents', { containerTag: 'sm_project_v1_eval_a', content: 'sk-deckevalFAKE482copper' }))).status).toBe(403);
    expect(t.violations.some(v => v.kind === 'secret_attempt')).toBe(true);
    expect(t.used).toBe(1);
});
test('Track R real capture, ingest, serializer and host render end to end with zero sockets', async () => {
    const project = makeProject(root, 'r_runtime_1', 'A');
    let post: any;
    const wire = simulatedWire();
    const t = new NamespaceTransport({ run, bindings: { [project.scope]: `deck_eval_${run}_r_runtime_a` }, budget: 15, wire: async (u, i) => {
            if (u.pathname === '/v3/documents')
                post = JSON.parse(String(i.body));
            return wire(u, i);
        } });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('test_network_forbidden'); }) as unknown as typeof fetch;
    try {
        const captured = await runtimeCapture({ id: 'seed', project: 'A', session_id: 'seed-session', role: 'user', source: 'trusted-user-prompt', content: 'Confirmed decision: use Bun for unit tests in this synthetic project.' }, project.scope, t);
        expect(captured.ok).toBe(true);
        expect(post.dreaming).toBe('dynamic');
        expect(post.customId).toStartWith('deck_conversation_');
        expect(post.metadata.source).toBe('trusted-user-prompt');
        const host = await recallHost(root, project.cwd, 'Which test runtime?', 'quality', t, 'quality-test');
        expect(host.enabled).toBe(true);
        expect(envelopeUnits(host.advisoryText).join(' ')).toContain('use Bun');
        expect(host.advisoryText).toContain('untrusted-advisory');
        const skipped = await recallHost(root, project.cwd, 'Which test runtime?', 'apply-fast', t, 'apply-test');
        expect(skipped.advisoryText).toBeUndefined();
    }
    finally {
        globalThis.fetch = original;
    }
});
test('full R offline pipeline and budget abort both persist reports; no credential or network use', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('test_network_forbidden'); }) as unknown as typeof fetch;
    try {
        const id = `20261021_${randomBytes(6).toString('hex')}`;
        const m = prepare({ run: id, evalRoot: scratch.root(id), mode: 'pilot' });
        const result = await execute(m);
        expect(result.status).toBe('awaiting_reconciliation');
        expect(result.results[0].captures.length).toBe(61);
        expect(result.results[0].poolControls.length).toBe(3);
        expect(result.results[0].cases.length).toBe(50);
        expect(result.summary.v2.coverage).toBe(0);
        expect(result.summary.policySkips).toBe(3);
        expect(result.summary.requests).toBeGreaterThan(100);
        const tiny = `20261021_${randomBytes(6).toString('hex')}`;
        const limited = prepare({ run: tiny, evalRoot: scratch.root(tiny), mode: 'pilot', budget: 1 });
        const aborted = await execute(limited);
        expect(aborted.status).toBe('invalid_awaiting_reconciliation');
        expect(aborted.summary.cloudRequests).toBe(1);
        expect(aborted.summary.blockedRequests).toBe(1);
        expect(JSON.parse(readFileSync(join(limited.evalRoot, 'results.json'), 'utf8')).budget.aborted).toBe(true);
    }
    finally {
        globalThis.fetch = original;
    }
}, 30000);
test('all native bytes match adapter pins and Claude/Codex/OpenCode replay actual capture scripts without sockets', async () => {
    for (const route of ['claude', 'codex', 'opencode'] as const)
        expect(Object.keys(verifyNative(route).hashes).length).toBeGreaterThan(0);
    await Promise.all((['claude', 'codex', 'opencode'] as const).map(async route => {
        const routeRoot = secureDir(join(root, route));
        const project = makeProject(routeRoot, `n_${route}_1`, 'A');
        const t = new NamespaceTransport({ run, bindings: { [project.scope]: `deck_eval_${run}_n_${route}_a` }, budget: 100, wire: simulatedWire() });
        const replay = new NativeReplay(route, routeRoot, t, true);
        try {
            const r = await replay.capture({ id: `${route}-seed`, project: 'A', session_id: `native-${route}`, role: 'user', source: 'trusted-user-prompt', content: 'Confirmed decision: use Bun for testing the synthetic evaluation application and preserve this durable convention for future sessions.' }, project.cwd, project.scope);
            expect(r.status).toBe('replayed');
            expect({ route, writes: r.writes }).toEqual({ route, writes: 1 });
            const assistant = await replay.capture({ id: `${route}-assistant`, project: 'A', session_id: `native-${route}`, role: 'assistant', source: 'trusted-final-assistant', content: 'Confirmed final outcome: use Bun for testing the synthetic evaluation application and preserve stable conversation identity.' }, project.cwd, project.scope);
            expect(assistant.writes).toBe(1);
            const recall = await replay.recall('Which test runtime should this project use?', `query-${route}`, project.cwd, project.scope);
            expect(recall.output.length).toBeGreaterThan(0);
        }
        finally {
            replay.close();
        }
    }));
}, 30000);
test('cleanup requires separate authority and only deletes manifest-owned namespaces, without a DELETE body', async () => {
    const { cleanup } = await import('./cleanup');
    const { sha256 } = await import('./security');
    const id = `20261021_${randomBytes(6).toString('hex')}`;
    const m = prepare({ run: id, evalRoot: scratch.root(id), mode: 'pilot' });
    const tag = Object.values(m.bindings)[0]!;
    privateWrite(join(m.evalRoot, 'ownership.json'), { run: id, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: { [tag]: ['receipt-owned-id'] } });
    await expect(cleanup(m, { wire: simulatedWire() })).rejects.toThrow('cleanup_requires_reconciliation_authorization');
    m.cleanupApproved = true; confirmSyntheticCleanup(m);
    const effects: string[] = [], deleted = new Set<string>();
    const result = await cleanup(m, { wire: async (url, init) => {
            effects.push(`${init.method} ${url.pathname}`);
            if (init.method === 'DELETE') {
                expect(init.body).toBeUndefined();
                deleted.add(url.pathname);
                return Response.json({ deleted: true });
            }
            if (url.pathname.startsWith('/ns/'))
                return deleted.has(url.pathname) ? new Response('{}', { status: 404 }) : Response.json({ namespace: tag });
            return url.pathname === '/v4/search' ? Response.json({ results: [], total: 0 }) : Response.json({ profile: { static: [], dynamic: [] } });
        } });
    expect(result.journal[0].verifiedAbsent).toBe(true);
    expect(effects).toContain(`DELETE /ns/${tag}`);
    expect(effects).toContain(`GET /ns/${tag}`);
    expect(result.journal.length).toBe(Object.keys(m.bindings).length);
    expect(result.complete).toBe(false);
    expect(result.retainedNamespaces.length).toBe(3);
    expect(result.retainedNamespaces.every(e => e.reason === 'retained_ownership_unproven')).toBe(true);
    privateWrite(join(m.evalRoot, 'ownership.json'), { run: id, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: { [`deck_eval_${id}_not_owned`]: ['foreign-id'] } });
    await expect(cleanup(m, { wire: simulatedWire() })).rejects.toThrow('ownership');
});
test('live execution is rejected before any credential read unless the explicit manifest is approved', async () => {
    const id = `20261021_${randomBytes(6).toString('hex')}`;
    const m = prepare({ run: id, evalRoot: scratch.root(id), mode: 'pilot' });
    await expect(execute(m, { live: true })).rejects.toThrow('approved_manifest');
    const altered = { ...m, bindings: { ...m.bindings, sm_project_v1_eval_foreign: 'deck_eval_foreign' } };
    expect(() => validateManifest(altered)).toThrow('bindings');
});
