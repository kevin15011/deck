import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync, readlinkSync } from 'node:fs';
import { testScratch } from './test-support';
import { newRunId, prepare } from './manifest';
import { execute } from './run';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { NativeReplay } from './capture-replay/native';
import { nativePositiveControl } from './capture-replay/positive-control';
import { makeProject } from './capture-replay/runtime';
import { privateWrite } from './security';
import { reportSummary } from './report';
import { scoreArtifact } from './case-artifacts';
import { dataset } from './dataset';
const scratch = testScratch();
test('pinned native routes retrieve seeded positive controls over IPC inside separate OS network namespaces', async () => {
    await Promise.all((['claude', 'codex', 'opencode'] as const).map(async route => {
        const run = newRunId(), root = scratch.root(run), project = makeProject(root, `n_${route}_1`, 'CONTROL');
        const t = new NamespaceTransport({ run, bindings: { [project.scope]: `deck_eval_${run}_n_${route}_1_control` }, budget: 100, wire: simulatedWire() });
        const replay = new NativeReplay(route, root, t, true);
        const result = await nativePositiveControl(replay, project, true, 1);
        expect({ route, status: result.status, reason: result.reason }).toEqual({ route, status: 'passed', reason: null });
        expect(result.captureAcknowledged).toBe(true);
        expect(result.retrieved).toBe(true);
        expect(replay.isolation.length).toBeGreaterThan(0);
        expect(replay.isolation.every(i => i.netNamespace !== readlinkSync('/proc/self/ns/net'))).toBe(true);
        const mapping = JSON.parse(readFileSync(join(root, 'opaque-identities.json'), 'utf8')).bindings;
        expect(Object.values(mapping).every(x => /^[a-f0-9-]{36}$/.test(String(x)))).toBe(true);
        replay.close();
    }));
}, 30000);
test('full baseline requires three repeats and cannot fall back to the old unguarded live path', async () => {
    const run = newRunId();
    expect(() => prepare({ run, evalRoot: scratch.root(run), mode: 'full', repeats: 1 })).toThrow('full_baseline_requires_at_least_three_repeats');
    const m = prepare({ run, evalRoot: scratch.root(run), mode: 'full', repeats: 3 });
    await expect(execute(m)).rejects.toThrow('full_baseline_processing_plan_not_supported');
    m.liveApproved = true;
    await expect(execute(m, { live: true })).rejects.toThrow('full_baseline_processing_plan_not_supported');
});
test('native IPC preserves JSON headers, counts settings/fan-out blocks and fences http2, child_process and dns', async () => {
    const run = newRunId(), root = scratch.root(run), project = makeProject(root, 'n_claude_1', 'A');
    const t = new NamespaceTransport({ run, bindings: { [project.scope]: `deck_eval_${run}_n_claude_1_a` }, budget: 10, wire: async () => Response.json({ profile: { static: ['safe fact'], dynamic: [] } }, { headers: { 'retry-after': '2', 'x-request-id': 'fixture-request' } }) });
    const replay = new NativeReplay('claude', root, t, true);
    privateWrite(join(replay.pin.root, 'eval-fence-probe.cjs'), String.raw `
const deny=[];for(const [name,f] of [['http2',()=>require('node:http2').connect('https://example.invalid')],['dns',()=>require('node:dns').lookup('example.invalid',()=>{})],['dns-promises',()=>require('node:dns').promises.lookup('example.invalid')],['child_process',()=>require('node:child_process').spawn('curl',['https://example.invalid'])]]){try{f();}catch{deny.push(name);}}
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const session=JSON.parse(input).session_id;const base=process.env.SUPERMEMORY_API_URL,headers={authorization:'Bearer '+process.env.SUPERMEMORY_API_KEY,'content-type':'application/json'},post=(path,method,body)=>fetch(base+path,{method,headers,body:JSON.stringify(body)});
try{await fetch('https://example.invalid/eval-updater')}catch{};const r=await post('/v4/profile','POST',{containerTag:process.env.SUPERMEMORY_REPO_TAG});const types=Object.fromEntries(r.headers);
const settings=await post('/v3/settings','PATCH',{shouldLLMFilter:true,filterPrompt:'synthetic'});const legacy=await post('/v4/profile','POST',{containerTag:'legacy-personal',q:'example'});console.log(JSON.stringify({session,deny,types,settings:settings.status,legacy:legacy.status}));})();
`);
    const r = await replay.hook('eval-fence-probe.cjs', { session_id: 'q999-old-decision' }, project.cwd, project.scope);
    expect(r.status).toBe('replayed');
    const output = JSON.parse(r.output);
    expect(output.session).toMatch(/^[a-f0-9-]{36}$/);
    expect(output.session).not.toContain('q999');
    expect(output.deny).toEqual(['http2', 'dns', 'dns-promises', 'child_process']);
    expect(output.types['content-type']).toContain('application/json');
    expect(output.types['retry-after']).toBe('2');
    expect(output.settings).toBe(403);
    expect(output.legacy).toBe(403);
    expect(t.blocked.filter(x => x.category === 'native_fence').length).toBe(5);
    expect(t.blocked.filter(x => x.category !== 'native_fence').map(x => x.category)).toEqual(['account_settings', 'legacy_or_inactive_scope']);
    const report = reportSummary([], [t]);
    expect(report.requests).toBe(8);
    expect(report.blockedRequests).toBe(7);
    expect(report.blockedByCategory.legacy_or_inactive_scope.counterfactualCost.profileQueryMeterUsd).toBe('unknown');
    const mapping = JSON.parse(readFileSync(join(root, 'opaque-identities.json'), 'utf8')).bindings;
    expect(Object.keys(mapping).some(k => k.includes('q999-old-decision'))).toBe(true);
    expect(Object.values(mapping).some(x => String(x).includes('q999') || String(x).includes('old-decision'))).toBe(false);
    replay.close();
}, 15000);
test('R and N use identical role-cap and @5 scores while native apply-fast injection stays a visible violation', () => {
    const q = dataset().questions.find(q => q.role === 'apply-fast')!, a: any = { injectedText: 'fact', injectedUnits: ['fact'], rawReturnedUnits: [], durationMs: 1, project: q.project_under_query, settledEligible: false };
    for (const track of ['R', 'N']) {
        const row = scoreArtifact(q, { ...a, track });
        expect(row.cap).toBe(0);
        expect(row.status).toBe('policy_skip');
        expect(row.rolePolicyViolation).toBe(true);
        expect(row.final.precisionAtK).toBeNull();
        expect(row.at5).toBeDefined();
    }
});
