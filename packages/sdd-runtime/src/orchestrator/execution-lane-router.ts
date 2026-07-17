import { buildLaneDecisionV1, type ExecutionLane, type LaneDecisionV1 } from "../contracts/execution-lane";
import { deepFreeze, sha256Digest } from "../contracts/canonical";
import type { RiskResult } from "../contracts/risk";
import { assignExecutionCohort } from "../execution/telemetry";
import { DEFAULT_ROUTER_CONFIG, routeQuality } from "./quality-router";

export type RoutePolicyV1 = "legacy-triage" | "shadow-risk-lanes" | "risk-lanes";

export interface ExecutionLaneFactsV1 {
  readonly explicitAcceptance: boolean;
  readonly explicitFullSdd: boolean;
  readonly boundedTargetCount: number;
  readonly fileCount: number;
  readonly packageCount: number;
  readonly affectedAreaKnown: boolean;
  readonly checksKnown: boolean;
  readonly incident: boolean;
  readonly generatedSource: boolean;
  readonly security: boolean;
  readonly authorization: boolean;
  readonly privacy: boolean;
  readonly dataLoss: boolean;
  readonly migration: boolean;
  readonly destructive: boolean;
  readonly publicApi: boolean;
  readonly crossPackageArchitecture: boolean;
  readonly registrySemantics: boolean;
  readonly unknownProtectedScope: boolean;
  readonly materialRepair: boolean;
}

export interface ExecutionLanePolicyV1 {
  readonly minimumLane: ExecutionLane;
  readonly userMinimumLane?: ExecutionLane;
  readonly allowFast: boolean;
  readonly requireReview: boolean;
}

export interface SelectExecutionLaneInputV1 {
  readonly risk: RiskResult;
  readonly facts: ExecutionLaneFactsV1;
  readonly policy: ExecutionLanePolicyV1;
  readonly routePolicy: RoutePolicyV1;
  readonly currentLane?: ExecutionLane;
}

const RANK: Readonly<Record<ExecutionLane, number>> = { fast: 0, guarded: 1, full_sdd: 2 };
const maxLane = (...lanes: readonly ExecutionLane[]) => lanes.reduce((highest, lane) => RANK[lane] > RANK[highest] ? lane : highest, "fast");
const BOOLEAN_FACTS: ReadonlyArray<keyof ExecutionLaneFactsV1> = [
  "explicitAcceptance", "explicitFullSdd", "affectedAreaKnown", "checksKnown", "incident", "generatedSource",
  "security", "authorization", "privacy", "dataLoss", "migration", "destructive", "publicApi",
  "crossPackageArchitecture", "registrySemantics", "unknownProtectedScope", "materialRepair",
];
const COUNT_FACTS: ReadonlyArray<keyof ExecutionLaneFactsV1> = ["boundedTargetCount", "fileCount", "packageCount"];
const LANES: readonly ExecutionLane[] = ["fast", "guarded", "full_sdd"];

function assertInput(input: SelectExecutionLaneInputV1): void {
  if (!input || typeof input !== "object" || !input.risk || typeof input.risk !== "object" ||
    !input.facts || typeof input.facts !== "object" || !input.policy || typeof input.policy !== "object") {
    throw new Error("invalid-evidence: execution lane input");
  }
  const expectedTier = input.risk.score >= DEFAULT_ROUTER_CONFIG.criticalThreshold
    ? "critical"
    : input.risk.score >= DEFAULT_ROUTER_CONFIG.boundaryThreshold
      ? "high"
      : input.risk.score >= DEFAULT_ROUTER_CONFIG.standardThreshold
        ? "boundary"
        : "standard";
  const factKeys = [...BOOLEAN_FACTS, ...COUNT_FACTS];
  const actualFactKeys = Object.keys(input.facts);
  const invalid = !Number.isFinite(input.risk.score) || input.risk.score < 0 || input.risk.score > 100 ||
    !Number.isFinite(input.risk.confidence) || input.risk.confidence < 0 || input.risk.confidence > 1 ||
    input.risk.tier !== expectedTier ||
    !["legacy-triage", "shadow-risk-lanes", "risk-lanes"].includes(input.routePolicy) ||
    !LANES.includes(input.policy.minimumLane) ||
    input.policy.userMinimumLane !== undefined && !LANES.includes(input.policy.userMinimumLane) ||
    input.currentLane !== undefined && !LANES.includes(input.currentLane) ||
    typeof input.policy.allowFast !== "boolean" || typeof input.policy.requireReview !== "boolean" ||
    actualFactKeys.length !== factKeys.length || factKeys.some((key) => !actualFactKeys.includes(key)) ||
    BOOLEAN_FACTS.some((key) => typeof input.facts[key] !== "boolean") ||
    COUNT_FACTS.some((key) => !Number.isInteger(input.facts[key]) || (input.facts[key] as number) < 0);
  if (invalid) throw new Error("invalid-evidence: execution lane input");
}

export function selectExecutionLaneV1(input: SelectExecutionLaneInputV1): LaneDecisionV1 {
  assertInput(input);
  const floorReasons: string[] = [];
  const fullFloors: ReadonlyArray<readonly [boolean, string]> = [
    [input.facts.explicitFullSdd, "EXPLICIT_FULL_SDD"],
    [input.facts.security, "SECURITY_FLOOR"],
    [input.facts.authorization, "AUTHORIZATION_FLOOR"],
    [input.facts.privacy, "PRIVACY_FLOOR"],
    [input.facts.dataLoss, "DATA_LOSS_FLOOR"],
    [input.facts.migration, "MIGRATION_FLOOR"],
    [input.facts.destructive, "DESTRUCTIVE_FLOOR"],
    [input.facts.publicApi, "PUBLIC_API_FLOOR"],
    [input.facts.crossPackageArchitecture, "CROSS_PACKAGE_ARCHITECTURE_FLOOR"],
    [input.facts.registrySemantics, "REGISTRY_SEMANTICS_FLOOR"],
    [input.facts.unknownProtectedScope, "UNKNOWN_PROTECTED_SCOPE"],
    [input.risk.tier === "high", "HIGH_RISK_FLOOR"],
    [input.risk.tier === "critical", "CRITICAL_RISK_FLOOR"],
    [input.risk.confidence < 0.8, "LOW_CONFIDENCE_FLOOR"],
  ];
  for (const [active, code] of fullFloors) if (active) floorReasons.push(code);

  const fastEligible = floorReasons.length === 0 && input.risk.score < DEFAULT_ROUTER_CONFIG.standardThreshold &&
    input.facts.explicitAcceptance && input.facts.boundedTargetCount > 0 && input.facts.fileCount === 1 &&
    input.facts.packageCount === 1 && input.facts.affectedAreaKnown && input.facts.checksKnown &&
    !input.facts.incident && !input.facts.materialRepair && !input.facts.generatedSource && input.policy.allowFast;
  let lane: ExecutionLane = floorReasons.length > 0 ? "full_sdd" : fastEligible ? "fast" : "guarded";
  if (lane === "guarded") {
    if (input.risk.score >= DEFAULT_ROUTER_CONFIG.standardThreshold) floorReasons.push("BOUNDARY_RISK");
    if (input.facts.fileCount > 1) floorReasons.push("MULTI_FILE");
    if (input.facts.packageCount > 1) floorReasons.push("MULTI_PACKAGE");
    if (!input.facts.affectedAreaKnown) floorReasons.push("AFFECTED_AREA_UNKNOWN");
    if (!input.facts.checksKnown) floorReasons.push("CHECKS_UNKNOWN");
    if (input.facts.generatedSource) floorReasons.push("GENERATED_SOURCE");
    if (input.facts.incident) floorReasons.push("INCIDENT");
    if (input.facts.materialRepair) floorReasons.push("MATERIAL_REPAIR");
    if (!input.policy.allowFast) floorReasons.push("FAST_DISABLED_BY_POLICY");
    if (!input.facts.explicitAcceptance) floorReasons.push("EXPLICIT_ACCEPTANCE_MISSING");
  }

  const policyOverrides: string[] = [];
  const requested = input.policy.userMinimumLane ?? "fast";
  const beforePolicy = lane;
  lane = maxLane(lane, input.policy.minimumLane, requested, input.currentLane ?? "fast");
  if (RANK[input.policy.minimumLane] > RANK[beforePolicy]) policyOverrides.push(`PROJECT_MINIMUM_${input.policy.minimumLane.toUpperCase()}`);
  if (RANK[requested] > RANK[beforePolicy]) policyOverrides.push(`USER_MINIMUM_${requested.toUpperCase()}`);
  if (input.currentLane && RANK[input.currentLane] > RANK[beforePolicy]) policyOverrides.push(`NO_DOWNGRADE_${input.currentLane.toUpperCase()}`);

  const legacy = routeQuality({ ...input.risk, overrides: [] }, DEFAULT_ROUTER_CONFIG);
  const legacyRecommendation = legacy.requiresReplanOrOverride ? "full_sdd" : legacy.invokeQuality ? "guarded" : "fast";
  const evidenceDigest = sha256Digest({
    risk: { score: input.risk.score, tier: input.risk.tier, confidence: input.risk.confidence },
    facts: input.facts,
    policy: input.policy,
    routePolicy: input.routePolicy,
    currentLane: input.currentLane ?? null,
  });
  return buildLaneDecisionV1({
    schema: "lane-decision-v1",
    lane,
    riskScore: input.risk.score,
    floorReasons,
    policyOverrides,
    policyVersion: "execution-lane-policy-v1",
    evidenceDigest,
    legacyRecommendation,
    shadowOnly: input.routePolicy !== "risk-lanes",
  });
}

export function assignExecutionLaneCohortV1(changeId: string, cohortPercent: number): boolean {
  return assignExecutionCohort(changeId, cohortPercent);
}

export interface LaneCheckPlanV1 {
  readonly lane: ExecutionLane;
  readonly targeted: "required";
  readonly affectedArea: "required" | "not_available";
  readonly broad: "mandatory" | "policy_deferrable" | "not_available";
  readonly independentVerify: true;
  readonly independentReview: boolean;
  readonly freshFinalReview: boolean;
}

export function adaptLaneToCheckPlanV1(
  decision: LaneDecisionV1,
  options: { readonly affectedAreaAvailable: boolean; readonly broadAvailable: boolean; readonly policyRequiresReview: boolean },
): LaneCheckPlanV1 {
  const full = decision.lane === "full_sdd", guarded = decision.lane === "guarded";
  const mandatoryBroad = full || decision.floorReasons.some((reason) => reason === "INCIDENT" || reason === "MATERIAL_REPAIR");
  return deepFreeze({
    lane: decision.lane,
    targeted: "required",
    affectedArea: options.affectedAreaAvailable ? "required" : "not_available",
    broad: mandatoryBroad ? "mandatory" : options.broadAvailable ? "policy_deferrable" : "not_available",
    independentVerify: true,
    independentReview: full || guarded || options.policyRequiresReview,
    freshFinalReview: full || decision.floorReasons.some((reason) => ["INCIDENT", "MATERIAL_REPAIR", "SECURITY_FLOOR", "AUTHORIZATION_FLOOR"].includes(reason)),
  });
}
