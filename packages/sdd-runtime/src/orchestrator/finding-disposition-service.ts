import { parseApplyBatchContractV1, type ApplyBatchContractV1 } from "../contracts/apply-batch";
import { parseBaselineEvidenceEnvelopeV1, type BaselineEvidenceEnvelopeV1, type QualityDispositionEnvelopeV1 } from "../contracts/baseline-evidence";
import { assertDigest, assertExactKeys, cloneCanonical, codeValue, deepFreeze, denseArray, enumValue, sha256Digest, stringValue, timestampValue, type Sha256Digest } from "../contracts/canonical";
import { parseFailureManifestV1, type FailureFindingV1, type FailureManifestV1, type FindingId } from "../contracts/failure-manifest";
import type { FindingDispositionEnvelopeV1 } from "../contracts/finding-disposition";

export interface MandatoryQualityExecutionV1 { readonly stage: "targeted" | "affected_area" | "independent_review" | "broad"; readonly status: "completed"; readonly producerInstanceId: string; readonly producedAt: string; readonly evidenceDigest: Sha256Digest }
export type { QualityDispositionEnvelopeV1 } from "../contracts/baseline-evidence";
export interface FindingBaselineDecisionV1 { readonly findingId: FindingId; readonly disposition: "warning" | "blocking"; readonly reasonCode: string; readonly baselineEvidenceDigest?: Sha256Digest }
export interface FindingDispositionBaselineEvaluationV1 { readonly qualityDisposition: QualityDispositionEnvelopeV1; readonly stageStatus: "passed" | "failed"; readonly rawFindings: readonly FailureFindingV1[]; readonly decisions: readonly FindingBaselineDecisionV1[] }

interface EvaluationInputV1 {
  schema: "finding-disposition-baseline-evaluation-v1";
  batch: ApplyBatchContractV1;
  manifest: FailureManifestV1;
  findingDisposition: FindingDispositionEnvelopeV1;
  verificationDigest: Sha256Digest;
  baselineEvidence: readonly { findingId: FindingId; evidence: BaselineEvidenceEnvelopeV1 }[];
  mandatoryExecution: readonly MandatoryQualityExecutionV1[];
  currentEvidenceBindings: Omit<BaselineEvidenceEnvelopeV1["freshness"], "producedAt" | "expiresAt" | "invalidationTriggers">;
  producerRole: "verify" | "review" | "orchestrator" | "archive";
  producerInstanceId: string;
  producedAt: string;
  now: string;
}

const INPUT_KEYS = ["schema", "batch", "manifest", "findingDisposition", "verificationDigest", "baselineEvidence", "mandatoryExecution", "currentEvidenceBindings", "producerRole", "producerInstanceId", "producedAt", "now"];
const BINDING_KEYS = ["policyDigest", "normalizerDigest", "commandDigest", "testDigest", "oracleDigest", "dependencyDigest", "configurationDigest", "lockfileDigest", "protectedPolicyDigest", "candidateDigest", "environmentDigest", "producerIdentityDigest", "linkedArtifactDigest"] as const;
const QUALITY_STAGES = ["targeted", "affected_area", "independent_review", "broad"] as const;
const PROTECTED_TERMS = /(?:security|authorization|credential|secret|git[_-]?safety|destructive|data[_-]?loss|migration|public[_-]?interface|cross[_-]?package|architecture|generated[_-]?output|registry[_-]?(?:conflict|recovery)|freshness|required[_-]?(?:artifact|requirement|task|design))/i;
const severityRank = { low: 0, medium: 1, high: 2, critical: 3 } as const;

function parseMandatoryExecution(value: unknown): MandatoryQualityExecutionV1[] {
  const stages = denseArray(value, "mandatoryExecution", 4).map((entry, index) => {
    assertExactKeys(entry, ["stage", "status", "producerInstanceId", "producedAt", "evidenceDigest"], `mandatoryExecution[${index}]`);
    assertDigest(entry.evidenceDigest, `mandatoryExecution[${index}].evidenceDigest`);
    return { stage: enumValue(entry.stage, QUALITY_STAGES, `mandatoryExecution[${index}].stage`), status: enumValue(entry.status, ["completed"], `mandatoryExecution[${index}].status`), producerInstanceId: codeValue(entry.producerInstanceId, `mandatoryExecution[${index}].producerInstanceId`), producedAt: timestampValue(entry.producedAt, `mandatoryExecution[${index}].producedAt`), evidenceDigest: entry.evidenceDigest };
  });
  if (stages.length !== QUALITY_STAGES.length || stages.some((entry, index) => entry.stage !== QUALITY_STAGES[index]) || new Set(stages.map((entry) => entry.producerInstanceId)).size !== stages.length) throw new Error("invalid-evidence: mandatory-execution");
  return stages;
}

function parseFindingDisposition(value: unknown, batch: ApplyBatchContractV1, manifest: FailureManifestV1): FindingDispositionEnvelopeV1 {
  assertExactKeys(value, ["schema", "envelopeId", "digest", "classificationPolicyVersion", "changeId", "batchId", "batchDigest", "manifestDigest", "entries", "semanticDigest"], "findingDisposition");
  if (value.schema !== "finding-disposition-envelope-v1" || value.batchId !== batch.batchId || value.batchDigest !== batch.digest || value.manifestDigest !== manifest.digest || value.changeId !== batch.changeId) throw new Error("invalid-evidence: findingDisposition.binding");
  assertDigest(value.digest, "findingDisposition.digest"); assertDigest(value.semanticDigest, "findingDisposition.semanticDigest");
  if (typeof value.envelopeId !== "string" || !/^disposition:v1:[a-f0-9]{32}$/.test(value.envelopeId)) throw new Error("invalid-evidence: findingDisposition.envelopeId");
  const entries = denseArray(value.entries, "findingDisposition.entries");
  const payload = { schema: value.schema, classificationPolicyVersion: codeValue(value.classificationPolicyVersion, "findingDisposition.classificationPolicyVersion"), changeId: value.changeId, batchId: value.batchId, batchDigest: value.batchDigest, manifestDigest: value.manifestDigest, entries, semanticDigest: value.semanticDigest };
  const expected = sha256Digest(payload);
  if (value.digest !== expected || value.envelopeId !== `disposition:v1:${expected.slice(7, 39)}`) throw new Error("invalid-evidence: findingDisposition.digest");
  const ids = entries.map((entry, index) => { assertExactKeys(entry, ["findingId", "disposition", "requirementIds", "taskIds", "checkIds", "classificationReasonCode", "baselinePolicyRef", "deferPolicyRef"], `findingDisposition.entries[${index}]`); return stringValue(entry.findingId, `findingDisposition.entries[${index}].findingId`) as FindingId; });
  if (ids.length !== manifest.findings.length || new Set(ids).size !== ids.length || ids.some((id, index) => id !== manifest.findings[index]?.findingId)) throw new Error("invalid-evidence: findingDisposition.entries");
  return deepFreeze(cloneCanonical(value)) as unknown as FindingDispositionEnvelopeV1;
}

function protectedFinding(finding: FailureFindingV1, evidence: BaselineEvidenceEnvelopeV1): boolean {
  return finding.isSecurityRelevant || ["security", "authorization", "git_safety", "requirement", "architecture"].includes(finding.rootCause) || PROTECTED_TERMS.test(`${finding.category} ${finding.rootCause} ${finding.oracleId} ${finding.requirementIds.join(" ")} ${finding.taskIds.join(" ")}`) || evidence.nonRegression.baselineProtectedRisk !== "none" || evidence.nonRegression.candidateProtectedRisk !== "none";
}

function thresholdReason(evidence: BaselineEvidenceEnvelopeV1): string | undefined {
  const baselineMatches = evidence.baselineObservations.filter((run) => run.outcome === "matched" && run.normalizedFingerprint === evidence.normalizedFingerprint).length;
  const candidateMatches = evidence.candidateObservations.filter((run) => run.outcome === "matched" && run.normalizedFingerprint === evidence.normalizedFingerprint).length;
  const baselineReused = evidence.ledgerAuthority.replacesBaselineRuns && evidence.baselineObservations.length === 0;
  if (evidence.findingMode === "deterministic") {
    if ((!baselineReused && (evidence.baselineObservations.length !== 2 || baselineMatches !== 2)) || evidence.candidateObservations.length !== 2 || candidateMatches !== 2) return "INSUFFICIENT_DETERMINISTIC_REPRODUCTION";
  } else {
    if (baselineReused || evidence.baselineObservations.length !== 5 || evidence.candidateObservations.length !== 5 || baselineMatches < 3 || candidateMatches < 3 || candidateMatches > baselineMatches) return "INSUFFICIENT_FLAKY_REPRODUCTION";
  }
  if ((!baselineReused && evidence.nonRegression.baselineOccurrenceCount !== baselineMatches) || evidence.nonRegression.candidateOccurrenceCount !== candidateMatches) return "CONFLICTING_OCCURRENCE_EVIDENCE";
}

function evidenceReason(evidence: BaselineEvidenceEnvelopeV1, finding: FailureFindingV1, input: EvaluationInputV1, execution: readonly MandatoryQualityExecutionV1[]): string | undefined {
  if (finding.relationship !== "unrelated_baseline" || finding.status !== "pre_existing" || !finding.evidence.length) return "MANIFEST_NOT_UNRELATED_PRE_EXISTING";
  if (evidence.candidateSubject.batchId !== input.batch.batchId || evidence.candidateSubject.batchDigest !== input.batch.digest || evidence.freshness.candidateDigest !== evidence.candidateSubject.treeDigest) return "CANDIDATE_IDENTITY_MISMATCH";
  if (BINDING_KEYS.some((key) => evidence.freshness[key] !== input.currentEvidenceBindings[key])) return "STALE_EVIDENCE_BINDING";
  const observations = [...evidence.baselineObservations, ...evidence.candidateObservations];
  if (evidence.baselineObservations.some((run) => run.subjectDigest !== evidence.baselineSubject.digest) || evidence.candidateObservations.some((run) => run.subjectDigest !== evidence.candidateSubject.treeDigest)) return "OBSERVATION_SUBJECT_MISMATCH";
  if (observations.some((run) => run.commandPlanDigest !== evidence.environmentEquivalence.candidate.commandPlanDigest || run.environmentDigest !== evidence.freshness.environmentDigest)) return "NON_FIXED_OR_ENVIRONMENT_MISMATCH";
  if (evidence.freshness.commandDigest !== evidence.environmentEquivalence.candidate.commandPlanDigest || evidence.freshness.lockfileDigest !== evidence.environmentEquivalence.candidate.lockfileDigest) return "STALE_COMMAND_OR_LOCKFILE";
  const threshold = thresholdReason(evidence); if (threshold) return threshold;
  if (evidence.causalIsolation.credibleCausalPath || evidence.causalIsolation.overlappingLocations.length || evidence.causalIsolation.overlappingDependencies.length || evidence.causalIsolation.overlappingConfigurations.length || evidence.causalIsolation.overlappingOracles.length) return "CAUSALLY_RELATED";
  const metric = evidence.nonRegression;
  if (severityRank[metric.candidateSeverity] > severityRank[metric.baselineSeverity] || metric.candidateOccurrenceCount > metric.baselineOccurrenceCount || metric.candidateReachability > metric.baselineReachability || metric.candidateDurationMs > metric.baselineDurationMs || metric.candidateResourceUnits > metric.baselineResourceUnits || metric.skippedChecks || metric.weakenedChecks || metric.filteredChecks || metric.relabeledChecks) return "WORSENED_OR_WEAKENED";
  if (protectedFinding(finding, evidence)) return "PROTECTED_FINDING";
  const now = Date.parse(input.now), produced = Date.parse(evidence.freshness.producedAt), expires = Date.parse(evidence.freshness.expiresAt), ledgerExpires = Date.parse(evidence.ledgerAuthority.expiresAt);
  if (produced > now || expires < now || ledgerExpires < now || evidence.ledgerAuthority.status !== "active") return "STALE_OR_INACTIVE_EVIDENCE";
  if (evidence.findingMode === "flaky" && (expires - produced > 14 * 24 * 60 * 60 * 1000 || now - produced > 14 * 24 * 60 * 60 * 1000)) return "FLAKY_EVIDENCE_EXPIRED";
  const cohort = evidence.environmentEquivalence.candidate.cohort;
  if (evidence.ledgerAuthority.environmentCohort !== `${cohort.os}+${cohort.arch}+${cohort.runtimeName}-${cohort.runtimeMajor}`) return "LEDGER_COHORT_MISMATCH";
  const identities = new Set([input.producerInstanceId, ...execution.map((stage) => stage.producerInstanceId)]);
  if (evidence.ledgerAuthority.approvalCandidateDigest === evidence.candidateSubject.treeDigest || evidence.ledgerAuthority.approvalCandidateDigest === input.batch.digest || identities.has(evidence.ledgerAuthority.approvalIdentity) || identities.has(evidence.ledgerAuthority.approvalTransactionId)) return "SELF_ADMISSION_REJECTED";
}

function parseInput(value: unknown): EvaluationInputV1 {
  assertExactKeys(value, INPUT_KEYS, "finding disposition baseline evaluation");
  if (value.schema !== "finding-disposition-baseline-evaluation-v1") throw new Error("unsupported-contract-version");
  const batch = parseApplyBatchContractV1(value.batch), manifest = parseFailureManifestV1(value.manifest, batch), findingDisposition = parseFindingDisposition(value.findingDisposition, batch, manifest);
  assertDigest(value.verificationDigest, "verificationDigest");
  const baselineEvidence = denseArray(value.baselineEvidence, "baselineEvidence").map((entry, index) => { assertExactKeys(entry, ["findingId", "evidence"], `baselineEvidence[${index}]`); const findingId = stringValue(entry.findingId, `baselineEvidence[${index}].findingId`) as FindingId; return { findingId, evidence: entry.evidence as BaselineEvidenceEnvelopeV1 }; }).sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (new Set(baselineEvidence.map((entry) => entry.findingId)).size !== baselineEvidence.length) throw new Error("invalid-evidence: duplicate-baseline-evidence");
  const rawBindings = value.currentEvidenceBindings;
  assertExactKeys(rawBindings, BINDING_KEYS, "currentEvidenceBindings");
  const currentEvidenceBindings = Object.fromEntries(BINDING_KEYS.map((key) => [key, (() => { assertDigest(rawBindings[key], `currentEvidenceBindings.${key}`); return rawBindings[key]; })()])) as EvaluationInputV1["currentEvidenceBindings"];
  const mandatoryExecution = parseMandatoryExecution(value.mandatoryExecution), producerInstanceId = codeValue(value.producerInstanceId, "producerInstanceId");
  if (mandatoryExecution.some((stage) => stage.producerInstanceId === producerInstanceId)) throw new Error("invalid-evidence: producer-identity-reuse");
  return { schema: value.schema, batch, manifest, findingDisposition, verificationDigest: value.verificationDigest, baselineEvidence, mandatoryExecution, currentEvidenceBindings, producerRole: enumValue(value.producerRole, ["verify", "review", "orchestrator", "archive"], "producerRole"), producerInstanceId, producedAt: timestampValue(value.producedAt, "producedAt"), now: timestampValue(value.now, "now") };
}

export function evaluateFindingDispositionBaselineV1(value: unknown): FindingDispositionBaselineEvaluationV1 {
  const input = parseInput(value);
  const dispositionEntries = new Map(input.findingDisposition.entries.map((entry) => [entry.findingId, entry]));
  const evidenceEntries = new Map(input.baselineEvidence.map((entry) => [entry.findingId, entry.evidence]));
  const decisions: FindingBaselineDecisionV1[] = input.manifest.findings.map((finding): FindingBaselineDecisionV1 => {
    const rawEvidence = evidenceEntries.get(finding.findingId), lowLevel = dispositionEntries.get(finding.findingId);
    if (!rawEvidence) return { findingId: finding.findingId, disposition: "blocking", reasonCode: "MISSING_BASELINE_EVIDENCE" };
    let evidence: BaselineEvidenceEnvelopeV1;
    try { evidence = parseBaselineEvidenceEnvelopeV1(rawEvidence); } catch { return { findingId: finding.findingId, disposition: "blocking", reasonCode: "INVALID_OR_CONFLICTING_BASELINE_EVIDENCE" }; }
    if (lowLevel?.disposition !== "pre-existing" || lowLevel.baselinePolicyRef !== finding.fingerprint) return { findingId: finding.findingId, disposition: "blocking", reasonCode: "LOW_LEVEL_DISPOSITION_MISMATCH", baselineEvidenceDigest: evidence.digest };
    const reasonCode = evidenceReason(evidence, finding, input, input.mandatoryExecution);
    return reasonCode ? { findingId: finding.findingId, disposition: "blocking", reasonCode, baselineEvidenceDigest: evidence.digest } : { findingId: finding.findingId, disposition: "warning", reasonCode: "PROVEN_UNRELATED_BASELINE", baselineEvidenceDigest: evidence.digest };
  }).sort((a, b) => a.findingId.localeCompare(b.findingId));
  const warningFindingIds = decisions.filter((item) => item.disposition === "warning").map((item) => item.findingId), blockingFindingIds = decisions.filter((item) => item.disposition === "blocking").map((item) => item.findingId);
  const status = blockingFindingIds.length ? "failed" : warningFindingIds.length ? "passed_with_warnings" : "passed";
  const payload = { schema: "quality-disposition-envelope-v1" as const, batchId: input.batch.batchId, batchDigest: input.batch.digest, manifestDigest: input.manifest.digest, verificationDigest: input.verificationDigest, findingDispositionDigest: input.findingDisposition.digest, baselineEvidenceDigests: [...new Set(decisions.flatMap((item) => item.baselineEvidenceDigest ? [item.baselineEvidenceDigest] : []))].sort(), mandatoryExecutionComplete: true as const, status, warningFindingIds, blockingFindingIds, producerRole: input.producerRole, producerInstanceId: input.producerInstanceId, producedAt: input.producedAt };
  const qualityDisposition = deepFreeze({ ...payload, digest: sha256Digest(payload) }) as QualityDispositionEnvelopeV1;
  return deepFreeze({ qualityDisposition, stageStatus: status === "failed" ? "failed" : "passed", rawFindings: cloneCanonical(input.manifest.findings), decisions });
}
