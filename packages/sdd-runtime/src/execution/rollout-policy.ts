import { deepFreeze, sha256Digest, type Sha256Digest } from "../contracts/canonical";
import type {
  RolloutMetricObservationV1,
  RolloutObservationV1,
  TelemetryLaneV1,
  TelemetryRiskTierV1,
} from "./telemetry";

export type RolloutCohortPercentV1 = 0 | 5 | 25 | 50 | 100;
export type RolloutGateStatusV1 = "eligible" | "rollout-paused";

export type RolloutControlsV1 = Readonly<{
  executionContracts: "off" | "observe" | "enforce";
  decisionKernel: "legacy" | "shadow" | "active";
  invocationAuthorization: Readonly<{
    default: "static-compatible" | "invocation-required";
    opencode?: "static-compatible" | "invocation-required";
    pi?: "static-compatible" | "invocation-required";
  }>;
  registryWriter: "distributed-compatible" | "centralized";
  routePolicy: "legacy-triage" | "shadow-risk-lanes" | "risk-lanes";
  promptProfile: "legacy" | "compact";
  telemetry: "off" | "local-safe";
}>;

export type RolloutEfficiencyV1 = Readonly<{
  riskTier: TelemetryRiskTierV1;
  lane: TelemetryLaneV1;
  acceptedCompletionImprovementPercent: number | null;
  phaseLaunchImprovementPercent: number | null;
  noPositiveDeltaCycleImprovementPercent: number | null;
  registryConflictImprovementPercent: number | null;
  controlPlaneP95Ms: number | null;
  meetsSpecValueTarget: boolean;
  meetsDesignEfficiencyTargets: boolean;
}>;

export type RolloutGateDecisionV1 = Readonly<{
  schema: "rollout-gate-decision-v1";
  status: RolloutGateStatusV1;
  currentCohortPercent: RolloutCohortPercentV1;
  requestedCohortPercent: RolloutCohortPercentV1;
  effectiveCohortPercent: RolloutCohortPercentV1;
  reasonCodes: readonly string[];
  efficiency: readonly RolloutEfficiencyV1[];
  evidenceDigest: Sha256Digest;
}>;

export type PromptProfileActivationV1 = Readonly<{
  schema: "prompt-profile-activation-v1";
  status: RolloutGateStatusV1;
  requestedProfile: "legacy" | "compact";
  effectiveProfile: "legacy" | "compact";
  reasonCodes: readonly string[];
  evidenceDigest: Sha256Digest;
}>;

export type RolloutHistoryEventV1 = Readonly<{
  schema: "rollout-history-event-v1";
  observedDay: number;
  status: "legacy-compatible" | "observe" | "active" | "rollout-paused" | "rolled-back";
  cohortPercent: RolloutCohortPercentV1;
  reasonCodes: readonly string[];
  evidenceDigest: Sha256Digest;
}>;

export type RolloutStateV1 = Readonly<{
  schema: "developer-team-rollout-state-v1";
  status: RolloutHistoryEventV1["status"];
  cohortPercent: RolloutCohortPercentV1;
  automaticEffectsEnabled: boolean;
  controls: RolloutControlsV1;
  permanentFloors: Readonly<{
    explicitFullSdd: boolean;
    freshReview: boolean;
    gitSafety: boolean;
    requiredAuthorization: boolean;
  }>;
  history: readonly RolloutHistoryEventV1[];
}>;

export type RolloutResponsibleControlV1 =
  | "executionContracts"
  | "decisionKernel"
  | "invocationAuthorization"
  | "registryWriter"
  | "routePolicy"
  | "promptProfile"
  | "telemetry";

const COHORT_STEPS: readonly RolloutCohortPercentV1[] = [0, 5, 25, 50, 100];
const RISK_TIERS: readonly TelemetryRiskTierV1[] = ["low", "medium", "high", "critical"];
const LANES: readonly TelemetryLaneV1[] = ["fast", "guarded", "full_sdd"];
const ACTIVE_PAUSE_REASONS = new Set([
  "deterministic-replay-mismatch",
  "batch-reference-discontinuity",
  "authorization-bypass",
  "registry-history-violation",
  "broad-check-noncompliance",
  "fresh-review-noncompliance",
  "lane-floor-violation",
  "adapter-semantic-divergence",
  "escaped-critical-finding",
  "escaped-security-architecture-regression",
  "accepted-completion-regression",
]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validRolloutObservation(observation: RolloutObservationV1): boolean {
  if (
    observation?.schema !== "rollout-observation-v1"
    || !isNonNegativeInteger(observation.eligibleExecutions)
    || !isNonNegativeInteger(observation.consecutiveDays)
    || !Array.isArray(observation.observedRunners)
    || observation.observedRunners.some((runner) => runner !== "opencode" && runner !== "pi")
    || new Set(observation.observedRunners).size !== observation.observedRunners.length
    || !observation.safety
    || !Array.isArray(observation.metrics)
    || observation.metrics.length === 0
  ) return false;
  if (observation.consecutiveDays > observation.eligibleExecutions) return false;

  const safety = observation.safety;
  const countValues = [
    safety.replayMismatchCount,
    safety.batchReferenceBreakCount,
    safety.authorizationBypassCount,
    safety.registryHistoryLossCount,
    safety.duplicateRegistryEventCount,
    safety.broadCheckMissCount,
    safety.freshReviewMissCount,
    safety.laneFloorDowngradeCount,
    safety.adapterDivergenceCount,
    safety.escapedCriticalFindingCount,
  ];
  if (
    countValues.some((value) => !isNonNegativeInteger(value))
    || !isFiniteNonNegative(safety.baselineSecurityArchitectureEscapeRate)
    || !isFiniteNonNegative(safety.candidateSecurityArchitectureEscapeRate)
  ) return false;

  const metricKeys = new Set<string>();
  let baselineTotal = 0;
  let candidateTotal = 0;
  for (const metric of observation.metrics) {
    if (!RISK_TIERS.includes(metric.riskTier) || !LANES.includes(metric.lane)) return false;
    const key = `${metric.riskTier}:${metric.lane}`;
    if (metricKeys.has(key)) return false;
    metricKeys.add(key);
    if (!isNonNegativeInteger(metric.baselineCount) || !isNonNegativeInteger(metric.candidateCount)) return false;
    baselineTotal += metric.baselineCount;
    candidateTotal += metric.candidateCount;
    const measurements = [
      metric.baselineMedianAcceptedCompletionMs,
      metric.candidateMedianAcceptedCompletionMs,
      metric.baselineMedianPhaseLaunchCount,
      metric.candidateMedianPhaseLaunchCount,
      metric.baselineNoPositiveDeltaCycleRate,
      metric.candidateNoPositiveDeltaCycleRate,
      metric.baselineRegistryConflictRate,
      metric.candidateRegistryConflictRate,
      metric.candidateControlPlaneP95Ms,
    ];
    if (measurements.some((value) => value !== null && !isFiniteNonNegative(value))) return false;
  }
  return candidateTotal === observation.eligibleExecutions
    && baselineTotal >= observation.eligibleExecutions;
}

function percentageImprovement(baseline: number | null, candidate: number | null): number | null {
  if (baseline === null || candidate === null) return null;
  if (baseline === 0) return candidate === 0 ? 0 : -100;
  return Math.round(((baseline - candidate) / baseline) * 10_000) / 100;
}

function efficiency(metric: RolloutMetricObservationV1): RolloutEfficiencyV1 {
  const acceptedCompletion = percentageImprovement(
    metric.baselineMedianAcceptedCompletionMs,
    metric.candidateMedianAcceptedCompletionMs,
  );
  const phaseLaunch = percentageImprovement(
    metric.baselineMedianPhaseLaunchCount,
    metric.candidateMedianPhaseLaunchCount,
  );
  const noPositiveDelta = percentageImprovement(
    metric.baselineNoPositiveDeltaCycleRate,
    metric.candidateNoPositiveDeltaCycleRate,
  );
  const registryConflict = percentageImprovement(
    metric.baselineRegistryConflictRate,
    metric.candidateRegistryConflictRate,
  );
  return Object.freeze({
    riskTier: metric.riskTier,
    lane: metric.lane,
    acceptedCompletionImprovementPercent: acceptedCompletion,
    phaseLaunchImprovementPercent: phaseLaunch,
    noPositiveDeltaCycleImprovementPercent: noPositiveDelta,
    registryConflictImprovementPercent: registryConflict,
    controlPlaneP95Ms: metric.candidateControlPlaneP95Ms,
    meetsSpecValueTarget: (acceptedCompletion ?? Number.NEGATIVE_INFINITY) >= 10
      || (phaseLaunch ?? Number.NEGATIVE_INFINITY) >= 10,
    meetsDesignEfficiencyTargets: (acceptedCompletion ?? Number.NEGATIVE_INFINITY) >= 20
      && (phaseLaunch ?? Number.NEGATIVE_INFINITY) >= 15
      && (noPositiveDelta ?? Number.NEGATIVE_INFINITY) >= 25
      && (registryConflict ?? Number.NEGATIVE_INFINITY) >= 50
      && metric.candidateControlPlaneP95Ms !== null
      && metric.candidateControlPlaneP95Ms < 100,
  });
}

function isNextCohortStep(current: RolloutCohortPercentV1, requested: RolloutCohortPercentV1): boolean {
  const index = COHORT_STEPS.indexOf(current);
  return index >= 0 && COHORT_STEPS[index + 1] === requested;
}

function addSafetyReasons(observation: RolloutObservationV1, reasons: string[]): void {
  const safety = observation.safety;
  if (safety.replayMismatchCount > 0) reasons.push("deterministic-replay-mismatch");
  if (safety.batchReferenceBreakCount > 0) reasons.push("batch-reference-discontinuity");
  if (safety.authorizationBypassCount > 0) reasons.push("authorization-bypass");
  if (safety.registryHistoryLossCount > 0 || safety.duplicateRegistryEventCount > 0) {
    reasons.push("registry-history-violation");
  }
  if (safety.broadCheckMissCount > 0) reasons.push("broad-check-noncompliance");
  if (safety.freshReviewMissCount > 0) reasons.push("fresh-review-noncompliance");
  if (safety.laneFloorDowngradeCount > 0) reasons.push("lane-floor-violation");
  if (safety.adapterDivergenceCount > 0) reasons.push("adapter-semantic-divergence");
  if (safety.escapedCriticalFindingCount > 0) reasons.push("escaped-critical-finding");
  if (safety.candidateSecurityArchitectureEscapeRate > safety.baselineSecurityArchitectureEscapeRate) {
    reasons.push("escaped-security-architecture-regression");
  }
}

export function evaluateRolloutGateV1(input: Readonly<{
  observation: RolloutObservationV1;
  baselineFrozen: boolean;
  legacyCompatibilityProven: boolean;
  additiveHistoryProven: boolean;
  currentCohortPercent: RolloutCohortPercentV1;
  requestedCohortPercent: RolloutCohortPercentV1;
  currentStepObservationDays: number;
}>): RolloutGateDecisionV1 {
  const reasons: string[] = [];
  const observation = input.observation;
  const observationValid = validRolloutObservation(observation);
  const validEvidence = observationValid
    && typeof input.baselineFrozen === "boolean"
    && typeof input.legacyCompatibilityProven === "boolean"
    && typeof input.additiveHistoryProven === "boolean"
    && isNonNegativeInteger(input.currentStepObservationDays)
    && COHORT_STEPS.includes(input.currentCohortPercent)
    && COHORT_STEPS.includes(input.requestedCohortPercent);
  const currentCohortPercent = COHORT_STEPS.includes(input.currentCohortPercent)
    ? input.currentCohortPercent
    : 0;
  const requestedCohortPercent = COHORT_STEPS.includes(input.requestedCohortPercent)
    ? input.requestedCohortPercent
    : currentCohortPercent;
  if (!validEvidence) reasons.push("invalid-rollout-evidence");
  if (!isNextCohortStep(currentCohortPercent, requestedCohortPercent)) {
    reasons.push("invalid-rollout-step");
  }
  if (observationValid && observation.eligibleExecutions < 100) reasons.push("insufficient-eligible-executions");
  if (observationValid && observation.consecutiveDays < 14) reasons.push("insufficient-consecutive-days");
  if (input.currentCohortPercent > 0 && input.currentStepObservationDays < 7) {
    reasons.push("insufficient-step-observation");
  }
  if (!input.baselineFrozen) reasons.push("baseline-not-frozen");
  if (!input.legacyCompatibilityProven) reasons.push("legacy-compatibility-unproven");
  if (!input.additiveHistoryProven) reasons.push("additive-history-unproven");
  if (observationValid) {
    if (!observation.observedRunners.includes("opencode") || !observation.observedRunners.includes("pi")) {
      reasons.push("adapter-parity-incomplete");
    }
    addSafetyReasons(observation, reasons);

    for (const metric of observation.metrics) {
      if (
        metric.baselineCount === 0
        || metric.candidateCount === 0
        || metric.baselineMedianAcceptedCompletionMs === null
        || metric.candidateMedianAcceptedCompletionMs === null
      ) {
        reasons.push("incomplete-metric-comparison");
        continue;
      }
      if (metric.candidateMedianAcceptedCompletionMs > metric.baselineMedianAcceptedCompletionMs * 1.05) {
        reasons.push("accepted-completion-regression");
      }
    }
  }

  const reasonCodes = Object.freeze([...new Set(reasons)]);
  const efficiencyReport = Object.freeze(validEvidence ? observation.metrics.map(efficiency) : []);
  const status: RolloutGateStatusV1 = reasonCodes.length === 0 ? "eligible" : "rollout-paused";
  const effectiveCohortPercent = status === "eligible"
    ? requestedCohortPercent
    : currentCohortPercent;
  const evidenceDigest = sha256Digest({
    input: validEvidence ? input : {
      schema: "invalid-rollout-evidence-v1",
      currentCohortPercent: String(input.currentCohortPercent),
      requestedCohortPercent: String(input.requestedCohortPercent),
    },
    status,
    effectiveCohortPercent,
    reasonCodes,
    efficiency: efficiencyReport,
  });

  return deepFreeze({
    schema: "rollout-gate-decision-v1",
    status,
    currentCohortPercent,
    requestedCohortPercent,
    effectiveCohortPercent,
    reasonCodes,
    efficiency: efficiencyReport,
    evidenceDigest,
  });
}

export function evaluateCompactPromptActivationV1(input: Readonly<{
  requestedProfile: "legacy" | "compact";
  rolloutDecision: RolloutGateDecisionV1;
  runtimeParity: boolean;
  adapterParity: boolean;
  goldenInvariants: boolean;
  providerFiltering: boolean;
  deterministicGeneration: boolean;
  generatedSourceClean: boolean;
  byteReductionPercent: number;
  tokenReductionPercent: number;
}>): PromptProfileActivationV1 {
  const reasons: string[] = [];
  const reductionEvidenceValid = isFiniteNonNegative(input.byteReductionPercent)
    && isFiniteNonNegative(input.tokenReductionPercent);
  if (input.requestedProfile === "compact") {
    if (input.rolloutDecision.status !== "eligible") reasons.push("rollout-not-eligible");
    if (!input.runtimeParity) reasons.push("runtime-parity-unproven");
    if (!input.adapterParity) reasons.push("adapter-parity-unproven");
    if (!input.goldenInvariants) reasons.push("golden-invariants-unproven");
    if (!input.providerFiltering) reasons.push("provider-filtering-unproven");
    if (!input.deterministicGeneration) reasons.push("deterministic-generation-unproven");
    if (!input.generatedSourceClean) reasons.push("generated-source-dirty");
    if (!reductionEvidenceValid) {
      reasons.push("invalid-prompt-reduction-evidence");
    } else if (input.byteReductionPercent < 30 || input.tokenReductionPercent < 30) {
      reasons.push("prompt-reduction-below-threshold");
    }
  }
  const reasonCodes = Object.freeze(reasons);
  const status: RolloutGateStatusV1 = reasonCodes.length === 0 ? "eligible" : "rollout-paused";
  const effectiveProfile = input.requestedProfile === "compact" && status === "eligible"
    ? "compact"
    : "legacy";
  const evidenceDigest = sha256Digest({
    input: reductionEvidenceValid ? input : {
      requestedProfile: input.requestedProfile,
      rolloutEvidenceDigest: input.rolloutDecision.evidenceDigest,
      reductionEvidence: "invalid",
    },
    status,
    effectiveProfile,
    reasonCodes,
  });
  return deepFreeze({
    schema: "prompt-profile-activation-v1",
    status,
    requestedProfile: input.requestedProfile,
    effectiveProfile,
    reasonCodes,
    evidenceDigest,
  });
}

export function resolvePromptProfileActivationV1(
  _activation: PromptProfileActivationV1 | undefined,
): "legacy" | "compact" {
  return "compact";
}

function previousCohortStep(value: RolloutCohortPercentV1): RolloutCohortPercentV1 {
  const index = COHORT_STEPS.indexOf(value);
  return index <= 0 ? 0 : COHORT_STEPS[index - 1]!;
}

function rollbackControls(
  controls: RolloutControlsV1,
  responsibleControl: RolloutResponsibleControlV1 | undefined,
  requiredAuthorization: boolean,
  registryRecoveryProven: boolean,
): RolloutControlsV1 {
  const next: RolloutControlsV1 = {
    ...controls,
    invocationAuthorization: { ...controls.invocationAuthorization },
  };
  switch (responsibleControl) {
    case "executionContracts":
      return { ...next, executionContracts: controls.executionContracts === "enforce" ? "observe" : "off" };
    case "decisionKernel":
      return { ...next, decisionKernel: controls.decisionKernel === "active" ? "shadow" : "legacy" };
    case "invocationAuthorization":
      return requiredAuthorization ? next : {
        ...next,
        invocationAuthorization: { default: "static-compatible", opencode: "static-compatible", pi: "static-compatible" },
      };
    case "registryWriter":
      return registryRecoveryProven
        ? { ...next, registryWriter: "distributed-compatible" }
        : next;
    case "routePolicy":
      return {
        ...next,
        routePolicy: controls.routePolicy === "risk-lanes" ? "shadow-risk-lanes" : "legacy-triage",
      };
    case "promptProfile":
      return next;
    case "telemetry":
      return { ...next, telemetry: "off" };
    default:
      return next;
  }
}

export function transitionRolloutStateV1(
  state: RolloutStateV1,
  input: Readonly<{
    decision: RolloutGateDecisionV1;
    responsibleControl?: RolloutResponsibleControlV1;
    registryRecoveryProven?: boolean;
    observedDay: number;
  }>,
): RolloutStateV1 {
  if (!Number.isSafeInteger(input.observedDay) || input.observedDay < 0) {
    throw new Error("invalid-rollout-observed-day");
  }
  const eligible = input.decision.status === "eligible";
  const wasActive = state.status === "active" && state.cohortPercent > 0;
  const pauseActive = !eligible
    && wasActive
    && input.decision.reasonCodes.some((reason) => ACTIVE_PAUSE_REASONS.has(reason));
  const cohortPercent = eligible
    ? input.decision.effectiveCohortPercent
    : pauseActive ? previousCohortStep(state.cohortPercent) : state.cohortPercent;
  const status: RolloutStateV1["status"] = eligible
    ? cohortPercent > 0 ? "active" : "observe"
    : wasActive && !pauseActive ? state.status : "rollout-paused";
  const controls = eligible || !pauseActive
    ? { ...state.controls, invocationAuthorization: { ...state.controls.invocationAuthorization } }
    : rollbackControls(
        state.controls,
        input.responsibleControl,
        state.permanentFloors.requiredAuthorization,
        input.registryRecoveryProven === true,
      );
  const historyEvent: RolloutHistoryEventV1 = {
    schema: "rollout-history-event-v1",
    observedDay: input.observedDay,
    status,
    cohortPercent,
    reasonCodes: [...input.decision.reasonCodes],
    evidenceDigest: input.decision.evidenceDigest,
  };

  return deepFreeze({
    schema: "developer-team-rollout-state-v1",
    status,
    cohortPercent,
    automaticEffectsEnabled: eligible
      ? cohortPercent > 0
      : pauseActive ? false : state.automaticEffectsEnabled,
    controls,
    permanentFloors: { ...state.permanentFloors },
    history: [...state.history, historyEvent],
  });
}
