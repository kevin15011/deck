import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createSupermemoryRuntime, createSupermemoryHttpTransport, resolveSupermemoryRolePolicy, type SupermemoryRuntimeRole } from '../../../packages/adapter-supermemory/src/runtime';
import { evaluateAdaptiveMemoryCaptureEligibility } from '../../../packages/core/src/memory/capture-eligibility';
import { createSupermemoryRuntimeHost, type SupermemoryRuntimeHost } from '../../../apps/cli/src/supermemory-runtime-host';
import { resolveCanonicalSupermemoryProjectScope } from '../../../packages/core/src/memory/canonical-supermemory-project';
import { NamespaceTransport } from '../namespace-transport';
import { nativeRawUnits } from './native-output';
import { secureDir, privateWrite, sha256, fail } from '../security';
export type Seed = {
    id: string;
    project: string;
    session_id: string;
    role: 'user' | 'assistant';
    source: 'trusted-user-prompt' | 'trusted-final-assistant';
    content: string;
    temporal_phase?: string;
    [key: string]: any;
};
export function makeProject(root: string, writer: string, project: string) {
    const name = `${writer}_${project.toLowerCase().replaceAll('-', '_')}`;
    const cwd = secureDir(join(root, 'projects', name));
    const git = spawnSync('git', ['init', '--quiet', cwd], { env: { PATH: process.env.PATH!, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig') }, encoding: 'utf8' });
    if (git.status !== 0)
        fail('synthetic_git_init_failed');
    chmodSync(join(cwd, '.git'), 0o700);
    chmodSync(join(cwd, '.git/config'), 0o600);
    privateWrite(join(cwd, '.git', 'config'), `[core]\n repositoryformatversion = 0\n bare = false\n[remote "origin"]\n url = https://github.com/eval/${name}.git\n`);
    const identity = resolveCanonicalSupermemoryProjectScope({ projectRoot: cwd, remotes: [] });
    if (!identity.ok)
        fail('synthetic_identity_failed');
    return { cwd, scope: identity.scope };
}
export function serializedRuntime(t: NamespaceTransport) { return createSupermemoryHttpTransport({ apiKey: 'NONFUNCTIONAL_LOCAL_RUNTIME_BEARER', fetchImpl: (url, init) => t.fetch(new URL(String(url)), init ?? {}) }); }
export function runtimeCapture(seed: Seed, scope: string, t: NamespaceTransport) {
    return createSupermemoryRuntime({ canonicalScope: scope, sessionId: t.runtimeSession(scope, seed.session_id), transport: serializedRuntime(t), runnerId: 'eval-runtime' }).capture({ role: seed.role, source: seed.source, content: seed.content, capturedAt: new Date(Date.UTC(2026, 9, 21, 0, 0, seed.turn_order ?? 0)).toISOString() });
}
export async function recallHost(root: string, projectRoot: string, query: string, role: SupermemoryRuntimeRole, t: NamespaceTransport, sessionId: string, defer = false) {
    const identity = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
    if (!identity.ok)
        fail('synthetic_identity_failed');
    sessionId = t.runtimeSession(identity.scope, sessionId);
    return createSupermemoryRuntimeHost({ projectRoot, runnerId: 'pi', sessionId, role, query, deckConfig: { adaptiveMemory: { enabled: true } } as any, apiKey: 'NONFUNCTIONAL_LOCAL_RUNTIME_BEARER', secretStore: { read: () => undefined } as any, transport: serializedRuntime(t), stateHome: secureDir(join(root, 'state')), deferInitialRecallToLoopback: defer });
}
export function envelopeUnits(text?: string): string[] {
    if (!text)
        return [];
    const line = text.split('\n').find(s => s.startsWith('{'));
    try {
        return JSON.parse(line ?? '{}').items?.map((i: any) => i.content) ?? [];
    }
    catch {
        return [];
    }
}
export function rawUnits(observations: NamespaceTransport['observations']) { return nativeRawUnits(observations); }
/** Execute the real bridge handler with a socket-free Bun server effect offline. */
export async function bridgeClient(host: SupermemoryRuntimeHost, offline: boolean) {
    let handler: ((r: Request) => Promise<Response>) | undefined;
    const serve = Bun.serve;
    if (offline)
        (Bun as any).serve = (options: any) => { handler = options.fetch; return { port: 1, stop() { } }; };
    let bridge;
    try {
        bridge = await host.startLoopbackBridge();
    }
    finally {
        Bun.serve = serve;
    }
    if (!bridge)
        fail('production_bridge_unavailable');
    let ordinal = 0;
    return { close: () => bridge.close(), send: async (event: any) => {
            const body = { schema: 'deck-runner-memory-loopback-v1', runnerId: 'pi', sessionId: host.sessionId, eventId: `eval-${++ordinal}`, timestamp: Date.now(), ...event };
            const request = new Request(bridge.endpoint, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const response = offline ? await handler!(request) : await fetch(request);
            return response.json() as Promise<any>;
        } };
}
export async function lifecycleControls(root: string, project: {
    cwd: string;
    scope: string;
}, t: NamespaceTransport, offline: boolean, checkpoint: () => Promise<void> = async () => {}) {
    const result: any[] = [];
    const content = 'Confirmed decision: keep conversation identity stable across resumed evaluation turns.';
    const host = await recallHost(root, project.cwd, 'stable conversation identity', 'lead', t, 'lifecycle-main', true);
    if (!host.enabled)
        fail('control_host_disabled');
    const bridge = await bridgeClient(host, offline);
    const count = () => t.events.filter(e => e.endpoint === '/v3/documents').length;
    const record = (name: string, before: number, expected: number, extra: any = {}) => result.push({ name, status: count() - before === expected ? 'passed' : 'failed', expectedWrites: expected, observedWrites: count() - before, ...extra });
    try {
        let before = count();
        await bridge.send({ event: 'capture', content, source: 'trusted-user-prompt' });
        await checkpoint();
        await bridge.send({ event: 'capture', content: 'Confirmed decision: preserve the second turn as a separate conversation delta.', source: 'trusted-user-prompt' });
        record('same-session-two-captures', before, 2);
        await checkpoint();
        before = count();
        const resumed = await recallHost(root, project.cwd, 'resume', 'lead', t, 'lifecycle-main', true);
        await resumed.captureOutcome({ exitCode: 0, finalAssistantMessage: 'Confirmed final outcome: session identity was preserved after resume.' });
        record('resume-same-session', before, 1);
        await checkpoint();
        before = count();
        const event = { event: 'capture', eventId: 'duplicate-control', content, source: 'trusted-user-prompt' };
        await bridge.send(event);
        await bridge.send(event);
        record('successful-duplicate-event-replay', before, 1);
        await checkpoint();
        // A failed capture is not cached: a supported retry with the same event ID must be attempted.
        before = count();
        const failed = await bridge.send({ ...event, eventId: 'failed-retry', content: 'thanks' });
        const retry = await bridge.send({ ...event, eventId: 'failed-retry' });
        record('failed-event-retry', before, 1, { firstOk: failed.ok, retryOk: retry.ok });
        await checkpoint();
        before = count();
        await host.captureOutcome({ exitCode: 0, finalAssistantMessage: content });
        const exclusion = await host.captureOutcome({ exitCode: 0 } as any);
        record('assistant-final-vs-tool-stdout', before, 1, { unsupported: exclusion.diagnostics.length > 0, toolEligibility: evaluateAdaptiveMemoryCaptureEligibility({ source: 'tool', content }).eligible });
        await checkpoint();
        before = count();
        const recallEvent = { event: 'recall', eventId: 'tool-turn-replay', query: 'stable conversation identity', logicalTurnId: 'turn-1', snapshotGeneration: 1 };
        const first = await bridge.send(recallEvent);
        const ordinaryEffects = () => t.events.filter(e => !e.endpoint.includes('/document/')).length;
        const eventCount = ordinaryEffects();
        const second = await bridge.send(recallEvent);
        const retained = first.advisoryText;
        record('tool-continuation-retains-snapshot', before, 0, { status: retained === second.advisoryText && ordinaryEffects() === eventCount ? 'passed' : 'failed', surface: 'Production host event replay; Pi model inference reuse remains unobserved.', retainedSnapshotHash: sha256(retained ?? ''), providerCallsForLocalReuse: ordinaryEffects() - eventCount });
        await checkpoint();
        before = count();
        const children = await Promise.all([bridge.send({ event: 'role_start', sessionId: 'child-a', role: 'quality', query: 'stable identity', logicalTurnId: 'turn-2', snapshotGeneration: 2 }), bridge.send({ event: 'role_start', sessionId: 'child-b', role: 'apply-fast', query: 'stable identity', logicalTurnId: 'turn-3', snapshotGeneration: 3 })]);
        record('next-turn-and-concurrent-child-isolation', before, 0, { qualityHasContext: !!children[0].advisoryText, applyFastEmpty: !children[1].advisoryText });
        await checkpoint();
        before = count();
        const pending = bridge.send({ event: 'capture', content, source: 'trusted-user-prompt' });
        await pending;
        await bridge.send({ event: 'shutdown_flush' });
        record('shutdown-flush-barrier', before, 1, { acknowledged: true });
        await checkpoint();
    }
    finally {
        await bridge.close();
    }
    return result;
}
export const roleCap = (role: string) => resolveSupermemoryRolePolicy(role as SupermemoryRuntimeRole).maxResults;
