import {
  consumeApprovalReceiptV1,
  parseApprovalReceiptV1,
  type ApprovalConsumptionRecordV1,
} from "../contracts/approval-receipt";
import {
  reconcileAuthoritativeOutcomesV1,
  type AuthoritativeOutcomeV1,
  type OutcomeReconciliationV1,
} from "../contracts/authoritative-outcome";
import type { Sha256Digest } from "../contracts/canonical";
import { assertCriticalApplyPreflightV1 } from "../contracts/qa-authority";
import {
  assessCoordinationV1,
  type CoordinationAssessmentV1,
  type CoordinationWorkItemV1,
} from "./coordination-assessment";
import {
  evaluateGovernanceRecoveryV1,
  type GovernanceRecoveryDecisionV1,
  type GovernanceRecoveryInputV1,
} from "./governance-recovery";
import {
  evaluateProcessPostureV1,
  type ProcessPostureDecisionV1,
  type ProcessPostureEvidenceV1,
} from "./process-posture";

export type DeveloperTeamLeadershipActionV1 =
  | "start_direct"
  | "delegate_specialists"
  | "run_sdd"
  | "continue_delta"
  | "adopt_existing_outcome"
  | "repair_governance"
  | "coordinate_internally"
  | "run_preflight"
  | "revise_plan"
  | "ask_user"
  | "blocked";

export interface DeveloperTeamLeadershipInputV1 {
  readonly posture: ProcessPostureEvidenceV1;
  readonly work: readonly CoordinationWorkItemV1[];
  readonly registryRecoveryRequired?: boolean;
  readonly continuation?: Readonly<{
    sameOutcome: boolean;
    withinAuthorizedScope: boolean;
    riskUnchanged: boolean;
    reversible: boolean;
  }>;
  readonly userDecision?: Readonly<{
    productDecisionRequired?: boolean;
    scopeExpansionRequired?: boolean;
    protectedRiskDecisionRequired?: boolean;
    irreversibleActionRequired?: boolean;
  }>;
  readonly governanceRecovery?: GovernanceRecoveryInputV1;
  readonly approval?: Readonly<{
    receipt: unknown;
    request: Readonly<{
      changeId: string;
      gate: string;
      subjectDigest: Sha256Digest;
      transitionId: string;
    }>;
    prior?: ApprovalConsumptionRecordV1;
  }>;
  readonly outcomeHandoff?: Readonly<{
    current: AuthoritativeOutcomeV1;
    incoming: AuthoritativeOutcomeV1;
  }>;
  readonly criticalPreflight?: Readonly<{
    candidate: unknown;
    planDeclaresCriticalPreflight: boolean;
    receipt?: unknown;
  }>;
}

export interface DeveloperTeamLeadershipDecisionV1 {
  readonly schema: "developer-team-leadership-decision-v1";
  readonly action: DeveloperTeamLeadershipActionV1;
  readonly userInterventionRequired: boolean;
  readonly reasonCodes: readonly string[];
  readonly posture: ProcessPostureDecisionV1;
  readonly coordination: CoordinationAssessmentV1;
  readonly approvalStatus: "not-required" | "consumed" | "replayed" | "stale" | "wrong-subject" | "reused" | "invalid";
  readonly approvalConsumption?: ApprovalConsumptionRecordV1;
  readonly preflightStatus: "not-required" | "passed" | "required" | "stale" | "failed" | "invalid";
  readonly governance?: GovernanceRecoveryDecisionV1;
  readonly outcome?: OutcomeReconciliationV1;
}

const processAction = (posture: ProcessPostureDecisionV1): DeveloperTeamLeadershipActionV1 =>
  posture.process === "direct"
    ? "start_direct"
    : posture.process === "specialists"
      ? "delegate_specialists"
      : "run_sdd";

const decisionFlags = (value: DeveloperTeamLeadershipInputV1["userDecision"]): string[] => {
  if (!value) return [];
  const reasons: string[] = [];
  if (value.productDecisionRequired) reasons.push("PRODUCT_DECISION_REQUIRED");
  if (value.scopeExpansionRequired) reasons.push("SCOPE_EXPANSION_REQUIRED");
  if (value.protectedRiskDecisionRequired) reasons.push("PROTECTED_RISK_DECISION_REQUIRED");
  if (value.irreversibleActionRequired) reasons.push("IRREVERSIBLE_ACTION_REQUIRED");
  return reasons;
};

/**
 * One authority for the Orchestrator's user-facing next step.
 *
 * It combines proportional process, real-conflict coordination, durable approval
 * consumption, governance recovery, mode handoff reconciliation, and normal
 * conversational continuation. Quality readiness remains independently enforced
 * by the QA control plane.
 */
export function decideDeveloperTeamLeadershipV1(
  input: DeveloperTeamLeadershipInputV1,
): DeveloperTeamLeadershipDecisionV1 {
  if (!input || !Array.isArray(input.work)) throw new Error("invalid-developer-team-leadership-input");
  const posture = evaluateProcessPostureV1(input.posture);
  const coordination = assessCoordinationV1({
    work: input.work,
    registryRecoveryRequired: input.registryRecoveryRequired,
  });
  const reasons = [...posture.rationaleCodes, ...coordination.reasonCodes];
  const userReasons = decisionFlags(input.userDecision);
  let approvalStatus: DeveloperTeamLeadershipDecisionV1["approvalStatus"] = "not-required";
  let approvalConsumption: ApprovalConsumptionRecordV1 | undefined;
  let governance: GovernanceRecoveryDecisionV1 | undefined;
  let outcome: OutcomeReconciliationV1 | undefined;
  let preflightStatus: DeveloperTeamLeadershipDecisionV1["preflightStatus"] = "not-required";

  if (input.approval) {
    try {
      const approval = consumeApprovalReceiptV1(
        parseApprovalReceiptV1(input.approval.receipt),
        input.approval.request,
        input.approval.prior,
      );
      approvalStatus = approval.status;
      if (approval.status === "consumed" || approval.status === "replayed") {
        approvalConsumption = approval.record;
        reasons.push(approval.status === "consumed" ? "APPROVAL_CONSUMED" : "APPROVAL_REPLAY_IDEMPOTENT");
      } else {
        reasons.push(`APPROVAL_${approval.status.replace("-", "_").toUpperCase()}`);
      }
    } catch {
      approvalStatus = "invalid";
      reasons.push("APPROVAL_INVALID");
    }
  }

  if (input.governanceRecovery) {
    governance = evaluateGovernanceRecoveryV1(input.governanceRecovery);
    reasons.push(...governance.reasonCodes);
  }
  if (input.outcomeHandoff) {
    outcome = reconcileAuthoritativeOutcomesV1(input.outcomeHandoff);
    reasons.push(...outcome.reasonCodes);
  }
  if (input.criticalPreflight?.planDeclaresCriticalPreflight) {
    try {
      assertCriticalApplyPreflightV1(
        input.criticalPreflight.candidate,
        true,
        input.criticalPreflight.receipt,
      );
      preflightStatus = "passed";
      reasons.push("PREFLIGHT_PASSED");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = ["PREFLIGHT_REQUIRED", "PREFLIGHT_STALE", "PREFLIGHT_FAILED"].includes(message)
        ? message
        : "PREFLIGHT_INVALID";
      preflightStatus = code === "PREFLIGHT_REQUIRED"
        ? "required"
        : code === "PREFLIGHT_STALE"
          ? "stale"
          : code === "PREFLIGHT_FAILED"
            ? "failed"
            : "invalid";
      reasons.push(code);
    }
  }

  let action: DeveloperTeamLeadershipActionV1;
  let userInterventionRequired = false;
  if (userReasons.length > 0) {
    reasons.push(...userReasons);
    action = "ask_user";
    userInterventionRequired = true;
  } else if (approvalStatus === "stale" || approvalStatus === "wrong-subject") {
    action = "ask_user";
    userInterventionRequired = true;
  } else if (approvalStatus === "reused" || approvalStatus === "invalid") {
    action = "blocked";
  } else if (coordination.classification === "blocking" || coordination.classification === "serialize") {
    action = "coordinate_internally";
  } else if (governance?.decision === "block") {
    action = "blocked";
  } else if (governance?.decision === "permit") {
    action = "repair_governance";
  } else if (outcome?.blocked) {
    action = "blocked";
  } else if (outcome?.adoptWithoutReimplementation) {
    action = "adopt_existing_outcome";
  } else if (preflightStatus === "required" || preflightStatus === "stale" || preflightStatus === "invalid") {
    action = "run_preflight";
  } else if (preflightStatus === "failed") {
    action = "revise_plan";
  } else if (
    input.continuation?.sameOutcome
    && input.continuation.withinAuthorizedScope
    && input.continuation.riskUnchanged
    && input.continuation.reversible
  ) {
    action = "continue_delta";
    reasons.push("IN_SCOPE_CONVERSATIONAL_DELTA");
  } else {
    action = processAction(posture);
  }

  return Object.freeze({
    schema: "developer-team-leadership-decision-v1",
    action,
    userInterventionRequired,
    reasonCodes: Object.freeze(reasons),
    posture,
    coordination,
    approvalStatus,
    preflightStatus,
    ...(approvalConsumption ? { approvalConsumption } : {}),
    ...(governance ? { governance } : {}),
    ...(outcome ? { outcome } : {}),
  });
}
