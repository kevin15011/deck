import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NativeReplay } from './native';
import { nativeContext, nativeRawUnits } from './native-output';
import { settle } from '../settle';
import { privateWrite, sha256 } from '../security';
export const CONTROL_FACT = 'zircon lantern verification';
export async function nativePositiveControl(replay: NativeReplay, project: {
    cwd: string;
    scope: string;
}, offline: boolean, repeat: number) {
    const t = replay.t;
    const before = t.observations.length;
    const id = randomUUID();
    t.phase = `n_${replay.route}_${repeat}_positive_capture`;
    const capture = await replay.capture({ id, project: 'CONTROL', session_id: randomUUID(), role: 'user', source: 'trusted-user-prompt', content: `Confirmed decision: this synthetic project must use ${CONTROL_FACT} before every queue deployment.` }, project.cwd, project.scope);
    let settleResult: any = null;
    let output = '', recall: any;
    if (capture.writes > 0) {
        t.phase = `n_${replay.route}_${repeat}_positive_settle`;
        settleResult = await settle(t, project.scope, 'queue deployment verification', offline);
        t.phase = `n_${replay.route}_${repeat}_positive_recall`;
        const frozen = t.frozen;
        t.frozen = true;
        try {
            recall = await replay.recall('Which verification must this synthetic project use before every queue deployment?', randomUUID(), project.cwd, project.scope);
            output = recall.output;
        }
        finally {
            t.frozen = frozen;
        }
    }
    const injected = nativeContext(output);
    const retrieved = injected.units.some(s => s.normalize('NFKC').toLowerCase().includes(CONTROL_FACT));
    const passed = capture.writes > 0 && retrieved && recall?.prompt.status === 'replayed';
    const artifact = `controls/${replay.route}_${repeat}_positive.json`;
    privateWrite(join(replay.root, artifact), t.sanitize(JSON.stringify({ capture, settle: settleResult, injectedText: injected.text, injectedUnits: injected.units, rawReturnedUnits: nativeRawUnits(t.observations.slice(before)), nativeHookOutput: output, expectedFact: CONTROL_FACT }, null, 2) + '\n'));
    return { status: passed ? 'passed' : 'failed', captureAcknowledged: capture.writes > 0, retrieved, reason: passed ? null : capture.writes === 0 ? 'native_positive_capture_unacknowledged' : 'native_positive_control_no_fact', artifact, injectionHash: sha256(injected.text), settle: settleResult };
}
