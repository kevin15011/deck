import type { ExecutionLane } from "../contracts/execution-lane";

export type ProcessPostureV1 = "direct" | "specialists" | "full_sdd";

export interface ProcessPostureDecisionV1 {
  readonly schema: "process-posture-decision-v1";
  readonly process: ProcessPostureV1;
  readonly safetyLane: ExecutionLane;
  readonly rationaleCodes: readonly string[];
  readonly workRationale: Readonly<{ skipped: readonly string[]; combined: readonly string[] }>;
}

export interface ProcessPostureEvidenceV1 {
  readonly uncertaintyResolved: boolean;
  readonly decisionEnabled: boolean;
  readonly materialRiskReduced: boolean;
  readonly expectedCoordinationBenefit: number;
  readonly expectedCoordinationCost: number;
  readonly equallySafeDirectPathAvailable: boolean;
  readonly safetyLane: ExecutionLane;
  readonly previousProcess?: ProcessPostureV1;
  readonly previousSafetyLane?: ExecutionLane;
}

const laneRank: Readonly<Record<ExecutionLane, number>> = { fast: 0, guarded: 1, full_sdd: 2 };

function validEvidence(input: ProcessPostureEvidenceV1): void {
  if (!input || typeof input !== "object" || ![input.uncertaintyResolved, input.decisionEnabled, input.materialRiskReduced, input.equallySafeDirectPathAvailable].every((value) => typeof value === "boolean") || !Number.isFinite(input.expectedCoordinationBenefit) || input.expectedCoordinationBenefit < 0 || !Number.isFinite(input.expectedCoordinationCost) || input.expectedCoordinationCost < 0 || !(input.safetyLane in laneRank) || (input.previousSafetyLane !== undefined && !(input.previousSafetyLane in laneRank))) throw new Error("invalid-process-posture-evidence");
}

/** Chooses process depth independently from, and never below, the existing safety lane. */
export function evaluateProcessPostureV1(input: ProcessPostureEvidenceV1): ProcessPostureDecisionV1 {
  validEvidence(input);
  const safetyLane = input.previousSafetyLane && laneRank[input.previousSafetyLane] > laneRank[input.safetyLane] ? input.previousSafetyLane : input.safetyLane;
  const rationaleCodes: string[] = [];
  const workRationale = { skipped: [] as string[], combined: [] as string[] };
  const coordinationPays = input.expectedCoordinationBenefit > input.expectedCoordinationCost;
  let process: ProcessPostureV1;
  if (input.equallySafeDirectPathAvailable) {
    process = "direct";
    rationaleCodes.push("EQUALLY_SAFE_DIRECT_PATH");
    workRationale.skipped.push("specialist_coordination", "full_sdd_artifacts");
  } else if (!input.uncertaintyResolved && !input.decisionEnabled && !input.materialRiskReduced && coordinationPays) {
    process = "full_sdd";
    rationaleCodes.push("UNRESOLVED_MATERIAL_RISK", "COORDINATION_BENEFIT_EXCEEDS_COST");
    workRationale.combined.push("exploration", "decision_support", "risk_reduction");
  } else if (coordinationPays && (!input.uncertaintyResolved || !input.decisionEnabled || !input.materialRiskReduced)) {
    process = "specialists";
    rationaleCodes.push("BOUNDED_SPECIALIST_VALUE");
    workRationale.skipped.push("full_sdd_artifacts");
  } else {
    process = "direct";
    rationaleCodes.push("COORDINATION_COST_NOT_JUSTIFIED");
    workRationale.skipped.push("specialist_coordination", "full_sdd_artifacts");
  }
  if (safetyLane !== input.safetyLane) rationaleCodes.push("SAFETY_LANE_MONOTONIC");
  if (input.previousProcess && input.previousProcess !== process) rationaleCodes.push(`PROCESS_${process.toUpperCase()}_FROM_${input.previousProcess.toUpperCase()}`);
  return Object.freeze({ schema: "process-posture-decision-v1", process, safetyLane, rationaleCodes: Object.freeze(rationaleCodes), workRationale: Object.freeze({ skipped: Object.freeze(workRationale.skipped), combined: Object.freeze(workRationale.combined) }) });
}
