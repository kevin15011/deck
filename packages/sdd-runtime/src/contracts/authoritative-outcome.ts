import { assertDigest, assertExactKeys, assertId, cloneCanonical, deepFreeze, enumValue, sha256Digest, type Sha256Digest } from "./canonical";

export type AuthoritativeOutcomeModeV1 = "direct" | "specialists" | "full_sdd";
export type AuthoritativeOutcomeStatusV1 = "delivered" | "partial";
export interface AuthoritativeOutcomeV1 {
  readonly schema: "authoritative-outcome-v1";
  readonly outcomeId: `outcome:v1:${string}`;
  readonly digest: Sha256Digest;
  readonly subjectDigest: Sha256Digest;
  readonly resultDigest: Sha256Digest;
  readonly protectedRequirementsDigest: Sha256Digest;
  readonly mode: AuthoritativeOutcomeModeV1;
  readonly status: AuthoritativeOutcomeStatusV1;
  readonly supersedes?: `outcome:v1:${string}`;
}
export type AuthoritativeOutcomeInputV1 = Omit<AuthoritativeOutcomeV1, "outcomeId" | "digest">;

function read(value: unknown): AuthoritativeOutcomeInputV1 {
  assertExactKeys(value, ["schema", "subjectDigest", "resultDigest", "protectedRequirementsDigest", "mode", "status", "supersedes"], "authoritative outcome");
  if (value.schema !== "authoritative-outcome-v1") throw new Error("unsupported-contract-version");
  assertDigest(value.subjectDigest, "authoritative outcome.subjectDigest");
  assertDigest(value.resultDigest, "authoritative outcome.resultDigest");
  assertDigest(value.protectedRequirementsDigest, "authoritative outcome.protectedRequirementsDigest");
  if (value.supersedes !== undefined) assertId(value.supersedes, "outcome:v1:", "authoritative outcome.supersedes");
  return cloneCanonical({ schema: "authoritative-outcome-v1" as const, subjectDigest: value.subjectDigest as Sha256Digest, resultDigest: value.resultDigest as Sha256Digest, protectedRequirementsDigest: value.protectedRequirementsDigest as Sha256Digest, mode: enumValue(value.mode, ["direct", "specialists", "full_sdd"], "authoritative outcome.mode"), status: enumValue(value.status, ["delivered", "partial"], "authoritative outcome.status"), ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes as `outcome:v1:${string}` }) });
}

export function buildAuthoritativeOutcomeV1(value: AuthoritativeOutcomeInputV1): AuthoritativeOutcomeV1 {
  const payload = read(value), digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest, outcomeId: `outcome:v1:${digest.slice(7, 39)}` }) as AuthoritativeOutcomeV1;
}

export interface OutcomeReconciliationV1 { readonly schema: "outcome-reconciliation-v1"; readonly classification: "matching" | "superseding" | "conflicting" | "partial" | "untracked_mode_handoff"; readonly blocked: boolean; readonly idempotent: boolean; readonly adoptWithoutReimplementation: boolean; readonly reasonCodes: readonly string[]; }

export function reconcileAuthoritativeOutcomesV1(input: Readonly<{ current: AuthoritativeOutcomeV1; incoming: AuthoritativeOutcomeV1 }>): OutcomeReconciliationV1 {
  const { current, incoming } = input;
  if (current.protectedRequirementsDigest !== incoming.protectedRequirementsDigest) return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "conflicting", blocked: true, idempotent: false, adoptWithoutReimplementation: false, reasonCodes: Object.freeze(["PROTECTED_REQUIREMENTS_DRIFT"]) });
  if (incoming.status === "partial") return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "partial", blocked: false, idempotent: false, adoptWithoutReimplementation: false, reasonCodes: Object.freeze(["PARTIAL_DELIVERY"]) });
  const sameDelivery = current.subjectDigest === incoming.subjectDigest && current.resultDigest === incoming.resultDigest && current.status === incoming.status;
  if (sameDelivery && current.mode === incoming.mode) return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "matching", blocked: false, idempotent: current.outcomeId === incoming.outcomeId, adoptWithoutReimplementation: current.mode === "direct", reasonCodes: Object.freeze(["MATCHING_DELIVERY"]) });
  if (incoming.supersedes === current.outcomeId) return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "superseding", blocked: false, idempotent: false, adoptWithoutReimplementation: false, reasonCodes: Object.freeze(["DECLARED_SUPERSESSION"]) });
  if (sameDelivery && current.mode !== incoming.mode) return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "untracked_mode_handoff", blocked: false, idempotent: false, adoptWithoutReimplementation: false, reasonCodes: Object.freeze(["MODE_HANDOFF_NOT_RECORDED"]) });
  return Object.freeze({ schema: "outcome-reconciliation-v1", classification: "conflicting", blocked: false, idempotent: false, adoptWithoutReimplementation: false, reasonCodes: Object.freeze(["RESULT_CONFLICT"]) });
}
