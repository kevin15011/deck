import { assertDigest, assertExactKeys, deepFreeze, sha256Digest, stringArray, type Sha256Digest } from "../contracts/canonical";
import { parseApplyBatchContractV1, type ApplyBatchContractV1 } from "../contracts/apply-batch";
import { parseCandidateRefV1, parseQaAuthoritySnapshotV1, validateCandidateRefV1, type CandidateRefV1, type QaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { parseFailureManifestV1, type FailureManifestV1 } from "../contracts/failure-manifest";
import { parseQualityDispositionEnvelopeV1, type QualityDispositionEnvelopeV1 } from "../contracts/baseline-evidence";
import { parseRegistryIntentV1, type RegistryIntentV1 } from "../contracts/registry-intent";
import { parseVerificationStageExecutionJoinV1, type VerificationStageExecutionJoinV1 } from "../contracts/verification-stage-execution";
import {
  broadDispositionIsReadyV1,
  parseBroadCausalDispositionEnvelopeV1,
  parseReviewConvergenceResultV1,
  type BroadCausalDispositionEnvelopeV1,
  type ReviewConvergenceResultV1,
} from "./broad-causal-disposition";

export type QualityReadinessDecisionV1 =
  | {
      readonly schema: "quality-readiness-decision-v1";
      readonly kind: "registry_commit_ready";
      readonly candidateDigest: Sha256Digest;
      readonly phaseStatus: "passed" | "passed_with_warnings";
      readonly warningFindingIds: readonly string[];
      readonly evidenceDigests: readonly Sha256Digest[];
      readonly orderedIntentDigests: readonly Sha256Digest[];
      readonly digest: Sha256Digest;
    }
  | {
      readonly schema: "quality-readiness-decision-v1";
      readonly kind: "blocked";
      readonly candidateDigest: Sha256Digest;
      readonly blockingFindingIds: readonly string[];
      readonly reasonCodes: readonly string[];
      readonly evidenceDigests: readonly Sha256Digest[];
      readonly digest: Sha256Digest;
    }
  | {
      readonly schema: "quality-readiness-decision-v1";
      readonly kind: "invalid_evidence";
      readonly reasonCodes: readonly string[];
      readonly digest: Sha256Digest;
    };

export interface QualityReadinessInputV1 {
  readonly authority: QaAuthoritySnapshotV1;
  readonly currentCandidate: CandidateRefV1;
  readonly batch: ApplyBatchContractV1;
  readonly review: ReviewConvergenceResultV1;
  readonly targetedJoin: VerificationStageExecutionJoinV1;
  readonly affectedAreaJoin: VerificationStageExecutionJoinV1;
  readonly broadJoin: VerificationStageExecutionJoinV1;
  readonly broadManifest: FailureManifestV1;
  readonly qualityDisposition: QualityDispositionEnvelopeV1;
  readonly disposition: BroadCausalDispositionEnvelopeV1;
  readonly roleResultDigests: {
    readonly targeted: Sha256Digest;
    readonly affectedArea: Sha256Digest;
    readonly review: Sha256Digest;
    readonly broad: Sha256Digest;
  };
  readonly orderedIntents: readonly RegistryIntentV1[];
}

function invalid(reasonCodes: readonly string[]): QualityReadinessDecisionV1 {
  const payload = { schema: "quality-readiness-decision-v1" as const, kind: "invalid_evidence" as const, reasonCodes };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) });
}

export function parseQualityReadinessDecisionV1(value: unknown): QualityReadinessDecisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("QUALITY_READINESS_INVALID");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "registry_commit_ready") {
    assertExactKeys(raw, ["schema", "kind", "candidateDigest", "phaseStatus", "warningFindingIds", "evidenceDigests", "orderedIntentDigests", "digest"], "quality readiness");
    if (raw.schema !== "quality-readiness-decision-v1") throw new Error("QUALITY_READINESS_INVALID");
    assertDigest(raw.candidateDigest, "readiness.candidateDigest");
    const warningFindingIds = stringArray(raw.warningFindingIds, "readiness.warningFindingIds", true);
    const evidenceDigests = [...raw.evidenceDigests as Sha256Digest[]];
    const orderedIntentDigests = [...raw.orderedIntentDigests as Sha256Digest[]];
    for (const digest of [...evidenceDigests, ...orderedIntentDigests]) assertDigest(digest, "readiness.digest");
    if (!orderedIntentDigests.length || new Set(orderedIntentDigests).size !== orderedIntentDigests.length) throw new Error("QUALITY_READINESS_INVALID");
    const phaseStatus = raw.phaseStatus === "passed_with_warnings" ? "passed_with_warnings" as const : raw.phaseStatus === "passed" ? "passed" as const : undefined;
    if (!phaseStatus || (warningFindingIds.length > 0) !== (phaseStatus === "passed_with_warnings")) throw new Error("QUALITY_READINESS_INVALID");
    const payload = { schema: raw.schema, kind: raw.kind, candidateDigest: raw.candidateDigest, phaseStatus, warningFindingIds, evidenceDigests, orderedIntentDigests };
    if (raw.digest !== sha256Digest(payload)) throw new Error("QUALITY_READINESS_INVALID");
    return deepFreeze({ ...payload, digest: raw.digest }) as QualityReadinessDecisionV1;
  }
  if (raw.kind === "blocked") {
    assertExactKeys(raw, ["schema", "kind", "candidateDigest", "blockingFindingIds", "reasonCodes", "evidenceDigests", "digest"], "quality readiness");
    if (raw.schema !== "quality-readiness-decision-v1") throw new Error("QUALITY_READINESS_INVALID");
    assertDigest(raw.candidateDigest, "readiness.candidateDigest");
    const blockingFindingIds = stringArray(raw.blockingFindingIds, "readiness.blockingFindingIds", true);
    const reasonCodes = stringArray(raw.reasonCodes, "readiness.reasonCodes", true);
    const evidenceDigests = [...raw.evidenceDigests as Sha256Digest[]];
    for (const digest of evidenceDigests) assertDigest(digest, "readiness.evidenceDigest");
    const payload = { schema: raw.schema, kind: raw.kind, candidateDigest: raw.candidateDigest, blockingFindingIds, reasonCodes, evidenceDigests };
    if (raw.digest !== sha256Digest(payload)) throw new Error("QUALITY_READINESS_INVALID");
    return deepFreeze({ ...payload, digest: raw.digest }) as QualityReadinessDecisionV1;
  }
  assertExactKeys(raw, ["schema", "kind", "reasonCodes", "digest"], "quality readiness");
  if (raw.schema !== "quality-readiness-decision-v1" || raw.kind !== "invalid_evidence") throw new Error("QUALITY_READINESS_INVALID");
  const reasonCodes = stringArray(raw.reasonCodes, "readiness.reasonCodes", true);
  const payload = { schema: raw.schema, kind: raw.kind, reasonCodes };
  if (raw.digest !== sha256Digest(payload)) throw new Error("QUALITY_READINESS_INVALID");
  return deepFreeze({ ...payload, digest: raw.digest }) as QualityReadinessDecisionV1;
}

export function decideQualityReadinessV1(input: QualityReadinessInputV1): QualityReadinessDecisionV1 {
  try {
    const authority = parseQaAuthoritySnapshotV1(input.authority);
    const currentCandidate = parseCandidateRefV1(input.currentCandidate);
    if (!validateCandidateRefV1(authority.candidate, currentCandidate).ok) return invalid(["QA_CANDIDATE_STALE"]);
    const batch = parseApplyBatchContractV1(input.batch);
    if (batch.batchId !== authority.batchId || batch.digest !== authority.batchDigest) return invalid(["QA_EVIDENCE_INCOMPLETE"]);
    const review = parseReviewConvergenceResultV1(input.review, authority.candidate);
    const targetedJoin = parseVerificationStageExecutionJoinV1(input.targetedJoin);
    const affectedAreaJoin = parseVerificationStageExecutionJoinV1(input.affectedAreaJoin);
    const broadJoin = parseVerificationStageExecutionJoinV1(input.broadJoin);
    const broadManifest = parseFailureManifestV1(input.broadManifest, batch);
    const qualityDisposition = parseQualityDispositionEnvelopeV1(input.qualityDisposition, broadManifest);
    const disposition = parseBroadCausalDispositionEnvelopeV1(input.disposition, authority.candidate);
    const orderedIntents = input.orderedIntents.map(parseRegistryIntentV1);
    const orderedIntentDigests = orderedIntents.map((intent) => intent.digest);
    const stageEvidence = (stage: "targeted" | "affected_area" | "review" | "broad") => authority.convergence.records.stageEvidence
      .filter((entry) => entry.stage === stage && entry.generation === authority.generation);
    const targetedEvidence = stageEvidence("targeted");
    const affectedEvidence = stageEvidence("affected_area");
    const reviewEvidence = stageEvidence("review");
    const broadEvidence = stageEvidence("broad");
    const resultRecord = (stage: "targeted" | "affected_area" | "review" | "broad") => authority.convergence.records.resultRecords
      .filter((entry) => entry.stage === stage && entry.generation === authority.generation);
    const expectedRoleResultDigests = [input.roleResultDigests.targeted, input.roleResultDigests.affectedArea, input.roleResultDigests.review, input.roleResultDigests.broad];
    expectedRoleResultDigests.forEach((digest) => assertDigest(digest, "readiness.roleResultDigest"));
    const acceptedRoleResultDigests = [resultRecord("targeted"), resultRecord("affected_area"), resultRecord("review"), resultRecord("broad")];
    if (
      authority.lifecycle !== "registry_commit_pending" || authority.reviewDigest === undefined || authority.broadDigest === undefined ||
      review.digest !== authority.reviewDigest || review.checklistDigest !== authority.reviewChecklistDigest ||
      targetedJoin.status !== "passed" || affectedAreaJoin.status !== "passed" || broadJoin.status !== "passed" ||
      targetedJoin.stage !== "targeted" || affectedAreaJoin.stage !== "affected_area" || broadJoin.stage !== "broad" ||
      [targetedJoin, affectedAreaJoin, broadJoin].some((join) =>
        join.generation !== authority.generation || join.implementationSubjectDigest !== authority.implementationSubjectDigest ||
        join.dependencySetDigest !== authority.dependencySetDigest
      ) ||
      targetedEvidence.length !== 1 || targetedEvidence[0]!.evidenceDigest !== targetedJoin.digest ||
      affectedEvidence.length !== 1 || affectedEvidence[0]!.evidenceDigest !== affectedAreaJoin.digest ||
      reviewEvidence.length !== 1 || reviewEvidence[0]!.evidenceDigest !== review.digest ||
      broadEvidence.length !== 1 || broadEvidence[0]!.evidenceDigest !== broadJoin.digest ||
      acceptedRoleResultDigests.some((records, index) => records.length !== 1 || records[0]!.roleResultEnvelopeDigest !== expectedRoleResultDigests[index]) ||
      broadJoin.rawFailureManifestDigest !== broadManifest.digest ||
      qualityDisposition.batchId !== authority.batchId || qualityDisposition.batchDigest !== authority.batchDigest ||
      resultRecord("broad")[0]?.verificationDigest !== qualityDisposition.verificationDigest ||
      qualityDisposition.manifestDigest !== broadManifest.digest || disposition.qualityDispositionDigest !== qualityDisposition.digest ||
      disposition.batchDigest !== authority.batchDigest || disposition.generation !== authority.generation ||
      disposition.implementationSubjectDigest !== authority.implementationSubjectDigest ||
      disposition.dependencySetDigest !== authority.dependencySetDigest || disposition.broadStageJoinDigest !== broadJoin.digest ||
      disposition.broadManifestDigest !== broadManifest.digest || disposition.protectedPolicyDigest !== authority.protectedPolicyDigest ||
      disposition.reviewDigest !== review.digest || disposition.digest !== authority.broadDigest ||
      !broadDispositionIsReadyV1(disposition, authority.candidate) ||
      orderedIntentDigests.length === 0 || new Set(orderedIntentDigests).size !== orderedIntentDigests.length ||
      JSON.stringify(orderedIntentDigests) !== JSON.stringify(authority.convergence.current.registryIntentDigests) ||
      orderedIntents.some((intent) => intent.changeId !== authority.changeId || intent.batchId !== authority.batchId || intent.batchDigest !== authority.batchDigest) ||
      orderedIntents[0]!.base.stateDigest !== authority.registryBase.stateDigest ||
      orderedIntents[0]!.base.eventsDigest !== authority.registryBase.eventsDigest ||
      disposition.entries.some((entry) => entry.kind === "warning" && !orderedIntents.some((intent) =>
        intent.intentId === entry.followUpRef && intent.status === "passed_with_warnings" &&
        intent.artifact.kind === "warning-follow-up" && intent.event.notes.includes(entry.findingId)
      ))
    ) return invalid(["QA_EVIDENCE_INCOMPLETE"]);

    const blockingFindingIds = disposition.entries
      .filter((entry) => entry.kind === "blocking")
      .map((entry) => entry.findingId);
    const evidenceDigests = [targetedJoin.digest, affectedAreaJoin.digest, review.digest, broadJoin.digest, broadManifest.digest, qualityDisposition.digest, disposition.digest, ...expectedRoleResultDigests];
    if (blockingFindingIds.length) {
      const payload = {
        schema: "quality-readiness-decision-v1" as const,
        kind: "blocked" as const,
        candidateDigest: authority.candidateDigest,
        blockingFindingIds,
        reasonCodes: ["BROAD_CAUSAL_BLOCKERS"],
        evidenceDigests,
      };
      return deepFreeze({ ...payload, digest: sha256Digest(payload) });
    }

    const warningFindingIds = disposition.entries
      .filter((entry) => entry.kind === "warning")
      .map((entry) => entry.findingId);
    const payload = {
      schema: "quality-readiness-decision-v1" as const,
      kind: "registry_commit_ready" as const,
      candidateDigest: authority.candidateDigest,
      phaseStatus: warningFindingIds.length ? "passed_with_warnings" as const : "passed" as const,
      warningFindingIds,
      evidenceDigests,
      orderedIntentDigests,
    };
    return deepFreeze({ ...payload, digest: sha256Digest(payload) });
  } catch {
    return invalid(["QA_EVIDENCE_INVALID"]);
  }
}
