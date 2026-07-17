import type { BatchId } from "./apply-batch"; import type { Sha256Digest } from "./canonical";
import { assertDigest, assertExactKeys, assertId, cloneCanonical, codeValue, deepFreeze, enumValue, repositoryPath, sha256Digest, stringArray, timestampValue } from "./canonical";
export interface InvocationAuthorizationClaimsV1 { schema: "invocation-authorization-v1"; authorizationId: `authz:v1:${string}`; invocationId: string; changeId: string; batchId: BatchId; batchDigest: Sha256Digest; role: "apply-general" | "apply-backend" | "apply-frontend"; taskArtifactDigest: Sha256Digest; allowedActions: readonly ["targeted_repair"]; allowedTargets: readonly string[]; blockedTargets: readonly string[]; userAuthorizationReceiptDigest: Sha256Digest; issuedAt: string; expiresAt: string; nonce: string; maxUses: 1 }
export interface AuthorizationReferenceV1 { authorizationId: string; invocationId: string; claimsDigest: Sha256Digest; validation: "accepted" | "rejected"; rejectionCode?: string }
export type InvocationAuthorizationClaimsInputV1 = Omit<InvocationAuthorizationClaimsV1, "authorizationId">;
export function buildInvocationAuthorizationClaimsV1(value: InvocationAuthorizationClaimsInputV1): InvocationAuthorizationClaimsV1 {
  const digest = sha256Digest(value);
  return parseInvocationAuthorizationClaimsV1({ ...cloneCanonical(value), authorizationId: `authz:v1:${digest.slice(7, 39)}` });
}
export function parseInvocationAuthorizationClaimsV1(value: unknown): InvocationAuthorizationClaimsV1 {
  assertExactKeys(value, ["schema", "authorizationId", "invocationId", "changeId", "batchId", "batchDigest", "role", "taskArtifactDigest", "allowedActions", "allowedTargets", "blockedTargets", "userAuthorizationReceiptDigest", "issuedAt", "expiresAt", "nonce", "maxUses"], "authorization claims fields");
  if (value.schema !== "invocation-authorization-v1") throw new Error("unsupported-contract-version");
  assertId(value.authorizationId, "authz:v1:", "authorization.authorizationId");
  const invocationId = codeValue(value.invocationId, "authorization.invocationId");
  const changeId = codeValue(value.changeId, "authorization.changeId");
  assertId(value.batchId, "batch:v1:", "authorization.batchId");
  assertDigest(value.batchDigest, "authorization.batchDigest");
  assertDigest(value.taskArtifactDigest, "authorization.taskArtifactDigest");
  assertDigest(value.userAuthorizationReceiptDigest, "authorization.receipt");
  const role = enumValue(value.role, ["apply-general", "apply-backend", "apply-frontend"], "authorization.role");
  const allowedActions = stringArray(value.allowedActions, "authorization.allowedActions", true);
  if (allowedActions.length !== 1 || allowedActions[0] !== "targeted_repair") throw new Error("invalid-evidence: authorization.allowedActions");
  const pathContext = { repositoryRoot: "." };
  const allowedTargets = stringArray(value.allowedTargets, "authorization.allowedTargets", true).map((target, index) => repositoryPath(target, pathContext, `authorization.allowedTargets[${index}]`)).sort();
  const blockedTargets = stringArray(value.blockedTargets, "authorization.blockedTargets", true).map((target, index) => repositoryPath(target, pathContext, `authorization.blockedTargets[${index}]`)).sort();
  if (new Set(allowedTargets).size !== allowedTargets.length || new Set(blockedTargets).size !== blockedTargets.length) throw new Error("invalid-evidence: authorization target-duplicate");
  if (allowedTargets.some((target) => blockedTargets.includes(target))) throw new Error("invalid-evidence: authorization target-collision");
  const issuedAt = timestampValue(value.issuedAt, "authorization.issuedAt");
  const expiresAt = timestampValue(value.expiresAt, "authorization.expiresAt");
  if (expiresAt <= issuedAt) throw new Error("invalid-evidence: authorization.expiresAt");
  const nonce = codeValue(value.nonce, "authorization.nonce");
  if (value.maxUses !== 1) throw new Error("invalid-evidence: authorization.maxUses");
  const payload = { schema: "invocation-authorization-v1" as const, invocationId, changeId, batchId: value.batchId, batchDigest: value.batchDigest, role, taskArtifactDigest: value.taskArtifactDigest, allowedActions: allowedActions as ["targeted_repair"], allowedTargets, blockedTargets, userAuthorizationReceiptDigest: value.userAuthorizationReceiptDigest, issuedAt, expiresAt, nonce, maxUses: 1 as const };
  const expectedId = `authz:v1:${sha256Digest(payload).slice(7, 39)}`;
  if (value.authorizationId !== expectedId) throw new Error("invalid-evidence: authorization identity");
  return deepFreeze({ ...payload, authorizationId: value.authorizationId }) as InvocationAuthorizationClaimsV1;
}
export function parseAuthorizationReferenceV1(value: unknown): AuthorizationReferenceV1 {
  assertExactKeys(value, ["authorizationId", "invocationId", "claimsDigest", "validation", "rejectionCode"], "authorization reference fields");
  assertId(value.authorizationId, "authz:v1:", "authorizationRef.authorizationId");
  const invocationId = codeValue(value.invocationId, "authorizationRef.invocationId");
  assertDigest(value.claimsDigest, "authorizationRef.claimsDigest");
  const validation = enumValue(value.validation, ["accepted", "rejected"], "authorizationRef.validation");
  const rejectionCode = value.rejectionCode === undefined ? undefined : codeValue(value.rejectionCode, "authorizationRef.rejectionCode");
  if ((validation === "rejected") !== (rejectionCode !== undefined)) throw new Error("invalid-evidence: authorizationRef.rejectionCode");
  return deepFreeze({ authorizationId: value.authorizationId, invocationId, claimsDigest: value.claimsDigest, validation, ...(rejectionCode === undefined ? {} : { rejectionCode }) }) as AuthorizationReferenceV1;
}
export function buildAuthorizationReferenceV1(value: AuthorizationReferenceV1): AuthorizationReferenceV1 { return parseAuthorizationReferenceV1(value); }
