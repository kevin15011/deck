import type { FailureFindingV1 } from "../contracts/failure-manifest";

/** The single safety classification consumed by both delta algebra and routing. */
export interface ProtectedRiskClassificationV1 {
  readonly securityOrDataLoss: boolean;
  readonly highOrCritical: boolean;
  readonly authorizationOrGitSafety: boolean;
  readonly uncoveredRequirement: boolean;
  readonly blocksAutomaticRepair: boolean;
}

export function classifyProtectedRiskV1(finding: FailureFindingV1): ProtectedRiskClassificationV1 {
  const securityOrDataLoss = finding.isSecurityRelevant || finding.category === "data-loss" || finding.rootCause === "security";
  const highOrCritical = finding.severity === "high" || finding.severity === "critical";
  const authorizationOrGitSafety = finding.rootCause === "authorization" || finding.rootCause === "git_safety";
  const uncoveredRequirement = finding.rootCause === "requirement" || finding.requirementIds.length === 0;
  return Object.freeze({ securityOrDataLoss, highOrCritical, authorizationOrGitSafety, uncoveredRequirement,
    blocksAutomaticRepair: securityOrDataLoss || highOrCritical || authorizationOrGitSafety || uncoveredRequirement });
}
