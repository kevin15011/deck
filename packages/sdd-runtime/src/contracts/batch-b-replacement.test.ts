import { describe, expect, test } from "bun:test";
import * as publicApi from "../index";

const digest = (c: string) => `sha256:${c.repeat(64)}` as const;
const error = (fn: () => unknown) => { try { fn(); return "accepted"; } catch (cause) { return (cause as Error).message; } };
const batchInput = (root = "/checkout/deck") => ({
  schema: "apply-batch-v1" as const, changeId: "change", taskIds: ["EG2-R2"], dependencies: [], ownerRole: "apply-general" as const,
  allowedTargets: [`${root}/packages/sdd-runtime`], blockedTargets: [], acceptanceObligations: ["REQ-CONTRACT-005"], verificationPlan: [], artifactDigests: {},
  authorizationGrantRef: digest("a"), provenance: { actor: "apply-general", issuedAt: "2026-07-15T00:00:00.000Z" }, repositoryRoot: root,
});
const batch = publicApi.buildApplyBatchContractV1(batchInput() as never);
const finding = (overrides: Record<string, unknown> = {}) => ({ batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "review", sourceArtifact: "/checkout/deck/review.md",
  severity: "low", category: "contract", rootCause: "implementation", requirementIds: ["REQ-CONTRACT-005"], taskIds: ["EG2-R2"],
  locationKeys: ["/checkout/deck/packages/sdd-runtime/src/contracts/failure-manifest.ts"], oracleId: "B-B1", isSecurityRelevant: false, status: "open",
  relationship: "batch_related", evidence: [{ kind: "check", checkId: "B-B1", artifact: "/checkout/deck/review.md", resultCode: "FAILED" }], ...overrides });
const manifest = (findings: unknown[]) => publicApi.buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: "change", batch,
  producerRole: "review", producerInstanceId: "fresh-review", producedAt: "2026-07-15T00:00:00.000Z", repositoryRoot: "/checkout/deck", findings } as never);

describe("EG2-R2 public trust-boundary RED matrix", () => {
  // B-B7-COMBINED-PLACEMENT-CASE-v1: split into four individually named tests.

  test("B-B1 rejects PEM private-key in finding summary placement", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nCHECK_SECRET\n-----END PRIVATE KEY-----";
    expect(error(() => manifest([finding({ summary: pem })]))).toBe("unsafe-diagnostic-content: failure finding");
  });

  test("B-B1 rejects PEM private-key in evidence excerpt placement", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nCHECK_SECRET\n-----END PRIVATE KEY-----";
    expect(error(() => manifest([finding({ evidence: [{ kind: "check", checkId: "B-B1", artifact: "review.md", excerpt: pem }] })]))).toBe("unsafe-diagnostic-content: failure finding");
  });

  test("B-B1 rejects PEM private-key in remediation code placement", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nCHECK_SECRET\n-----END PRIVATE KEY-----";
    expect(error(() => manifest([finding({ remediationCode: pem })]))).toBe("unsafe-diagnostic-content: failure finding");
  });

  test("B-B1 rejects PEM private-key in evidence transcript placement", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nCHECK_SECRET\n-----END PRIVATE KEY-----";
    expect(error(() => manifest([finding({ evidence: [{ kind: "check", checkId: "B-B1", artifact: "review.md", transcript: pem }] })]))).toBe("invalid-evidence: evidence fields");
  });

  test("B-B4 uses authoritative roots, not repository directory markers", () => {
    const a = publicApi.buildApplyBatchContractV1(batchInput("/home/a/arbitrary") as never);
    const b = publicApi.buildApplyBatchContractV1(batchInput("C:\\ci\\other") as never);
    expect(a.allowedTargets).toEqual(["packages/sdd-runtime"]);
    expect(b.allowedTargets).toEqual(["packages/sdd-runtime"]);
    expect(a.batchId).toBe(b.batchId);
  });

  test("B-B5 deduplicates exact evidence and rejects semantic collisions", () => {
    const duplicate = { kind: "check", checkId: "B-B5", artifact: "review.md", resultCode: "FAILED" };
    expect(manifest([finding({ evidence: [duplicate, duplicate] })]).findings[0]!.evidence).toEqual([duplicate]);
    expect(error(() => manifest([finding({ evidence: [duplicate, { ...duplicate, resultCode: "PASSED" }] })]))).toBe("invalid-evidence: evidence-collision");
  });

  test("B-B2 applies exact 2x regression movement and safety precedence", () => {
    const prior = manifest([finding({ severity: "low", oracleId: "same" })]);
    const current = manifest([finding({ severity: "high", oracleId: "same" })]);
    const delta = publicApi.computeFailureDeltaV1(prior, current);
    expect(delta.priorRisk).toEqual({ securityHardStops: 0, critical: 0, high: 0, medium: 0, low: 1, uncoveredRequirements: 0, weighted: 1 });
    expect(delta.currentRisk).toEqual({ securityHardStops: 0, critical: 0, high: 1, medium: 0, low: 0, uncoveredRequirements: 0, weighted: 100 });
    expect(delta.weightedMovement).toBe(-199);
    expect(delta.progress).toBe("negative");
  });

  test("B-B6 rejects an exactly self-hashed malformed delta", () => {
    const valid = publicApi.computeFailureDeltaV1(undefined, manifest([]));
    const malformed = { ...valid, resolved: "not-array" };
    const payload = { ...malformed } as Record<string, unknown>; delete payload.digest; delete payload.deltaId;
    const crypto = require("node:crypto");
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const supplied = `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
    expect(error(() => publicApi.parseFailureDeltaV1({ ...malformed, digest: supplied, deltaId: `delta:v1:${supplied.slice(7, 39)}` }, undefined, manifest([])))).toBe("invalid-evidence: delta.resolved");
  });

  test("B-B3 recursively rejects a malformed nested decision", () => {
    const lane = publicApi.buildLaneDecisionV1({ schema: "lane-decision-v1", lane: "full_sdd", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: true });
    const verification = publicApi.buildStagedVerificationStateV1({ schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] });
    const causalContext = publicApi.buildCausalContextV1({ schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] });
    const issued = publicApi.buildExecutionDecisionV1({ schema: "execution-decision-v1", batchId: batch.batchId, action: "stop", selectedRootCause: "security", rationaleCodes: [], freshness: { freshApply: false, freshVerify: false, freshReview: true, reasonCodes: [] }, lane: "full_sdd", terminalGuard: { outcome: "stop", rationaleCodes: [] }, registryIntents: [] });
    expect(error(() => publicApi.createExecutionDossierV1({ schema: "execution-dossier-v1", batch, lane, verification, causalContext, registryIntents: [], decision: { ...issued, freshness: { freshApply: false } } } as never))).toBe("invalid-evidence: decision.freshness");
  });

  // B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1: exact complete public V1 surface.
    // Uses literal sorted equality to catch both missing AND extra exports.
    test("B-B7 exports the exact public function surface at package root", () => {
    const expected = ["DEFAULT_BUDGET_CONFIG","DEFAULT_DISCOVERY_CONFIG","DEFAULT_ENFORCEMENT_CONFIG","DEFAULT_LOOP_BREAKER_CONFIG","DEFAULT_ORCHESTRATOR_PERSONALITY","DEFAULT_PIPELINE_CONFIG","DEFAULT_RECOVERY_CONFIG","DEFAULT_RISK_THRESHOLDS","DEFAULT_ROUTER_CONFIG","DEFAULT_RUNNER_PIPELINE_CONFIG","DEFAULT_SCORER_CONFIG","ORCHESTRATOR_PERSONALITIES","adaptDossierToRepairIncidentV1","adaptLaneToCheckPlanV1","adaptRepairIncidentToFailureManifestV1","aggregateDeckPreparationHandoffV1","aggregateRolloutTelemetryV1","applyEnforcement","assignExecutionCohort","assignExecutionLaneCohortV1","attemptResume","buildApplyBatchContractV1","buildAuthorizationReferenceV1","buildCausalContextV1","buildExecutionDecisionV1","buildFailureManifestV1","buildInvocationAuthorizationClaimsV1","buildLaneDecisionV1","buildRegistryIntentV1","buildSessionPreparationDelegationDigestV1","buildStagedVerificationStateV1","capabilityDescriptorDigestV1","checkBudget","checkLoopCondition","classifyFailure","classifyInvalidExecutionInputV1","classifyProtectedRiskV1","classifyTransportFailure","composeDeveloperTeamExecutionV1","computeFailureDeltaV1","computeRiskScore","consumeExecutionRoleResultV1","consumeSessionPreparationAuthorizationV1","createBoundedLocalTelemetrySink","createConfiguredTelemetrySinkV1","createDeveloperTeamRunnerHostBridgeV1","createExecutionDossierV1","createInvocationAuthorizationServiceV1","createNoopTelemetrySink","createProjectDiscoveryAdapter","createSessionPreparationAuthorizationServiceV1","createSessionPreparationStateV1","createStagedVerificationScheduleV1","evaluateCompactPromptActivationV1","evaluateExecutionDecisionV1","evaluateFreshnessPolicyV1","evaluateRepairIncident","evaluateRolloutGateV1","executeDeveloperTeamStepV1","executeTargetedRepairV1","parseApplyBatchContractV1","parseAuthorizationReferenceV1","parseCausalContextV1","parseDeckPreparationHandoffV1","parseExecutionDecisionV1","parseExecutionDossierV1","parseExecutionRoleInvocationV1","parseFailureDeltaV1","parseFailureManifestV1","parseInvocationAuthorizationClaimsV1","parseLaneDecisionV1","parseRegistryIntentV1","parseRepairIncidentYAML","parseSessionPreparationRequestV1","parseStagedVerificationStateV1","planExecutionDecisionV1","probeRunnerExecutionCapabilities","projectCausalContextForRoleV1","recordBoundedBaseline","replayExecutionDecisionV1","resolveEnforcementMode","resolvePromptProfileActivationV1","reviseExecutionDossierV1","routeQuality","runOrchestratorPipeline","runProductionExecutionDecisionPipelineV1","runRunnerPipeline","scheduleExecutionRoleInvocationV1","selectExecutionLaneV1","serializeSafeTelemetryEvent","submitStateUpdate","transitionRolloutStateV1","transitionStagedVerificationV1","validateAdapterCapabilities","validateArtifactForResume","validatePhaseOutcome","validateRiskResult","validateSelfAudit","validateStateUpdate","validateTransportContext","validateVerificationAcceptanceV1","validateVerificationDisciplineV1"] as const;
    const registryExpected = ["buildRegistryPairTransactionV1", "classifyRegistryRecoveryV1", "commitExecutionRegistryIntentsV1", "createFileSystemRegistryStoreV1", "createNodeRegistryFileSystemPortV1", "createRegistryCoordinatorV1", "markRegistryTransactionCommittedV1", "parseRegistryPairTransactionV1"] as const;
    const effectivenessExpected = ["BASELINE_DISPOSITION_POLICY_VERSION_V1", "BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1", "aggregateUserOutcomeTelemetryV1", "applyGenesisAtomicallyV1", "assertCriticalApplyPreflightV1", "assessCoordinationV1", "bindExecutionPlanQaAuthorityV1", "broadDispositionIsReadyV1", "buildApplyPreflightReceiptV1", "buildApprovalReceiptV1", "buildAuthoritativeOutcomeV1", "buildBaselineEvidenceEnvelopeV1", "buildBroadCausalDispositionEnvelopeV1", "buildCandidateRefV1", "buildNormalizedFindingFingerprintV1", "buildProtectedRequirementSnapshotV1", "buildRegistryLifecycleIntentV1", "buildReviewConvergenceResultV1", "buildVerificationCheckResultV1", "buildVerificationStageExecutionPlanV1", "consumeApprovalReceiptV1", "createQaRunnerHostAuthorityV1", "decideDeveloperTeamLeadershipV1", "decideQaNextActionV1", "decideQualityReadinessV1", "deriveQaImpactInvalidationV1", "evaluateFindingDispositionBaselineV1", "evaluateGovernanceRecoveryV1", "evaluateProcessPostureV1", "executeVerificationStageV1", "joinVerificationStageExecutionV1", "parseApprovalReceiptV1", "parseBaselineEvidenceEnvelopeV1", "parseBroadCausalDispositionEnvelopeV1", "parseCandidateRefV1", "parseQaAuthorityBindingV1", "parseQaAuthoritySnapshotV1", "parseQualityDispositionEnvelopeV1", "parseQualityReadinessDecisionV1", "parseRegistryLifecycleIntentV1", "parseReviewConvergenceResultV1", "parseVerificationCheckResultV1", "parseVerificationStageExecutionPlanV1", "planLegacyGenesisV1", "reconcileAuthoritativeOutcomesV1", "registryLifecycleEventV1", "selectSessionChangeV1", "serializeUserOutcomeTelemetryAggregateV1", "serializeUserOutcomeTelemetryEventV1", "validateCandidateRefV1"] as const;
    expect(Object.keys(publicApi).sort()).toEqual([...expected, "parseExecutionDossierHistoryV1", ...registryExpected, ...effectivenessExpected, "parseRegistryAtomicCommitReceiptV1", "parseVerificationWaveExecutionReceiptV1", "parseVerificationStageExecutionJoinV1", "isTrustedRegistryCoordinatorV1"].sort());
  });

  test("B-B7 exports no canonical internal helpers at package root", () => {
    expect("canonicalJson" in publicApi).toBe(false);
    expect("sha256Digest" in publicApi).toBe(false);
    expect("deepFreeze" in publicApi).toBe(false);
    expect("cloneCanonical" in publicApi).toBe(false);
  });
});
