import { expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import {
  createInvocationAuthorizationServiceV1,
  type InvocationAuthorizationExpectationV1,
  type InvocationAuthorizationIssueInputV1,
} from "./invocation-authorization-service";

const sha = (byte: string) => `sha256:${byte.repeat(64)}` as const;
const batch = buildApplyBatchContractV1({
  schema: "apply-batch-v1",
  changeId: "batch-d-authorization",
  taskIds: ["EG4-T1"],
  dependencies: [],
  ownerRole: "apply-general",
  allowedTargets: ["packages/sdd-runtime"],
  blockedTargets: ["openspec/changes/runner-capability-standardization"],
  acceptanceObligations: ["REQ-AUTH-001"],
  verificationPlan: [{ stage: "targeted", checkIds: ["authorization"] }],
  artifactDigests: { "tasks.md": sha("a") },
  authorizationGrantRef: sha("b"),
  provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00Z" },
});

function harness(seed = 1) {
  let now = Date.parse("2026-07-16T12:00:00Z");
  let counter = seed;
  const service = createInvocationAuthorizationServiceV1({
    now: () => new Date(now),
    randomBytes: (length) => Uint8Array.from({ length }, () => (counter++ % 251) + 1),
  });
  const issueInput: InvocationAuthorizationIssueInputV1 = {
    invocationId: "invocation-d-1",
    changeId: batch.changeId,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    role: "apply-general",
    taskArtifactDigest: sha("c"),
    allowedActions: ["targeted_repair"],
    allowedTargets: ["packages/sdd-runtime"],
    blockedTargets: [...batch.blockedTargets],
    userAuthorizationReceiptDigest: sha("d"),
  };
  const expected: InvocationAuthorizationExpectationV1 = {
    invocationId: issueInput.invocationId,
    changeId: issueInput.changeId,
    batchId: issueInput.batchId,
    batchDigest: issueInput.batchDigest,
    role: issueInput.role,
    taskArtifactDigest: issueInput.taskArtifactDigest,
    userAuthorizationReceiptDigest: issueInput.userAuthorizationReceiptDigest,
    action: "targeted_repair",
    target: "packages/sdd-runtime",
    allowedTargets: [...batch.allowedTargets],
    blockedTargets: [...batch.blockedTargets],
  };
  return {
    service,
    issue: (overrides: Partial<InvocationAuthorizationIssueInputV1> = {}, ttlMs = 300_000) => service.issue({ ...issueInput, ...overrides }, ttlMs),
    expected,
    setNow: (value: number) => { now = value; },
    getNow: () => now,
  };
}

test("D-AUTH-01 exact valid envelope reserves one matching capability", () => {
  const h = harness();
  const envelope = h.issue();
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({
    accepted: true,
    reference: {
      authorizationId: envelope.claims.authorizationId,
      invocationId: "invocation-d-1",
      claimsDigest: sha256Digest(envelope.claims),
      validation: "accepted",
    },
  });
});

test("authorization inspection does not consume the nonce before delegation", () => {
  const h = harness();
  const envelope = h.issue();
  expect(h.service.validate(envelope, h.expected).accepted).toBe(true);
  expect(h.service.validate(envelope, h.expected).accepted).toBe(true);
  expect(h.service.validateAndReserve(envelope, h.expected).accepted).toBe(true);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_REPLAYED" });
});

test("D-AUTH-02 missing envelope is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(undefined, h.expected)).toEqual({ accepted: false, code: "AUTHZ_MISSING" });
});

test("D-AUTH-03 tampered proof is denied without delegation authority", () => {
  const h = harness();
  const envelope = h.issue();
  const suffix = envelope.proof.value.endsWith("A") ? "B" : "A";
  const tampered = { ...envelope, proof: { ...envelope.proof, value: `${envelope.proof.value.slice(0, -1)}${suffix}` } };
  expect(h.service.validateAndReserve(tampered, h.expected)).toEqual({ accepted: false, code: "AUTHZ_PROOF_INVALID" });
  expect(h.service.validateAndReserve({ ...envelope, claims: { ...envelope.claims, role: "apply-backend" } }, h.expected)).toEqual({ accepted: false, code: "AUTHZ_MALFORMED" });
});

test("D-AUTH-04 expired envelope is denied", () => {
  const h = harness();
  const envelope = h.issue({}, 1_000);
  h.setNow(h.getNow() + 1_001);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_EXPIRED" });
  let lifetimeError: unknown;
  try {
    h.issue({}, 300_001);
  } catch (error) {
    lifetimeError = error;
  }
  expect(String(lifetimeError)).toBe("Error: invalid-evidence: authorization.lifetimeMs");
});

test("D-AUTH-05 future-issued envelope is denied", () => {
  const h = harness();
  const original = h.getNow();
  h.setNow(original + 60_000);
  const envelope = h.issue();
  h.setNow(original);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_FUTURE" });
});

test("D-AUTH-06 consumed nonce cannot be replayed", () => {
  const h = harness();
  const envelope = h.issue();
  expect(h.service.validateAndReserve(envelope, h.expected).accepted).toBe(true);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_REPLAYED" });
});

test("D-AUTH-07 process restart invalidates a prior envelope", () => {
  const first = harness(1);
  const restarted = harness(101);
  expect(restarted.service.validateAndReserve(first.issue(), restarted.expected)).toEqual({ accepted: false, code: "AUTHZ_RESTARTED" });
});

test("D-AUTH-08 malformed envelope is denied safely", () => {
  const h = harness();
  expect(h.service.validateAndReserve({ schema: "unknown" }, h.expected)).toEqual({ accepted: false, code: "AUTHZ_MALFORMED" });
});

test("D-AUTH-09 revoked envelope is denied", () => {
  const h = harness();
  const envelope = h.issue();
  h.service.revoke(envelope.claims.authorizationId);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_REVOKED" });
});

test("D-AUTH-10 role mismatch is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, role: "apply-backend" })).toEqual({ accepted: false, code: "AUTHZ_ROLE_MISMATCH" });
});

test("D-AUTH-11 change mismatch is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, changeId: "other-change" })).toEqual({ accepted: false, code: "AUTHZ_CHANGE_MISMATCH" });
});

test("D-AUTH-12 batch ID mismatch is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, batchId: `batch:v1:${"e".repeat(32)}` })).toEqual({ accepted: false, code: "AUTHZ_BATCH_ID_MISMATCH" });
});

test("D-AUTH-13 batch digest mismatch is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, batchDigest: sha("e") })).toEqual({ accepted: false, code: "AUTHZ_BATCH_DIGEST_MISMATCH" });
});

test("D-AUTH-14 task artifact digest mismatch is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, taskArtifactDigest: sha("e") })).toEqual({ accepted: false, code: "AUTHZ_TASK_ARTIFACT_MISMATCH" });
});

test("D-AUTH-15 non-targeted action is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, action: "diagnose_runtime" })).toEqual({ accepted: false, code: "AUTHZ_ACTION_MISMATCH" });
});

test("D-AUTH-16 target mismatch or overbroad scope is denied", () => {
  const h = harness();
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, target: "packages/core" })).toEqual({ accepted: false, code: "AUTHZ_TARGET_MISMATCH" });
  expect(h.service.validateAndReserve(h.issue({ allowedTargets: ["packages"] }), h.expected)).toEqual({ accepted: false, code: "AUTHZ_TARGET_MISMATCH" });
  expect(h.service.validateAndReserve(h.issue(), { ...h.expected, target: "packages/sdd-runtime/src" })).toEqual({ accepted: false, code: "AUTHZ_TARGET_MISMATCH" });
});

test("D-AUTH-17 blocked target intersection is denied", () => {
  const h = harness();
  const envelope = h.issue({ allowedTargets: ["packages/sdd-runtime/private"], blockedTargets: ["packages/sdd-runtime"] });
  const expected = { ...h.expected, target: "packages/sdd-runtime/private", allowedTargets: ["packages/sdd-runtime/private"], blockedTargets: ["packages/sdd-runtime"] };
  expect(h.service.validateAndReserve(envelope, expected)).toEqual({ accepted: false, code: "AUTHZ_BLOCKED_TARGET" });
});

test("D-AUTH-18 failed launch leaves nonce consumed", () => {
  const h = harness();
  const envelope = h.issue();
  const reserved = h.service.validateAndReserve(envelope, h.expected);
  expect(reserved.accepted).toBe(true);
  expect(h.service.validateAndReserve(envelope, h.expected)).toEqual({ accepted: false, code: "AUTHZ_REPLAYED" });
});

test("D-AUTH-19 diagnostics and references expose no proof key receipt or secret", () => {
  const h = harness();
  const envelope = h.issue();
  const accepted = h.service.validateAndReserve(envelope, h.expected);
  const rejected = h.service.validateAndReserve({ ...envelope, prompt: "SECRET_PROMPT_SENTINEL", command: "SECRET_COMMAND_SENTINEL" }, h.expected);
  const serialized = JSON.stringify({ service: h.service, accepted, rejected });
  expect(serialized).not.toContain(envelope.proof.value);
  expect(serialized).not.toContain(envelope.claims.userAuthorizationReceiptDigest);
  expect(serialized).not.toContain("SECRET_PROMPT_SENTINEL");
  expect(serialized).not.toContain("SECRET_COMMAND_SENTINEL");
  expect(serialized).not.toMatch(/private|secret|receipt/i);
});
