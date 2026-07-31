import {
  assertDigest,
  assertExactKeys,
  assertId,
  cloneCanonical,
  codeValue,
  deepFreeze,
  enumValue,
  integerValue,
  sha256Digest,
  stringArray,
  type Sha256Digest,
} from "./canonical";
import type { BatchId } from "./apply-batch";
import {
  parseExecutionConvergenceDossierWithAuthorityV1,
  type ConvergenceAuthorityRecordSetV1,
  type ConvergenceLifecycleStateV1,
  type ConvergenceTransitionReceiptV1,
  type ExecutionConvergenceDossierV1,
} from "./execution-convergence";

export type QaStageV1 = "targeted" | "affected_area" | "review" | "broad";

export interface CandidateRefV1 {
  readonly schema: "candidate-ref-v1";
  readonly generation: number;
  readonly implementationDigest: Sha256Digest;
  readonly treeDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly requirementsDigest: Sha256Digest;
  readonly environmentDigest: Sha256Digest;
  readonly checkPlanDigest: Sha256Digest;
  readonly digest: Sha256Digest;
}

export interface QaConvergenceAuthoritySourceV1 {
  readonly current: ExecutionConvergenceDossierV1;
  readonly history: readonly ExecutionConvergenceDossierV1[];
  readonly receipts: readonly ConvergenceTransitionReceiptV1[];
  readonly records: ConvergenceAuthorityRecordSetV1;
}

export interface QaFreshnessAuthorityV1 {
  readonly applyInstanceIds: readonly string[];
  readonly verifyInstanceId?: string;
  readonly reviewInstanceId?: string;
  readonly priorVerifyInstanceId?: string;
  readonly priorReviewInstanceId?: string;
  readonly codeModifiedAfterVerify: boolean;
  readonly reviewRequired: boolean;
  readonly freshReviewTriggers: readonly string[];
  readonly capabilities: {
    readonly freshAgentScheduling: boolean;
    readonly roleIsolation: boolean;
  };
}

export interface QaAuthoritySnapshotV1 {
  readonly schema: "qa-authority-snapshot-v1";
  readonly qaRunId: `qa-run:v1:${string}`;
  readonly changeId: string;
  readonly batchId: BatchId;
  readonly batchDigest: Sha256Digest;
  readonly candidate: CandidateRefV1;
  readonly candidateDigest: Sha256Digest;
  readonly convergence: QaConvergenceAuthoritySourceV1;
  readonly convergenceAuthorityDigest: Sha256Digest;
  readonly executionDossierDigest: Sha256Digest;
  readonly convergenceDossierDigest: Sha256Digest;
  readonly convergenceRevision: number;
  readonly lifecycle: ConvergenceLifecycleStateV1;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly freshness: QaFreshnessAuthorityV1;
  readonly reviewCheckIds: readonly string[];
  readonly reviewChecklistDigest: Sha256Digest;
  readonly stagedVerificationDigest: Sha256Digest;
  readonly scopedStageDigest?: Sha256Digest;
  readonly reviewDigest?: Sha256Digest;
  readonly broadDigest?: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
  readonly registryBase: {
    readonly stateDigest: Sha256Digest;
    readonly eventsDigest: Sha256Digest;
  };
  readonly digest: Sha256Digest;
}

export type QaAuthorityBindingV1 =
  | { readonly kind: "convergence"; readonly snapshot: QaAuthoritySnapshotV1 }
  | { readonly kind: "legacy_compatibility"; readonly nonAuthoritative: true };

export interface ApplyPreflightReceiptV1 {
  readonly schema: "apply-preflight-receipt-v1";
  readonly candidateDigest: Sha256Digest;
  readonly generation: number;
  readonly status: "passed" | "failed";
  readonly criticalAssumptions: readonly string[];
  readonly evidenceDigests: readonly Sha256Digest[];
  readonly digest: Sha256Digest;
}

export interface ProtectedRequirementSnapshotV1 {
  readonly schema: "protected-requirement-snapshot-v1";
  readonly candidateDigest: Sha256Digest;
  readonly officialArtifactDigests: Readonly<Record<string, Sha256Digest>>;
  readonly reconciliationReceiptDigest?: Sha256Digest;
  readonly replacementBatchDigest?: Sha256Digest;
  readonly digest: Sha256Digest;
}

export interface QaEvidenceReuseReceiptV1 {
  readonly schema: "qa-evidence-reuse-receipt-v1";
  readonly stage: QaStageV1;
  readonly originalCandidateDigest: Sha256Digest;
  readonly newCandidateDigest: Sha256Digest;
  readonly reason: "unchanged_slice";
  readonly digest: Sha256Digest;
}

export interface QaImpactInvalidationV1 {
  readonly schema: "qa-impact-invalidation-v1";
  readonly invalidatedStages: readonly QaStageV1[];
  readonly reuseReceipts: readonly QaEvidenceReuseReceiptV1[];
  readonly reason: "implementation_changed" | "dependency_changed" | "protected_requirements_changed" | "unknown_impact";
  readonly digest: Sha256Digest;
}

const CANDIDATE_KEYS = ["schema", "generation", "implementationDigest", "treeDigest", "dependencySetDigest", "requirementsDigest", "environmentDigest", "checkPlanDigest", "digest"] as const;
const STAGES: readonly QaStageV1[] = ["targeted", "affected_area", "review", "broad"];
const QA_LIFECYCLES: readonly ConvergenceLifecycleStateV1[] = [
  "awaiting_apply_result", "targeted_pending", "affected_pending", "review_pending", "broad_pending",
  "registry_commit_pending", "complete", "routing_pending", "repair_pending", "diagnosis_pending",
  "replan_required", "escalated", "stopped", "recovery_required",
];
const QA_FRESH_REVIEW_TRIGGERS = [
  "incident", "security_finding", "architecture_finding", "authorization_rejection",
  "generated_artifact_correction", "public_contract_repair", "migration_repair", "cross_package_repair",
  "multi_package_repair", "material_repair", "high_risk_repair",
] as const;
const QA_REVIEW_CHECK_IDS = ["architecture-review", "security-review"] as const;
const QA_AUTHORITY_SNAPSHOT_KEYS = [
  "schema", "qaRunId", "changeId", "batchId", "batchDigest", "candidate", "candidateDigest",
  "convergence", "convergenceAuthorityDigest", "executionDossierDigest", "convergenceDossierDigest", "convergenceRevision", "lifecycle", "generation",
  "implementationSubjectDigest", "dependencySetDigest", "freshness", "reviewCheckIds", "reviewChecklistDigest", "stagedVerificationDigest", "protectedPolicyDigest",
  "scopedStageDigest", "reviewDigest", "broadDigest", "registryBase", "digest",
] as const;

function digestMap(value: Record<string, Sha256Digest>, name: string): Record<string, Sha256Digest> {
  const entries = Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) throw new Error(`${name}_REQUIRED`);
  for (const [key, digest] of entries) {
    codeValue(key, `${name}.key`);
    assertDigest(digest, `${name}.${key}`);
  }
  return Object.fromEntries(entries);
}

export function buildCandidateRefV1(input: Omit<CandidateRefV1, "schema" | "digest">): CandidateRefV1 {
  assertExactKeys(input, ["generation", "implementationDigest", "treeDigest", "dependencySetDigest", "requirementsDigest", "environmentDigest", "checkPlanDigest"], "candidate");
  const payload = cloneCanonical({
    schema: "candidate-ref-v1" as const,
    generation: integerValue(input.generation, "candidate.generation", 0),
    implementationDigest: input.implementationDigest,
    treeDigest: input.treeDigest,
    dependencySetDigest: input.dependencySetDigest,
    requirementsDigest: input.requirementsDigest,
    environmentDigest: input.environmentDigest,
    checkPlanDigest: input.checkPlanDigest,
  });
  for (const [key, value] of Object.entries(payload)) if (key.endsWith("Digest")) assertDigest(value, `candidate.${key}`);
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as CandidateRefV1;
}

export function parseCandidateRefV1(value: unknown): CandidateRefV1 {
  assertExactKeys(value, CANDIDATE_KEYS, "candidate");
  const raw = value as unknown as CandidateRefV1;
  if (raw.schema !== "candidate-ref-v1") throw new Error("unsupported-contract-version");
  const { schema: _schema, digest: _digest, ...input } = raw;
  const candidate = buildCandidateRefV1(input);
  if (raw.digest !== candidate.digest) throw new Error("CANDIDATE_GENERATION_STALE");
  return candidate;
}

export function parseQaConvergenceAuthoritySourceV1(value: unknown): QaConvergenceAuthoritySourceV1 {
  assertExactKeys(value, ["current", "history", "receipts", "records"], "qa convergence authority");
  const raw = value as unknown as QaConvergenceAuthoritySourceV1;
  if (!Array.isArray(raw.history) || !Array.isArray(raw.receipts) || !raw.records) throw new Error("QA_CONVERGENCE_AUTHORITY_INVALID");
  const current = parseExecutionConvergenceDossierWithAuthorityV1(raw.current, raw.history, raw.receipts, raw.records);
  return deepFreeze({ current, history: raw.history, receipts: raw.receipts, records: raw.records });
}

function convergenceAuthorityDigest(value: QaConvergenceAuthoritySourceV1): Sha256Digest {
  return sha256Digest({
    currentDigest: value.current.digest,
    historyDigests: value.history.map((entry) => entry.digest),
    receiptDigests: value.receipts.map((entry) => entry.digest),
    stageEvidenceDigests: value.records.stageEvidence.map((entry) => entry.digest),
    invalidationDigests: value.records.invalidations.map((entry) => entry.digest),
    resultRecordDigests: value.records.resultRecords.map((entry) => entry.digest),
  });
}

function normalizeQaFreshnessAuthorityV1(value: QaFreshnessAuthorityV1): QaFreshnessAuthorityV1 {
  assertExactKeys(value, [
    "applyInstanceIds", "verifyInstanceId", "reviewInstanceId", "priorVerifyInstanceId", "priorReviewInstanceId",
    "codeModifiedAfterVerify", "reviewRequired", "freshReviewTriggers", "capabilities",
  ], "qa freshness authority");
  assertExactKeys(value.capabilities, ["freshAgentScheduling", "roleIsolation"], "qa freshness capabilities");
  if (
    typeof value.codeModifiedAfterVerify !== "boolean" || typeof value.reviewRequired !== "boolean" ||
    typeof value.capabilities.freshAgentScheduling !== "boolean" || typeof value.capabilities.roleIsolation !== "boolean"
  ) throw new Error("QA_FRESHNESS_AUTHORITY_INVALID");
  const applyInstanceIds = stringArray(value.applyInstanceIds, "qaFreshness.applyInstanceIds", true);
  if (applyInstanceIds.length === 0) throw new Error("QA_FRESHNESS_AUTHORITY_INVALID");
  const identity = (candidate: string | undefined, name: string) => candidate === undefined ? undefined : codeValue(candidate, name);
  const freshReviewTriggers = stringArray(value.freshReviewTriggers, "qaFreshness.freshReviewTriggers", true)
    .map((trigger) => enumValue(trigger, QA_FRESH_REVIEW_TRIGGERS, "qaFreshness.freshReviewTrigger"));
  return deepFreeze({
    applyInstanceIds,
    ...(identity(value.verifyInstanceId, "qaFreshness.verifyInstanceId") === undefined ? {} : { verifyInstanceId: value.verifyInstanceId }),
    ...(identity(value.reviewInstanceId, "qaFreshness.reviewInstanceId") === undefined ? {} : { reviewInstanceId: value.reviewInstanceId }),
    ...(identity(value.priorVerifyInstanceId, "qaFreshness.priorVerifyInstanceId") === undefined ? {} : { priorVerifyInstanceId: value.priorVerifyInstanceId }),
    ...(identity(value.priorReviewInstanceId, "qaFreshness.priorReviewInstanceId") === undefined ? {} : { priorReviewInstanceId: value.priorReviewInstanceId }),
    codeModifiedAfterVerify: value.codeModifiedAfterVerify,
    reviewRequired: value.reviewRequired,
    freshReviewTriggers,
    capabilities: { ...value.capabilities },
  });
}

export function buildQaAuthoritySnapshotV1(input: {
  readonly candidate: CandidateRefV1;
  readonly changeId: string;
  readonly convergence: QaConvergenceAuthoritySourceV1;
  readonly freshness: QaFreshnessAuthorityV1;
  readonly executionDossierDigest: Sha256Digest;
  readonly stagedVerificationDigest: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
  readonly registryBase: { readonly stateDigest: Sha256Digest; readonly eventsDigest: Sha256Digest };
}): QaAuthoritySnapshotV1 {
  assertExactKeys(input, [
    "candidate", "changeId", "convergence", "freshness", "executionDossierDigest", "stagedVerificationDigest",
    "protectedPolicyDigest", "registryBase",
  ], "qa authority snapshot input");
  const candidate = parseCandidateRefV1(input.candidate);
  const convergence = parseQaConvergenceAuthoritySourceV1(input.convergence);
  const state = convergence.current.state;
  const changeId = codeValue(input.changeId, "qaAuthority.changeId");
  const freshness = normalizeQaFreshnessAuthorityV1(input.freshness);
  const reviewCheckIds = [...QA_REVIEW_CHECK_IDS];
  const reviewChecklistDigest = sha256Digest({ candidateCheckPlanDigest: candidate.checkPlanDigest, reviewCheckIds });
  assertId(convergence.current.baseBatchId, "batch:v1:", "qaAuthority.batchId");
  for (const [name, value] of Object.entries({
    batchDigest: convergence.current.baseBatchDigest,
    executionDossierDigest: input.executionDossierDigest,
    convergenceDossierDigest: convergence.current.digest,
    stagedVerificationDigest: input.stagedVerificationDigest,
    protectedPolicyDigest: input.protectedPolicyDigest,
  })) assertDigest(value, `qaAuthority.${name}`);
  if (convergence.current.baseDossierDigest !== input.executionDossierDigest) {
    throw new Error("QA_CONVERGENCE_DOSSIER_MISMATCH");
  }
  assertExactKeys(input.registryBase, ["stateDigest", "eventsDigest"], "qa authority registry base");
  assertDigest(input.registryBase.stateDigest, "qaAuthority.registryBase.stateDigest");
  assertDigest(input.registryBase.eventsDigest, "qaAuthority.registryBase.eventsDigest");
  const lifecycle = enumValue(state.lifecycle, QA_LIFECYCLES, "qaAuthority.lifecycle");
  if (candidate.generation !== state.generation || candidate.implementationDigest !== state.implementationSubjectDigest) {
    throw new Error("QA_CANDIDATE_CONVERGENCE_MISMATCH");
  }
  const currentGenerationEvidence = convergence.records.stageEvidence.filter((entry) => entry.generation === state.generation);
  if (!currentGenerationEvidence.length || currentGenerationEvidence.some((entry) => entry.dependencySetDigest !== candidate.dependencySetDigest)) {
    throw new Error("QA_DEPENDENCY_CONVERGENCE_MISMATCH");
  }
  if ((lifecycle === "broad_pending" || lifecycle === "registry_commit_pending") && state.reviewDigest === undefined) {
    throw new Error("QA_REVIEW_BINDING_REQUIRED");
  }
  if (lifecycle === "registry_commit_pending" && (state.broadDigest === undefined || convergence.current.dispositionDigest === undefined)) {
    throw new Error("QA_BROAD_BINDING_REQUIRED");
  }
  const base = cloneCanonical({
    schema: "qa-authority-snapshot-v1" as const,
    changeId,
    batchId: convergence.current.baseBatchId as BatchId,
    batchDigest: convergence.current.baseBatchDigest,
    candidate,
    candidateDigest: candidate.digest,
    convergence,
    convergenceAuthorityDigest: convergenceAuthorityDigest(convergence),
    executionDossierDigest: input.executionDossierDigest,
    convergenceDossierDigest: convergence.current.digest,
    convergenceRevision: convergence.current.revision,
    lifecycle,
    generation: state.generation,
    implementationSubjectDigest: state.implementationSubjectDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    freshness,
    reviewCheckIds,
    reviewChecklistDigest,
    stagedVerificationDigest: input.stagedVerificationDigest,
    ...(state.scopedStageDigest === undefined ? {} : { scopedStageDigest: state.scopedStageDigest }),
    ...(state.reviewDigest === undefined ? {} : { reviewDigest: state.reviewDigest }),
    ...(convergence.current.dispositionDigest === undefined ? {} : { broadDigest: convergence.current.dispositionDigest }),
    protectedPolicyDigest: input.protectedPolicyDigest,
    registryBase: input.registryBase,
  });
  const qaRunId = `qa-run:v1:${sha256Digest(base).slice(7, 39)}` as const;
  const payload = cloneCanonical({ ...base, qaRunId });
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as QaAuthoritySnapshotV1;
}

export function parseQaAuthoritySnapshotV1(value: unknown): QaAuthoritySnapshotV1 {
  assertExactKeys(value, QA_AUTHORITY_SNAPSHOT_KEYS, "qa authority snapshot");
  const raw = value as unknown as QaAuthoritySnapshotV1;
  if (raw.schema !== "qa-authority-snapshot-v1") throw new Error("unsupported-contract-version");
  assertId(raw.qaRunId, "qa-run:v1:", "qaAuthority.qaRunId");
  const { digest, ...payload } = raw;
  if (digest !== sha256Digest(payload)) throw new Error("QA_AUTHORITY_STALE");
  const rebuilt = buildQaAuthoritySnapshotV1({
    candidate: raw.candidate,
    changeId: raw.changeId,
    convergence: raw.convergence,
    freshness: raw.freshness,
    executionDossierDigest: raw.executionDossierDigest,
    stagedVerificationDigest: raw.stagedVerificationDigest,
    protectedPolicyDigest: raw.protectedPolicyDigest,
    registryBase: raw.registryBase,
  });
  if (raw.qaRunId !== rebuilt.qaRunId || raw.digest !== rebuilt.digest) throw new Error("QA_AUTHORITY_STALE");
  return rebuilt;
}

export function parseQaAuthorityBindingV1(value: unknown): QaAuthorityBindingV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("QA_AUTHORITY_REQUIRED");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "legacy_compatibility") {
    assertExactKeys(raw, ["kind", "nonAuthoritative"], "qa authority binding");
    if (raw.nonAuthoritative !== true) throw new Error("QA_AUTHORITY_REQUIRED");
    return deepFreeze({ kind: "legacy_compatibility" as const, nonAuthoritative: true as const });
  }
  assertExactKeys(raw, ["kind", "snapshot"], "qa authority binding");
  if (raw.kind !== "convergence") throw new Error("QA_AUTHORITY_REQUIRED");
  return deepFreeze({ kind: "convergence" as const, snapshot: parseQaAuthoritySnapshotV1(raw.snapshot) });
}

export function validateCandidateRefV1(currentValue: unknown, suppliedValue: unknown): { readonly ok: true } | { readonly ok: false; readonly code: "CANDIDATE_GENERATION_STALE" | "CANDIDATE_MISMATCH" } {
  try {
    const current = parseCandidateRefV1(currentValue), supplied = parseCandidateRefV1(suppliedValue);
    if (current.generation !== supplied.generation) return deepFreeze({ ok: false as const, code: "CANDIDATE_GENERATION_STALE" as const });
    return current.digest === supplied.digest
      ? deepFreeze({ ok: true as const })
      : deepFreeze({ ok: false as const, code: "CANDIDATE_MISMATCH" as const });
  } catch {
    return deepFreeze({ ok: false as const, code: "CANDIDATE_GENERATION_STALE" as const });
  }
}

export function buildApplyPreflightReceiptV1(input: { readonly candidate: CandidateRefV1; readonly status: "passed" | "failed"; readonly criticalAssumptions: readonly string[]; readonly evidenceDigests: readonly Sha256Digest[] }): ApplyPreflightReceiptV1 {
  const candidate = parseCandidateRefV1(input.candidate);
  const criticalAssumptions = stringArray(input.criticalAssumptions, "preflight.criticalAssumptions", true);
  const evidenceDigests = [...new Set(input.evidenceDigests)].sort();
  for (const digest of evidenceDigests) assertDigest(digest, "preflight.evidenceDigest");
  if (criticalAssumptions.length > 0 && evidenceDigests.length === 0) throw new Error("PREFLIGHT_EVIDENCE_REQUIRED");
  const payload = { schema: "apply-preflight-receipt-v1" as const, candidateDigest: candidate.digest, generation: candidate.generation, status: enumValue(input.status, ["passed", "failed"] as const, "preflight.status"), criticalAssumptions, evidenceDigests };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as ApplyPreflightReceiptV1;
}

export function assertCriticalApplyPreflightV1(candidateValue: unknown, planDeclaresCriticalPreflight: boolean, receiptValue?: unknown): void {
  if (!planDeclaresCriticalPreflight) return;
  if (!receiptValue) throw new Error("PREFLIGHT_REQUIRED");
  const candidate = parseCandidateRefV1(candidateValue);
  const receipt = receiptValue as ApplyPreflightReceiptV1;
  if (receipt.schema !== "apply-preflight-receipt-v1" || receipt.candidateDigest !== candidate.digest || receipt.generation !== candidate.generation) throw new Error("PREFLIGHT_STALE");
  if (receipt.digest !== sha256Digest({ schema: receipt.schema, candidateDigest: receipt.candidateDigest, generation: receipt.generation, status: receipt.status, criticalAssumptions: receipt.criticalAssumptions, evidenceDigests: receipt.evidenceDigests })) throw new Error("PREFLIGHT_STALE");
  if (receipt.status !== "passed") throw new Error("PREFLIGHT_FAILED");
}

export function buildProtectedRequirementSnapshotV1(input: { readonly candidate: CandidateRefV1; readonly officialArtifactDigests: Record<string, Sha256Digest>; readonly suppliedArtifactDigests: Record<string, Sha256Digest>; readonly reconciliationReceiptDigest?: Sha256Digest; readonly replacementBatchDigest?: Sha256Digest }): ProtectedRequirementSnapshotV1 {
  const candidate = parseCandidateRefV1(input.candidate);
  const officialArtifactDigests = digestMap(input.officialArtifactDigests, "officialArtifactDigests");
  const supplied = digestMap(input.suppliedArtifactDigests, "suppliedArtifactDigests");
  const drift = Object.keys(officialArtifactDigests).some((key) => supplied[key] !== officialArtifactDigests[key]);
  if (drift && (!input.reconciliationReceiptDigest || !input.replacementBatchDigest)) throw new Error("PROTECTED_REQUIREMENTS_RECONCILIATION_REQUIRED");
  if (input.reconciliationReceiptDigest) assertDigest(input.reconciliationReceiptDigest, "reconciliationReceiptDigest");
  if (input.replacementBatchDigest) assertDigest(input.replacementBatchDigest, "replacementBatchDigest");
  const payload = { schema: "protected-requirement-snapshot-v1" as const, candidateDigest: candidate.digest, officialArtifactDigests, ...(input.reconciliationReceiptDigest ? { reconciliationReceiptDigest: input.reconciliationReceiptDigest } : {}), ...(input.replacementBatchDigest ? { replacementBatchDigest: input.replacementBatchDigest } : {}) };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as ProtectedRequirementSnapshotV1;
}

export function deriveQaImpactInvalidationV1(input: { readonly previousCandidate: CandidateRefV1; readonly currentCandidate: CandidateRefV1 }): QaImpactInvalidationV1 {
  const previous = parseCandidateRefV1(input.previousCandidate), current = parseCandidateRefV1(input.currentCandidate);
  const implementationChanged = previous.implementationDigest !== current.implementationDigest || previous.treeDigest !== current.treeDigest;
  const protectedRequirementsChanged = previous.requirementsDigest !== current.requirementsDigest;
  const candidateChanged = previous.digest !== current.digest;
  const invalidatedStages = candidateChanged ? [...STAGES] : [];
  const reason = protectedRequirementsChanged
    ? "protected_requirements_changed" as const
    : implementationChanged
      ? "implementation_changed" as const
      : previous.dependencySetDigest !== current.dependencySetDigest ? "dependency_changed" as const : "unknown_impact" as const;
  const reuseReceipts: readonly QaEvidenceReuseReceiptV1[] = [];
  const payload = { schema: "qa-impact-invalidation-v1" as const, invalidatedStages, reuseReceipts, reason };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as QaImpactInvalidationV1;
}
