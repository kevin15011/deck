import { buildExecutionDecisionV1, type ExecutionDecisionV1, type TerminalGuardResultV1 } from "../contracts/execution-decision";
import type { ExecutionDossierV1 } from "../contracts/execution-dossier";
import type { FailureRootCause } from "../contracts/failure-manifest";
import type { RepairIncident } from "../contracts/repair-incident";
import { evaluateRepairIncident, type RepairGovernanceConfig } from "./repair-loop-governance";
import { classifyProtectedRiskV1 } from "./protected-risk";

export interface ExecutionDecisionKernelInputV1 {
  dossier: ExecutionDossierV1;
  authority: { state: "authorized" | "missing" | "invalid" };
  gitSafety: { state: "not-required" | "confirmed" | "confirmation-required" | "invalid" };
  incident?: RepairIncident;
  governanceConfig?: RepairGovernanceConfig;
  /** A terminal guard captured at ingress. Replay consumes this frozen result. */
  terminalGuard?: TerminalGuardResultV1;
  /** Captured policy identity; callers must not silently change routing policy during replay. */
  policyVersion: "execution-decision-policy-v1";
}

const runtimeCauses = new Set<FailureRootCause>(["environment", "transport", "capability", "unknown"]);

function selectedRootCause(dossier: ExecutionDossierV1): FailureRootCause {
  const findings = dossier.currentManifest?.findings.filter((finding) => finding.relationship !== "unrelated_baseline" && finding.status === "open") ?? [];
  if (findings.some((finding) => finding.rootCause === "security" || finding.rootCause === "git_safety")) return "security";
  if (findings.some((finding) => finding.rootCause === "requirement")) return "requirement";
  if (findings.some((finding) => finding.rootCause === "architecture" || finding.rootCause === "batch_shape")) return "architecture";
  if (findings.some((finding) => finding.rootCause === "oracle")) return "oracle";
  return findings.find((finding) => runtimeCauses.has(finding.rootCause))?.rootCause ?? findings[0]?.rootCause ?? "implementation";
}

/** Terminal governance is monotonic: it can restrict a repair, never relax a safety floor. */
export function resolveTerminalGovernanceGuardV1(input: ExecutionDecisionKernelInputV1, action: ExecutionDecisionV1["action"] = "targeted_repair"): TerminalGuardResultV1 {
  if (!input.incident) return { outcome: "permit", rationaleCodes: [] };
  const result = evaluateRepairIncident(input.incident, input.governanceConfig);
  if (result.decision === "block") return { outcome: "stop", rationaleCodes: ["TERMINAL_BUDGET_BLOCK"] };
  if (result.decision === "escalate") return { outcome: "escalate", rationaleCodes: ["TERMINAL_ESCALATE"] };
  if (result.decision === "replan" && action === "targeted_repair") return { outcome: "replan", rationaleCodes: ["TERMINAL_REPLAN"] };
  if (result.decision === "checkpoint" && action === "targeted_repair") return { outcome: "checkpoint", rationaleCodes: ["TERMINAL_CHECKPOINT"] };
  return { outcome: "permit", rationaleCodes: [] };
}

/** Pure root-cause routing. Legacy budgets can only make its result more restrictive. */
export function evaluateExecutionDecisionV1(input: ExecutionDecisionKernelInputV1): ExecutionDecisionV1 {
  const rootCause = selectedRootCause(input.dossier);
  const openFindings = input.dossier.currentManifest?.findings.filter((finding) => finding.relationship !== "unrelated_baseline" && finding.status === "open") ?? [];
  const hasProtectedRisk = openFindings.some((finding) => classifyProtectedRiskV1(finding).blocksAutomaticRepair);
  const hasMixedRootCause = new Set(openFindings.map((finding) => finding.rootCause)).size > 1;
  const hasRelatedRegression = (input.dossier.delta?.regressed.length ?? 0) > 0 || input.dossier.delta?.progress === "negative";
  const fullSddFloor = input.dossier.lane.lane === "full_sdd" || input.dossier.lane.shadowOnly;
  let action: ExecutionDecisionV1["action"];
  let rationaleCodes: string[];
  if (input.authority.state === "missing") { action = "stop"; rationaleCodes = ["AUTHZ_MISSING"]; }
  else if (input.authority.state === "invalid") { action = "stop"; rationaleCodes = ["AUTHZ_INVALID"]; }
  else if (input.gitSafety.state === "confirmation-required") { action = "stop"; rationaleCodes = ["GIT_SAFETY_CONFIRMATION_REQUIRED"]; }
  else if (input.gitSafety.state === "invalid") { action = "stop"; rationaleCodes = ["GIT_SAFETY_CONFIRMATION_INVALID"]; }
  else if (rootCause === "security" || openFindings.some((finding) => classifyProtectedRiskV1(finding).securityOrDataLoss || classifyProtectedRiskV1(finding).authorizationOrGitSafety)) { action = "escalate"; rationaleCodes = [openFindings.some((finding) => finding.category === "data-loss") ? "PROTECTED_RISK_DATA_LOSS" : "SECURITY_REGRESSION"]; }
  else if (rootCause === "requirement") { action = "replan_spec"; rationaleCodes = ["ROOT_REQUIREMENT_GAP"]; }
  else if (rootCause === "architecture" || rootCause === "batch_shape") { action = "replan_design_or_tasks"; rationaleCodes = ["ROOT_DESIGN_GAP"]; }
  else if (rootCause === "oracle") { action = "correct_oracle"; rationaleCodes = ["ORACLE_STALE"]; }
  else if (hasMixedRootCause) { action = "replan_design_or_tasks"; rationaleCodes = ["MIXED_ROOT_CAUSE_REPLAN"]; }
  else if (runtimeCauses.has(rootCause)) { action = "diagnose_runtime"; rationaleCodes = ["RUNTIME_AMBIGUOUS"]; }
  else if (!openFindings.length) { action = input.dossier.verification.nextStage ? "advance_verification" : "complete"; rationaleCodes = [action === "complete" ? "NO_OPEN_FINDINGS_COMPLETE" : "VERIFY_STAGE_ADVANCE"]; }
  else if (hasRelatedRegression) {
    action = hasProtectedRisk ? "escalate" : "replan_design_or_tasks";
    rationaleCodes = [hasProtectedRisk ? "RELATED_REGRESSION_ESCALATE" : "RELATED_REGRESSION_REPLAN"];
  }
  else if (input.dossier.delta?.progress === "positive" && !hasProtectedRisk && !hasMixedRootCause && !fullSddFloor && openFindings.every((finding) => finding.rootCause === "implementation")) {
    action = "targeted_repair"; rationaleCodes = ["DELTA_POSITIVE_SCOPED_REPAIR"];
  }
  else if (input.dossier.delta?.progress === "positive") {
    action = fullSddFloor || hasProtectedRisk ? "escalate" : "replan_design_or_tasks";
    rationaleCodes = [fullSddFloor ? "FULL_SDD_FLOOR" : hasProtectedRisk ? "HIGH_RISK_REPAIR_FORBIDDEN" : "MIXED_ROOT_CAUSE_REPLAN"];
  }
  else if (input.dossier.delta?.progress === "none") { action = "checkpoint"; rationaleCodes = ["DELTA_NONE_CHECKPOINT"]; }
  else { action = "replan_design_or_tasks"; rationaleCodes = ["DELTA_NEGATIVE_REPLAN"]; }

  const guard = input.terminalGuard ?? resolveTerminalGovernanceGuardV1(input, action);
  const permanentStop = action === "stop";
  if (!permanentStop && guard.outcome === "stop") action = "stop";
  else if (!permanentStop && action !== "escalate" && !fullSddFloor && guard.outcome === "escalate") action = "escalate";
  else if (guard.outcome === "replan" && action === "targeted_repair") action = "replan_design_or_tasks";
  else if (guard.outcome === "checkpoint" && action === "targeted_repair") action = "checkpoint";
  rationaleCodes = [...rationaleCodes, ...guard.rationaleCodes];

  const requiredVerificationStage = action === "targeted_repair"
    ? "targeted"
    : action === "advance_verification"
      ? input.dossier.verification.nextStage
      : undefined;
  return buildExecutionDecisionV1({ schema: "execution-decision-v1", batchId: input.dossier.batch.batchId, action, selectedRootCause: rootCause, rationaleCodes, ...(requiredVerificationStage === undefined ? {} : { requiredVerificationStage }), freshness: { freshApply: false, freshVerify: action === "targeted_repair", freshReview: action === "escalate", reasonCodes: [] }, lane: input.dossier.lane.lane, terminalGuard: guard, registryIntents: [] });
}
