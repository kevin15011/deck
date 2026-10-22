import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { scoreUnits, type Question } from './score';
import { roleCap } from './capture-replay/runtime';
import { privateWrite, sha256, fail, FAKE_SECRETS, CANARIES } from './security';
import { NamespaceTransport } from './namespace-transport';
export type CaseArtifact = {
    schema: 'deck-eval-case-v1';
    id: string;
    track: string;
    route?: string;
    repeat: number;
    writer?: string;
    reader?: string;
    project: string;
    role: string;
    durationMs: number;
    settledEligible: boolean;
    settledReason?: string;
    injectedText: string;
    injectedUnits: string[];
    rawReturnedUnits: string[];
    rawResponses?: unknown[];
    nativeHookOutput?: string;
    [key: string]: any;
};
export function scoreArtifact(q: Question, a: CaseArtifact) { const k = roleCap(q.role); const final = scoreUnits(q, a.injectedUnits, k); return { id: q.id, category: q.category, role: q.role, project_under_query: a.project, status: a.availability ?? (k === 0 ? 'policy_skip' : 'scored'), durationMs: a.durationMs, cap: k, final, at1: scoreUnits(q, a.injectedUnits, 1), at5: scoreUnits(q, a.injectedUnits, 5), raw: scoreUnits(q, a.rawReturnedUnits, k), rawAt1: scoreUnits(q, a.rawReturnedUnits, 1), rawAt5: scoreUnits(q, a.rawReturnedUnits, 5), injectedBytes: Buffer.byteLength(a.injectedText), injectedTokens: Math.max(a.injectedText.split(/\s+/).filter(Boolean).length, Math.ceil(Buffer.byteLength(a.injectedText) / 4)), injectionHash: sha256(a.injectedText), settledEligible: a.settledEligible, settledReason: a.settledReason, policySkipExpected: k === 0, policySkipObserved: a.injectedText.length === 0, rolePolicyViolation: k === 0 && a.injectedText.length > 0, surfaceSafety: { secrets: FAKE_SECRETS.filter(x => a.injectedText.includes(x)).map(sha256), canaries: CANARIES.filter(x => a.injectedText.includes(x)).map(sha256) } }; }
export function persistCase(root: string, q: Question, a: CaseArtifact, t: NamespaceTransport) {
    const name = 'cases/' + randomBytes(16).toString('hex') + '.json';
    const encoded = t.sanitize(JSON.stringify(a, null, 2) + '\n');
    privateWrite(join(root, name), encoded);
    const safe = JSON.parse(encoded) as CaseArtifact;
    return { ...scoreArtifact(q, safe), artifact: name, artifactSha256: sha256(encoded) };
}
export function readCase(root: string, row: any): CaseArtifact {
    if (!/^cases\/[a-f0-9]{32}\.json$/.test(row.artifact))
        fail('unsafe_case_artifact');
    const path = join(root, row.artifact);
    const parent = lstatSync(join(root, 'cases'));
    const st = lstatSync(path);
    if (parent.isSymbolicLink() || !parent.isDirectory() || !st.isFile() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o600)
        fail('case_artifact_permissions_invalid');
    const text = readFileSync(path, 'utf8');
    if (sha256(text) !== row.artifactSha256)
        fail('case_artifact_hash_mismatch');
    return JSON.parse(text);
}
