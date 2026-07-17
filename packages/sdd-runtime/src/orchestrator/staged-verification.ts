import type { BatchId, VerificationStage } from "../contracts/apply-batch";
import { assertDigest, deepFreeze, normalizeSet, type Sha256Digest } from "../contracts/canonical";
import type { SafeEvidenceRefV1 } from "../contracts/failure-manifest";
import {
  buildStagedVerificationStateV1,
  parseStagedVerificationStateV1,
  type StageStatus,
  type StagedVerificationStateV1,
  type VerificationOmissionEvidenceV1,
  type VerificationStageStateV1,
} from "../contracts/verification-state";
import type { ExecutionLane } from "../contracts/execution-lane";

const STAGES = ["targeted", "affected_area", "broad"] as const;
const MANDATORY_BROAD_REASONS = new Set<MandatoryBroadReasonV1>([
  "security", "authorization", "data_loss", "migration", "destructive", "public_api",
  "cross_package_architecture", "incident", "material_repair",
]);

export type MandatoryBroadReasonV1 =
  | "security"
  | "authorization"
  | "data_loss"
  | "migration"
  | "destructive"
  | "public_api"
  | "cross_package_architecture"
  | "incident"
  | "material_repair";

export interface StagedVerificationPolicyV1 {
  readonly lane: ExecutionLane;
  readonly broadRequired: boolean;
  readonly mandatoryBroadReasons: readonly MandatoryBroadReasonV1[];
  readonly broadDeferralPolicyIds: readonly string[];
}

export interface VerificationStageTransitionV1 {
  readonly stage: VerificationStage;
  readonly status: "passed" | "failed" | "skipped" | "deferred";
  readonly evidence: readonly SafeEvidenceRefV1[];
  readonly omission?: VerificationOmissionEvidenceV1;
}

export interface StagedVerificationTransitionResultV1 {
  readonly code: "advanced" | "complete" | "verification-evidence-required" | "lane-floor-violation" | "invalid-evidence";
  readonly rationaleCode: string;
  readonly state: StagedVerificationStateV1;
}

function result(
  code: StagedVerificationTransitionResultV1["code"],
  rationaleCode: string,
  state: StagedVerificationStateV1,
): StagedVerificationTransitionResultV1 {
  return deepFreeze({ code, rationaleCode, state });
}

function completeOmission(omission: VerificationOmissionEvidenceV1 | undefined): omission is VerificationOmissionEvidenceV1 {
  try {
    return omission !== undefined && typeof omission.reasonCode === "string" && omission.reasonCode.length > 0 &&
      typeof omission.policyId === "string" && omission.policyId.length > 0 &&
      (omission.expiresAt !== undefined || omission.nextTrigger !== undefined) &&
      typeof omission.riskAcceptance?.actor === "string" && omission.riskAcceptance.actor.length > 0 &&
      typeof omission.riskAcceptance.acceptedAt === "string" && omission.riskAcceptance.acceptedAt.length > 0 &&
      typeof omission.riskAcceptance.rationaleCode === "string" && omission.riskAcceptance.rationaleCode.length > 0 &&
      typeof omission.evidence?.checkId === "string" && omission.evidence.checkId.length > 0 &&
      typeof omission.evidence.artifact === "string" && omission.evidence.artifact.length > 0;
  } catch {
    return false;
  }
}

function policyIsValid(policy: StagedVerificationPolicyV1): boolean {
  return policy !== null && typeof policy === "object" &&
    ["fast", "guarded", "full_sdd"].includes(policy.lane) && typeof policy.broadRequired === "boolean" &&
    Array.isArray(policy.mandatoryBroadReasons) &&
    policy.mandatoryBroadReasons.every((reason) => MANDATORY_BROAD_REASONS.has(reason)) &&
    new Set(policy.mandatoryBroadReasons).size === policy.mandatoryBroadReasons.length &&
    Array.isArray(policy.broadDeferralPolicyIds) &&
    policy.broadDeferralPolicyIds.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(id)) &&
    new Set(policy.broadDeferralPolicyIds).size === policy.broadDeferralPolicyIds.length;
}

function scheduleIsCanonical(state: StagedVerificationStateV1): boolean {
  return state.stages.length === STAGES.length && state.stages.every((stage, index) => stage.stage === STAGES[index]) &&
    state.stages.filter((stage) => stage.status === "running").length <= 1;
}

function stageEvidenceComplete(stage: VerificationStageStateV1, evidence: readonly SafeEvidenceRefV1[]): boolean {
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  return stage.checkIds.every((checkId) => evidence.some((item) => item.checkId === checkId));
}

export function createStagedVerificationScheduleV1(input: {
  readonly batchId: BatchId;
  readonly checkIds: Readonly<Record<VerificationStage, readonly string[]>>;
}): StagedVerificationStateV1 {
  return buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: input.batchId,
    stages: STAGES.map((stage) => ({ stage, status: "pending" as const, checkIds: normalizeSet(input.checkIds[stage], `verification.${stage}.checkIds`), evidence: [] })),
    nextStage: "targeted",
  });
}

export function transitionStagedVerificationV1(
  stateValue: unknown,
  transition: VerificationStageTransitionV1,
  policy: StagedVerificationPolicyV1,
): StagedVerificationTransitionResultV1 {
  let state: StagedVerificationStateV1;
  try { state = parseStagedVerificationStateV1(stateValue); }
  catch {
    const fallback = buildStagedVerificationStateV1({ schema: "staged-verification-state-v1", batchId: "batch:v1:00000000000000000000000000000000" as BatchId, stages: [] });
    return result("invalid-evidence", "VERIFY_STATE_INVALID", fallback);
  }
  if (!policyIsValid(policy) || !transition || typeof transition !== "object" ||
    !["passed", "failed", "skipped", "deferred"].includes(transition.status) || !Array.isArray(transition.evidence)) {
    return result("invalid-evidence", "VERIFY_POLICY_OR_TRANSITION_INVALID", state);
  }
  if (!scheduleIsCanonical(state) || !STAGES.includes(transition.stage) || state.nextStage !== transition.stage) {
    return result("invalid-evidence", "VERIFY_STAGE_ORDER_INVALID", state);
  }
  const stageIndex = STAGES.indexOf(transition.stage);
  if (state.stages.slice(0, stageIndex).some((stage) => stage.status !== "passed" && stage.status !== "skipped" && stage.status !== "deferred")) {
    return result("verification-evidence-required", "VERIFY_PRIOR_STAGE_INCOMPLETE", state);
  }
  const current = state.stages[stageIndex];
  if (current.status !== "pending" && current.status !== "running") return result("invalid-evidence", "VERIFY_STAGE_ALREADY_TERMINAL", state);

  const omitted = transition.status === "skipped" || transition.status === "deferred";
  if (!omitted && !stageEvidenceComplete(current, transition.evidence)) {
    return result("verification-evidence-required", "VERIFY_STAGE_EVIDENCE_MISSING", state);
  }
  if (omitted && !completeOmission(transition.omission)) {
    return result("verification-evidence-required", "VERIFY_OMISSION_EVIDENCE_MISSING", state);
  }
  if (transition.stage === "targeted" && omitted) {
    return result("lane-floor-violation", "VERIFY_TARGETED_MANDATORY", state);
  }
  if (transition.stage === "broad" && omitted) {
    if (policy.lane === "full_sdd" || policy.mandatoryBroadReasons.length > 0) {
      return result("lane-floor-violation", "VERIFY_BROAD_MANDATORY", state);
    }
    if (transition.omission!.reasonCode === "policy_deferred" &&
      !policy.broadDeferralPolicyIds.includes(transition.omission!.policyId) ||
      policy.broadRequired && transition.omission!.reasonCode !== "policy_deferred") {
      return result("lane-floor-violation", "VERIFY_BROAD_DEFERRAL_NOT_AUTHORIZED", state);
    }
  }
  if (omitted && transition.omission!.reasonCode === "blocked_by_prior_stage") {
    return result("invalid-evidence", "VERIFY_FAILED_STAGE_BLOCKS_ADVANCE", state);
  }

  const stages = state.stages.map((stage, index): VerificationStageStateV1 => index === stageIndex ? {
    stage: stage.stage,
    status: transition.status,
    checkIds: stage.checkIds,
    evidence: omitted ? [transition.omission!.evidence] : transition.evidence,
    ...(omitted ? { skipReason: transition.omission!.reasonCode, omission: transition.omission } : {}),
  } : stage);
  const advances = transition.status !== "failed";
  const nextStage = advances ? STAGES[stageIndex + 1] : undefined;
  let next: StagedVerificationStateV1;
  try {
    next = buildStagedVerificationStateV1({
      schema: "staged-verification-state-v1",
      batchId: state.batchId,
      stages,
      ...(nextStage === undefined ? {} : { nextStage }),
    });
  } catch {
    return result("invalid-evidence", "VERIFY_TRANSITION_INVALID", state);
  }
  if (!advances) return result("verification-evidence-required", "VERIFY_STAGE_FAILED", next);
  return result(nextStage === undefined ? "complete" : "advanced", nextStage === undefined ? "VERIFY_COMPLETE" : "VERIFY_STAGE_ADVANCE", next);
}

export function validateVerificationAcceptanceV1(
  stateValue: unknown,
  policy: StagedVerificationPolicyV1,
): StagedVerificationTransitionResultV1 {
  let state: StagedVerificationStateV1;
  try { state = parseStagedVerificationStateV1(stateValue); }
  catch {
    const fallback = buildStagedVerificationStateV1({ schema: "staged-verification-state-v1", batchId: "batch:v1:00000000000000000000000000000000" as BatchId, stages: [] });
    return result("invalid-evidence", "VERIFY_STATE_INVALID", fallback);
  }
  if (!policyIsValid(policy)) return result("invalid-evidence", "VERIFY_POLICY_INVALID", state);
  if (!scheduleIsCanonical(state) || state.nextStage !== undefined) return result("verification-evidence-required", "VERIFY_STAGES_INCOMPLETE", state);
  for (const stage of state.stages) {
    if (stage.status === "failed" || stage.status === "pending" || stage.status === "running") {
      return result("verification-evidence-required", "VERIFY_STAGES_INCOMPLETE", state);
    }
    if ((stage.status === "skipped" || stage.status === "deferred") && !completeOmission(stage.omission)) {
      return result("verification-evidence-required", "VERIFY_OMISSION_EVIDENCE_MISSING", state);
    }
    if (stage.status === "passed" && !stageEvidenceComplete(stage, stage.evidence)) {
      return result("verification-evidence-required", "VERIFY_STAGE_EVIDENCE_MISSING", state);
    }
  }
  if (state.stages[0].status !== "passed") return result("lane-floor-violation", "VERIFY_TARGETED_MANDATORY", state);
  const broad = state.stages[2];
  if (broad.status !== "passed" && (policy.lane === "full_sdd" || policy.mandatoryBroadReasons.length > 0)) {
    return result("lane-floor-violation", "VERIFY_BROAD_MANDATORY", state);
  }
  if ((broad.status === "skipped" || broad.status === "deferred") &&
    (broad.omission?.reasonCode === "policy_deferred" && !policy.broadDeferralPolicyIds.includes(broad.omission.policyId) ||
      policy.broadRequired && broad.omission?.reasonCode !== "policy_deferred")) {
    return result("lane-floor-violation", "VERIFY_BROAD_DEFERRAL_NOT_AUTHORIZED", state);
  }
  return result("complete", "VERIFY_ACCEPTED", state);
}

export interface VerificationDisciplineEvidenceV1 {
  readonly behaviorChanged: boolean;
  readonly priorFailingTest?: SafeEvidenceRefV1;
  readonly generatedOutputsChanged: readonly string[];
  readonly canonicalSourcesChanged: readonly string[];
  readonly generatorInvocation?: SafeEvidenceRefV1;
  readonly firstRegenerationDigest?: Sha256Digest;
  readonly secondRegenerationDigest?: Sha256Digest;
  readonly directGeneratedEdit: boolean;
}

export function validateVerificationDisciplineV1(
  stateValue: unknown,
  evidence: VerificationDisciplineEvidenceV1,
): { readonly code: "accepted" | "verification-evidence-required"; readonly rationaleCodes: readonly string[] } {
  let state: StagedVerificationStateV1;
  try { state = parseStagedVerificationStateV1(stateValue); }
  catch { return deepFreeze({ code: "verification-evidence-required", rationaleCodes: ["VERIFY_STATE_INVALID"] }); }
  const rationaleCodes: string[] = [];
  if (evidence.behaviorChanged && evidence.priorFailingTest?.resultCode !== "failed-before-implementation") rationaleCodes.push("TDD_PRIOR_FAILURE_REQUIRED");
  if (evidence.behaviorChanged && (!scheduleIsCanonical(state) || state.nextStage !== undefined ||
    state.stages.some((stage) => stage.status !== "passed" && stage.status !== "skipped" && stage.status !== "deferred"))) {
    rationaleCodes.push("TDD_PASSING_STAGES_REQUIRED");
  }
  if (evidence.generatedOutputsChanged.length > 0) {
    if (evidence.directGeneratedEdit) rationaleCodes.push("GENERATED_DIRECT_EDIT");
    if (evidence.canonicalSourcesChanged.length === 0) rationaleCodes.push("GENERATED_CANONICAL_SOURCE_REQUIRED");
    if (!evidence.generatorInvocation) rationaleCodes.push("GENERATED_INVOCATION_REQUIRED");
    let regenerationDigestsValid = true;
    try {
      assertDigest(evidence.firstRegenerationDigest, "verification.firstRegenerationDigest");
      assertDigest(evidence.secondRegenerationDigest, "verification.secondRegenerationDigest");
    } catch {
      regenerationDigestsValid = false;
    }
    if (!regenerationDigestsValid || evidence.firstRegenerationDigest !== evidence.secondRegenerationDigest) {
      rationaleCodes.push("GENERATED_DETERMINISM_REQUIRED");
    }
  }
  const normalized = normalizeSet(rationaleCodes, "verification.discipline.rationaleCodes");
  return deepFreeze({ code: normalized.length === 0 ? "accepted" : "verification-evidence-required", rationaleCodes: normalized });
}
