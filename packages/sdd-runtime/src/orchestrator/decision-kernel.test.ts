import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1, buildFailureManifestV1, computeFailureDeltaV1, createExecutionDossierV1, evaluateExecutionDecisionV1 } from "../index";

const batch = buildApplyBatchContractV1({ schema: "apply-batch-v1", changeId: "kernel", taskIds: ["EG3-T1"], dependencies: [], ownerRole: "apply-general", allowedTargets: ["packages/sdd-runtime"], blockedTargets: ["openspec/changes/runner-capability-standardization"], acceptanceObligations: ["REQ-DECISION-002"], verificationPlan: [{ stage: "targeted", checkIds: ["kernel"] }], artifactDigests: { "tasks.md": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, authorizationGrantRef: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00Z" } });
const finding = (rootCause: "implementation" | "oracle" | "requirement" | "architecture" | "security" | "environment", severity: "low" | "high" | "critical" = "low") => ({ batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "verify" as const, sourceArtifact: "verify.md", severity, category: "kernel", rootCause, requirementIds: ["REQ-DECISION-002"], taskIds: ["EG3-T1"], locationKeys: ["kernel.ts"], oracleId: "kernel", isSecurityRelevant: rootCause === "security", status: "open" as const, evidence: [{ kind: "check", checkId: "kernel", artifact: "result.json" }] });
const dossier = (rootCause: Parameters<typeof finding>[0], progress: "positive" | "none" | "negative" = "positive", currentSeverity: "low" | "high" | "critical" = rootCause === "security" ? "critical" : "low") => { const current = buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch, producerRole: "verify", producerInstanceId: "verify", producedAt: "2026-07-16T00:00:00Z", findings: [finding(rootCause, currentSeverity)] }); const prior = buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch, producerRole: "verify", producerInstanceId: "verify", producedAt: "2026-07-15T00:00:00Z", findings: [finding(rootCause, progress === "positive" ? "critical" : currentSeverity)] }); const delta = computeFailureDeltaV1(prior, current); return createExecutionDossierV1({ schema: "execution-dossier-v1", batch, priorManifest: prior, currentManifest: current, delta, lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 10, floorReasons: [], policyOverrides: [], shadowOnly: false }, verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [{ stage: "targeted", status: "pending", checkIds: ["kernel"], evidence: [] }], nextStage: "targeted" }, causalContext: { schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: current.findings.map((entry) => entry.findingId), evidenceRefs: [], attemptSummaries: [] }, registryIntents: [] }); };

describe("execution decision kernel", () => {
  test("routes root-cause precedence with deterministic reason codes", () => {
    expect(evaluateExecutionDecisionV1({ dossier: dossier("implementation"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("targeted_repair");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("oracle"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("correct_oracle");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("requirement"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("replan_spec");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("architecture"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("replan_design_or_tasks");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("environment"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("diagnose_runtime");
  });

  test("gives hard stops, invalid authorization, and no-progress precedence over repair", () => {
    expect(evaluateExecutionDecisionV1({ dossier: dossier("implementation"), authority: { state: "invalid" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("stop");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("security"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("escalate");
    expect(evaluateExecutionDecisionV1({ dossier: dossier("implementation", "none"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" }).action).toBe("checkpoint");
  });

  test("never converts a shrinking high-risk implementation finding into targeted repair", () => {
    const decision = evaluateExecutionDecisionV1({ dossier: dossier("implementation", "positive", "high"), authority: { state: "authorized" }, gitSafety: { state: "not-required" }, policyVersion: "execution-decision-policy-v1" });
    expect(decision.action).toBe("escalate");
    expect(decision.rationaleCodes).toEqual(["HIGH_RISK_REPAIR_FORBIDDEN"]);
  });

  test("is replay-equivalent and preserves legacy governance as a terminal-only guard", () => {
    const input = { dossier: dossier("implementation"), authority: { state: "authorized" as const }, gitSafety: { state: "not-required" as const }, policyVersion: "execution-decision-policy-v1" as const };
    expect(evaluateExecutionDecisionV1(input)).toEqual(evaluateExecutionDecisionV1(input));
  });
});
