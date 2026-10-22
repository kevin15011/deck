import type { NativeReplay } from './native';
import { runtimeCapture, type Seed } from './runtime';
import type { NamespaceTransport } from '../namespace-transport';
export const skipProbes = [
    ['trivial', 'thanks'],
    ['diff', 'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-const x=1\n+const x=2'],
    ['source', 'import { value } from "synthetic";\nexport function example() {\n const value = 1;\n return value;\n}'],
    ['log', 'FAIL synthetic test\nExpected: true\nReceived: false\n1 failed'],
    ['artifact', 'OFFICIAL CONTEXT\nOpenSpec\n## ADDED Requirements\nThe synthetic implementation must use Bun.'],
] as const;
export async function runtimeSkipProbes(scope: string, t: NamespaceTransport) {
    const results = [];
    for (const [id, content] of skipProbes) {
        const before = t.used;
        const capture = await runtimeCapture({ id, project: 'CONTROL', session_id: `skip-${id}`, role: 'user', source: 'trusted-user-prompt', content }, scope, t);
        results.push({ id, status: capture.metrics.status, reason: 'reason' in capture ? capture.reason : null, providerRequests: t.used - before });
    }
    return results;
}
export async function nativeLifecycle(replay: NativeReplay, projectRoot: string, scope: string, repeat: number) {
    const content = 'Confirmed decision: this synthetic project uses Bun for unit tests and preserves stable conversation identity after resume.';
    const base: Seed = { id: 'native-control-one', project: 'CONTROL', session_id: `native-control-${repeat}-${replay.route}`, role: 'user', source: 'trusted-user-prompt', content };
    const first = await replay.capture(base, projectRoot, scope);
    const second = await replay.capture({ ...base, id: 'native-control-two', role: 'assistant', source: 'trusted-final-assistant', content: 'Confirmed final outcome: the synthetic project uses Bun for unit tests and preserves stable conversation identity after resume.' }, projectRoot, scope);
    const duplicate = await replay.capture({ ...base, id: 'native-control-two', role: 'assistant', source: 'trusted-final-assistant', content: 'Confirmed final outcome: the synthetic project uses Bun for unit tests and preserves stable conversation identity after resume.' }, projectRoot, scope);
    const resumed = await replay.capture({ ...base, id: 'native-control-three', content: 'Correction: retain all eligible turns when resuming this synthetic evaluation conversation.' }, projectRoot, scope);
    const skips = [];
    for (const [id, text] of skipProbes) {
        const capture = await replay.capture({ ...base, id: `skip-${id}`, session_id: `native-skip-${repeat}-${id}`, content: text }, projectRoot, scope);
        skips.push({ id, writes: capture.writes, status: capture.status });
    }
    return { sameSessionTwoCaptures: { writes: [first.writes, second.writes], status: first.writes > 0 && second.writes > 0 ? 'observed' : 'unknown' }, duplicateReplay: { writes: duplicate.writes, status: replay.route === 'opencode' ? 'unknown_process_restart' : duplicate.writes === 0 ? 'observed_no_write' : 'observed_duplicate_write' }, resume: { writes: resumed.writes, status: resumed.writes > 0 ? 'observed' : 'unknown' }, skipProbes: skips, toolContinuation: { status: 'unknown', reason: 'No model inference is executed by hook replay.' }, flush: { status: 'observed', acknowledgedWrites: first.writes + second.writes + resumed.writes }, ...(replay.route === 'opencode' ? { transcriptNote: 'Minimal native host supplies a synthetic Acknowledged assistant completion after each user-only seed to make a completed turn; terminal session.deleted drains plugin runExclusive.' } : {}) };
}
