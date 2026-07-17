import { buildCausalContextV1, type CausalContextV1 } from "../contracts/causal-context";
import { deepFreeze, normalizeSet } from "../contracts/canonical";
import { parseExecutionDossierV1, type ExecutionDossierHistoryV1 } from "../contracts/execution-dossier";

export type FreshReviewTriggerV1 =
  | "incident"
  | "security_finding"
  | "architecture_finding"
  | "authorization_rejection"
  | "generated_artifact_correction"
  | "public_contract_repair"
  | "migration_repair"
  | "cross_package_repair"
  | "multi_package_repair"
  | "material_repair"
  | "high_risk_repair";

export interface FreshnessPolicyInputV1 {
  readonly applyInstanceIds: readonly string[];
  readonly verifyInstanceId?: string;
  readonly reviewInstanceId?: string;
  readonly priorVerifyInstanceId?: string;
  readonly priorReviewInstanceId?: string;
  readonly codeModifiedAfterVerify: boolean;
  readonly reviewRequired: boolean;
  readonly freshReviewTriggers: readonly FreshReviewTriggerV1[];
  readonly capabilities: {
    readonly freshAgentScheduling: boolean;
    readonly roleIsolation: boolean;
  };
}

export interface FreshnessPolicyResultV1 {
  readonly code: "accepted" | "verification-evidence-required" | "shadow-full-sdd" | "invalid-evidence";
  readonly freshVerifyRequired: boolean;
  readonly freshReviewRequired: boolean;
  readonly rationaleCodes: readonly string[];
}

const FRESH_REVIEW_TRIGGERS = new Set<FreshReviewTriggerV1>([
  "incident", "security_finding", "architecture_finding", "authorization_rejection",
  "generated_artifact_correction", "public_contract_repair", "migration_repair",
  "cross_package_repair", "multi_package_repair", "material_repair", "high_risk_repair",
]);

function validIdentity(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(value);
}

export function evaluateFreshnessPolicyV1(input: FreshnessPolicyInputV1): FreshnessPolicyResultV1 {
  if (!Array.isArray(input.applyInstanceIds) || input.applyInstanceIds.length === 0 ||
    !Array.isArray(input.freshReviewTriggers) || input.freshReviewTriggers.some((trigger) => !FRESH_REVIEW_TRIGGERS.has(trigger)) ||
    new Set(input.freshReviewTriggers).size !== input.freshReviewTriggers.length ||
    typeof input.codeModifiedAfterVerify !== "boolean" || typeof input.reviewRequired !== "boolean" ||
    typeof input.capabilities?.freshAgentScheduling !== "boolean" || typeof input.capabilities?.roleIsolation !== "boolean" ||
    input.applyInstanceIds.some((identity) => !validIdentity(identity)) || new Set(input.applyInstanceIds).size !== input.applyInstanceIds.length ||
    input.verifyInstanceId !== undefined && !validIdentity(input.verifyInstanceId) ||
    input.reviewInstanceId !== undefined && !validIdentity(input.reviewInstanceId) ||
    input.priorVerifyInstanceId !== undefined && !validIdentity(input.priorVerifyInstanceId) ||
    input.priorReviewInstanceId !== undefined && !validIdentity(input.priorReviewInstanceId)) {
    return deepFreeze({ code: "invalid-evidence", freshVerifyRequired: input.codeModifiedAfterVerify === true, freshReviewRequired: true, rationaleCodes: ["ROLE_IDENTITY_INVALID"] });
  }
  const freshVerifyRequired = input.codeModifiedAfterVerify;
  const freshReviewRequired = input.reviewRequired || input.freshReviewTriggers.length > 0;
  const rationaleCodes: string[] = [];
  if (!input.capabilities.roleIsolation) rationaleCodes.push("ROLE_ISOLATION_UNPROVEN");
  if (!input.verifyInstanceId) rationaleCodes.push("VERIFY_IDENTITY_REQUIRED");
  if (input.verifyInstanceId && input.applyInstanceIds.includes(input.verifyInstanceId)) rationaleCodes.push("APPLY_VERIFY_IDENTITY_COLLISION");
  if (freshVerifyRequired && !input.priorVerifyInstanceId) rationaleCodes.push("PRIOR_VERIFY_IDENTITY_REQUIRED");
  if (freshVerifyRequired && input.verifyInstanceId === input.priorVerifyInstanceId) rationaleCodes.push("FRESH_VERIFY_REQUIRED");
  if (freshReviewRequired && !input.reviewInstanceId) rationaleCodes.push("REVIEW_IDENTITY_REQUIRED");
  if (input.reviewInstanceId && (input.applyInstanceIds.includes(input.reviewInstanceId) || input.reviewInstanceId === input.verifyInstanceId)) {
    rationaleCodes.push("REVIEW_IDENTITY_COLLISION");
  }
  if (input.freshReviewTriggers.length > 0 && input.reviewInstanceId === input.priorReviewInstanceId) rationaleCodes.push("FRESH_REVIEW_REQUIRED");
  if ((freshVerifyRequired || freshReviewRequired) && !input.capabilities.freshAgentScheduling) {
    rationaleCodes.push("FRESH_AGENT_SCHEDULING_UNPROVEN");
  }
  rationaleCodes.push(...input.freshReviewTriggers.map((trigger) => `FRESH_REVIEW_${trigger.toUpperCase()}`));
  const normalized = normalizeSet(rationaleCodes, "freshness.rationaleCodes");
  const unsupported = normalized.includes("ROLE_ISOLATION_UNPROVEN") || normalized.includes("FRESH_AGENT_SCHEDULING_UNPROVEN");
  const blocking = normalized.some((code) => code.endsWith("_REQUIRED") || code.endsWith("_COLLISION"));
  return deepFreeze({
    code: unsupported ? "shadow-full-sdd" : blocking ? "verification-evidence-required" : "accepted",
    freshVerifyRequired,
    freshReviewRequired,
    rationaleCodes: normalized,
  });
}

export function projectCausalContextForRoleV1(
  dossierValue: unknown,
  role: "apply" | "verify" | "review",
  history?: ExecutionDossierHistoryV1,
): CausalContextV1 {
  const dossier = parseExecutionDossierV1(dossierValue, history);
  if (role === "apply") return dossier.causalContext;
  return buildCausalContextV1({
    schema: "causal-context-v1",
    batchDigest: dossier.causalContext.batchDigest,
    priorDecisionDigests: dossier.causalContext.priorDecisionDigests,
    activeFindingIds: dossier.causalContext.activeFindingIds,
    evidenceRefs: dossier.causalContext.evidenceRefs,
    attemptSummaries: [],
  });
}
