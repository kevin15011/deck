export interface GovernanceRecoveryDecisionV1 { readonly schema: "governance-recovery-decision-v1"; readonly decision: "permit" | "block"; readonly reasonCodes: readonly string[]; readonly requiredActions: readonly string[]; readonly grantsProductModificationAuthority: false; }
export interface GovernanceRecoveryInputV1 { readonly governanceOracleBroken: boolean; readonly separatelyAuthorizedRepair: boolean; readonly repairTargetsOnlyGovernanceOracle: boolean; readonly containsProductWork: boolean; readonly suppressesProtectedFindings: boolean; readonly canonicalValidationWillRerun: boolean; }

export function evaluateGovernanceRecoveryV1(input: GovernanceRecoveryInputV1): GovernanceRecoveryDecisionV1 {
  if (!input || Object.values(input).some((value) => typeof value !== "boolean")) throw new Error("invalid-governance-recovery-input");
  const reasonCodes: string[] = [];
  if (!input.governanceOracleBroken) reasonCodes.push("GOVERNANCE_ORACLE_NOT_BROKEN");
  if (!input.separatelyAuthorizedRepair) reasonCodes.push("SEPARATE_REPAIR_AUTHORIZATION_REQUIRED");
  if (!input.repairTargetsOnlyGovernanceOracle) reasonCodes.push("REPAIR_SCOPE_NOT_EXACT");
  if (input.containsProductWork) reasonCodes.push("PRODUCT_WORK_FORBIDDEN");
  if (input.suppressesProtectedFindings) reasonCodes.push("PROTECTED_FINDING_SUPPRESSION_FORBIDDEN");
  if (!input.canonicalValidationWillRerun) reasonCodes.push("CANONICAL_VALIDATION_RERUN_REQUIRED");
  const decision = reasonCodes.length === 0 ? "permit" : "block";
  return Object.freeze({ schema: "governance-recovery-decision-v1", decision, reasonCodes: Object.freeze(reasonCodes), requiredActions: Object.freeze(decision === "permit" ? ["RERUN_CANONICAL_VALIDATION"] : []), grantsProductModificationAuthority: false });
}
