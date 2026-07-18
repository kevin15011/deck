import type { ApplyBatchContractV1, BatchId } from "./apply-batch";
import { assertBatchReferenceV1 } from "./apply-batch";
import {
  assertDigest,
  assertExactKeys,
  assertId,
  cloneCanonical,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  sha256Digest,
  stringArray,
  stringValue,
  type Sha256Digest,
} from "./canonical";
import type { FailureFindingV1, FailureManifestV1, FindingId } from "./failure-manifest";

export type FindingDispositionV1 = "blocking" | "recommendation" | "deferred" | "pre-existing";

export type DispositionClassificationReasonCodeV1 =
  | "BASELINE_PRE_EXISTING"
  | "POLICY_DEFERRED"
  | "ADVISORY_RECOMMENDATION"
  | "AMBIGUOUS_OR_ACTIVE_BLOCKING";

export interface FindingDispositionEntryV1 {
  findingId: FindingId;
  disposition: FindingDispositionV1;
  requirementIds: readonly string[];
  taskIds: readonly string[];
  checkIds: readonly string[];
  classificationReasonCode: DispositionClassificationReasonCodeV1;
  baselinePolicyRef?: string;
  deferPolicyRef?: string;
}

export interface FindingDispositionEnvelopeV1 {
  schema: "finding-disposition-envelope-v1";
  envelopeId: `disposition:v1:${string}`;
  digest: Sha256Digest;
  classificationPolicyVersion: string;
  changeId: string;
  batchId: BatchId;
  batchDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  entries: readonly FindingDispositionEntryV1[];
  semanticDigest: Sha256Digest;
}

export interface DispositionClassificationInputV1 {
  classificationPolicyVersion: string;
  /** Exact accepted baseline/prior-state fingerprints that prove pre-existing. */
  baselineFingerprints: readonly Sha256Digest[];
  /** Map of findingId → non-expired policy-authorized defer reference. */
  deferPolicyRefs: Readonly<Record<string, string>>;
  /** Check IDs classified as advisory (recommendation candidates). */
  advisoryCheckIds: readonly string[];
  /** Mandatory requirement IDs for the current batch. */
  mandatoryRequirementIds: readonly string[];
  /** Mandatory task IDs for the current batch. */
  mandatoryTaskIds: readonly string[];
  /** Mandatory check IDs for the current batch. */
  mandatoryCheckIds: readonly string[];
}

export interface FindingDispositionEnvelopeInputV1 {
  manifest: FailureManifestV1;
  batch: ApplyBatchContractV1;
  classification: DispositionClassificationInputV1;
  /** Mandatory for authoritative disposition; omitted only for legacy structural projection. */
  protectedRiskAuthority?: ProtectedRiskAuthorityContextV1;
}

/** Closed protected-risk class derived from finding fields + mandatory policy authority. */
export type ProtectedRiskClassV1 =
  | "none"
  | "security"
  | "data_loss"
  | "security_and_data_loss"
  | "ambiguous";

/**
 * Pure authority context for protected-risk derivation (additive; not a V1 envelope field).
 * Bound to batch/manifest digests and current policy snapshot digests.
 */
export interface ProtectedRiskAuthorityContextV1 {
  batchDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  classificationPolicyVersion: string;
  routingPolicyVersion: string;
  /** Exact current Spec/Design/Tasks digests; must match batch.artifactDigests when keys present. */
  artifactDigests: Readonly<Record<string, Sha256Digest>>;
  /** Sorted mandatory security requirement/task/check/oracle IDs from approved policy. */
  mandatorySecurityRequirementIds: readonly string[];
  mandatorySecurityTaskIds: readonly string[];
  mandatorySecurityCheckIds: readonly string[];
  mandatorySecurityOracleIds: readonly string[];
  /** Sorted mandatory data-loss requirement/task/check/oracle IDs from approved policy. */
  mandatoryDataLossRequirementIds: readonly string[];
  mandatoryDataLossTaskIds: readonly string[];
  mandatoryDataLossCheckIds: readonly string[];
  mandatoryDataLossOracleIds: readonly string[];
  policySnapshotDigest: Sha256Digest;
}

export type ProtectedRiskPolicyAuthorityV1 = Pick<
  ProtectedRiskAuthorityContextV1,
  | "classificationPolicyVersion"
  | "routingPolicyVersion"
  | "mandatorySecurityRequirementIds"
  | "mandatorySecurityTaskIds"
  | "mandatorySecurityCheckIds"
  | "mandatorySecurityOracleIds"
  | "mandatoryDataLossRequirementIds"
  | "mandatoryDataLossTaskIds"
  | "mandatoryDataLossCheckIds"
  | "mandatoryDataLossOracleIds"
>;

export const PROTECTED_RISK_POLICY_ARTIFACT_KEY = "protected-risk-policy";

const DISPOSITIONS = ["blocking", "recommendation", "deferred", "pre-existing"] as const;
const REASON_CODES = [
  "BASELINE_PRE_EXISTING",
  "POLICY_DEFERRED",
  "ADVISORY_RECOMMENDATION",
  "AMBIGUOUS_OR_ACTIVE_BLOCKING",
] as const;

const ENTRY_KEYS = [
  "findingId",
  "disposition",
  "requirementIds",
  "taskIds",
  "checkIds",
  "classificationReasonCode",
  "baselinePolicyRef",
  "deferPolicyRef",
] as const;

const ENVELOPE_KEYS = [
  "schema",
  "envelopeId",
  "digest",
  "classificationPolicyVersion",
  "changeId",
  "batchId",
  "batchDigest",
  "manifestDigest",
  "entries",
  "semanticDigest",
] as const;

function normalizeClassification(input: DispositionClassificationInputV1): DispositionClassificationInputV1 {
  assertExactKeys(
    input,
    [
      "classificationPolicyVersion",
      "baselineFingerprints",
      "deferPolicyRefs",
      "advisoryCheckIds",
      "mandatoryRequirementIds",
      "mandatoryTaskIds",
      "mandatoryCheckIds",
    ],
    "disposition classification",
  );
  const baselineFingerprints = stringArray(input.baselineFingerprints, "classification.baselineFingerprints", true) as Sha256Digest[];
  baselineFingerprints.forEach((d, i) => assertDigest(d, `classification.baselineFingerprints[${i}]`));
  const deferPolicyRefs: Record<string, string> = {};
  assertExactKeys(input.deferPolicyRefs as unknown as Record<string, unknown>, Object.keys(input.deferPolicyRefs), "classification.deferPolicyRefs");
  for (const [findingId, ref] of Object.entries(input.deferPolicyRefs)) {
    assertId(findingId, "finding:v1:", `classification.deferPolicyRefs.${findingId}`);
    deferPolicyRefs[findingId] = codeValue(ref, `classification.deferPolicyRefs.${findingId}`);
  }
  return cloneCanonical({
    classificationPolicyVersion: codeValue(input.classificationPolicyVersion, "classification.classificationPolicyVersion"),
    baselineFingerprints,
    deferPolicyRefs,
    advisoryCheckIds: stringArray(input.advisoryCheckIds, "classification.advisoryCheckIds", true),
    mandatoryRequirementIds: stringArray(input.mandatoryRequirementIds, "classification.mandatoryRequirementIds", true),
    mandatoryTaskIds: stringArray(input.mandatoryTaskIds, "classification.mandatoryTaskIds", true),
    mandatoryCheckIds: stringArray(input.mandatoryCheckIds, "classification.mandatoryCheckIds", true),
  });
}

function checkIdsFromFinding(finding: FailureFindingV1): string[] {
  return stringArray(
    finding.evidence.map((e) => e.checkId),
    "finding.checkIds",
    true,
  );
}

function isMandatory(finding: FailureFindingV1, classification: DispositionClassificationInputV1, checkIds: readonly string[]): boolean {
  if (finding.requirementIds.some((id) => classification.mandatoryRequirementIds.includes(id))) return true;
  if (finding.taskIds.some((id) => classification.mandatoryTaskIds.includes(id))) return true;
  if (checkIds.some((id) => classification.mandatoryCheckIds.includes(id))) return true;
  return false;
}

const PROTECTED_RISK_AUTHORITY_KEYS = [
  "batchDigest",
  "manifestDigest",
  "classificationPolicyVersion",
  "routingPolicyVersion",
  "artifactDigests",
  "mandatorySecurityRequirementIds",
  "mandatorySecurityTaskIds",
  "mandatorySecurityCheckIds",
  "mandatorySecurityOracleIds",
  "mandatoryDataLossRequirementIds",
  "mandatoryDataLossTaskIds",
  "mandatoryDataLossCheckIds",
  "mandatoryDataLossOracleIds",
  "policySnapshotDigest",
] as const;

function uniqueSortedIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function anchorsMatch(
  finding: FailureFindingV1,
  checkIds: readonly string[],
  reqIds: readonly string[],
  taskIds: readonly string[],
  checkPolicy: readonly string[],
  oracleIds: readonly string[],
): boolean {
  if (finding.requirementIds.some((id) => reqIds.includes(id))) return true;
  if (finding.taskIds.some((id) => taskIds.includes(id))) return true;
  if (checkIds.some((id) => checkPolicy.includes(id))) return true;
  if (oracleIds.includes(finding.oracleId)) return true;
  return false;
}

/** Spec/Design/Tasks keys that must exact-match batch.artifactDigests when present. */
const MANDATORY_POLICY_ARTIFACT_KEYS = [
  "spec",
  "design",
  "tasks",
  "spec.md",
  "design.md",
  "tasks.md",
] as const;

/**
 * Content-addressed policy snapshot digest over the authority policy slice
 * (excluding the snapshot digest field itself).
 */
export function computeProtectedRiskPolicySnapshotDigestV1(
  authority: Omit<ProtectedRiskAuthorityContextV1, "policySnapshotDigest">,
): Sha256Digest {
  return sha256Digest(
    cloneCanonical({
      batchDigest: authority.batchDigest,
      manifestDigest: authority.manifestDigest,
      classificationPolicyVersion: authority.classificationPolicyVersion,
      routingPolicyVersion: authority.routingPolicyVersion,
      artifactDigests: authority.artifactDigests,
      mandatorySecurityRequirementIds: authority.mandatorySecurityRequirementIds,
      mandatorySecurityTaskIds: authority.mandatorySecurityTaskIds,
      mandatorySecurityCheckIds: authority.mandatorySecurityCheckIds,
      mandatorySecurityOracleIds: authority.mandatorySecurityOracleIds,
      mandatoryDataLossRequirementIds: authority.mandatoryDataLossRequirementIds,
      mandatoryDataLossTaskIds: authority.mandatoryDataLossTaskIds,
      mandatoryDataLossCheckIds: authority.mandatoryDataLossCheckIds,
      mandatoryDataLossOracleIds: authority.mandatoryDataLossOracleIds,
    }),
  );
}

/**
 * Digest of the policy slice that must be committed by the immutable Apply batch.
 * Unlike the contextual snapshot, this excludes batch/manifest identities so the
 * batch can bind it without a circular digest dependency.
 */
export function computeProtectedRiskPolicyAuthorityDigestV1(
  policy: ProtectedRiskPolicyAuthorityV1,
): Sha256Digest {
  return sha256Digest(
    cloneCanonical({
      classificationPolicyVersion: codeValue(
        policy.classificationPolicyVersion,
        "policy.classificationPolicyVersion",
      ),
      routingPolicyVersion: codeValue(policy.routingPolicyVersion, "policy.routingPolicyVersion"),
      mandatorySecurityRequirementIds: uniqueSortedIds(policy.mandatorySecurityRequirementIds),
      mandatorySecurityTaskIds: uniqueSortedIds(policy.mandatorySecurityTaskIds),
      mandatorySecurityCheckIds: uniqueSortedIds(policy.mandatorySecurityCheckIds),
      mandatorySecurityOracleIds: uniqueSortedIds(policy.mandatorySecurityOracleIds),
      mandatoryDataLossRequirementIds: uniqueSortedIds(policy.mandatoryDataLossRequirementIds),
      mandatoryDataLossTaskIds: uniqueSortedIds(policy.mandatoryDataLossTaskIds),
      mandatoryDataLossCheckIds: uniqueSortedIds(policy.mandatoryDataLossCheckIds),
      mandatoryDataLossOracleIds: uniqueSortedIds(policy.mandatoryDataLossOracleIds),
    }),
  );
}

export function normalizeProtectedRiskAuthorityV1(
  authority: ProtectedRiskAuthorityContextV1,
): ProtectedRiskAuthorityContextV1 {
  assertExactKeys(authority, PROTECTED_RISK_AUTHORITY_KEYS, "protected-risk authority");
  assertDigest(authority.batchDigest, "authority.batchDigest");
  assertDigest(authority.manifestDigest, "authority.manifestDigest");
  assertDigest(authority.policySnapshotDigest, "authority.policySnapshotDigest");
  const artifactDigests: Record<string, Sha256Digest> = {};
  if (
    typeof authority.artifactDigests !== "object" ||
    authority.artifactDigests === null ||
    Array.isArray(authority.artifactDigests)
  ) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  for (const [key, digest] of Object.entries(authority.artifactDigests)) {
    assertDigest(digest, `authority.artifactDigests.${key}`);
    artifactDigests[key] = digest;
  }
  const normalized = cloneCanonical({
    batchDigest: authority.batchDigest,
    manifestDigest: authority.manifestDigest,
    classificationPolicyVersion: codeValue(
      authority.classificationPolicyVersion,
      "authority.classificationPolicyVersion",
    ),
    routingPolicyVersion: codeValue(authority.routingPolicyVersion, "authority.routingPolicyVersion"),
    artifactDigests,
    mandatorySecurityRequirementIds: uniqueSortedIds(
      stringArray(authority.mandatorySecurityRequirementIds, "authority.mandatorySecurityRequirementIds", true),
    ),
    mandatorySecurityTaskIds: uniqueSortedIds(
      stringArray(authority.mandatorySecurityTaskIds, "authority.mandatorySecurityTaskIds", true),
    ),
    mandatorySecurityCheckIds: uniqueSortedIds(
      stringArray(authority.mandatorySecurityCheckIds, "authority.mandatorySecurityCheckIds", true),
    ),
    mandatorySecurityOracleIds: uniqueSortedIds(
      stringArray(authority.mandatorySecurityOracleIds, "authority.mandatorySecurityOracleIds", true),
    ),
    mandatoryDataLossRequirementIds: uniqueSortedIds(
      stringArray(authority.mandatoryDataLossRequirementIds, "authority.mandatoryDataLossRequirementIds", true),
    ),
    mandatoryDataLossTaskIds: uniqueSortedIds(
      stringArray(authority.mandatoryDataLossTaskIds, "authority.mandatoryDataLossTaskIds", true),
    ),
    mandatoryDataLossCheckIds: uniqueSortedIds(
      stringArray(authority.mandatoryDataLossCheckIds, "authority.mandatoryDataLossCheckIds", true),
    ),
    mandatoryDataLossOracleIds: uniqueSortedIds(
      stringArray(authority.mandatoryDataLossOracleIds, "authority.mandatoryDataLossOracleIds", true),
    ),
  });
  const expectedSnapshot = computeProtectedRiskPolicySnapshotDigestV1(normalized);
  if (authority.policySnapshotDigest !== expectedSnapshot) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  return cloneCanonical({
    ...normalized,
    policySnapshotDigest: authority.policySnapshotDigest,
  });
}

/**
 * Derive closed protected-risk class from V1 finding fields + mandatory policy authority.
 * Caller flags are never accepted as clearing authority (pass only through derived class).
 */
export function deriveProtectedRiskV1(
  finding: FailureFindingV1,
  authority?: ProtectedRiskAuthorityContextV1,
): ProtectedRiskClassV1 {
  const checkIds = checkIdsFromFinding(finding);
  // Intrinsic security authority: either authoritative field is positive (OR).
  // Contradiction (security root with isSecurityRelevant false) is ambiguous per design.
  const rootSecurity = finding.rootCause === "security";
  const flagSecurity = finding.isSecurityRelevant === true;
  let security = rootSecurity || flagSecurity;
  let ambiguous = rootSecurity && !flagSecurity;

  let dataLoss = false;
  if (authority) {
    const auth = normalizeProtectedRiskAuthorityV1(authority);
    const policySecurity = anchorsMatch(
      finding,
      checkIds,
      auth.mandatorySecurityRequirementIds,
      auth.mandatorySecurityTaskIds,
      auth.mandatorySecurityCheckIds,
      auth.mandatorySecurityOracleIds,
    );
    if (policySecurity) {
      security = true;
      ambiguous = false;
    }
    dataLoss = anchorsMatch(
      finding,
      checkIds,
      auth.mandatoryDataLossRequirementIds,
      auth.mandatoryDataLossTaskIds,
      auth.mandatoryDataLossCheckIds,
      auth.mandatoryDataLossOracleIds,
    );
  }

  if (ambiguous && !dataLoss) return "ambiguous";
  if (security && dataLoss) return "security_and_data_loss";
  if (security) return "security";
  if (dataLoss) return "data_loss";
  return "none";
}

/**
 * Total disposition projection with fixed precedence:
 * 1. derived protected/ambiguous risk → blocking (dominates advisory/defer/baseline)
 * 2. pre-existing (baseline proof + no protected-risk authority)
 * 3. deferred (valid defer ref + not mandatory)
 * 4. recommendation (advisory + not mandatory)
 * 5. blocking (fail-safe default)
 */
export function projectFindingDispositionV1(
  finding: FailureFindingV1,
  classificationInput: DispositionClassificationInputV1,
  protectedRiskAuthority?: ProtectedRiskAuthorityContextV1,
): FindingDispositionEntryV1 {
  const classification = normalizeClassification(classificationInput);
  const checkIds = checkIdsFromFinding(finding);
  const mandatory = isMandatory(finding, classification, checkIds);

  // 1. Protected-risk authority dominates every advisory/defer/baseline path.
  const riskClass = deriveProtectedRiskV1(finding, protectedRiskAuthority);
  if (riskClass !== "none") {
    return cloneCanonical({
      findingId: finding.findingId,
      disposition: "blocking" as const,
      requirementIds: [...finding.requirementIds].sort(),
      taskIds: [...finding.taskIds].sort(),
      checkIds,
      classificationReasonCode: "AMBIGUOUS_OR_ACTIVE_BLOCKING" as const,
    });
  }

  // 2. pre-existing: unrelated_baseline + pre_existing + exact baseline fingerprint
  if (
    finding.relationship === "unrelated_baseline" &&
    finding.status === "pre_existing" &&
    classification.baselineFingerprints.includes(finding.fingerprint)
  ) {
    return cloneCanonical({
      findingId: finding.findingId,
      disposition: "pre-existing" as const,
      requirementIds: [...finding.requirementIds].sort(),
      taskIds: [...finding.taskIds].sort(),
      checkIds,
      classificationReasonCode: "BASELINE_PRE_EXISTING" as const,
      baselinePolicyRef: finding.fingerprint,
    });
  }

  // 3. deferred: valid non-expired policy-authorized defer ref, not mandatory floor
  const deferRef = classification.deferPolicyRefs[finding.findingId];
  if (deferRef && !mandatory) {
    return cloneCanonical({
      findingId: finding.findingId,
      disposition: "deferred" as const,
      requirementIds: [...finding.requirementIds].sort(),
      taskIds: [...finding.taskIds].sort(),
      checkIds,
      classificationReasonCode: "POLICY_DEFERRED" as const,
      deferPolicyRef: deferRef,
    });
  }

  // 4. recommendation: advisory check classification and not required by batch obligations
  const advisory = checkIds.length > 0 && checkIds.every((id) => classification.advisoryCheckIds.includes(id));
  if (advisory && !mandatory && finding.relationship !== "unrelated_baseline") {
    return cloneCanonical({
      findingId: finding.findingId,
      disposition: "recommendation" as const,
      requirementIds: [...finding.requirementIds].sort(),
      taskIds: [...finding.taskIds].sort(),
      checkIds,
      classificationReasonCode: "ADVISORY_RECOMMENDATION" as const,
    });
  }

  // 5. blocking — missing/conflicting/insufficient proof fails safely here
  return cloneCanonical({
    findingId: finding.findingId,
    disposition: "blocking" as const,
    requirementIds: [...finding.requirementIds].sort(),
    taskIds: [...finding.taskIds].sort(),
    checkIds,
    classificationReasonCode: "AMBIGUOUS_OR_ACTIVE_BLOCKING" as const,
  });
}

function semanticPayload(
  classificationPolicyVersion: string,
  changeId: string,
  batchDigest: Sha256Digest,
  entries: readonly FindingDispositionEntryV1[],
) {
  // Excludes producer identity, prose, wall-clock timestamps, and full manifest digest.
  return cloneCanonical({
    classificationPolicyVersion,
    changeId,
    batchDigest,
    entries: entries.map((e) => ({
      findingId: e.findingId,
      disposition: e.disposition,
      requirementIds: e.requirementIds,
      taskIds: e.taskIds,
      checkIds: e.checkIds,
      classificationReasonCode: e.classificationReasonCode,
      ...(e.baselinePolicyRef === undefined ? {} : { baselinePolicyRef: e.baselinePolicyRef }),
      ...(e.deferPolicyRef === undefined ? {} : { deferPolicyRef: e.deferPolicyRef }),
    })),
  });
}

function parseEntry(raw: unknown, index: number): FindingDispositionEntryV1 {
  assertExactKeys(raw, ENTRY_KEYS, `entries[${index}]`);
  assertId(raw.findingId, "finding:v1:", `entries[${index}].findingId`);
  const disposition = enumValue(raw.disposition, DISPOSITIONS, `entries[${index}].disposition`);
  const classificationReasonCode = enumValue(
    raw.classificationReasonCode,
    REASON_CODES,
    `entries[${index}].classificationReasonCode`,
  );
  return cloneCanonical({
    findingId: raw.findingId as FindingId,
    disposition,
    requirementIds: stringArray(raw.requirementIds, `entries[${index}].requirementIds`, true),
    taskIds: stringArray(raw.taskIds, `entries[${index}].taskIds`, true),
    checkIds: stringArray(raw.checkIds, `entries[${index}].checkIds`, true),
    classificationReasonCode,
    ...(raw.baselinePolicyRef === undefined
      ? {}
      : { baselinePolicyRef: codeValue(raw.baselinePolicyRef, `entries[${index}].baselinePolicyRef`) }),
    ...(raw.deferPolicyRef === undefined
      ? {}
      : { deferPolicyRef: codeValue(raw.deferPolicyRef, `entries[${index}].deferPolicyRef`) }),
  });
}

/**
 * Bind mandatory protected-risk authority for disposition/routing/effect.
 * Missing authority, incomplete Spec/Design/Tasks bindings, or snapshot mismatch fail closed.
 */
export function bindProtectedRiskAuthority(
  authority: ProtectedRiskAuthorityContextV1 | undefined,
  batch: ApplyBatchContractV1,
  manifest: FailureManifestV1,
  classificationPolicyVersion: string,
  options: { required: boolean } = { required: true },
): ProtectedRiskAuthorityContextV1 | undefined {
  if (authority === undefined) {
    if (options.required) {
      throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
    return undefined;
  }
  const auth = normalizeProtectedRiskAuthorityV1(authority);
  if (auth.batchDigest !== batch.digest || auth.manifestDigest !== manifest.digest) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  if (auth.classificationPolicyVersion !== classificationPolicyVersion) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  const expectedPolicyDigest = batch.artifactDigests[PROTECTED_RISK_POLICY_ARTIFACT_KEY];
  if (
    expectedPolicyDigest === undefined ||
    computeProtectedRiskPolicyAuthorityDigestV1(auth) !== expectedPolicyDigest
  ) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  // Exact-match every Spec/Design/Tasks entry present on the batch; incomplete maps fail closed.
  for (const key of MANDATORY_POLICY_ARTIFACT_KEYS) {
    const batchDigest = batch.artifactDigests[key];
    if (batchDigest === undefined) continue;
    if (auth.artifactDigests[key] !== batchDigest) {
      throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  }
  // Every authority-supplied artifact entry must match batch when the batch carries that key.
  for (const [key, digest] of Object.entries(auth.artifactDigests)) {
    const batchDigest = batch.artifactDigests[key];
    if (batchDigest !== undefined && batchDigest !== digest) {
      throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  }
  // When the batch binds any mandatory policy artifact, authority must not carry an empty map.
  const batchHasMandatory = MANDATORY_POLICY_ARTIFACT_KEYS.some((k) => batch.artifactDigests[k] !== undefined);
  if (batchHasMandatory && Object.keys(auth.artifactDigests).length === 0) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  return auth;
}

export function buildFindingDispositionEnvelopeV1(input: FindingDispositionEnvelopeInputV1): FindingDispositionEnvelopeV1 {
  assertExactKeys(input, ["manifest", "batch", "classification", "protectedRiskAuthority"], "finding disposition envelope input");
  const { manifest, batch } = input;
  if (manifest.schema !== "failure-manifest-v1") throw new Error("unsupported-contract-version");
  assertBatchReferenceV1(manifest, batch);
  if (manifest.changeId !== batch.changeId) throw new Error("invalid-evidence: changeId");
  const classification = normalizeClassification(input.classification);
  // Authorizing disposition requires complete protected-risk authority (fail closed when omitted).
  const protectedRiskAuthority = bindProtectedRiskAuthority(
    input.protectedRiskAuthority,
    batch,
    manifest,
    classification.classificationPolicyVersion,
    { required: true },
  );

  const entries = [...manifest.findings]
    .map((finding) => projectFindingDispositionV1(finding, classification, protectedRiskAuthority))
    .sort((a, b) => a.findingId.localeCompare(b.findingId));

  // One-to-one finding set
  if (entries.length !== manifest.findings.length) throw new Error("invalid-evidence: disposition-entry-count");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.findingId)) throw new Error("invalid-evidence: duplicate-finding-id");
    seen.add(entry.findingId);
  }
  for (const finding of manifest.findings) {
    if (!seen.has(finding.findingId)) throw new Error("invalid-evidence: missing-finding-id");
  }

  const semanticDigest = sha256Digest(
    semanticPayload(classification.classificationPolicyVersion, batch.changeId, batch.digest, entries),
  );
  const payload = cloneCanonical({
    schema: "finding-disposition-envelope-v1" as const,
    classificationPolicyVersion: classification.classificationPolicyVersion,
    changeId: codeValue(batch.changeId, "envelope.changeId"),
    batchId: batch.batchId,
    batchDigest: batch.digest,
    manifestDigest: manifest.digest,
    entries,
    semanticDigest,
  });
  const digest = sha256Digest(payload);
  return deepFreeze({
    ...payload,
    envelopeId: `disposition:v1:${digest.slice(7, 39)}` as const,
    digest,
  }) as FindingDispositionEnvelopeV1;
}

export function parseFindingDispositionEnvelopeV1(
  value: unknown,
  manifest: FailureManifestV1,
  batch: ApplyBatchContractV1,
  classification: DispositionClassificationInputV1,
  protectedRiskAuthority?: ProtectedRiskAuthorityContextV1,
): FindingDispositionEnvelopeV1 {
  assertExactKeys(value, ENVELOPE_KEYS, "finding disposition envelope");
  if (value.schema !== "finding-disposition-envelope-v1") throw new Error("unsupported-contract-version");
  assertId(value.envelopeId, "disposition:v1:", "envelope.envelopeId");
  assertDigest(value.digest, "envelope.digest");
  assertDigest(value.semanticDigest, "envelope.semanticDigest");
  assertDigest(value.batchDigest, "envelope.batchDigest");
  assertDigest(value.manifestDigest, "envelope.manifestDigest");
  assertBatchReferenceV1({ batchId: stringValue(value.batchId, "envelope.batchId"), batchDigest: stringValue(value.batchDigest, "envelope.batchDigest") }, batch);
  if (value.manifestDigest !== manifest.digest) throw new Error("invalid-evidence: manifestDigest");
  if (value.changeId !== batch.changeId || value.changeId !== manifest.changeId) throw new Error("invalid-evidence: changeId");

  const entries = denseArray(value.entries, "entries").map((raw, i) => parseEntry(raw, i));
  // sorted unique one-to-one with manifest
  const sorted = [...entries].sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (JSON.stringify(entries.map((e) => e.findingId)) !== JSON.stringify(sorted.map((e) => e.findingId))) {
    throw new Error("invalid-evidence: entries-order");
  }
  const entryIds = new Set(entries.map((e) => e.findingId));
  if (entryIds.size !== entries.length) throw new Error("invalid-evidence: duplicate-finding-id");
  const manifestIds = new Set(manifest.findings.map((f) => f.findingId));
  if (entryIds.size !== manifestIds.size) throw new Error("invalid-evidence: disposition-entry-count");
  for (const id of entryIds) {
    if (!manifestIds.has(id as FindingId)) throw new Error("invalid-evidence: foreign-finding-id");
  }
  for (const id of manifestIds) {
    if (!entryIds.has(id)) throw new Error("invalid-evidence: missing-finding-id");
  }

  // Authoritative classification recomputation: self-rehashed downgrades are not independent authority.
  const normalizedClassification = normalizeClassification(classification);
  const classificationPolicyVersion = codeValue(value.classificationPolicyVersion, "envelope.classificationPolicyVersion");
  if (classificationPolicyVersion !== normalizedClassification.classificationPolicyVersion) {
    throw new Error("invalid-evidence: classificationPolicyVersion");
  }
  // Authorizing parse requires complete protected-risk authority (fail closed when omitted).
  const boundAuthority = bindProtectedRiskAuthority(
    protectedRiskAuthority,
    batch,
    manifest,
    classificationPolicyVersion,
    { required: true },
  );
  const expectedEntries = [...manifest.findings]
    .map((finding) => projectFindingDispositionV1(finding, normalizedClassification, boundAuthority))
    .sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    // Distinguish protected-risk forgery from general recompute mismatch when possible.
    const anyProtected = manifest.findings.some((f) => deriveProtectedRiskV1(f, boundAuthority) !== "none");
    if (anyProtected) {
      throw new Error("invalid-evidence: DISPOSITION_PROTECTED_RISK_MISMATCH");
    }
    throw new Error("invalid-evidence: disposition-recompute-mismatch");
  }

  const semanticDigest = sha256Digest(
    semanticPayload(classificationPolicyVersion, batch.changeId, batch.digest, expectedEntries),
  );
  if (value.semanticDigest !== semanticDigest) throw new Error("invalid-evidence: semanticDigest");

  const payload = cloneCanonical({
    schema: "finding-disposition-envelope-v1" as const,
    classificationPolicyVersion,
    changeId: codeValue(value.changeId, "envelope.changeId"),
    batchId: batch.batchId,
    batchDigest: batch.digest,
    manifestDigest: manifest.digest,
    entries: expectedEntries,
    semanticDigest,
  });
  const expected = sha256Digest(payload);
  if (value.digest !== expected || value.envelopeId !== `disposition:v1:${expected.slice(7, 39)}`) {
    throw new Error("invalid-evidence: finding disposition envelope");
  }
  return deepFreeze({ ...payload, envelopeId: value.envelopeId, digest: value.digest }) as FindingDispositionEnvelopeV1;
}

/** Active blockers: disposition blocking AND V1 status still open. */
export function activeBlockingEntriesV1(
  envelope: FindingDispositionEnvelopeV1,
  manifest: FailureManifestV1,
): readonly FindingDispositionEntryV1[] {
  const open = new Set(manifest.findings.filter((f) => f.status === "open").map((f) => f.findingId));
  return envelope.entries.filter((e) => e.disposition === "blocking" && open.has(e.findingId));
}

export function activeBlockingSetDigestV1(
  envelope: FindingDispositionEnvelopeV1,
  manifest: FailureManifestV1,
): Sha256Digest {
  const ids = activeBlockingEntriesV1(envelope, manifest).map((e) => e.findingId).sort();
  return sha256Digest({ activeBlockingFindingIds: ids });
}
