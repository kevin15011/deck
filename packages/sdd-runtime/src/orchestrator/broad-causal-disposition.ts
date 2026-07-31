import {
  assertDigest,
  assertExactKeys,
  codeValue,
  deepFreeze,
  enumValue,
  integerValue,
  sha256Digest,
  stringArray,
  type Sha256Digest,
} from "../contracts/canonical";
import { parseQualityDispositionEnvelopeV1, type QualityDispositionEnvelopeV1 } from "../contracts/baseline-evidence";
import { parseCandidateRefV1, type CandidateRefV1 } from "../contracts/qa-authority";

export type BroadCausalClassificationV1 =
  | "candidate_caused"
  | "new"
  | "worsened"
  | "related"
  | "unproven"
  | "stale"
  | "conflicting"
  | "non_candidate_residual"
  | "protected_risk";

export type ReviewFindingStatusV1 = "resolved" | "persistent" | "new";
export interface ReviewConvergenceFindingV1 { readonly findingId: string; readonly status: ReviewFindingStatusV1 }
export interface ReviewConvergenceResultV1 { readonly schema: "review-convergence-result-v1"; readonly candidateDigest: Sha256Digest; readonly checklistDigest: Sha256Digest; readonly findingSetDigest: Sha256Digest; readonly complete: true; readonly findings: readonly ReviewConvergenceFindingV1[]; readonly digest: Sha256Digest }

export type BroadCausalDispositionEntryV1 =
  | {
      readonly findingId: string;
      readonly kind: "blocking";
      readonly classification: Exclude<BroadCausalClassificationV1, "non_candidate_residual">;
      readonly evidenceDigests: readonly Sha256Digest[];
      readonly complete: boolean;
      readonly protected: boolean;
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly findingId: string;
      readonly kind: "warning";
      readonly classification: "non_candidate_residual";
      readonly evidenceDigests: readonly Sha256Digest[];
      readonly complete: true;
      readonly protected: false;
      readonly baselineEvidenceDigest: Sha256Digest;
      readonly reviewAttestationDigest: Sha256Digest;
      readonly residualRiskCode: string;
      readonly followUpRef: string;
    };

export interface BroadCausalDispositionEnvelopeV1 {
  readonly schema: "broad-causal-disposition-envelope-v1";
  readonly candidateDigest: Sha256Digest;
  readonly batchDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly broadStageJoinDigest: Sha256Digest;
  readonly broadManifestDigest: Sha256Digest;
  readonly reviewDigest: Sha256Digest;
  readonly qualityDispositionDigest: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
  readonly findingSetDigest: Sha256Digest;
  readonly entries: readonly BroadCausalDispositionEntryV1[];
  readonly digest: Sha256Digest;
}

export interface BroadCausalDispositionBindingV1 {
  readonly batchDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly broadStageJoinDigest: Sha256Digest;
  readonly broadManifestDigest: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
}

type BroadEntryInputV1 = {
  readonly findingId: string;
  readonly classification: BroadCausalClassificationV1;
  readonly evidenceDigests: readonly Sha256Digest[];
  readonly complete?: boolean;
  readonly protected?: boolean;
  readonly reasonCodes?: readonly string[];
  readonly baselineEvidenceDigest?: Sha256Digest;
  readonly residualRiskCode?: string;
  readonly followUpRef?: string;
};

const CLASSIFICATIONS: readonly BroadCausalClassificationV1[] = [
  "candidate_caused", "new", "worsened", "related", "unproven", "stale", "conflicting",
  "non_candidate_residual", "protected_risk",
];

function candidate(value: CandidateRefV1): CandidateRefV1 { return parseCandidateRefV1(value); }

function findingSet(value: readonly string[], name: string): string[] {
  const ids = stringArray(value, name, true);
  if (new Set(ids).size !== ids.length) throw new Error(`${name.toUpperCase()}_DUPLICATE`);
  return [...ids].sort();
}

function evidenceDigests(value: readonly Sha256Digest[]): Sha256Digest[] {
  const digests = [...new Set(value)].sort();
  for (const digest of digests) assertDigest(digest, "broad.evidenceDigest");
  return digests;
}

export function buildReviewConvergenceResultV1(input: {
  readonly candidate: CandidateRefV1;
  readonly checklistDigest: Sha256Digest;
  readonly findingSetDigest: Sha256Digest;
  readonly complete: boolean;
  readonly findings: readonly ReviewConvergenceFindingV1[];
}): ReviewConvergenceResultV1 {
  const subject = candidate(input.candidate);
  assertDigest(input.checklistDigest, "review.checklistDigest");
  assertDigest(input.findingSetDigest, "review.findingSetDigest");
  if (input.complete !== true) throw new Error("REVIEW_FINDING_SET_INCOMPLETE");
  const findings = [...input.findings]
    .map((finding) => ({
      findingId: codeValue(finding.findingId, "review.findingId"),
      status: enumValue(finding.status, ["resolved", "persistent", "new"] as const, "review.status"),
    }))
    .sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (
    new Set(findings.map((finding) => finding.findingId)).size !== findings.length ||
    input.findingSetDigest !== sha256Digest(findings)
  ) throw new Error("REVIEW_FINDING_SET_INCOMPLETE");
  const payload = {
    schema: "review-convergence-result-v1" as const,
    candidateDigest: subject.digest,
    checklistDigest: input.checklistDigest,
    findingSetDigest: input.findingSetDigest,
    complete: true as const,
    findings,
  };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as ReviewConvergenceResultV1;
}

export function parseReviewConvergenceResultV1(value: unknown, expectedCandidate: CandidateRefV1): ReviewConvergenceResultV1 {
  assertExactKeys(value, ["schema", "candidateDigest", "checklistDigest", "findingSetDigest", "complete", "findings", "digest"], "review convergence result");
  const raw = value as unknown as ReviewConvergenceResultV1;
  const subject = candidate(expectedCandidate);
  if (raw.schema !== "review-convergence-result-v1" || raw.candidateDigest !== subject.digest || raw.complete !== true) throw new Error("REVIEW_CONVERGENCE_INVALID");
  const rebuilt = buildReviewConvergenceResultV1({ candidate: subject, checklistDigest: raw.checklistDigest, findingSetDigest: raw.findingSetDigest, complete: raw.complete, findings: raw.findings });
  if (raw.digest !== rebuilt.digest) throw new Error("REVIEW_CONVERGENCE_INVALID");
  return rebuilt;
}

export function buildBroadCausalDispositionEnvelopeV1(input: {
  readonly candidate: CandidateRefV1;
  readonly binding: BroadCausalDispositionBindingV1;
  readonly review: ReviewConvergenceResultV1;
  readonly qualityDisposition: QualityDispositionEnvelopeV1;
  readonly broadFindingIds: readonly string[];
  readonly entries: readonly BroadEntryInputV1[];
}): BroadCausalDispositionEnvelopeV1 {
  const subject = candidate(input.candidate);
  const review = parseReviewConvergenceResultV1(input.review, subject);
  const quality = parseQualityDispositionEnvelopeV1(input.qualityDisposition);
  assertExactKeys(input.binding, ["batchDigest", "generation", "implementationSubjectDigest", "dependencySetDigest", "broadStageJoinDigest", "broadManifestDigest", "protectedPolicyDigest"], "broad causal binding");
  for (const digest of [input.binding.batchDigest, input.binding.implementationSubjectDigest, input.binding.dependencySetDigest, input.binding.broadStageJoinDigest, input.binding.broadManifestDigest, input.binding.protectedPolicyDigest]) {
    assertDigest(digest, "broad binding digest");
  }
  const generation = integerValue(input.binding.generation, "broad.generation", 0);
  if (
    generation !== subject.generation || input.binding.implementationSubjectDigest !== subject.implementationDigest ||
    input.binding.dependencySetDigest !== subject.dependencySetDigest || quality.batchDigest !== input.binding.batchDigest ||
    quality.manifestDigest !== input.binding.broadManifestDigest
  ) throw new Error("BROAD_DISPOSITION_BINDING_INVALID");
  const broadFindingIds = findingSet(input.broadFindingIds, "broadFindingIds");
  const decidedFindingIds = [...quality.warningFindingIds, ...quality.blockingFindingIds].sort();
  if (JSON.stringify(decidedFindingIds) !== JSON.stringify(broadFindingIds)) throw new Error("BROAD_FINDING_SET_INCOMPLETE");
  const warningIds = new Set(quality.warningFindingIds);
  const blockingIds = new Set(quality.blockingFindingIds);
  const entries = [...input.entries].map((entry): BroadCausalDispositionEntryV1 => {
    const findingId = codeValue(entry.findingId, "broad.findingId");
    const classification = enumValue(entry.classification, CLASSIFICATIONS, "broad.classification");
    const evidence = evidenceDigests(entry.evidenceDigests);
    if (warningIds.has(findingId as never)) {
      if (
        classification !== "non_candidate_residual" || entry.complete !== true || entry.protected === true ||
        !review.findings.some((finding) => finding.findingId === findingId && finding.status === "persistent") ||
        entry.baselineEvidenceDigest === undefined || !quality.baselineEvidenceDigests.includes(entry.baselineEvidenceDigest) ||
        !evidence.includes(entry.baselineEvidenceDigest) || entry.residualRiskCode === undefined || entry.followUpRef === undefined
      ) throw new Error("BROAD_WARNING_EVIDENCE_INVALID");
      assertDigest(entry.baselineEvidenceDigest, "broad.baselineEvidenceDigest");
      return {
        findingId,
        kind: "warning",
        classification: "non_candidate_residual",
        evidenceDigests: evidence,
        complete: true,
        protected: false,
        baselineEvidenceDigest: entry.baselineEvidenceDigest,
        reviewAttestationDigest: review.digest,
        residualRiskCode: codeValue(entry.residualRiskCode, "broad.residualRiskCode"),
        followUpRef: codeValue(entry.followUpRef, "broad.followUpRef"),
      };
    }
    if (!blockingIds.has(findingId as never)) throw new Error("BROAD_FINDING_SET_INCOMPLETE");
    const protectedFinding = entry.protected === true || classification === "protected_risk";
    return {
      findingId,
      kind: "blocking",
      classification: classification === "non_candidate_residual"
        ? "unproven"
        : protectedFinding ? "protected_risk" : classification,
      evidenceDigests: evidence,
      complete: entry.complete === true,
      protected: protectedFinding,
      reasonCodes: stringArray(entry.reasonCodes ?? ["BASELINE_EVALUATION_BLOCKING"], "broad.reasonCodes", true),
    };
  }).sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (
    entries.length !== broadFindingIds.length ||
    entries.some((entry, index) => entry.findingId !== broadFindingIds[index]) ||
    new Set(entries.map((entry) => entry.findingId)).size !== entries.length
  ) throw new Error("BROAD_FINDING_SET_INCOMPLETE");
  const payload = {
    schema: "broad-causal-disposition-envelope-v1" as const,
    candidateDigest: subject.digest,
    batchDigest: input.binding.batchDigest,
    generation,
    implementationSubjectDigest: input.binding.implementationSubjectDigest,
    dependencySetDigest: input.binding.dependencySetDigest,
    broadStageJoinDigest: input.binding.broadStageJoinDigest,
    broadManifestDigest: input.binding.broadManifestDigest,
    reviewDigest: review.digest,
    qualityDispositionDigest: quality.digest,
    protectedPolicyDigest: input.binding.protectedPolicyDigest,
    findingSetDigest: sha256Digest(broadFindingIds),
    entries,
  };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as BroadCausalDispositionEnvelopeV1;
}

export function parseBroadCausalDispositionEnvelopeV1(value: unknown, candidateValue: CandidateRefV1): BroadCausalDispositionEnvelopeV1 {
  assertExactKeys(value, ["schema", "candidateDigest", "batchDigest", "generation", "implementationSubjectDigest", "dependencySetDigest", "broadStageJoinDigest", "broadManifestDigest", "reviewDigest", "qualityDispositionDigest", "protectedPolicyDigest", "findingSetDigest", "entries", "digest"], "broad causal disposition");
  const raw = value as unknown as BroadCausalDispositionEnvelopeV1;
  const subject = candidate(candidateValue);
  if (raw.schema !== "broad-causal-disposition-envelope-v1" || raw.candidateDigest !== subject.digest) throw new Error("BROAD_DISPOSITION_INVALID");
  for (const digest of [raw.batchDigest, raw.implementationSubjectDigest, raw.dependencySetDigest, raw.broadStageJoinDigest, raw.broadManifestDigest, raw.reviewDigest, raw.qualityDispositionDigest, raw.protectedPolicyDigest, raw.findingSetDigest, raw.digest]) assertDigest(digest, "broad disposition digest");
  if (
    integerValue(raw.generation, "broad.generation", 0) !== subject.generation ||
    raw.implementationSubjectDigest !== subject.implementationDigest || raw.dependencySetDigest !== subject.dependencySetDigest
  ) throw new Error("BROAD_DISPOSITION_INVALID");
  if (!Array.isArray(raw.entries)) throw new Error("BROAD_DISPOSITION_INVALID");
  const entries = raw.entries.map((entry): BroadCausalDispositionEntryV1 => {
    if (entry.kind === "blocking") {
      assertExactKeys(entry, ["findingId", "kind", "classification", "evidenceDigests", "complete", "protected", "reasonCodes"], "broad blocking disposition entry");
      const classification = enumValue(entry.classification, CLASSIFICATIONS, "broad.classification");
      if (classification === "non_candidate_residual" || typeof entry.complete !== "boolean" || typeof entry.protected !== "boolean") {
        throw new Error("BROAD_DISPOSITION_INVALID");
      }
      if (entry.protected !== (classification === "protected_risk")) throw new Error("BROAD_DISPOSITION_INVALID");
      return {
        findingId: codeValue(entry.findingId, "broad.findingId"),
        kind: "blocking",
        classification,
        evidenceDigests: evidenceDigests(entry.evidenceDigests as readonly Sha256Digest[]),
        complete: entry.complete,
        protected: entry.protected,
        reasonCodes: stringArray(entry.reasonCodes, "broad.reasonCodes", true),
      };
    }
    if (entry.kind === "warning") {
      assertExactKeys(entry, ["findingId", "kind", "classification", "evidenceDigests", "complete", "protected", "baselineEvidenceDigest", "reviewAttestationDigest", "residualRiskCode", "followUpRef"], "broad warning disposition entry");
      if (entry.classification !== "non_candidate_residual" || entry.complete !== true || entry.protected !== false) {
        throw new Error("BROAD_DISPOSITION_INVALID");
      }
      assertDigest(entry.baselineEvidenceDigest, "broad.baselineEvidenceDigest");
      assertDigest(entry.reviewAttestationDigest, "broad.reviewAttestationDigest");
      const evidence = evidenceDigests(entry.evidenceDigests as readonly Sha256Digest[]);
      if (!evidence.includes(entry.baselineEvidenceDigest) || entry.reviewAttestationDigest !== raw.reviewDigest) {
        throw new Error("BROAD_DISPOSITION_INVALID");
      }
      return {
        findingId: codeValue(entry.findingId, "broad.findingId"),
        kind: "warning",
        classification: "non_candidate_residual",
        evidenceDigests: evidence,
        complete: true,
        protected: false,
        baselineEvidenceDigest: entry.baselineEvidenceDigest,
        reviewAttestationDigest: entry.reviewAttestationDigest,
        residualRiskCode: codeValue(entry.residualRiskCode, "broad.residualRiskCode"),
        followUpRef: codeValue(entry.followUpRef, "broad.followUpRef"),
      };
    }
    throw new Error("BROAD_DISPOSITION_INVALID");
  }).sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (JSON.stringify(entries) !== JSON.stringify(raw.entries)) throw new Error("BROAD_DISPOSITION_INVALID");
  const ids = entries.map((entry) => entry.findingId).sort();
  if (new Set(ids).size !== ids.length || raw.findingSetDigest !== sha256Digest(ids)) throw new Error("BROAD_DISPOSITION_INVALID");
  const payload = {
    schema: raw.schema,
    candidateDigest: raw.candidateDigest,
    batchDigest: raw.batchDigest,
    generation: raw.generation,
    implementationSubjectDigest: raw.implementationSubjectDigest,
    dependencySetDigest: raw.dependencySetDigest,
    broadStageJoinDigest: raw.broadStageJoinDigest,
    broadManifestDigest: raw.broadManifestDigest,
    reviewDigest: raw.reviewDigest,
    qualityDispositionDigest: raw.qualityDispositionDigest,
    protectedPolicyDigest: raw.protectedPolicyDigest,
    findingSetDigest: raw.findingSetDigest,
    entries,
  };
  if (raw.digest !== sha256Digest(payload)) throw new Error("BROAD_DISPOSITION_INVALID");
  return deepFreeze({ ...payload, digest: raw.digest });
}

export function broadDispositionIsReadyV1(value: BroadCausalDispositionEnvelopeV1, candidateValue: CandidateRefV1): boolean {
  try {
    const parsed = parseBroadCausalDispositionEnvelopeV1(value, candidateValue);
    return parsed.entries.every((entry) => entry.kind === "blocking" || (
      entry.classification === "non_candidate_residual" && entry.complete && !entry.protected &&
      entry.evidenceDigests.includes(entry.baselineEvidenceDigest) && entry.reviewAttestationDigest === parsed.reviewDigest
    ));
  } catch {
    return false;
  }
}
