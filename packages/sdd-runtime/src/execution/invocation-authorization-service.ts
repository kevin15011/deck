import { createHash, createHmac, createSecretKey, randomBytes as secureRandomBytes, timingSafeEqual } from "node:crypto";
import type { BatchId } from "../contracts/apply-batch";
import {
  buildAuthorizationReferenceV1,
  buildInvocationAuthorizationClaimsV1,
  parseInvocationAuthorizationClaimsV1,
  type AuthorizationReferenceV1,
  type InvocationAuthorizationClaimsV1,
} from "../contracts/invocation-authorization";
import {
  assertDigest,
  assertExactKeys,
  assertId,
  canonicalJson,
  deepFreeze,
  sha256Digest,
  type Sha256Digest,
} from "../contracts/canonical";

const MAXIMUM_LIFETIME_MS = 300_000;
const MAXIMUM_CLOCK_SKEW_MS = 30_000;

export type InvocationAuthorizationRejectionCodeV1 =
  | "AUTHZ_MISSING"
  | "AUTHZ_MALFORMED"
  | "AUTHZ_PROOF_INVALID"
  | "AUTHZ_EXPIRED"
  | "AUTHZ_FUTURE"
  | "AUTHZ_LIFETIME_INVALID"
  | "AUTHZ_REPLAYED"
  | "AUTHZ_RESTARTED"
  | "AUTHZ_REVOKED"
  | "AUTHZ_INVOCATION_MISMATCH"
  | "AUTHZ_ROLE_MISMATCH"
  | "AUTHZ_CHANGE_MISMATCH"
  | "AUTHZ_BATCH_ID_MISMATCH"
  | "AUTHZ_BATCH_DIGEST_MISMATCH"
  | "AUTHZ_TASK_ARTIFACT_MISMATCH"
  | "AUTHZ_RECEIPT_MISMATCH"
  | "AUTHZ_ACTION_MISMATCH"
  | "AUTHZ_TARGET_MISMATCH"
  | "AUTHZ_BLOCKED_TARGET";

export interface InvocationAuthorizationEnvelopeV1 {
  readonly claims: InvocationAuthorizationClaimsV1;
  readonly proof: {
    readonly algorithm: "hmac-sha256";
    readonly ephemeralKeyId: Sha256Digest;
    readonly value: string;
  };
}

export interface InvocationAuthorizationIssueInputV1 {
  readonly invocationId: string;
  readonly changeId: string;
  readonly batchId: BatchId;
  readonly batchDigest: Sha256Digest;
  readonly role: InvocationAuthorizationClaimsV1["role"];
  readonly taskArtifactDigest: Sha256Digest;
  readonly allowedActions: readonly ["targeted_repair"];
  readonly allowedTargets: readonly string[];
  readonly blockedTargets: readonly string[];
  readonly userAuthorizationReceiptDigest: Sha256Digest;
}

export interface InvocationAuthorizationExpectationV1 {
  readonly invocationId: string;
  readonly changeId: string;
  readonly batchId: BatchId;
  readonly batchDigest: Sha256Digest;
  readonly role: InvocationAuthorizationClaimsV1["role"];
  readonly taskArtifactDigest: Sha256Digest;
  readonly userAuthorizationReceiptDigest: Sha256Digest;
  readonly action: string;
  readonly target: string;
  readonly allowedTargets: readonly string[];
  readonly blockedTargets: readonly string[];
}

export type InvocationAuthorizationValidationResultV1 =
  | { readonly accepted: true; readonly reference: AuthorizationReferenceV1 }
  | { readonly accepted: false; readonly code: InvocationAuthorizationRejectionCodeV1 };

export interface InvocationAuthorizationServiceV1 {
  readonly ephemeralKeyId: Sha256Digest;
  issue(input: InvocationAuthorizationIssueInputV1, lifetimeMs?: number): InvocationAuthorizationEnvelopeV1;
  validate(envelope: unknown, expected: InvocationAuthorizationExpectationV1): InvocationAuthorizationValidationResultV1;
  validateAndReserve(envelope: unknown, expected: InvocationAuthorizationExpectationV1): InvocationAuthorizationValidationResultV1;
  revoke(authorizationId: string): void;
}

export interface InvocationAuthorizationServiceOptionsV1 {
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
}

function parseEnvelope(value: unknown): InvocationAuthorizationEnvelopeV1 {
  assertExactKeys(value, ["claims", "proof"], "authorization envelope fields");
  const claims = parseInvocationAuthorizationClaimsV1(value.claims);
  assertExactKeys(value.proof, ["algorithm", "ephemeralKeyId", "value"], "authorization proof fields");
  if (value.proof.algorithm !== "hmac-sha256") throw new Error("unsupported-contract-version");
  assertDigest(value.proof.ephemeralKeyId, "authorization.proof.ephemeralKeyId");
  if (typeof value.proof.value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.proof.value)) {
    throw new Error("invalid-evidence: authorization.proof.value");
  }
  const proofValue = value.proof.value;
  return deepFreeze({ claims, proof: { algorithm: "hmac-sha256", ephemeralKeyId: value.proof.ephemeralKeyId, value: proofValue } });
}

function pathsIntersect(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/$/, "");
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function targetWithin(target: string, scope: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedTarget = normalize(target);
  const normalizedScope = normalize(scope);
  return normalizedTarget === normalizedScope || normalizedTarget.startsWith(`${normalizedScope}/`);
}

function denied(code: InvocationAuthorizationRejectionCodeV1): InvocationAuthorizationValidationResultV1 {
  return { accepted: false, code };
}

export function createInvocationAuthorizationServiceV1(options: InvocationAuthorizationServiceOptionsV1 = {}): InvocationAuthorizationServiceV1 {
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? ((length: number) => secureRandomBytes(length));
  const drawRandomBytes = (length: number, field: string): Buffer => {
    const bytes = Buffer.from(randomBytes(length));
    if (bytes.length !== length) throw new Error(`invalid-evidence: ${field}`);
    return bytes;
  };
  const keyBytes = drawRandomBytes(32, "authorization.key");
  const ephemeralKeyId = `sha256:${createHash("sha256").update(keyBytes).digest("hex")}` as Sha256Digest;
  const keyHandle = createSecretKey(keyBytes);
  keyBytes.fill(0);
  const consumedNonces = new Set<string>();
  const revokedAuthorizationIds = new Set<string>();

  function sign(claims: InvocationAuthorizationClaimsV1): string {
    return createHmac("sha256", keyHandle).update(canonicalJson(claims), "utf8").digest("base64url");
  }

  function issue(input: InvocationAuthorizationIssueInputV1, lifetimeMs = MAXIMUM_LIFETIME_MS): InvocationAuthorizationEnvelopeV1 {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > MAXIMUM_LIFETIME_MS) {
      throw new Error("invalid-evidence: authorization.lifetimeMs");
    }
    const issued = now();
    if (!(issued instanceof Date) || Number.isNaN(issued.valueOf())) throw new Error("invalid-evidence: authorization.now");
    const claims = buildInvocationAuthorizationClaimsV1({
      schema: "invocation-authorization-v1",
      ...input,
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.valueOf() + lifetimeMs).toISOString(),
      nonce: drawRandomBytes(32, "authorization.nonce").toString("hex"),
      maxUses: 1,
    });
    return deepFreeze({ claims, proof: { algorithm: "hmac-sha256", ephemeralKeyId, value: sign(claims) } });
  }

  function validateEnvelope(envelopeValue: unknown, expected: InvocationAuthorizationExpectationV1, reserveNonce: boolean): InvocationAuthorizationValidationResultV1 {
    if (envelopeValue === undefined || envelopeValue === null) return denied("AUTHZ_MISSING");
    let envelope: InvocationAuthorizationEnvelopeV1;
    try {
      envelope = parseEnvelope(envelopeValue);
    } catch {
      return denied("AUTHZ_MALFORMED");
    }
    const { claims, proof } = envelope;
    if (proof.ephemeralKeyId !== ephemeralKeyId) return denied("AUTHZ_RESTARTED");
    const suppliedProof = Buffer.from(proof.value, "utf8");
    const expectedProof = Buffer.from(sign(claims), "utf8");
    if (suppliedProof.length !== expectedProof.length || !timingSafeEqual(suppliedProof, expectedProof)) return denied("AUTHZ_PROOF_INVALID");

    const current = now();
    if (!(current instanceof Date) || Number.isNaN(current.valueOf())) return denied("AUTHZ_MALFORMED");
    const currentTime = current.valueOf();
    const issuedAt = Date.parse(claims.issuedAt);
    const expiresAt = Date.parse(claims.expiresAt);
    if (expiresAt - issuedAt > MAXIMUM_LIFETIME_MS) return denied("AUTHZ_LIFETIME_INVALID");
    if (issuedAt - currentTime > MAXIMUM_CLOCK_SKEW_MS) return denied("AUTHZ_FUTURE");
    if (currentTime >= expiresAt) return denied("AUTHZ_EXPIRED");
    if (revokedAuthorizationIds.has(claims.authorizationId)) return denied("AUTHZ_REVOKED");
    if (consumedNonces.has(claims.nonce)) return denied("AUTHZ_REPLAYED");
    if (claims.invocationId !== expected.invocationId) return denied("AUTHZ_INVOCATION_MISMATCH");
    if (claims.role !== expected.role) return denied("AUTHZ_ROLE_MISMATCH");
    if (claims.changeId !== expected.changeId) return denied("AUTHZ_CHANGE_MISMATCH");
    if (claims.batchId !== expected.batchId) return denied("AUTHZ_BATCH_ID_MISMATCH");
    if (claims.batchDigest !== expected.batchDigest) return denied("AUTHZ_BATCH_DIGEST_MISMATCH");
    if (claims.taskArtifactDigest !== expected.taskArtifactDigest) return denied("AUTHZ_TASK_ARTIFACT_MISMATCH");
    if (claims.userAuthorizationReceiptDigest !== expected.userAuthorizationReceiptDigest) return denied("AUTHZ_RECEIPT_MISMATCH");
    if (expected.action !== "targeted_repair" || claims.allowedActions.length !== 1 || claims.allowedActions[0] !== expected.action) return denied("AUTHZ_ACTION_MISMATCH");
    if (claims.allowedTargets.length !== 1 || claims.allowedTargets[0] !== expected.target) return denied("AUTHZ_TARGET_MISMATCH");
    if (!expected.allowedTargets.some((scope) => targetWithin(expected.target, scope))) return denied("AUTHZ_TARGET_MISMATCH");
    const blockedTargets = [...claims.blockedTargets, ...expected.blockedTargets];
    if (blockedTargets.some((blocked) => pathsIntersect(expected.target, blocked))) return denied("AUTHZ_BLOCKED_TARGET");
    if (claims.allowedTargets.some((allowed) => blockedTargets.some((blocked) => pathsIntersect(allowed, blocked)))) return denied("AUTHZ_BLOCKED_TARGET");

    if (reserveNonce) consumedNonces.add(claims.nonce);
    const reference = buildAuthorizationReferenceV1({
      authorizationId: claims.authorizationId,
      invocationId: claims.invocationId,
      claimsDigest: sha256Digest(claims),
      validation: "accepted",
    });
    return { accepted: true, reference };
  }

  function validate(envelope: unknown, expected: InvocationAuthorizationExpectationV1): InvocationAuthorizationValidationResultV1 {
    return validateEnvelope(envelope, expected, false);
  }

  function validateAndReserve(envelope: unknown, expected: InvocationAuthorizationExpectationV1): InvocationAuthorizationValidationResultV1 {
    return validateEnvelope(envelope, expected, true);
  }

  function revoke(authorizationId: string): void {
    assertId(authorizationId, "authz:v1:", "authorization.authorizationId");
    revokedAuthorizationIds.add(authorizationId);
  }

  return Object.freeze({ ephemeralKeyId, issue, validate, validateAndReserve, revoke });
}
