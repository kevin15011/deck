import {
  assertDigest,
  assertExactKeys,
  booleanValue,
  cloneCanonical,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  integerValue,
  repositoryPath,
  sha256Digest,
  stringArray,
  stringValue,
  timestampValue,
  type Sha256Digest,
} from "./canonical";
import type { BatchId } from "./apply-batch";
import type { FailureManifestV1, FindingId } from "./failure-manifest";

export const BASELINE_DISPOSITION_POLICY_VERSION_V1 = "baseline-disposition-policy-v1" as const;
export const BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1 = "baseline-fingerprint-normalizer-v1" as const;
export type BaselineFindingModeV1 = "deterministic" | "flaky";
export type BaselineProtectedRiskV1 = "none" | "security" | "authorization" | "credential_or_secret" | "git_safety" | "destructive" | "data_loss" | "migration" | "public_interface" | "cross_package_architecture" | "generated_output" | "registry_recovery" | "freshness" | "required_artifact";

export interface NormalizedFindingFingerprintInputV1 {
  readonly policyVersion: typeof BASELINE_DISPOSITION_POLICY_VERSION_V1;
  readonly normalizerVersion: typeof BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1;
  readonly suiteId: string;
  readonly checkId: string;
  readonly diagnosticName: string;
  readonly location: string;
  readonly oracleId: string;
  readonly category: string;
  readonly stableErrorSignatureDigest: Sha256Digest;
}
export interface ImmutableQualitySubjectV1 { readonly kind: "immutable_baseline"; readonly ref: string; readonly digest: Sha256Digest; readonly treeDigest: Sha256Digest; readonly capturedAt: string; readonly candidateFirstRelevantModificationAt: string }
export interface CandidateQualitySubjectV1 { readonly kind: "active_candidate"; readonly batchId: BatchId; readonly batchDigest: Sha256Digest; readonly treeDigest: Sha256Digest; readonly firstRelevantModificationAt: string }
export interface FindingObservationV1 { readonly runIndex: number; readonly outcome: "matched" | "not_matched"; readonly normalizedFingerprint?: Sha256Digest; readonly subjectDigest: Sha256Digest; readonly commandPlanDigest: Sha256Digest; readonly environmentDigest: Sha256Digest; readonly durationMs: number; readonly resourceUnits: number; readonly observedAt: string }
export interface QualityEnvironmentIdentityV1 { readonly cohort: { readonly os: string; readonly arch: string; readonly runtimeName: string; readonly runtimeMajor: number }; readonly toolVersionsDigest: Sha256Digest; readonly lockfileDigest: Sha256Digest; readonly commandPlanDigest: Sha256Digest; readonly locale: string; readonly timezone: string; readonly environmentValuesDigest: Sha256Digest }
export interface PermittedEnvironmentDifferenceV1 { readonly field: "toolVersionsDigest" | "locale" | "timezone" | "environmentValuesDigest"; readonly baselineValueDigest: Sha256Digest; readonly candidateValueDigest: Sha256Digest; readonly oracleUnaffectedEvidenceDigest: Sha256Digest }
export interface EnvironmentEquivalenceV1 { readonly baseline: QualityEnvironmentIdentityV1; readonly candidate: QualityEnvironmentIdentityV1; readonly permittedDifferences: readonly PermittedEnvironmentDifferenceV1[] }
export interface CausalIsolationEvidenceV1 { readonly candidateDiffDigest: Sha256Digest; readonly allowlistDigest: Sha256Digest; readonly affectedAreaDigest: Sha256Digest; readonly callGraphDigest: Sha256Digest; readonly dataFlowDigest: Sha256Digest; readonly configurationAnalysisDigest: Sha256Digest; readonly oracleAnalysisDigest: Sha256Digest; readonly overlappingLocations: readonly string[]; readonly overlappingDependencies: readonly string[]; readonly overlappingConfigurations: readonly string[]; readonly overlappingOracles: readonly string[]; readonly credibleCausalPath: boolean }
export interface NonRegressionEvidenceV1 { readonly baselineSeverity: "low" | "medium" | "high" | "critical"; readonly candidateSeverity: "low" | "medium" | "high" | "critical"; readonly baselineOccurrenceCount: number; readonly candidateOccurrenceCount: number; readonly baselineReachability: number; readonly candidateReachability: number; readonly baselineDurationMs: number; readonly candidateDurationMs: number; readonly baselineResourceUnits: number; readonly candidateResourceUnits: number; readonly baselineProtectedRisk: BaselineProtectedRiskV1; readonly candidateProtectedRisk: BaselineProtectedRiskV1; readonly skippedChecks: boolean; readonly weakenedChecks: boolean; readonly filteredChecks: boolean; readonly relabeledChecks: boolean }
export interface BaselineLedgerAuthorityRefV1 { readonly schema: "baseline-ledger-authority-ref-v1"; readonly ledgerPath: "openspec/baseline-health.yaml"; readonly entryDigest: Sha256Digest; readonly normalizedFingerprint: Sha256Digest; readonly policyVersion: typeof BASELINE_DISPOSITION_POLICY_VERSION_V1; readonly normalizerVersion: typeof BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1; readonly immutableSubjectDigest: Sha256Digest; readonly environmentCohort: string; readonly evidenceDigest: Sha256Digest; readonly approvalIdentity: string; readonly approvalTransactionId: string; readonly approvalCandidateDigest: Sha256Digest; readonly admittedAt: string; readonly expiresAt: string; readonly status: "active" | "expired" | "revoked"; readonly replacesBaselineRuns: boolean; readonly permittedEnvironmentDifferences: readonly PermittedEnvironmentDifferenceV1[]; readonly invalidationTriggers: readonly string[] }
export interface BaselineEvidenceFreshnessV1 { readonly producedAt: string; readonly expiresAt: string; readonly policyDigest: Sha256Digest; readonly normalizerDigest: Sha256Digest; readonly commandDigest: Sha256Digest; readonly testDigest: Sha256Digest; readonly oracleDigest: Sha256Digest; readonly dependencyDigest: Sha256Digest; readonly configurationDigest: Sha256Digest; readonly lockfileDigest: Sha256Digest; readonly protectedPolicyDigest: Sha256Digest; readonly candidateDigest: Sha256Digest; readonly environmentDigest: Sha256Digest; readonly producerIdentityDigest: Sha256Digest; readonly linkedArtifactDigest: Sha256Digest; readonly invalidationTriggers: readonly string[] }
export interface BaselineEvidenceEnvelopeV1 { readonly schema: "baseline-evidence-envelope-v1"; readonly digest: Sha256Digest; readonly policyVersion: typeof BASELINE_DISPOSITION_POLICY_VERSION_V1; readonly normalizerVersion: typeof BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1; readonly normalizedFingerprint: Sha256Digest; readonly findingMode: BaselineFindingModeV1; readonly baselineSubject: ImmutableQualitySubjectV1; readonly candidateSubject: CandidateQualitySubjectV1; readonly baselineObservations: readonly FindingObservationV1[]; readonly candidateObservations: readonly FindingObservationV1[]; readonly environmentEquivalence: EnvironmentEquivalenceV1; readonly causalIsolation: CausalIsolationEvidenceV1; readonly nonRegression: NonRegressionEvidenceV1; readonly ledgerAuthority: BaselineLedgerAuthorityRefV1; readonly freshness: BaselineEvidenceFreshnessV1 }
export interface QualityDispositionEnvelopeV1 { readonly schema: "quality-disposition-envelope-v1"; readonly digest: Sha256Digest; readonly batchId: BatchId; readonly batchDigest: Sha256Digest; readonly manifestDigest: Sha256Digest; readonly verificationDigest: Sha256Digest; readonly findingDispositionDigest: Sha256Digest; readonly baselineEvidenceDigests: readonly Sha256Digest[]; readonly mandatoryExecutionComplete: true; readonly status: "passed" | "passed_with_warnings" | "failed"; readonly warningFindingIds: readonly FindingId[]; readonly blockingFindingIds: readonly FindingId[]; readonly producerRole: "verify" | "review" | "orchestrator" | "archive"; readonly producerInstanceId: string; readonly producedAt: string }
export type BaselineEvidenceInputV1 = Omit<BaselineEvidenceEnvelopeV1, "digest">;

const ENVELOPE_KEYS = ["schema", "digest", "policyVersion", "normalizerVersion", "normalizedFingerprint", "findingMode", "baselineSubject", "candidateSubject", "baselineObservations", "candidateObservations", "environmentEquivalence", "causalIsolation", "nonRegression", "ledgerAuthority", "freshness"];
const INPUT_KEYS = ENVELOPE_KEYS.filter((key) => key !== "digest");
const digestValue = (value: unknown, field: string): Sha256Digest => { assertDigest(value, field); return value; };
const time = (value: unknown, field: string) => timestampValue(value, field);
const textSet = (value: unknown, field: string) => stringArray(value, field, true);

export function buildNormalizedFindingFingerprintV1(value: unknown): Sha256Digest {
  assertExactKeys(value, ["policyVersion", "normalizerVersion", "suiteId", "checkId", "diagnosticName", "location", "oracleId", "category", "stableErrorSignatureDigest"], "normalized fingerprint input");
  if (value.policyVersion !== BASELINE_DISPOSITION_POLICY_VERSION_V1 || value.normalizerVersion !== BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1) throw new Error("unsupported-contract-version");
  const payload: NormalizedFindingFingerprintInputV1 = {
    policyVersion: value.policyVersion,
    normalizerVersion: value.normalizerVersion,
    suiteId: codeValue(value.suiteId, "fingerprint.suiteId"),
    checkId: codeValue(value.checkId, "fingerprint.checkId"),
    diagnosticName: stringValue(value.diagnosticName, "fingerprint.diagnosticName", 512),
    location: repositoryPath(value.location, { repositoryRoot: "." }, "fingerprint.location"),
    oracleId: codeValue(value.oracleId, "fingerprint.oracleId"),
    category: codeValue(value.category, "fingerprint.category").toLowerCase(),
    stableErrorSignatureDigest: digestValue(value.stableErrorSignatureDigest, "fingerprint.stableErrorSignatureDigest"),
  };
  return sha256Digest(payload);
}

function subject(value: unknown, candidate: boolean): ImmutableQualitySubjectV1 | CandidateQualitySubjectV1 {
  if (candidate) {
    assertExactKeys(value, ["kind", "batchId", "batchDigest", "treeDigest", "firstRelevantModificationAt"], "candidateSubject");
    if (value.kind !== "active_candidate" || typeof value.batchId !== "string" || !/^batch:v1:[a-f0-9]{32}$/.test(value.batchId)) throw new Error("invalid-evidence: candidateSubject");
    return { kind: "active_candidate", batchId: value.batchId as BatchId, batchDigest: digestValue(value.batchDigest, "candidateSubject.batchDigest"), treeDigest: digestValue(value.treeDigest, "candidateSubject.treeDigest"), firstRelevantModificationAt: time(value.firstRelevantModificationAt, "candidateSubject.firstRelevantModificationAt") };
  }
  assertExactKeys(value, ["kind", "ref", "digest", "treeDigest", "capturedAt", "candidateFirstRelevantModificationAt"], "baselineSubject");
  if (value.kind !== "immutable_baseline") throw new Error("invalid-evidence: baselineSubject.kind");
  const result: ImmutableQualitySubjectV1 = { kind: "immutable_baseline", ref: stringValue(value.ref, "baselineSubject.ref", 256), digest: digestValue(value.digest, "baselineSubject.digest"), treeDigest: digestValue(value.treeDigest, "baselineSubject.treeDigest"), capturedAt: time(value.capturedAt, "baselineSubject.capturedAt"), candidateFirstRelevantModificationAt: time(value.candidateFirstRelevantModificationAt, "baselineSubject.candidateFirstRelevantModificationAt") };
  if (Date.parse(result.capturedAt) >= Date.parse(result.candidateFirstRelevantModificationAt)) throw new Error("invalid-evidence: baselineSubject.preexistence");
  return result;
}

function observations(value: unknown, field: string): FindingObservationV1[] {
  const result = denseArray(value, field, 5).map((entry, index) => {
    assertExactKeys(entry, ["runIndex", "outcome", "normalizedFingerprint", "subjectDigest", "commandPlanDigest", "environmentDigest", "durationMs", "resourceUnits", "observedAt"], `${field}[${index}]`);
    const outcome = enumValue(entry.outcome, ["matched", "not_matched"], `${field}[${index}].outcome`);
    if (outcome === "matched") assertDigest(entry.normalizedFingerprint, `${field}[${index}].normalizedFingerprint`);
    else if (entry.normalizedFingerprint !== undefined) throw new Error(`invalid-evidence: ${field}[${index}].normalizedFingerprint`);
    return { runIndex: integerValue(entry.runIndex, `${field}[${index}].runIndex`, 1, 5), outcome, ...(outcome === "matched" ? { normalizedFingerprint: entry.normalizedFingerprint as Sha256Digest } : {}), subjectDigest: digestValue(entry.subjectDigest, `${field}[${index}].subjectDigest`), commandPlanDigest: digestValue(entry.commandPlanDigest, `${field}[${index}].commandPlanDigest`), environmentDigest: digestValue(entry.environmentDigest, `${field}[${index}].environmentDigest`), durationMs: integerValue(entry.durationMs, `${field}[${index}].durationMs`), resourceUnits: integerValue(entry.resourceUnits, `${field}[${index}].resourceUnits`), observedAt: time(entry.observedAt, `${field}[${index}].observedAt`) };
  });
  if (new Set(result.map((entry) => entry.runIndex)).size !== result.length || result.some((entry, index) => entry.runIndex !== index + 1)) throw new Error(`invalid-evidence: ${field}.runPlan`);
  return result;
}

function environmentIdentity(value: unknown, field: string): QualityEnvironmentIdentityV1 {
  assertExactKeys(value, ["cohort", "toolVersionsDigest", "lockfileDigest", "commandPlanDigest", "locale", "timezone", "environmentValuesDigest"], field);
  assertExactKeys(value.cohort, ["os", "arch", "runtimeName", "runtimeMajor"], `${field}.cohort`);
  return { cohort: { os: codeValue(value.cohort.os, `${field}.cohort.os`), arch: codeValue(value.cohort.arch, `${field}.cohort.arch`), runtimeName: codeValue(value.cohort.runtimeName, `${field}.cohort.runtimeName`), runtimeMajor: integerValue(value.cohort.runtimeMajor, `${field}.cohort.runtimeMajor`, 1, 999) }, toolVersionsDigest: digestValue(value.toolVersionsDigest, `${field}.toolVersionsDigest`), lockfileDigest: digestValue(value.lockfileDigest, `${field}.lockfileDigest`), commandPlanDigest: digestValue(value.commandPlanDigest, `${field}.commandPlanDigest`), locale: codeValue(value.locale, `${field}.locale`), timezone: codeValue(value.timezone, `${field}.timezone`), environmentValuesDigest: digestValue(value.environmentValuesDigest, `${field}.environmentValuesDigest`) };
}
function differences(value: unknown, field: string): PermittedEnvironmentDifferenceV1[] {
  return denseArray(value, field, 16).map((entry, index) => { assertExactKeys(entry, ["field", "baselineValueDigest", "candidateValueDigest", "oracleUnaffectedEvidenceDigest"], `${field}[${index}]`); return { field: enumValue(entry.field, ["toolVersionsDigest", "locale", "timezone", "environmentValuesDigest"], `${field}[${index}].field`), baselineValueDigest: digestValue(entry.baselineValueDigest, `${field}[${index}].baselineValueDigest`), candidateValueDigest: digestValue(entry.candidateValueDigest, `${field}[${index}].candidateValueDigest`), oracleUnaffectedEvidenceDigest: digestValue(entry.oracleUnaffectedEvidenceDigest, `${field}[${index}].oracleUnaffectedEvidenceDigest`) }; }).sort((a, b) => a.field.localeCompare(b.field));
}

function parsePayload(value: unknown, includesDigest: boolean): BaselineEvidenceInputV1 {
  assertExactKeys(value, includesDigest ? ENVELOPE_KEYS : INPUT_KEYS, "baseline evidence envelope");
  if (value.schema !== "baseline-evidence-envelope-v1" || value.policyVersion !== BASELINE_DISPOSITION_POLICY_VERSION_V1 || value.normalizerVersion !== BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1) throw new Error("unsupported-contract-version");
  assertDigest(value.normalizedFingerprint, "normalizedFingerprint");
  const baselineSubject = subject(value.baselineSubject, false) as ImmutableQualitySubjectV1;
  const candidateSubject = subject(value.candidateSubject, true) as CandidateQualitySubjectV1;
  if (baselineSubject.digest === candidateSubject.treeDigest || baselineSubject.treeDigest === candidateSubject.treeDigest) throw new Error("invalid-evidence: distinct-subjects");
  const baselineObservations = observations(value.baselineObservations, "baselineObservations"), candidateObservations = observations(value.candidateObservations, "candidateObservations");
  assertExactKeys(value.environmentEquivalence, ["baseline", "candidate", "permittedDifferences"], "environmentEquivalence");
  const baselineEnvironment = environmentIdentity(value.environmentEquivalence.baseline, "environmentEquivalence.baseline"), candidateEnvironment = environmentIdentity(value.environmentEquivalence.candidate, "environmentEquivalence.candidate"), permittedDifferences = differences(value.environmentEquivalence.permittedDifferences, "environmentEquivalence.permittedDifferences");
  if (new Set(permittedDifferences.map((item) => item.field)).size !== permittedDifferences.length) throw new Error("invalid-evidence: duplicate-environment-difference");
  if (JSON.stringify(baselineEnvironment.cohort) !== JSON.stringify(candidateEnvironment.cohort)) throw new Error("invalid-evidence: environment-cohort-mismatch");
  const differing = (["toolVersionsDigest", "lockfileDigest", "commandPlanDigest", "locale", "timezone", "environmentValuesDigest"] as const).filter((field) => baselineEnvironment[field] !== candidateEnvironment[field]);
  if (differing.some((field) => field === "lockfileDigest" || field === "commandPlanDigest" || !permittedDifferences.some((item) => item.field === field)) || permittedDifferences.some((item) => !differing.includes(item.field))) throw new Error("invalid-evidence: environment-equivalence");
  for (const difference of permittedDifferences) {
    const baselineValue = baselineEnvironment[difference.field], candidateValue = candidateEnvironment[difference.field];
    const baselineDigest = typeof baselineValue === "string" && baselineValue.startsWith("sha256:") ? baselineValue : sha256Digest(baselineValue);
    const candidateDigest = typeof candidateValue === "string" && candidateValue.startsWith("sha256:") ? candidateValue : sha256Digest(candidateValue);
    if (difference.baselineValueDigest !== baselineDigest || difference.candidateValueDigest !== candidateDigest) throw new Error("invalid-evidence: environment-difference-binding");
  }
  assertExactKeys(value.causalIsolation, ["candidateDiffDigest", "allowlistDigest", "affectedAreaDigest", "callGraphDigest", "dataFlowDigest", "configurationAnalysisDigest", "oracleAnalysisDigest", "overlappingLocations", "overlappingDependencies", "overlappingConfigurations", "overlappingOracles", "credibleCausalPath"], "causalIsolation");
  const causalIsolation: CausalIsolationEvidenceV1 = { candidateDiffDigest: digestValue(value.causalIsolation.candidateDiffDigest, "causalIsolation.candidateDiffDigest"), allowlistDigest: digestValue(value.causalIsolation.allowlistDigest, "causalIsolation.allowlistDigest"), affectedAreaDigest: digestValue(value.causalIsolation.affectedAreaDigest, "causalIsolation.affectedAreaDigest"), callGraphDigest: digestValue(value.causalIsolation.callGraphDigest, "causalIsolation.callGraphDigest"), dataFlowDigest: digestValue(value.causalIsolation.dataFlowDigest, "causalIsolation.dataFlowDigest"), configurationAnalysisDigest: digestValue(value.causalIsolation.configurationAnalysisDigest, "causalIsolation.configurationAnalysisDigest"), oracleAnalysisDigest: digestValue(value.causalIsolation.oracleAnalysisDigest, "causalIsolation.oracleAnalysisDigest"), overlappingLocations: textSet(value.causalIsolation.overlappingLocations, "causalIsolation.overlappingLocations"), overlappingDependencies: textSet(value.causalIsolation.overlappingDependencies, "causalIsolation.overlappingDependencies"), overlappingConfigurations: textSet(value.causalIsolation.overlappingConfigurations, "causalIsolation.overlappingConfigurations"), overlappingOracles: textSet(value.causalIsolation.overlappingOracles, "causalIsolation.overlappingOracles"), credibleCausalPath: booleanValue(value.causalIsolation.credibleCausalPath, "causalIsolation.credibleCausalPath") };
  assertExactKeys(value.nonRegression, ["baselineSeverity", "candidateSeverity", "baselineOccurrenceCount", "candidateOccurrenceCount", "baselineReachability", "candidateReachability", "baselineDurationMs", "candidateDurationMs", "baselineResourceUnits", "candidateResourceUnits", "baselineProtectedRisk", "candidateProtectedRisk", "skippedChecks", "weakenedChecks", "filteredChecks", "relabeledChecks"], "nonRegression");
  const severity = ["low", "medium", "high", "critical"] as const, risks = ["none", "security", "authorization", "credential_or_secret", "git_safety", "destructive", "data_loss", "migration", "public_interface", "cross_package_architecture", "generated_output", "registry_recovery", "freshness", "required_artifact"] as const;
  const nonRegression: NonRegressionEvidenceV1 = { baselineSeverity: enumValue(value.nonRegression.baselineSeverity, severity, "nonRegression.baselineSeverity"), candidateSeverity: enumValue(value.nonRegression.candidateSeverity, severity, "nonRegression.candidateSeverity"), baselineOccurrenceCount: integerValue(value.nonRegression.baselineOccurrenceCount, "nonRegression.baselineOccurrenceCount", 0, 5), candidateOccurrenceCount: integerValue(value.nonRegression.candidateOccurrenceCount, "nonRegression.candidateOccurrenceCount", 0, 5), baselineReachability: integerValue(value.nonRegression.baselineReachability, "nonRegression.baselineReachability"), candidateReachability: integerValue(value.nonRegression.candidateReachability, "nonRegression.candidateReachability"), baselineDurationMs: integerValue(value.nonRegression.baselineDurationMs, "nonRegression.baselineDurationMs"), candidateDurationMs: integerValue(value.nonRegression.candidateDurationMs, "nonRegression.candidateDurationMs"), baselineResourceUnits: integerValue(value.nonRegression.baselineResourceUnits, "nonRegression.baselineResourceUnits"), candidateResourceUnits: integerValue(value.nonRegression.candidateResourceUnits, "nonRegression.candidateResourceUnits"), baselineProtectedRisk: enumValue(value.nonRegression.baselineProtectedRisk, risks, "nonRegression.baselineProtectedRisk"), candidateProtectedRisk: enumValue(value.nonRegression.candidateProtectedRisk, risks, "nonRegression.candidateProtectedRisk"), skippedChecks: booleanValue(value.nonRegression.skippedChecks, "nonRegression.skippedChecks"), weakenedChecks: booleanValue(value.nonRegression.weakenedChecks, "nonRegression.weakenedChecks"), filteredChecks: booleanValue(value.nonRegression.filteredChecks, "nonRegression.filteredChecks"), relabeledChecks: booleanValue(value.nonRegression.relabeledChecks, "nonRegression.relabeledChecks") };
  assertExactKeys(value.ledgerAuthority, ["schema", "ledgerPath", "entryDigest", "normalizedFingerprint", "policyVersion", "normalizerVersion", "immutableSubjectDigest", "environmentCohort", "evidenceDigest", "approvalIdentity", "approvalTransactionId", "approvalCandidateDigest", "admittedAt", "expiresAt", "status", "replacesBaselineRuns", "permittedEnvironmentDifferences", "invalidationTriggers"], "ledgerAuthority");
  if (value.ledgerAuthority.schema !== "baseline-ledger-authority-ref-v1" || value.ledgerAuthority.ledgerPath !== "openspec/baseline-health.yaml" || value.ledgerAuthority.policyVersion !== BASELINE_DISPOSITION_POLICY_VERSION_V1 || value.ledgerAuthority.normalizerVersion !== BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1) throw new Error("invalid-evidence: ledgerAuthority");
  const ledgerAuthority: BaselineLedgerAuthorityRefV1 = { schema: "baseline-ledger-authority-ref-v1", ledgerPath: "openspec/baseline-health.yaml", entryDigest: digestValue(value.ledgerAuthority.entryDigest, "ledgerAuthority.entryDigest"), normalizedFingerprint: digestValue(value.ledgerAuthority.normalizedFingerprint, "ledgerAuthority.normalizedFingerprint"), policyVersion: value.ledgerAuthority.policyVersion, normalizerVersion: value.ledgerAuthority.normalizerVersion, immutableSubjectDigest: digestValue(value.ledgerAuthority.immutableSubjectDigest, "ledgerAuthority.immutableSubjectDigest"), environmentCohort: stringValue(value.ledgerAuthority.environmentCohort, "ledgerAuthority.environmentCohort", 128), evidenceDigest: digestValue(value.ledgerAuthority.evidenceDigest, "ledgerAuthority.evidenceDigest"), approvalIdentity: codeValue(value.ledgerAuthority.approvalIdentity, "ledgerAuthority.approvalIdentity"), approvalTransactionId: codeValue(value.ledgerAuthority.approvalTransactionId, "ledgerAuthority.approvalTransactionId"), approvalCandidateDigest: digestValue(value.ledgerAuthority.approvalCandidateDigest, "ledgerAuthority.approvalCandidateDigest"), admittedAt: time(value.ledgerAuthority.admittedAt, "ledgerAuthority.admittedAt"), expiresAt: time(value.ledgerAuthority.expiresAt, "ledgerAuthority.expiresAt"), status: enumValue(value.ledgerAuthority.status, ["active", "expired", "revoked"], "ledgerAuthority.status"), replacesBaselineRuns: booleanValue(value.ledgerAuthority.replacesBaselineRuns, "ledgerAuthority.replacesBaselineRuns"), permittedEnvironmentDifferences: differences(value.ledgerAuthority.permittedEnvironmentDifferences, "ledgerAuthority.permittedEnvironmentDifferences"), invalidationTriggers: textSet(value.ledgerAuthority.invalidationTriggers, "ledgerAuthority.invalidationTriggers") };
  assertExactKeys(value.freshness, ["producedAt", "expiresAt", "policyDigest", "normalizerDigest", "commandDigest", "testDigest", "oracleDigest", "dependencyDigest", "configurationDigest", "lockfileDigest", "protectedPolicyDigest", "candidateDigest", "environmentDigest", "producerIdentityDigest", "linkedArtifactDigest", "invalidationTriggers"], "freshness");
  const freshness: BaselineEvidenceFreshnessV1 = { producedAt: time(value.freshness.producedAt, "freshness.producedAt"), expiresAt: time(value.freshness.expiresAt, "freshness.expiresAt"), policyDigest: digestValue(value.freshness.policyDigest, "freshness.policyDigest"), normalizerDigest: digestValue(value.freshness.normalizerDigest, "freshness.normalizerDigest"), commandDigest: digestValue(value.freshness.commandDigest, "freshness.commandDigest"), testDigest: digestValue(value.freshness.testDigest, "freshness.testDigest"), oracleDigest: digestValue(value.freshness.oracleDigest, "freshness.oracleDigest"), dependencyDigest: digestValue(value.freshness.dependencyDigest, "freshness.dependencyDigest"), configurationDigest: digestValue(value.freshness.configurationDigest, "freshness.configurationDigest"), lockfileDigest: digestValue(value.freshness.lockfileDigest, "freshness.lockfileDigest"), protectedPolicyDigest: digestValue(value.freshness.protectedPolicyDigest, "freshness.protectedPolicyDigest"), candidateDigest: digestValue(value.freshness.candidateDigest, "freshness.candidateDigest"), environmentDigest: digestValue(value.freshness.environmentDigest, "freshness.environmentDigest"), producerIdentityDigest: digestValue(value.freshness.producerIdentityDigest, "freshness.producerIdentityDigest"), linkedArtifactDigest: digestValue(value.freshness.linkedArtifactDigest, "freshness.linkedArtifactDigest"), invalidationTriggers: textSet(value.freshness.invalidationTriggers, "freshness.invalidationTriggers") };
  if (Date.parse(freshness.producedAt) > Date.parse(freshness.expiresAt) || Date.parse(ledgerAuthority.admittedAt) > Date.parse(ledgerAuthority.expiresAt) || Date.parse(ledgerAuthority.admittedAt) >= Date.parse(candidateSubject.firstRelevantModificationAt)) throw new Error("invalid-evidence: evidence-lifetime");
  if (freshness.invalidationTriggers.length || ledgerAuthority.invalidationTriggers.length) throw new Error("invalid-evidence: invalidation-triggered");
  if (ledgerAuthority.normalizedFingerprint !== value.normalizedFingerprint || ledgerAuthority.immutableSubjectDigest !== baselineSubject.digest || JSON.stringify(ledgerAuthority.permittedEnvironmentDifferences) !== JSON.stringify(permittedDifferences)) throw new Error("invalid-evidence: ledger-binding");
  return cloneCanonical({ schema: "baseline-evidence-envelope-v1", policyVersion: BASELINE_DISPOSITION_POLICY_VERSION_V1, normalizerVersion: BASELINE_FINGERPRINT_NORMALIZER_VERSION_V1, normalizedFingerprint: value.normalizedFingerprint, findingMode: enumValue(value.findingMode, ["deterministic", "flaky"], "findingMode"), baselineSubject, candidateSubject, baselineObservations, candidateObservations, environmentEquivalence: { baseline: baselineEnvironment, candidate: candidateEnvironment, permittedDifferences }, causalIsolation, nonRegression, ledgerAuthority, freshness });
}

export function buildBaselineEvidenceEnvelopeV1(input: BaselineEvidenceInputV1): BaselineEvidenceEnvelopeV1 {
  const payload = parsePayload(input, false), digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest }) as BaselineEvidenceEnvelopeV1;
}
export function parseBaselineEvidenceEnvelopeV1(value: unknown): BaselineEvidenceEnvelopeV1 {
  assertExactKeys(value, ENVELOPE_KEYS, "baseline evidence envelope");
  assertDigest(value.digest, "baselineEvidence.digest");
  const payload = parsePayload(value, true), expected = sha256Digest(payload);
  if (value.digest !== expected) throw new Error("invalid-evidence: baseline evidence digest");
  return deepFreeze({ ...payload, digest: expected }) as BaselineEvidenceEnvelopeV1;
}

export function parseQualityDispositionEnvelopeV1(value: unknown, manifest?: FailureManifestV1): QualityDispositionEnvelopeV1 {
  const keys = ["schema", "digest", "batchId", "batchDigest", "manifestDigest", "verificationDigest", "findingDispositionDigest", "baselineEvidenceDigests", "mandatoryExecutionComplete", "status", "warningFindingIds", "blockingFindingIds", "producerRole", "producerInstanceId", "producedAt"];
  assertExactKeys(value, keys, "quality disposition envelope");
  if (value.schema !== "quality-disposition-envelope-v1" || value.mandatoryExecutionComplete !== true) throw new Error("unsupported-contract-version");
  assertDigest(value.digest, "qualityDisposition.digest"); assertDigest(value.batchDigest, "qualityDisposition.batchDigest"); assertDigest(value.manifestDigest, "qualityDisposition.manifestDigest"); assertDigest(value.verificationDigest, "qualityDisposition.verificationDigest"); assertDigest(value.findingDispositionDigest, "qualityDisposition.findingDispositionDigest");
  if (typeof value.batchId !== "string" || !/^batch:v1:[a-f0-9]{32}$/.test(value.batchId)) throw new Error("invalid-evidence: qualityDisposition.batchId");
  const baselineEvidenceDigests = denseArray(value.baselineEvidenceDigests, "qualityDisposition.baselineEvidenceDigests").map((item, index) => digestValue(item, `qualityDisposition.baselineEvidenceDigests[${index}]`));
  if (new Set(baselineEvidenceDigests).size !== baselineEvidenceDigests.length || JSON.stringify(baselineEvidenceDigests) !== JSON.stringify([...baselineEvidenceDigests].sort())) throw new Error("invalid-evidence: qualityDisposition.baselineEvidenceDigests");
  const findingIds = (items: unknown, field: string) => denseArray(items, field).map((item, index) => { if (typeof item !== "string" || !/^finding:v1:[a-f0-9]{32}$/.test(item)) throw new Error(`invalid-evidence: ${field}[${index}]`); return item as FindingId; });
  const warningFindingIds = findingIds(value.warningFindingIds, "qualityDisposition.warningFindingIds"), blockingFindingIds = findingIds(value.blockingFindingIds, "qualityDisposition.blockingFindingIds");
  if (new Set([...warningFindingIds, ...blockingFindingIds]).size !== warningFindingIds.length + blockingFindingIds.length || JSON.stringify(warningFindingIds) !== JSON.stringify([...warningFindingIds].sort()) || JSON.stringify(blockingFindingIds) !== JSON.stringify([...blockingFindingIds].sort())) throw new Error("invalid-evidence: qualityDisposition.findingIds");
  const status = enumValue(value.status, ["passed", "passed_with_warnings", "failed"], "qualityDisposition.status");
  if ((status === "passed" && (warningFindingIds.length || blockingFindingIds.length)) || (status === "passed_with_warnings" && (!warningFindingIds.length || blockingFindingIds.length)) || (status === "failed" && !blockingFindingIds.length)) throw new Error("invalid-evidence: qualityDisposition.status");
  const payload = cloneCanonical({ schema: "quality-disposition-envelope-v1" as const, batchId: value.batchId as BatchId, batchDigest: value.batchDigest as Sha256Digest, manifestDigest: value.manifestDigest as Sha256Digest, verificationDigest: value.verificationDigest as Sha256Digest, findingDispositionDigest: value.findingDispositionDigest as Sha256Digest, baselineEvidenceDigests, mandatoryExecutionComplete: true as const, status, warningFindingIds, blockingFindingIds, producerRole: enumValue(value.producerRole, ["verify", "review", "orchestrator", "archive"], "qualityDisposition.producerRole"), producerInstanceId: codeValue(value.producerInstanceId, "qualityDisposition.producerInstanceId"), producedAt: timestampValue(value.producedAt, "qualityDisposition.producedAt") });
  if (value.digest !== sha256Digest(payload)) throw new Error("invalid-evidence: quality disposition digest");
  if (manifest && (manifest.digest !== payload.manifestDigest || manifest.batchId !== payload.batchId || manifest.batchDigest !== payload.batchDigest || [...warningFindingIds, ...blockingFindingIds].some((id) => !manifest.findings.some((finding) => finding.findingId === id)) || warningFindingIds.length + blockingFindingIds.length !== manifest.findings.length)) throw new Error("invalid-evidence: qualityDisposition.manifest-binding");
  return deepFreeze({ ...payload, digest: value.digest }) as QualityDispositionEnvelopeV1;
}
