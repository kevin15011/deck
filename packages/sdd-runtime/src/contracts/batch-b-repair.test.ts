import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { buildFailureManifestV1 } from "./failure-manifest";
import { computeFailureDeltaV1 } from "../orchestrator/failure-delta";
import { parseApplyBatchContractV1 } from "./apply-batch";
import { parseFailureManifestV1 } from "./failure-manifest";
import { parseFailureDeltaV1 } from "./failure-delta";
import { parseExecutionDecisionV1 } from "./execution-decision";
import { parseInvocationAuthorizationClaimsV1 } from "./invocation-authorization";
import { parseRegistryIntentV1 } from "./registry-intent";
import { parseStagedVerificationStateV1 } from "./verification-state";
import { parseCausalContextV1 } from "./causal-context";
import { parseLaneDecisionV1 } from "./execution-lane";
import { createExecutionDossierV1, parseExecutionDossierV1 } from "./execution-dossier";

const digest = (c: string) => `sha256:${c.repeat(64)}` as const;
const batchInput = {
  schema: "apply-batch-v1" as const, changeId: "change", taskIds: ["EG2-R1"], dependencies: [], ownerRole: "apply-general" as const,
  allowedTargets: ["packages/sdd-runtime"], blockedTargets: [], acceptanceObligations: ["REQ-CONTRACT-005"], verificationPlan: [],
  artifactDigests: {}, authorizationGrantRef: digest("a"), provenance: { actor: "apply-general", issuedAt: "2026-07-15T00:00:00Z" },
};
const batch = buildApplyBatchContractV1(batchInput);
const baseFinding = (overrides: Record<string, unknown> = {}) => ({
  batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "review" as const, sourceArtifact: "review-batch-b.md",
  severity: "low" as const, category: "contract", rootCause: "implementation" as const, requirementIds: ["REQ-CONTRACT-005"],
  taskIds: ["EG2-R1"], locationKeys: ["packages/sdd-runtime/src/contracts/failure-manifest.ts"], oracleId: "B-B1",
  isSecurityRelevant: false, status: "open" as const, evidence: [{ kind: "test", checkId: "contract", artifact: "review-batch-b.md", resultCode: "failed" }], ...overrides,
});
const manifest = (findings: ReturnType<typeof baseFinding>[], producerRole: "apply" | "verify" | "review" = "review", repositoryRoot = ".") =>
  buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: "change", batch, producerRole, producerInstanceId: "instance", findings, producedAt: "2026-07-15T00:00:00Z", repositoryRoot });

describe("EG2-R1 adversarial public boundaries", () => {
  test("B-B1 rejects an unknown secret-bearing finding field", () => expect(() => manifest([baseFinding({ extra: "EXTRA_SECRET" })])).toThrow(new Error("invalid-evidence: failure finding fields")));
  test("B-B1 rejects a nested secret-bearing finding field", () => expect(() => manifest([baseFinding({ extra: { token: "NESTED_SECRET" } })])).toThrow(new Error("invalid-evidence: failure finding fields")));
  test("B-B1 rejects an unknown secret-bearing evidence field", () => expect(() => manifest([baseFinding({ evidence: [{ kind: "test", checkId: "contract", artifact: "review.md", resultCode: "failed", extra: "EVIDENCE_SECRET" }] })])).toThrow(new Error("invalid-evidence: evidence fields")));
  test("B-B1 safe manifest bytes omit rejected secret markers", () => {
    const bytes = JSON.stringify(manifest([baseFinding()]));
    expect(bytes.includes("EXTRA_SECRET")).toBe(false);
    expect(bytes.includes("NESTED_SECRET")).toBe(false);
    expect(bytes.includes("EVIDENCE_SECRET")).toBe(false);
  });

  test("B-B4 identity is checkout-prefix stable and semantic changes remain distinct", () => {
    const first = manifest([baseFinding({ sourceArtifact: "/home/alice/repo/review.md", locationKeys: ["/home/alice/repo/packages/sdd-runtime/src/a.ts"] })], "review", "/home/alice/repo").findings[0]!;
    const second = manifest([baseFinding({ sourceArtifact: "/mnt/ci/repo/review.md", locationKeys: ["/mnt/ci/repo/packages/sdd-runtime/src/a.ts"] })], "review", "/mnt/ci/repo").findings[0]!;
    const changed = manifest([baseFinding({ sourceArtifact: "/mnt/ci/repo/review.md", locationKeys: ["/mnt/ci/repo/packages/sdd-runtime/src/a.ts"], oracleId: "B-B4-other" })], "review", "/mnt/ci/repo").findings[0]!;
    expect([first.findingId, first.fingerprint, first.locationKeys]).toEqual([second.findingId, second.fingerprint, second.locationKeys]);
    expect(changed.findingId).not.toBe(first.findingId);
  });

  test("B-B5 rejects normalized artifact and semantic finding collisions", () => {
    expect(() => buildApplyBatchContractV1({ ...batchInput, artifactDigests: { "src\\a": digest("b"), "src/a": digest("c") } })).toThrow("invalid-evidence: normalized-key-collision");
    expect(() => manifest([baseFinding(), baseFinding()])).toThrow("invalid-evidence: duplicate-finding-identity");
  });

  test("B-B2 emits exact normative buckets and security dominance", () => {
    const critical = baseFinding({ severity: "critical", oracleId: "resolved" });
    const persistent = baseFinding({ oracleId: "persistent" });
    const reclassified = baseFinding({ oracleId: "reclassified", rootCause: "implementation" });
    const prior = manifest([critical, persistent, reclassified]);
    const current = manifest([
      persistent,
      baseFinding({ oracleId: "reclassified", rootCause: "oracle" }),
      baseFinding({ oracleId: "related-security", isSecurityRelevant: true }),
      baseFinding({ oracleId: "baseline", status: "pre_existing", relationship: "unrelated_baseline" }),
    ]);
    const delta = computeFailureDeltaV1(prior, current);
    const ids = Object.fromEntries(current.findings.map((f) => [f.oracleId, f.findingId]));
    expect(delta.resolved).toEqual([prior.findings.find((f) => f.oracleId === "resolved")!.findingId]);
    expect(delta.persistent).toEqual([ids.persistent]);
    expect(delta.newRelated).toEqual([ids["related-security"]]);
    expect(delta.newUnrelatedBaseline).toEqual([ids.baseline]);
    expect(delta.regressed).toEqual([]);
    expect(delta.reclassified).toEqual([ids.reclassified]);
    expect(delta.progress).toBe("negative");
    expect(delta.currentRisk.securityHardStops).toBe(1);
    expect(computeFailureDeltaV1(prior, current)).toEqual(delta);
  });

  test("B-B6 apply batch parser rejects an unknown shape with an exact error", () => expect(()=>parseApplyBatchContractV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: apply batch")));
  test("B-B6 failure delta parser rejects an unknown shape with authoritative manifests", () => expect(()=>parseFailureDeltaV1({schema:"unknown-v1",extension:true},undefined,manifest([]))).toThrow(new Error("invalid-evidence: failure delta fields")));
  test("B-B6 execution decision parser rejects an unknown shape with an exact error", () => expect(()=>parseExecutionDecisionV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: decision")));
  test("B-B6 authorization claims parser rejects an unknown shape with an exact error", () => expect(()=>parseInvocationAuthorizationClaimsV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: authorization claims fields")));
  test("B-B6 registry intent parser rejects an unknown shape with an exact error", () => expect(()=>parseRegistryIntentV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: registry intent fields")));
  test("B-B6 verification parser rejects an unknown shape with an exact error", () => expect(()=>parseStagedVerificationStateV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: verification")));
  test("B-B6 causal context parser rejects an unknown shape with an exact error", () => expect(()=>parseCausalContextV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: causal context")));
  test("B-B6 lane parser rejects an unknown shape with an exact error", () => expect(()=>parseLaneDecisionV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: lane decision")));
  test("B-B6 dossier parser rejects an unknown shape with an exact error", () => expect(()=>parseExecutionDossierV1({schema:"unknown-v1",extension:true})).toThrow(new Error("invalid-evidence: dossier")));
  test("B-B6 failure manifest parser rejects an unknown shape with an exact error", () => expect(()=>parseFailureManifestV1({schema:"unknown-v1"},batch)).toThrow(new Error("invalid-evidence: manifest.manifestId")));

  test("B-B3 dossier rejects a malformed cross-batch decision reference", () => {
    const lane = { schema: "lane-decision-v1" as const, lane: "full_sdd" as const, riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: true };
    const verification = { schema: "staged-verification-state-v1" as const, batchId: batch.batchId, stages: [] };
    const causalContext = { schema: "causal-context-v1" as const, batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] };
    expect(() => createExecutionDossierV1({ schema: "execution-dossier-v1", batch, lane, verification, causalContext, registryIntents: [], decision: { schema: "execution-decision-v1", decisionId: "decision:v1:bad", digest: digest("d"), batchId: "batch:v1:wrong", action: "stop", selectedRootCause: "security", rationaleCodes: [], freshness: { freshApply: false, freshVerify: false, freshReview: true, reasonCodes: [] }, lane: "full_sdd", terminalGuard: { outcome: "stop", rationaleCodes: [] }, registryIntents: [] } })).toThrow("invalid-evidence: decision.decisionId");
  });
});
