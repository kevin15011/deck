import { expect, test } from "bun:test";

import * as publicApi from "../index";

import {
  buildApplyBatchContractV1,
  buildFailureManifestV1,
  computeFailureDeltaV1,
  createExecutionDossierV1,
} from "../index";

import type { ApplyBatchContractV1 } from "../contracts/apply-batch";

import type { ExecutionDossierV1 } from "../contracts/execution-dossier";

import type {
  FailureFindingInputV1,
  FailureRootCause,
  FailureSeverity,
} from "../contracts/failure-manifest";

import type {
  RepairFailureEntry,
  RepairIncident,
} from "../contracts/repair-incident";

import { EXECUTION_V1_FIXTURES } from "../fixtures/execution-v1";

import { runOrchestratorPipeline } from "../orchestrator/orchestrator-pipeline";

import {
  assertBatchCContract,
  type BatchCContractObservation,
} from "./batch-c-assertions";

import {
  capabilityDescriptorDigestV1,
  executeTargetedRepairV1,
  type TargetedRepairCapabilityDescriptorV1,
} from "./execution-adapter-port";

import {
  composeDeveloperTeamExecutionV1,
  runProductionExecutionDecisionPipelineV1,
  type DeveloperTeamExecutionCompositionResultV1,
} from "./execution-composition";

import {
  replayExecutionDecisionV1,
  type ExecutionAuthorityStateV1,
  type GitSafetyStateV1,
  type TerminalGovernanceContextV1,
} from "./execution-control-plane";
import { sha, legacyInput, makeBatch, batch, FindingSpec, DossierOptions, CompositionOptions, finding, manifest, dossierFixtures, dossier, buildDossier, authorized, gitNotRequired, compositionInput, compose, descriptor, boundTargeted, observe, incident, governance } from './batch-c-authoritative-matrix-fixture';



test("C-REVIEW-03 unrelated Review baseline is quarantined", async () => {
  const result = compose({ prior: [], current: [{ key: "review-baseline", sourcePhase: "review", relationship: "unrelated_baseline", status: "pre_existing" }] });
  assertBatchCContract(await observe(result), { action: "advance_verification", rationale: ["VERIFY_STAGE_ADVANCE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(result.plan.dossier?.delta?.newUnrelatedBaseline).toHaveLength(1);
});


test("C-TERM-01 governance continue cannot manufacture repair", async () => {
  const result = compose({ prior: [{ key: "oracle", root: "oracle", severity: "low" }], current: [{ key: "oracle", root: "oracle", severity: "low" }], governance: governance(incident({ failures: false })) });
  assertBatchCContract(await observe(result), { action: "correct_oracle", rationale: ["ORACLE_STALE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-02 governance repair cannot manufacture repair", async () => {
  const result = compose({ prior: [{ key: "runtime", root: "environment", severity: "low" }], current: [{ key: "runtime", root: "environment", severity: "low" }], governance: governance(incident({ attempts: 1 })) });
  assertBatchCContract(await observe(result), { action: "diagnose_runtime", rationale: ["RUNTIME_AMBIGUOUS"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-03 soft budget checkpoints a targeted repair", async () => {
  const result = compose({ governance: governance(incident({ runtimeTokens: 50_000 })) });
  assertBatchCContract(await observe(result), { action: "checkpoint", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR", "TERMINAL_CHECKPOINT"], terminal: "checkpoint", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-04 repeated fingerprint replans a targeted repair", async () => {
  const result = compose({ governance: governance(incident({ attempts: 2 })) });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR", "TERMINAL_REPLAN"], terminal: "replan", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-05 escalation threshold escalates a targeted repair", async () => {
  const result = compose({ governance: governance(incident({ attempts: 3 })) });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR", "TERMINAL_ESCALATE"], terminal: "escalate", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-06 hard budget stops a targeted repair", async () => {
  const result = compose({ governance: governance(incident({ runtimeTokens: 70_000 })) });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR", "TERMINAL_BUDGET_BLOCK"], terminal: "stop", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-TERM-07 override cannot weaken authority Git security or Full-SDD floors", async () => {
  const result = compose({
    prior: [{ key: "security", root: "security", severity: "critical", isSecurityRelevant: true }],
    current: [{ key: "security", root: "security", severity: "low", isSecurityRelevant: true }],
    lane: "full_sdd",
    authority: { state: "invalid", rationaleCode: "AUTHZ_INVALID", rejectionCode: "revoked", reference: null },
    gitSafety: { state: "confirmation-required", commandDigest: sha("e"), rationaleCode: "GIT_SAFETY_CONFIRMATION_REQUIRED" },
    governance: governance(incident({ runtimeTokens: 70_000 }), { operatingMode: "automatic", hardStopOverride: { reason: "reviewed", at: "2026-07-16T01:00:00Z" } }),
  });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["AUTHZ_INVALID", "TERMINAL_CHECKPOINT"], terminal: "checkpoint", digest: "replay-equivalent", authority: "invalid", git: "confirmation-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-LEGACY-01 explicit no-dossier mode preserves exact legacy behavior", async () => {
  const result = composeDeveloperTeamExecutionV1({
    schema: "developer-team-execution-composition-v1",
    mode: "legacy",
    legacyInput,
    dossier: { kind: "none" },
    authority: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
    gitSafety: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
    governance: { kind: "none" },
    effectBinding: { kind: "none" },
  });
  assertBatchCContract(await observe(result), { action: "none", rationale: [], terminal: "none", digest: "not-applicable", authority: "not-applicable", git: "not-applicable", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "legacy-authoritative" });
  expect(result.legacy).toEqual(runOrchestratorPipeline(legacyInput));
});


test("C-SHADOW-01 shadow without legacy input is rejected", async () => {
  const input = compositionInput({ mode: "shadow" });
  delete input.legacyInput;
  const result = composeDeveloperTeamExecutionV1(input);
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
});


test("C-SHADOW-02 valid shadow records comparison with legacy authority", async () => {
  const result = compose({ mode: "shadow" });
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "legacy-authoritative" });
  expect(result.legacy).toEqual(runOrchestratorPipeline(legacyInput));
  expect(result.comparison.v1Action).toBe("targeted_repair");
});


test("C-SHADOW-03 targeted shadow recommendation cannot invoke capability", async () => {
  const provisional = compose({ mode: "shadow" });
  const capability = descriptor(provisional);
  const result = compose({ mode: "shadow", authority: authorized(capability.capabilityDigest) });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "legacy-authoritative" });
  const boundShadow = compose({ mode: "shadow", authority: authorized(capability.capabilityDigest), effectBinding: capability });
  expect(boundShadow.plan.reasonCode).toBe("invalid-evidence");
});


test("C-REPLAY-01 valid record replays twice exactly", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(replayExecutionDecisionV1(result.plan.replayRecord)).toEqual(replayExecutionDecisionV1(result.plan.replayRecord));
});


test("C-REPLAY-02 caller mutation cannot alter frozen replay", async () => {
  const rawDossier = structuredClone(dossier()) as any;
  const rawAuthority: any = authorized();
  const rawGovernance: any = { kind: "none" };
  const result = compose({ dossierValue: rawDossier, authority: rawAuthority, governance: rawGovernance });
  const original = structuredClone(result.plan.decision);
  rawDossier.batch.changeId = "tampered";
  rawAuthority.state = "invalid";
  rawGovernance.kind = "tampered";
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(result.plan.replay()).toEqual(original);
});


test("C-REPLAY-03 replay record is frozen and forged digest is rejected", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(Object.isFrozen(result.plan.replayRecord)).toBe(true);
  const forged = { ...result.plan.replayRecord, inputDigest: sha("f") };
  expect(replayExecutionDecisionV1(forged)).toBeUndefined();
});


test("C-INVALID-01 cyclic dossier returns frozen safe invalid identity", async () => {
  const value: any = {};
  value.self = value;
  const result = compose({ dossierValue: value });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(Object.isFrozen(result.plan.replayRecord)).toBe(true);
});


test("C-INVALID-02 prototype-bearing dossier returns safe fixed identity", async () => {
  const result = compose({ dossierValue: Object.create({ schema: "execution-dossier-v1" }) });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(result.plan.replayRecord.outcome === "invalid" && result.plan.replayRecord.invalidInput.failure).toBe("prototype");
});


test("C-INVALID-03 throwing getter is contained without raw leakage", async () => {
  const value = Object.create(null, { schema: { enumerable: true, get() { throw new Error("GETTER_SECRET"); } } });
  const result = compose({ dossierValue: value });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(JSON.stringify(result)).not.toContain("GETTER_SECRET");
});


test("C-INVALID-04 revoked proxy uses unclassifiable fallback", async () => {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  const result = compose({ dossierValue: revocable.proxy });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(result.plan.replayRecord.outcome === "invalid" && result.plan.replayRecord.invalidInput.valueClass).toBe("unclassifiable");
});


test("C-INVALID-05 secret-bearing invalid inputs share safe class identity", async () => {
  const first = compose({ dossierValue: { secret: "FIRST_SECRET_SENTINEL" } });
  const second = compose({ dossierValue: { secret: "SECOND_SECRET_SENTINEL" } });
  assertBatchCContract(await observe(first), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(first.plan.inputDigest).toBe(second.plan.inputDigest);
  expect(JSON.stringify(first)).not.toMatch(/FIRST_SECRET_SENTINEL|SECOND_SECRET_SENTINEL/);
});


test("C-INVALID-06 unsupported dossier version has safe identity", async () => {
  const result = compose({ dossierValue: { schema: "execution-dossier-v99" } });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
  expect(result.plan.replayRecord.outcome === "invalid" && result.plan.replayRecord.invalidInput.failure).toBe("unsupported-version");
});


test("C-EFFECT-01 capability digest mismatch is denied", async () => {
  const { result, capability } = boundTargeted();
  const forged = { ...capability, capabilityDigest: sha("f") };
  assertBatchCContract(await observe(result, forged), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } }, legacy: "not-applicable" });
  const unbound = compose({ authority: authorized(capability.capabilityDigest) });
  expect((await observe(unbound, capability)).effect).toEqual({ count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } });
  if (result.plan.replayRecord.outcome !== "valid") throw new Error("matrix setup requires a valid replay record");
  let forgedCalls = 0;
  const forgedPlan = {
    mode: "active",
    inputDigest: result.plan.inputDigest,
    decision: result.plan.decision,
    dossier: result.plan.dossier,
    replayRecord: {
      outcome: "valid",
      authority: result.plan.replayRecord.authority,
      gitSafety: result.plan.replayRecord.gitSafety,
      effectBinding: result.plan.replayRecord.effectBinding,
    },
    replay: () => result.plan.decision,
  } as any;
  const adapter = { descriptor: capability, invoke: async () => { forgedCalls++; return { invoked: true as const }; } };
  expect(await executeTargetedRepairV1(forgedPlan, adapter)).toEqual({ invoked: false, reasonCode: "invalid-evidence" });
  expect(forgedCalls).toBe(0);
  const corruptedPlan = { ...result.plan, replayRecord: { ...result.plan.replayRecord, inputDigest: sha("f") } } as any;
  expect(await executeTargetedRepairV1(corruptedPlan, adapter)).toEqual({ invoked: false, reasonCode: "invalid-evidence" });
  expect(forgedCalls).toBe(0);
});


test("C-EFFECT-02 target outside exact allowed scope is denied", async () => {
  const { result, capability } = boundTargeted({}, { target: "packages/core" });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } }, legacy: "not-applicable" });
});


test("C-EFFECT-03 target intersecting blocked scope is denied", async () => {
  const blockedBatch = makeBatch(["packages/sdd-runtime/private"], ["packages/sdd-runtime", "openspec/changes/runner-capability-standardization"]);
  const { result, capability } = boundTargeted({ batch: blockedBatch }, { target: "packages/sdd-runtime/private" });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } }, legacy: "not-applicable" });
});


test("C-EFFECT-04 diagnosis action cannot delegate", async () => {
  const result = compose({ prior: [{ key: "runtime", root: "environment", severity: "critical" }], current: [{ key: "runtime", root: "environment", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "diagnose_runtime", rationale: ["RUNTIME_AMBIGUOUS"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-05 oracle-correction action cannot delegate", async () => {
  const result = compose({ prior: [{ key: "oracle", root: "oracle", severity: "critical" }], current: [{ key: "oracle", root: "oracle", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "correct_oracle", rationale: ["ORACLE_STALE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-06 Spec-replan action cannot delegate", async () => {
  const result = compose({ prior: [{ key: "requirement", root: "requirement", severity: "critical" }], current: [{ key: "requirement", root: "requirement", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "replan_spec", rationale: ["ROOT_REQUIREMENT_GAP"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-07 Design-replan action cannot delegate", async () => {
  const result = compose({ prior: [{ key: "architecture", root: "architecture", severity: "critical" }], current: [{ key: "architecture", root: "architecture", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["ROOT_DESIGN_GAP"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-08 checkpoint action cannot delegate", async () => {
  const unchanged = { key: "unchanged", severity: "low" as const };
  const result = compose({ prior: [unchanged], current: [unchanged] });
  assertBatchCContract(await observe(result), { action: "checkpoint", rationale: ["DELTA_NONE_CHECKPOINT"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-09 escalation action cannot delegate", async () => {
  const result = compose({ prior: [{ key: "security", root: "security", severity: "critical", isSecurityRelevant: true }], current: [{ key: "security", root: "security", severity: "low", isSecurityRelevant: true }] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["SECURITY_REGRESSION"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-10 stop action cannot delegate", async () => {
  const result = compose({ authority: { state: "missing", rationaleCode: "AUTHZ_MISSING" } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["AUTHZ_MISSING"], terminal: "permit", digest: "replay-equivalent", authority: "missing", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-11 completion action cannot delegate", async () => {
  const result = compose({ prior: [], current: [], nextStage: null });
  assertBatchCContract(await observe(result), { action: "complete", rationale: ["NO_OPEN_FINDINGS_COMPLETE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-EFFECT-12 adapter error is terminal and never retried", async () => {
  const { result, capability } = boundTargeted();
  assertBatchCContract(await observe(result, capability, "throw"), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 1, target: "packages/sdd-runtime", result: { invoked: false, reasonCode: "adapter-error" } }, legacy: "not-applicable" });
});


test("C-EXPORT-01 package root exports the complete literal surface", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  const expected = ["DEFAULT_BUDGET_CONFIG","DEFAULT_DISCOVERY_CONFIG","DEFAULT_ENFORCEMENT_CONFIG","DEFAULT_LOOP_BREAKER_CONFIG","DEFAULT_ORCHESTRATOR_PERSONALITY","DEFAULT_PIPELINE_CONFIG","DEFAULT_RECOVERY_CONFIG","DEFAULT_RISK_THRESHOLDS","DEFAULT_ROUTER_CONFIG","DEFAULT_RUNNER_PIPELINE_CONFIG","DEFAULT_SCORER_CONFIG","ORCHESTRATOR_PERSONALITIES","adaptDossierToRepairIncidentV1","adaptLaneToCheckPlanV1","adaptRepairIncidentToFailureManifestV1","aggregateDeckPreparationHandoffV1","aggregateRolloutTelemetryV1","applyEnforcement","assignExecutionCohort","assignExecutionLaneCohortV1","attemptResume","buildApplyBatchContractV1","buildAuthorizationReferenceV1","buildCausalContextV1","buildExecutionDecisionV1","buildFailureManifestV1","buildInvocationAuthorizationClaimsV1","buildLaneDecisionV1","buildRegistryIntentV1","buildSessionPreparationDelegationDigestV1","buildStagedVerificationStateV1","capabilityDescriptorDigestV1","checkBudget","checkLoopCondition","classifyFailure","classifyInvalidExecutionInputV1","classifyProtectedRiskV1","classifyTransportFailure","composeDeveloperTeamExecutionV1","computeFailureDeltaV1","computeRiskScore","consumeExecutionRoleResultV1","consumeSessionPreparationAuthorizationV1","createBoundedLocalTelemetrySink","createConfiguredTelemetrySinkV1","createDeveloperTeamRunnerHostBridgeV1","createExecutionDossierV1","createInvocationAuthorizationServiceV1","createNoopTelemetrySink","createProjectDiscoveryAdapter","createSessionPreparationAuthorizationServiceV1","createSessionPreparationStateV1","createStagedVerificationScheduleV1","evaluateExecutionDecisionV1","evaluateFreshnessPolicyV1","evaluateRepairIncident","evaluateRolloutGateV1","executeDeveloperTeamStepV1","executeTargetedRepairV1","parseApplyBatchContractV1","parseAuthorizationReferenceV1","parseCausalContextV1","parseDeckPreparationHandoffV1","parseExecutionDecisionV1","parseExecutionDossierV1","parseExecutionRoleInvocationV1","parseFailureDeltaV1","parseFailureManifestV1","parseInvocationAuthorizationClaimsV1","parseLaneDecisionV1","parseRegistryIntentV1","parseRepairIncidentYAML","parseSessionPreparationRequestV1","parseStagedVerificationStateV1","planExecutionDecisionV1","probeRunnerExecutionCapabilities","projectCausalContextForRoleV1","recordBoundedBaseline","replayExecutionDecisionV1","resolveEnforcementMode","reviseExecutionDossierV1","routeQuality","runOrchestratorPipeline","runProductionExecutionDecisionPipelineV1","runRunnerPipeline","scheduleExecutionRoleInvocationV1","selectExecutionLaneV1","serializeSafeTelemetryEvent","submitStateUpdate","transitionRolloutStateV1","transitionStagedVerificationV1","validateAdapterCapabilities","validateArtifactForResume","validatePhaseOutcome","validateRiskResult","validateSelfAudit","validateStateUpdate","validateTransportContext","validateVerificationAcceptanceV1","validateVerificationDisciplineV1"];
  const registryExpected = ["buildRegistryPairTransactionV1", "classifyRegistryRecoveryV1", "commitExecutionRegistryIntentsV1", "createFileSystemRegistryStoreV1", "createNodeRegistryFileSystemPortV1", "createRegistryCoordinatorV1", "markRegistryTransactionCommittedV1", "parseRegistryPairTransactionV1"];
  const effectivenessExpected = ["BASELINE_DISPOSITION_POLICY_VERSION_V1", "BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1", "aggregateUserOutcomeTelemetryV1", "applyGenesisAtomicallyV1", "assertCriticalApplyPreflightV1", "assessCoordinationV1", "bindExecutionPlanQaAuthorityV1", "broadDispositionIsReadyV1", "buildApplyPreflightReceiptV1", "buildApprovalReceiptV1", "buildAuthoritativeOutcomeV1", "buildBaselineEvidenceEnvelopeV1", "buildBroadCausalDispositionEnvelopeV1", "buildCandidateRefV1", "buildNormalizedFindingFingerprintV1", "buildProtectedRequirementSnapshotV1", "buildRegistryLifecycleIntentV1", "buildReviewConvergenceResultV1", "buildVerificationCheckResultV1", "buildVerificationStageExecutionPlanV1", "consumeApprovalReceiptV1", "createQaRunnerHostAuthorityV1", "decideDeveloperTeamLeadershipV1", "decideQaNextActionV1", "decideQualityReadinessV1", "deriveQaImpactInvalidationV1", "evaluateFindingDispositionBaselineV1", "evaluateGovernanceRecoveryV1", "evaluateProcessPostureV1", "executeVerificationStageV1", "joinVerificationStageExecutionV1", "parseApprovalReceiptV1", "parseBaselineEvidenceEnvelopeV1", "parseBroadCausalDispositionEnvelopeV1", "parseCandidateRefV1", "parseQaAuthorityBindingV1", "parseQaAuthoritySnapshotV1", "parseQualityDispositionEnvelopeV1", "parseQualityReadinessDecisionV1", "parseRegistryLifecycleIntentV1", "parseReviewConvergenceResultV1", "parseVerificationCheckResultV1", "parseVerificationStageExecutionPlanV1", "planLegacyGenesisV1", "reconcileAuthoritativeOutcomesV1", "registryLifecycleEventV1", "selectSessionChangeV1", "serializeUserOutcomeTelemetryAggregateV1", "serializeUserOutcomeTelemetryEventV1", "validateCandidateRefV1"];
  expect(Object.keys(publicApi).sort()).toEqual([...expected, "createTaskSkillDiscoveryHostV1", "parseExecutionDossierHistoryV1", ...registryExpected, ...effectivenessExpected, "parseRegistryAtomicCommitReceiptV1", "parseVerificationWaveExecutionReceiptV1", "parseVerificationStageExecutionJoinV1", "isTrustedRegistryCoordinatorV1"].sort());
});