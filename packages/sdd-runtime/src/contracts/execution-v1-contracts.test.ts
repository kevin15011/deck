import { describe, expect, test } from "bun:test";
import {
  buildApplyBatchContractV1,
  buildFailureManifestV1,
  computeFailureDeltaV1,
  createExecutionDossierV1,
  reviseExecutionDossierV1,
} from "../index";
import { canonicalJson, sha256Digest } from "./canonical";

const batchInput = {
  schema: "apply-batch-v1" as const,
  changeId: "developer-team-execution-convergence",
  taskIds: ["EG2-T2", "EG2-T1"],
  dependencies: [{ before: "EG2-T1", after: "EG2-T2" }],
  ownerRole: "apply-general" as const,
  allowedTargets: ["packages/sdd-runtime/src/contracts"],
  blockedTargets: ["openspec/changes/runner-capability-standardization"],
  acceptanceObligations: ["REQ-CONTRACT-001"],
  verificationPlan: [{ stage: "targeted" as const, checkIds: ["contracts"] }],
  artifactDigests: { "tasks.md": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const },
  authorizationGrantRef: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  provenance: { actor: "apply-general", artifact: "openspec/changes/developer-team-execution-convergence/tasks.md", issuedAt: "2026-07-15T00:00:00Z" },
};

describe("execution v1 canonical contracts", () => {
  test("canonicalizes semantic object equality and rejects unsafe JSON values", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
    expect(() => canonicalJson({ n: Number.NaN })).toThrow("invalid-canonical-value");
    expect(() => canonicalJson(new Date())).toThrow("invalid-canonical-value");
    const sparse = Array(2); sparse[1] = "x";
    expect(() => canonicalJson(sparse)).toThrow("invalid-canonical-value");
  });

  test("issues deterministic deeply immutable batches and rejects unknown versions", () => {
    const a = buildApplyBatchContractV1(batchInput);
    const b = buildApplyBatchContractV1({ ...batchInput, taskIds: ["EG2-T1", "EG2-T2"] });
    expect(a).toEqual(b);
    expect(a.batchId).toBe(`batch:v1:${a.digest.slice(7, 39)}`);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.taskIds)).toBe(true);
    expect(() => buildApplyBatchContractV1({ ...batchInput, schema: "apply-batch-v2" } as never)).toThrow("unsupported-contract-version");
  });

  test("redacts evidence and keeps identity stable across prose, ordering, paths, and severity", () => {
    const batch = buildApplyBatchContractV1(batchInput);
    const finding = {
      batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "verify" as const,
      sourceArtifact: "/home/kevinlb/deck/verify.md", severity: "medium" as const,
      category: " Assertion ", rootCause: "implementation" as const,
      requirementIds: ["REQ-B", "REQ-A"], taskIds: ["EG2-T1"],
      locationKeys: ["/home/kevinlb/deck/packages/sdd-runtime/src/x.ts", "check:unit"],
      oracleId: "bun-contracts", isSecurityRelevant: false, status: "open" as const,
      evidence: [{ kind: "check", checkId: "unit", artifact: "/home/kevinlb/deck/out.log", excerpt: "token=secret-value" }],
      remediationCode: "FIX_CONTRACT", summary: "secret token=secret-value",
    };
    const one = buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch,
      producerRole: "verify", producerInstanceId: "verify-1", producedAt: "2026-07-15T01:00:00Z", repositoryRoot: "/home/kevinlb/deck", findings: [finding] });
    const two = buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch,
      producerRole: "review", producerInstanceId: "review-2", producedAt: "2026-07-15T02:00:00Z", repositoryRoot: "/home/kevinlb/deck",
      findings: [{ ...finding, severity: "high", sourcePhase: "review", evidence: [...finding.evidence].reverse(), summary: "different wording" }] });
    expect(one.findings[0]!.findingId).toBe(two.findings[0]!.findingId);
    expect(JSON.stringify(one)).not.toContain("secret-value");
    expect(JSON.stringify(one)).not.toContain("/home/kevinlb");
    expect(Object.isFrozen(one.findings[0]!.evidence)).toBe(true);
    expect(() => buildFailureManifestV1({ ...one, schema: "failure-manifest-v2" } as never)).toThrow("unsupported-contract-version");
  });

  test("classifies deterministic mutually exclusive deltas and risk metrics", () => {
    const batch = buildApplyBatchContractV1(batchInput);
    const base = { batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "verify" as const, sourceArtifact: "verify.md",
      category: "assertion", rootCause: "implementation" as const, requirementIds: ["REQ-A"], taskIds: ["EG2-T1"],
      locationKeys: ["x.ts"], oracleId: "unit", isSecurityRelevant: false, status: "open" as const, evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }] };
    const manifest = (severity: "low" | "high", status: "open" | "resolved" = "open") => buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch, producerRole: "verify", producerInstanceId: "v", producedAt: "2026-07-15T00:00:00Z", findings: [{ ...base, severity, status }] });
    const prior = manifest("low");
    const current = manifest("high");
    const delta = computeFailureDeltaV1(prior, current);
    expect(delta.regressed).toEqual([prior.findings[0]!.findingId]);
    expect(delta.reclassified).toEqual([]);
    expect(delta.persistent).toEqual([]);
    expect(delta.progress).toBe("negative");
    expect(computeFailureDeltaV1(prior, current)).toEqual(delta);
  });

  test("creates append-only dossier revisions without changing batch identity", () => {
    const batch = buildApplyBatchContractV1(batchInput);
    const lane = { schema: "lane-decision-v1" as const, lane: "full_sdd" as const, riskScore: 100, floorReasons: ["PUBLIC_CONTRACT"], policyOverrides: [], shadowOnly: true };
    const verification = { schema: "staged-verification-state-v1" as const, batchId: batch.batchId, stages: [{ stage: "targeted" as const, status: "pending" as const, checkIds: ["contracts"], evidence: [] }], nextStage: "targeted" as const };
    const causalContext = { schema: "causal-context-v1" as const, batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] };
    const first = createExecutionDossierV1({ schema: "execution-dossier-v1", batch, lane, verification, causalContext, registryIntents: [] });
    const second = reviseExecutionDossierV1(first, { registryIntents: [] });
    expect(second.revision).toBe(2);
    expect(second.previousDigest).toBe(first.digest);
    expect(second.batch).toEqual(first.batch);
    expect(Object.isFrozen(second)).toBe(true);
  });
});
