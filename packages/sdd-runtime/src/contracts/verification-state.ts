import type { BatchId, VerificationStage } from "./apply-batch";
import type { Sha256Digest } from "./canonical";
import {
  assertDigest,
  assertExactKeys,
  cloneCanonical,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  sha256Digest,
  stringArray,
  stringValue,
  timestampValue,
} from "./canonical";
import type { SafeEvidenceRefV1 } from "./failure-manifest";

export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "deferred";
export type VerificationOmissionReasonV1 = "not_applicable" | "not_available" | "blocked_by_prior_stage" | "policy_deferred";

export interface VerificationOmissionEvidenceV1 {
  readonly reasonCode: VerificationOmissionReasonV1;
  readonly evidence: SafeEvidenceRefV1;
  readonly policyId: string;
  readonly expiresAt?: string;
  readonly nextTrigger?: string;
  readonly riskAcceptance: {
    readonly actor: string;
    readonly acceptedAt: string;
    readonly rationaleCode: string;
  };
}

export interface VerificationStageStateV1 {
  readonly stage: VerificationStage;
  readonly status: StageStatus;
  readonly checkIds: readonly string[];
  readonly evidence: readonly SafeEvidenceRefV1[];
  readonly skipReason?: VerificationOmissionReasonV1;
  readonly omission?: VerificationOmissionEvidenceV1;
}

export interface StagedVerificationStateV1 {
  readonly schema: "staged-verification-state-v1";
  readonly digest: Sha256Digest;
  readonly batchId: BatchId;
  readonly stages: readonly VerificationStageStateV1[];
  readonly nextStage?: VerificationStage;
}

export type StagedVerificationStateInputV1 = Omit<StagedVerificationStateV1, "digest">;

function evidence(value: unknown, field: string): SafeEvidenceRefV1 {
  assertExactKeys(value, ["kind", "checkId", "artifact", "excerpt", "resultCode"], field);
  return {
    kind: codeValue(value.kind, `${field}.kind`),
    checkId: codeValue(value.checkId, `${field}.checkId`),
    artifact: stringValue(value.artifact, `${field}.artifact`),
    ...(value.excerpt === undefined ? {} : { excerpt: stringValue(value.excerpt, `${field}.excerpt`, 256) }),
    ...(value.resultCode === undefined ? {} : { resultCode: codeValue(value.resultCode, `${field}.resultCode`) }),
  };
}

function omission(value: unknown, field: string, reason: VerificationOmissionReasonV1): VerificationOmissionEvidenceV1 {
  assertExactKeys(value, ["reasonCode", "evidence", "policyId", "expiresAt", "nextTrigger", "riskAcceptance"], field);
  const reasonCode = enumValue(value.reasonCode, ["not_applicable", "not_available", "blocked_by_prior_stage", "policy_deferred"], `${field}.reasonCode`);
  if (reasonCode !== reason || value.expiresAt === undefined && value.nextTrigger === undefined) {
    throw new Error("invalid-evidence: verification.omission");
  }
  assertExactKeys(value.riskAcceptance, ["actor", "acceptedAt", "rationaleCode"], `${field}.riskAcceptance`);
  return {
    reasonCode,
    evidence: evidence(value.evidence, `${field}.evidence`),
    policyId: codeValue(value.policyId, `${field}.policyId`),
    ...(value.expiresAt === undefined ? {} : { expiresAt: timestampValue(value.expiresAt, `${field}.expiresAt`) }),
    ...(value.nextTrigger === undefined ? {} : { nextTrigger: codeValue(value.nextTrigger, `${field}.nextTrigger`) }),
    riskAcceptance: {
      actor: codeValue(value.riskAcceptance.actor, `${field}.riskAcceptance.actor`),
      acceptedAt: timestampValue(value.riskAcceptance.acceptedAt, `${field}.riskAcceptance.acceptedAt`),
      rationaleCode: codeValue(value.riskAcceptance.rationaleCode, `${field}.riskAcceptance.rationaleCode`),
    },
  };
}

function read(value: unknown) {
  assertExactKeys(value, ["schema", "batchId", "stages", "nextStage"], "verification");
  if (value.schema !== "staged-verification-state-v1") throw new Error("unsupported-contract-version");
  const stages = denseArray(value.stages, "verification.stages", 3).map((stage, index) => {
    const field = `verification.stages[${index}]`;
    assertExactKeys(stage, ["stage", "status", "checkIds", "evidence", "skipReason", "omission"], field);
    const status = enumValue(stage.status, ["pending", "running", "passed", "failed", "skipped", "deferred"], `${field}.status`);
    const omitted = status === "skipped" || status === "deferred";
    if (omitted !== (stage.skipReason !== undefined) || !omitted && stage.omission !== undefined) {
      throw new Error("invalid-evidence: verification.skipReason");
    }
    const skipReason = stage.skipReason === undefined
      ? undefined
      : enumValue(stage.skipReason, ["not_applicable", "not_available", "blocked_by_prior_stage", "policy_deferred"], `${field}.skipReason`);
    return {
      stage: enumValue(stage.stage, ["targeted", "affected_area", "broad"], `${field}.stage`),
      status,
      checkIds: stringArray(stage.checkIds, `${field}.checkIds`, true),
      evidence: denseArray(stage.evidence, `${field}.evidence`).map((item, evidenceIndex) => evidence(item, `${field}.evidence[${evidenceIndex}]`)),
      ...(skipReason === undefined ? {} : { skipReason }),
      ...(stage.omission === undefined || skipReason === undefined ? {} : { omission: omission(stage.omission, `${field}.omission`, skipReason) }),
    };
  });
  return cloneCanonical({
    schema: "staged-verification-state-v1" as const,
    batchId: stringValue(value.batchId, "verification.batchId") as BatchId,
    stages,
    ...(value.nextStage === undefined ? {} : { nextStage: enumValue(value.nextStage, ["targeted", "affected_area", "broad"], "verification.nextStage") }),
  });
}

export function buildStagedVerificationStateV1(value: StagedVerificationStateInputV1): StagedVerificationStateV1 {
  const payload = read(value), digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest });
}

export function parseStagedVerificationStateV1(value: unknown): StagedVerificationStateV1 {
  assertExactKeys(value, ["schema", "digest", "batchId", "stages", "nextStage"], "verification");
  assertDigest(value.digest, "verification.digest");
  const { digest, ...payload } = value;
  const parsed = read(payload);
  if (sha256Digest(parsed) !== digest) throw new Error("invalid-evidence: verification");
  return deepFreeze({ ...parsed, digest });
}
