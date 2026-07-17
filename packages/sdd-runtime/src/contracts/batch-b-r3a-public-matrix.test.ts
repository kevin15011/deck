import { describe, expect, test } from "bun:test";
import {
  buildApplyBatchContractV1,
  buildAuthorizationReferenceV1,
  buildCausalContextV1,
  buildExecutionDecisionV1,
  buildFailureManifestV1,
  buildInvocationAuthorizationClaimsV1,
  buildLaneDecisionV1,
  buildRegistryIntentV1,
  buildStagedVerificationStateV1,
  parseApplyBatchContractV1,
  parseAuthorizationReferenceV1,
  parseCausalContextV1,
  parseExecutionDecisionV1,
  parseFailureManifestV1,
  parseInvocationAuthorizationClaimsV1,
  parseLaneDecisionV1,
  parseRegistryIntentV1,
  parseStagedVerificationStateV1,
} from "../index";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const timestamp = "2026-07-15T00:00:00.000Z";
const batchInput = {
  schema: "apply-batch-v1" as const,
  changeId: "developer-team-execution-convergence",
  taskIds: ["EG2-R3A"],
  dependencies: [],
  ownerRole: "apply-general" as const,
  allowedTargets: ["packages/sdd-runtime/src/contracts"],
  blockedTargets: ["packages/core/src/skills/external/content.generated.ts"],
  acceptanceObligations: ["REQ-CONTRACT-005"],
  verificationPlan: [{ stage: "targeted" as const, checkIds: ["r3a-public-matrix"] }],
  artifactDigests: { "openspec/changes/developer-team-execution-convergence/tasks.md": digest("a") },
  authorizationGrantRef: digest("b"),
  provenance: { actor: "apply-general", artifact: "apply-progress.md", issuedAt: timestamp },
  repositoryRoot: "/repo",
};
const batch = buildApplyBatchContractV1(batchInput);
const finding = {
  batchId: batch.batchId,
  batchDigest: batch.digest,
  sourcePhase: "review" as const,
  sourceArtifact: "review-batch-b.md",
  severity: "high" as const,
  category: "trust-boundary",
  rootCause: "implementation" as const,
  requirementIds: ["REQ-CONTRACT-005"],
  taskIds: ["EG2-R3A"],
  locationKeys: ["packages/sdd-runtime/src/contracts/failure-manifest.ts"],
  oracleId: "B-B1",
  isSecurityRelevant: true,
  status: "open" as const,
  relationship: "batch_related" as const,
  evidence: [{ kind: "test", checkId: "r3a-public-matrix", artifact: "review-batch-b.md", resultCode: "failed" }],
};
const manifestInput = { schema: "failure-manifest-v1" as const, changeId: batch.changeId, batch, producerRole: "apply" as const, producerInstanceId: "general-apply", findings: [finding], producedAt: timestamp, repositoryRoot: "/repo" };
const manifest = buildFailureManifestV1(manifestInput);
const lane = buildLaneDecisionV1({ schema: "lane-decision-v1", lane: "full_sdd", riskScore: 1, floorReasons: ["security"], policyOverrides: [], shadowOnly: true });
const verification = buildStagedVerificationStateV1({ schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [{ stage: "targeted", status: "passed", checkIds: ["r3a-public-matrix"], evidence: [] }] });
const causal = buildCausalContextV1({ schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [manifest.findings[0]!.findingId], evidenceRefs: [], attemptSummaries: [{ attempt: 1, outcomeCode: "implemented", artifact: "apply-progress.md" }] });
const authorization = buildInvocationAuthorizationClaimsV1({ schema: "invocation-authorization-v1", invocationId: "invocation-r3a", changeId: batch.changeId, batchId: batch.batchId, batchDigest: batch.digest, role: "apply-general", taskArtifactDigest: digest("c"), allowedActions: ["targeted_repair"], allowedTargets: ["packages/sdd-runtime/src/contracts"], blockedTargets: [], userAuthorizationReceiptDigest: digest("d"), issuedAt: timestamp, expiresAt: "2026-07-16T00:00:00.000Z", nonce: "r3a-nonce", maxUses: 1 });
const authorizationRef = buildAuthorizationReferenceV1({ authorizationId: authorization.authorizationId, invocationId: authorization.invocationId, claimsDigest: digest("e"), validation: "accepted" });
const registryIntent = buildRegistryIntentV1({ schema: "registry-intent-v1", idempotencyKey: digest("f"), changeId: batch.changeId, batchId: batch.batchId, batchDigest: batch.digest, base: { stateDigest: digest("1"), eventsDigest: digest("2") }, phase: "apply", status: "verify-required", artifact: { kind: "apply-progress", path: "openspec/changes/developer-team-execution-convergence/apply-progress.md" }, provenance: { agent: "general", model: "gpt-5.6-sol", timestamp }, event: { name: "repair.batch-b.r3a.implemented", actor: "general", timestamp, notes: ["strict shrink pending Verify"] } });
const decision = buildExecutionDecisionV1({ schema: "execution-decision-v1", batchId: batch.batchId, action: "advance_verification", selectedRootCause: "implementation", rationaleCodes: ["r3a-implemented"], requiredVerificationStage: "targeted", freshness: { freshApply: false, freshVerify: true, freshReview: false, reasonCodes: ["independent-verify"] }, lane: lane.lane, terminalGuard: { outcome: "checkpoint", rationaleCodes: ["verify-required"] }, registryIntents: [] });

const exactError = (operation: () => unknown, message: string) => expect(operation).toThrow(new Error(message));

describe("EG2-R3A complete public-entrypoint RED/mutation matrix", () => {
  test("B-B1 rejects the independently reproduced short JWT in summary", () => exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, summary: "eyJhbGciOiJIUzI1NiJ9.RAW_PAYLOAD.RAW_SIG" }] }), "unsafe-diagnostic-content: failure finding"));
  test("B-B1 rejects the independently reproduced short JWT in remediation code", () => exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, remediationCode: "eyJhbGciOiJIUzI1NiJ9.RAW_PAYLOAD.RAW_SIG" }] }), "unsafe-diagnostic-content: failure finding"));
  test("B-B1 rejects the independently reproduced short JWT in evidence excerpt", () => exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, evidence: [{ ...finding.evidence[0], excerpt: "eyJhbGciOiJIUzI1NiJ9.RAW_PAYLOAD.RAW_SIG" }] }] }), "unsafe-diagnostic-content: failure finding"));
  test("B-B1 rejects the independently reproduced short JWT in evidence result code", () => exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, evidence: [{ ...finding.evidence[0], resultCode: "eyJhbGciOiJIUzI1NiJ9.RAW_PAYLOAD.RAW_SIG" }] }] }), "unsafe-diagnostic-content: failure finding"));
  test("independent mutation: wrong digest",()=>exactError(()=>parseApplyBatchContractV1({...batch,digest:"sha256:bad"}),"invalid-evidence: digest"));
  test("independent mutation: wrong ID",()=>exactError(()=>parseApplyBatchContractV1({...batch,batchId:"batch:v1:bad"}),"invalid-evidence: batchId"));
  test("independent mutation: wrong enum",()=>exactError(()=>parseApplyBatchContractV1({...batch,ownerRole:"root"}),"invalid-evidence: ownerRole"));
  test("independent mutation: wrong timestamp",()=>exactError(()=>parseApplyBatchContractV1({...batch,provenance:{...batch.provenance,issuedAt:"today"}}),"invalid-evidence: provenance.issuedAt"));
  test("independent mutation: NaN",()=>exactError(()=>parseLaneDecisionV1({...lane,riskScore:Number.NaN}),"invalid-evidence: lane.riskScore"));
  test("independent mutation: Infinity",()=>exactError(()=>parseLaneDecisionV1({...lane,riskScore:Number.POSITIVE_INFINITY}),"invalid-evidence: lane.riskScore"));
  test("independent mutation: target overlap",()=>exactError(()=>parseInvocationAuthorizationClaimsV1({...authorization,blockedTargets:authorization.allowedTargets}),"invalid-evidence: authorization target-collision"));
  test("independent mutation: rejection code",()=>exactError(()=>parseAuthorizationReferenceV1({...authorizationRef,rejectionCode:"unexpected"}),"invalid-evidence: authorizationRef.rejectionCode"));

  test("B-B4 authoritative POSIX/Windows roots preserve identity and reject external/traversal/drive-relative paths", () => {
    const posix = buildFailureManifestV1({ ...manifestInput, repositoryRoot: "/home/alice/repo", findings: [{ ...finding, sourceArtifact: "/home/alice/repo/review.md", locationKeys: ["/home/alice/repo/src/a.ts"] }] });
    const windows = buildFailureManifestV1({ ...manifestInput, repositoryRoot: "C:\\work\\repo", findings: [{ ...finding, sourceArtifact: "c:\\WORK\\REPO\\review.md", locationKeys: ["C:\\work\\repo\\src\\a.ts"] }] });
    expect([posix.findings[0]!.findingId, posix.findings[0]!.fingerprint, posix.findings[0]!.locationKeys]).toEqual([windows.findings[0]!.findingId, windows.findings[0]!.fingerprint, windows.findings[0]!.locationKeys]);
    exactError(()=>buildFailureManifestV1({...manifestInput,findings:[{...finding,sourceArtifact:"/other/repo/src/a.ts"}]}),"invalid-evidence: finding.sourceArtifact");
    exactError(()=>buildFailureManifestV1({...manifestInput,findings:[{...finding,sourceArtifact:"../src/a.ts"}]}),"invalid-evidence: finding.sourceArtifact");
    exactError(()=>buildFailureManifestV1({...manifestInput,findings:[{...finding,sourceArtifact:"C:src\\a.ts"}]}),"invalid-evidence: finding.sourceArtifact");
    exactError(()=>buildFailureManifestV1({...manifestInput,findings:[{...finding,sourceArtifact:"src//a.ts"}]}),"invalid-evidence: finding.sourceArtifact");
    exactError(()=>buildFailureManifestV1({...manifestInput,findings:[{...finding,sourceArtifact:"src/\0a.ts"}]}),"invalid-evidence: finding.sourceArtifact");
  });

  test("B-B5 exact evidence deduplicates, reorder is byte-identical, and semantic conflicts reject without inflation", () => {
    const evidenceA = { kind: "test", checkId: "matrix", artifact: "review.md", excerpt: "safe A", resultCode: "failed" };
    const evidenceB = { kind: "test", checkId: "other", artifact: "review.md", excerpt: "safe B", resultCode: "failed" };
    const duplicate = buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, evidence: [evidenceA, evidenceA, evidenceB] }] });
    const reordered = buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, evidence: [evidenceB, evidenceA] }] });
    expect(duplicate.findings[0]!.evidence).toEqual(reordered.findings[0]!.evidence);
    expect(duplicate.digest).toBe(reordered.digest);
    expect(duplicate.findings[0]!.evidence).toEqual(reordered.findings[0]!.evidence);
    exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [{ ...finding, evidence: [evidenceA, { ...evidenceA, excerpt: "conflict" }] }] }), "invalid-evidence: evidence-collision");
    exactError(() => buildFailureManifestV1({ ...manifestInput, findings: [finding, finding] }), "invalid-evidence: duplicate-finding-identity");
  });
});
