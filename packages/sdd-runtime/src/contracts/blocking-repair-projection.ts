import type { ApplyBatchContractV1, BatchId } from "./apply-batch";
import { assertBatchReferenceV1 } from "./apply-batch";
import {
  assertDigest,
  assertExactKeys,
  assertId,
  assertNoUnsafeDiagnosticContent,
  cloneCanonical,
  codeValue,
  deepFreeze,
  denseArray,
  integerValue,
  redactBoundedText,
  repositoryPath,
  sha256Digest,
  stringArray,
  stringValue,
  type Sha256Digest,
} from "./canonical";
import type { FailureManifestV1, FindingId, SafeEvidenceRefV1 } from "./failure-manifest";
import {
  bindProtectedRiskAuthority,
  deriveProtectedRiskV1,
  type FindingDispositionEnvelopeV1,
  type ProtectedRiskAuthorityContextV1,
} from "./finding-disposition";
import type { RoutingDecisionV1 } from "./routing-decision";
import {
  parseExecutionConvergenceDossierWithAuthorityV1,
  type ConvergenceAuthorityRecordSetV1,
  type ConvergenceTransitionReceiptV1,
  type ExecutionConvergenceDossierV1,
} from "./execution-convergence";

export interface BlockingRepairProjectionV1 {
  schema: "blocking-repair-projection-v1";
  projectionId: `repair-projection:v1:${string}`;
  digest: Sha256Digest;
  originalBatchId: BatchId;
  originalBatchDigest: Sha256Digest;
  originalManifestDigest: Sha256Digest;
  convergenceDossierRevision: number;
  convergenceDossierDigest: Sha256Digest;
  routingDecisionDigest: Sha256Digest;
  selectedFindingIds: readonly FindingId[];
  requirementIds: readonly string[];
  taskIds: readonly string[];
  checkIds: readonly string[];
  allowedTargets: readonly string[];
  acceptanceObligations: readonly string[];
  causalEvidenceRefs: readonly SafeEvidenceRefV1[];
  retryIdentity: Sha256Digest;
  attemptNumber: number;
  priorAttemptDigest?: Sha256Digest;
  authorizationRef: Sha256Digest;
  effectCapabilityBinding: string;
}

export interface BlockingRepairProjectionInputV1 {
  batch: ApplyBatchContractV1;
  manifest: FailureManifestV1;
  disposition: FindingDispositionEnvelopeV1;
  routing: RoutingDecisionV1;
  selectedFindingIds: readonly FindingId[];
  convergenceDossierRevision: number;
  convergenceDossierDigest: Sha256Digest;
  authorizationRef: Sha256Digest;
  effectCapabilityBinding: string;
  causalEvidenceRefs: readonly SafeEvidenceRefV1[];
  attemptNumber?: number;
  priorAttemptDigest?: Sha256Digest;
  repositoryRoot?: string;
  /** Current routing-policy version from normalized policy authority (never a local constant). */
  routingPolicyVersion: string;
  /** Current ledger for attempt binding at build time (required for authorizing build). */
  retryLedger: RetryLedgerAuthorityV1;
  /** Mandatory protected-risk authority at projection/effect boundaries. */
  protectedRiskAuthority: ProtectedRiskAuthorityContextV1;
}

export type EffectBoundaryResultV1 =
  | { accepted: true }
  | { accepted: false; outcome: "invalid-evidence"; rationaleCodes: readonly string[] };

const PROJECTION_KEYS = [
  "schema",
  "projectionId",
  "digest",
  "originalBatchId",
  "originalBatchDigest",
  "originalManifestDigest",
  "convergenceDossierRevision",
  "convergenceDossierDigest",
  "routingDecisionDigest",
  "selectedFindingIds",
  "requirementIds",
  "taskIds",
  "checkIds",
  "allowedTargets",
  "acceptanceObligations",
  "causalEvidenceRefs",
  "retryIdentity",
  "attemptNumber",
  "priorAttemptDigest",
  "authorizationRef",
  "effectCapabilityBinding",
] as const;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSortedSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Normalize location keys that include line/range/column suffixes to a repository path.
 * Supports `path:line`, `path:start-end`, and `path:line:column`. Windows drive prefixes
 * (`C:\...`) are preserved and not treated as line separators.
 */
function normalizeLocationKeyToPath(locationKey: string): string {
  const slash = locationKey.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(slash)) {
    // Windows absolute: strip trailing :line / :line-line / :line:col if present after path
    return slash.replace(/(?<=\.[A-Za-z0-9_]+):(\d+)(?:-(\d+))?(?::\d+)?$/, "");
  }
  return slash.replace(/:(\d+)(?:-(\d+))?(?::\d+)?$/, "");
}

function evidenceRefIdentity(ref: SafeEvidenceRefV1): string {
  return JSON.stringify({
    kind: ref.kind,
    checkId: ref.checkId,
    artifact: ref.artifact.replaceAll("\\", "/"),
    ...(ref.excerpt === undefined ? {} : { excerpt: ref.excerpt }),
    ...(ref.resultCode === undefined ? {} : { resultCode: ref.resultCode }),
  });
}

function sameEvidenceSet(actual: readonly SafeEvidenceRefV1[], expected: readonly SafeEvidenceRefV1[]): boolean {
  if (actual.length !== expected.length) return false;
  const a = actual.map(evidenceRefIdentity).sort();
  const b = expected.map(evidenceRefIdentity).sort();
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Independently re-derive anchors/checks/targets/causal evidence from selected findings.
 * Used by the builder and by the effect-boundary validator so authority is not
 * trusted from the projection payload alone.
 */
function deriveRepairAuthorityFromSelectedFindingsV1(input: {
  batch: ApplyBatchContractV1;
  manifest: FailureManifestV1;
  disposition: FindingDispositionEnvelopeV1;
  selectedFindingIds: readonly FindingId[];
  repositoryRoot?: string;
}): {
  requirementIds: string[];
  taskIds: string[];
  checkIds: string[];
  allowedTargets: string[];
  acceptanceObligations: string[];
  causalEvidenceRefs: SafeEvidenceRefV1[];
} {
  const openById = new Map(input.manifest.findings.map((f) => [f.findingId, f]));
  const dispositionById = new Map(input.disposition.entries.map((e) => [e.findingId, e]));
  const selectedFindingIds = [...input.selectedFindingIds];

  for (const id of selectedFindingIds) {
    const finding = openById.get(id);
    const entry = dispositionById.get(id);
    if (!finding || finding.status !== "open") throw new Error("invalid-evidence: selected-finding-not-open");
    if (!entry || entry.disposition !== "blocking") throw new Error("invalid-evidence: selected-not-blocking");
    if (!entry.requirementIds.length || !entry.taskIds.length || !entry.checkIds.length) {
      throw new Error("invalid-evidence: missing-anchors");
    }
  }

  const requirementIds = uniqueSorted(selectedFindingIds.flatMap((id) => dispositionById.get(id)!.requirementIds));
  const taskIds = uniqueSorted(selectedFindingIds.flatMap((id) => dispositionById.get(id)!.taskIds));
  const checkIds = uniqueSorted(selectedFindingIds.flatMap((id) => dispositionById.get(id)!.checkIds));

  const ctx = { repositoryRoot: input.repositoryRoot ?? "." };
  const derivedLocations = uniqueSorted(
    selectedFindingIds.flatMap((id) => {
      const finding = openById.get(id)!;
      return finding.locationKeys.map((k) => {
        const normalized = normalizeLocationKeyToPath(k);
        try {
          return repositoryPath(normalized, ctx, "locationKey");
        } catch {
          return normalized.replaceAll("\\", "/");
        }
      });
    }),
  );
  const allowedTargets = derivedLocations.filter((t) => input.batch.allowedTargets.includes(t)).sort();
  if (!allowedTargets.length) throw new Error("invalid-evidence: no-allowed-targets");
  if (allowedTargets.some((t) => input.batch.blockedTargets.includes(t))) {
    throw new Error("invalid-evidence: blocked-target-intersection");
  }

  const acceptanceObligations = input.batch.acceptanceObligations
    .filter((o) => requirementIds.includes(o))
    .sort();

  // Canonical causal evidence is exactly the selected findings' evidence refs (safe-normalized).
  const seenEvidence = new Set<string>();
  const causalEvidenceRefs: SafeEvidenceRefV1[] = [];
  for (const id of [...selectedFindingIds].sort()) {
    const finding = openById.get(id)!;
    for (const raw of finding.evidence) {
      try {
        assertNoUnsafeDiagnosticContent(raw, "causalEvidenceRefs");
      } catch {
        throw new Error("unsafe-diagnostic-content: causalEvidenceRefs");
      }
      const ref = cloneCanonical({
        kind: codeValue(raw.kind, "causalEvidenceRefs.kind"),
        checkId: codeValue(raw.checkId, "causalEvidenceRefs.checkId"),
        artifact: repositoryPath(raw.artifact, ctx, "causalEvidenceRefs.artifact"),
        ...(raw.excerpt === undefined
          ? {}
          : { excerpt: redactBoundedText(stringValue(raw.excerpt, "causalEvidenceRefs.excerpt", 1024)) }),
        ...(raw.resultCode === undefined
          ? {}
          : { resultCode: codeValue(raw.resultCode, "causalEvidenceRefs.resultCode") }),
      }) as SafeEvidenceRefV1;
      const key = evidenceRefIdentity(ref);
      if (!seenEvidence.has(key)) {
        seenEvidence.add(key);
        causalEvidenceRefs.push(ref);
      }
    }
  }
  causalEvidenceRefs.sort((a, b) => evidenceRefIdentity(a).localeCompare(evidenceRefIdentity(b)));

  return {
    requirementIds,
    taskIds,
    checkIds,
    allowedTargets,
    acceptanceObligations,
    causalEvidenceRefs,
  };
}

function parseEvidenceRefs(raw: unknown, repositoryRoot: string): SafeEvidenceRefV1[] {
  const ctx = { repositoryRoot };
  return denseArray(raw, "causalEvidenceRefs").map((item, i) => {
    assertExactKeys(item, ["kind", "checkId", "artifact", "excerpt", "resultCode"], `causalEvidenceRefs[${i}]`);
    try {
      assertNoUnsafeDiagnosticContent(item, `causalEvidenceRefs[${i}]`);
    } catch {
      throw new Error("unsafe-diagnostic-content: causalEvidenceRefs");
    }
    return cloneCanonical({
      kind: codeValue(item.kind, `causalEvidenceRefs[${i}].kind`),
      checkId: codeValue(item.checkId, `causalEvidenceRefs[${i}].checkId`),
      artifact: repositoryPath(item.artifact, ctx, `causalEvidenceRefs[${i}].artifact`),
      ...(item.excerpt === undefined
        ? {}
        : { excerpt: redactBoundedText(stringValue(item.excerpt, `causalEvidenceRefs[${i}].excerpt`, 1024)) }),
      ...(item.resultCode === undefined
        ? {}
        : { resultCode: codeValue(item.resultCode, `causalEvidenceRefs[${i}].resultCode`) }),
    });
  });
}

/** Complete retry-identity authority projection (additive; not injected into V1 keys). */
export interface RetryIdentityAuthorityProjectionV1 {
  routingPolicyVersion: string;
  originalBatchDigest: Sha256Digest;
  selectedFindingIds: readonly FindingId[];
  destination: string;
  owner: string;
  allowedTargets: readonly string[];
  requirementIds: readonly string[];
  taskIds: readonly string[];
  checkIds: readonly string[];
  acceptanceObligations: readonly string[];
  oracleIds: readonly string[];
  verificationPlanCheckIds: readonly string[];
}

/** Parsed attempt record referenced by convergence retryLedgerDigests. */
export interface RetryAttemptRecordV1 {
  digest: Sha256Digest;
  retryIdentity: Sha256Digest;
  attemptNumber: number;
  projectionDigest: Sha256Digest;
  priorAttemptDigest?: Sha256Digest;
  convergenceRevision: number;
  convergenceDigest: Sha256Digest;
  terminalEffectResult: "succeeded" | "failed" | "rejected";
}

/** Current ledger authority for attempt/prior binding at parse and effect. */
export interface RetryLedgerAuthorityV1 {
  retryLedgerDigests: readonly Sha256Digest[];
  attemptRecords: readonly RetryAttemptRecordV1[];
  currentConvergenceRevision: number;
  currentConvergenceDigest: Sha256Digest;
  /** Authority-parsed dossier whose digest is independently expected at the effect boundary. */
  currentDossier: ExecutionConvergenceDossierV1;
  dossierHistory: readonly ExecutionConvergenceDossierV1[];
  transitionReceipts: readonly ConvergenceTransitionReceiptV1[];
  convergenceAuthorityRecords: ConvergenceAuthorityRecordSetV1;
  /** Complete content-addressed projections referenced by attempt records. */
  projectionRecords: readonly BlockingRepairProjectionV1[];
}

export function buildRetryIdentityAuthorityProjectionV1(input: {
  routingPolicyVersion: string;
  batch: ApplyBatchContractV1;
  manifest: FailureManifestV1;
  selectedFindingIds: readonly FindingId[];
  destination: string;
  owner: string;
  allowedTargets: readonly string[];
  requirementIds: readonly string[];
  taskIds: readonly string[];
  checkIds: readonly string[];
}): RetryIdentityAuthorityProjectionV1 {
  const selected = [...input.selectedFindingIds].sort() as FindingId[];
  const openById = new Map(input.manifest.findings.map((f) => [f.findingId, f]));
  const oracleIds = uniqueSorted(
    selected.map((id) => {
      const f = openById.get(id);
      if (!f) throw new Error("invalid-evidence: selected-finding-missing");
      return f.oracleId;
    }),
  );
  // V1 has no optional marker: every verification-plan check ID is mandatory.
  const verificationPlanCheckIds = uniqueSorted(
    input.batch.verificationPlan.flatMap((stage) => [...stage.checkIds]),
  );
  // Complete original batch acceptance obligations (not caller-selected subset).
  const acceptanceObligations = uniqueSorted([...input.batch.acceptanceObligations]);
  return cloneCanonical({
    routingPolicyVersion: codeValue(input.routingPolicyVersion, "routingPolicyVersion"),
    originalBatchDigest: input.batch.digest,
    selectedFindingIds: selected,
    destination: codeValue(input.destination, "destination"),
    owner: codeValue(input.owner, "owner"),
    allowedTargets: [...input.allowedTargets].sort(),
    requirementIds: [...input.requirementIds].sort(),
    taskIds: [...input.taskIds].sort(),
    checkIds: [...input.checkIds].sort(),
    acceptanceObligations,
    oracleIds,
    verificationPlanCheckIds,
  });
}

export function computeRetryIdentityFromAuthorityV1(
  authority: RetryIdentityAuthorityProjectionV1,
): Sha256Digest {
  return sha256Digest({
    routingPolicyVersion: authority.routingPolicyVersion,
    originalBatchDigest: authority.originalBatchDigest,
    selectedFindingIds: [...authority.selectedFindingIds].sort(),
    destination: authority.destination,
    owner: authority.owner,
    allowedTargets: [...authority.allowedTargets].sort(),
    requirementIds: [...authority.requirementIds].sort(),
    taskIds: [...authority.taskIds].sort(),
    checkIds: [...authority.checkIds].sort(),
    acceptanceObligations: [...authority.acceptanceObligations].sort(),
    oracleIds: [...authority.oracleIds].sort(),
    verificationPlanCheckIds: [...authority.verificationPlanCheckIds].sort(),
  });
}

/** Content-addressed digest for a retry attempt record (authority-bound). */
export function computeRetryAttemptRecordDigestV1(
  record: Omit<RetryAttemptRecordV1, "digest">,
): Sha256Digest {
  return sha256Digest(
    cloneCanonical({
      schema: "retry-attempt-record-v1",
      retryIdentity: record.retryIdentity,
      attemptNumber: record.attemptNumber,
      projectionDigest: record.projectionDigest,
      ...(record.priorAttemptDigest === undefined
        ? {}
        : { priorAttemptDigest: record.priorAttemptDigest }),
      convergenceRevision: record.convergenceRevision,
      convergenceDigest: record.convergenceDigest,
      terminalEffectResult: record.terminalEffectResult,
    }),
  );
}

export function validateRetryAttemptAgainstLedgerV1(input: {
  expectedBatchId: BatchId;
  expectedBatchDigest: Sha256Digest;
  retryIdentity: Sha256Digest;
  attemptNumber: number;
  priorAttemptDigest?: Sha256Digest;
  convergenceDossierRevision: number;
  convergenceDossierDigest: Sha256Digest;
  ledger: RetryLedgerAuthorityV1;
}): { ok: true } | { ok: false; code: string } {
  const { ledger } = input;
  if (
    ledger.currentConvergenceRevision !== input.convergenceDossierRevision ||
    ledger.currentConvergenceDigest !== input.convergenceDossierDigest
  ) {
    return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
  }
  if (ledger.retryLedgerDigests.length !== ledger.attemptRecords.length) {
    return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
  }
  let current: ExecutionConvergenceDossierV1;
  try {
    current = parseExecutionConvergenceDossierWithAuthorityV1(
      ledger.currentDossier,
      ledger.dossierHistory,
      ledger.transitionReceipts,
      ledger.convergenceAuthorityRecords,
    );
  } catch {
    return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
  }
  if (
    current.baseBatchId !== input.expectedBatchId ||
    current.baseBatchDigest !== input.expectedBatchDigest ||
    current.revision !== ledger.currentConvergenceRevision ||
    current.digest !== ledger.currentConvergenceDigest ||
    current.retryLedgerDigests.length !== ledger.retryLedgerDigests.length ||
    current.retryLedgerDigests.some((digest, index) => digest !== ledger.retryLedgerDigests[index])
  ) {
    return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
  }
  const projectionByDigest = new Map<Sha256Digest, BlockingRepairProjectionV1>();
  for (const projection of ledger.projectionRecords) {
    if (projectionByDigest.has(projection.digest)) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    projectionByDigest.set(projection.digest, projection);
  }
  const convergenceByReference = new Map(
    [...ledger.dossierHistory, current].map((dossier) => [
      `${dossier.revision}:${dossier.digest}`,
      dossier,
    ]),
  );
  // Recompute every attempt-record digest; reject caller-carried forgeries.
  const seenDigests = new Set<string>();
  for (let i = 0; i < ledger.attemptRecords.length; i++) {
    const record = ledger.attemptRecords[i]!;
    const { digest: _carried, ...fields } = record;
    const recomputed = computeRetryAttemptRecordDigestV1(fields);
    if (record.digest !== recomputed || ledger.retryLedgerDigests[i] !== recomputed) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    if (seenDigests.has(record.digest)) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    seenDigests.add(record.digest);

    const projection = projectionByDigest.get(record.projectionDigest);
    if (!projection) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    const { projectionId, digest: projectionDigest, ...projectionPayload } = projection;
    const recomputedProjection = sha256Digest(projectionPayload);
    if (
      projectionDigest !== recomputedProjection ||
      projectionId !== `repair-projection:v1:${recomputedProjection.slice(7, 39)}` ||
      projection.retryIdentity !== record.retryIdentity ||
      projection.attemptNumber !== record.attemptNumber ||
      projection.priorAttemptDigest !== record.priorAttemptDigest ||
      projection.convergenceDossierRevision !== record.convergenceRevision ||
      projection.convergenceDossierDigest !== record.convergenceDigest
    ) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    const convergence = convergenceByReference.get(
      `${record.convergenceRevision}:${record.convergenceDigest}`,
    );
    if (!convergence) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
  }
  // Contiguous prior links, projection binding, and dossier head per identity.
  const forIdentity = ledger.attemptRecords.filter((r) => r.retryIdentity === input.retryIdentity);
  for (let i = 0; i < forIdentity.length; i++) {
    const rec = forIdentity[i]!;
    if (rec.attemptNumber !== i + 1) {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
    if (i === 0) {
      if (rec.priorAttemptDigest !== undefined) {
        return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
      }
    } else {
      const prior = forIdentity[i - 1]!;
      if (rec.priorAttemptDigest !== prior.digest) {
        return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
      }
    }
    // Projection binding must be present and content-addressed.
    try {
      assertDigest(rec.projectionDigest, "attempt.projectionDigest");
    } catch {
      return { ok: false, code: "RETRY_LEDGER_MISMATCH" };
    }
  }
  const expectedAttempt = forIdentity.length + 1;
  if (input.attemptNumber !== expectedAttempt) {
    return { ok: false, code: "RETRY_ATTEMPT_NUMBER_MISMATCH" };
  }
  if (expectedAttempt === 1) {
    if (input.priorAttemptDigest !== undefined) {
      return { ok: false, code: "RETRY_PRIOR_ATTEMPT_MISMATCH" };
    }
  } else {
    const prior = forIdentity[expectedAttempt - 2]!;
    if (input.priorAttemptDigest === undefined || input.priorAttemptDigest !== prior.digest) {
      return { ok: false, code: "RETRY_PRIOR_ATTEMPT_MISMATCH" };
    }
  }
  return { ok: true };
}

export function buildBlockingRepairProjectionV1(input: BlockingRepairProjectionInputV1): BlockingRepairProjectionV1 {
  assertExactKeys(
    input,
    [
      "batch",
      "manifest",
      "disposition",
      "routing",
      "selectedFindingIds",
      "convergenceDossierRevision",
      "convergenceDossierDigest",
      "authorizationRef",
      "effectCapabilityBinding",
      "causalEvidenceRefs",
      "attemptNumber",
      "priorAttemptDigest",
      "repositoryRoot",
      "routingPolicyVersion",
      "retryLedger",
      "protectedRiskAuthority",
    ],
    "blocking repair projection input",
  );
  const { batch, manifest, disposition, routing } = input;
  assertBatchReferenceV1(manifest, batch);
  assertDigest(input.convergenceDossierDigest, "convergenceDossierDigest");
  assertDigest(input.authorizationRef, "authorizationRef");
  if (input.authorizationRef !== batch.authorizationGrantRef) {
    throw new Error("invalid-evidence: authorizationRef");
  }
  if (disposition.manifestDigest !== manifest.digest || disposition.batchDigest !== batch.digest) {
    throw new Error("invalid-evidence: disposition reference");
  }
  if (routing.batchDigest !== batch.digest || routing.dispositionSemanticDigest !== disposition.semanticDigest) {
    throw new Error("invalid-evidence: routing reference");
  }
  if (routing.outcome !== "homogeneous") {
    throw new Error("invalid-evidence: non-homogeneous-routing");
  }
  // Mandatory protected-risk authority: independently rederive before authorizing projection.
  const protectedRiskAuthority = bindProtectedRiskAuthority(
    input.protectedRiskAuthority,
    batch,
    manifest,
    disposition.classificationPolicyVersion,
    { required: true },
  )!;
  if (protectedRiskAuthority.routingPolicyVersion !== codeValue(input.routingPolicyVersion, "routingPolicyVersion")) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }

  const selectedFindingIds = stringArray(input.selectedFindingIds, "selectedFindingIds", true) as FindingId[];
  if (!selectedFindingIds.length) throw new Error("invalid-evidence: empty-selected-findings");

  const routeById = new Map(routing.routes.map((r) => [r.findingId, r]));

  for (const id of selectedFindingIds) {
    const route = routeById.get(id);
    if (!route || route.destination !== "targeted_repair" || route.owner !== "apply") {
      throw new Error("invalid-evidence: selected-not-apply-repair");
    }
    const finding = manifest.findings.find((f) => f.findingId === id);
    if (!finding) throw new Error("invalid-evidence: selected-finding-missing");
    const risk = deriveProtectedRiskV1(finding, protectedRiskAuthority);
    if (risk !== "none") {
      throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  }

  // Homogeneous destination/owner across selected
  const selectedRoutes = selectedFindingIds.map((id) => routeById.get(id)!);
  if (new Set(selectedRoutes.map((r) => r.destination)).size !== 1 || new Set(selectedRoutes.map((r) => r.owner)).size !== 1) {
    throw new Error("invalid-evidence: mixed-selected-routes");
  }

  const {
    requirementIds,
    taskIds,
    checkIds,
    allowedTargets,
    acceptanceObligations,
    causalEvidenceRefs: derivedCausalEvidenceRefs,
  } = deriveRepairAuthorityFromSelectedFindingsV1({
    batch,
    manifest,
    disposition,
    selectedFindingIds,
    repositoryRoot: input.repositoryRoot,
  });

  const causalEvidenceRefs = parseEvidenceRefs(input.causalEvidenceRefs, input.repositoryRoot ?? ".");
  // Caller-supplied evidence must equal the complete canonical set derived from selected findings.
  if (!sameEvidenceSet(causalEvidenceRefs, derivedCausalEvidenceRefs)) {
    throw new Error("invalid-evidence: causal-evidence-mismatch");
  }

  const attemptNumber = input.attemptNumber === undefined ? 1 : integerValue(input.attemptNumber, "attemptNumber", 1);
  if (input.priorAttemptDigest !== undefined) assertDigest(input.priorAttemptDigest, "priorAttemptDigest");

  const destination = selectedRoutes[0]!.destination;
  const owner = selectedRoutes[0]!.owner;
  const routingPolicyVersion = codeValue(input.routingPolicyVersion, "routingPolicyVersion");
  const identityAuthority = buildRetryIdentityAuthorityProjectionV1({
    routingPolicyVersion,
    batch,
    manifest,
    selectedFindingIds,
    destination,
    owner,
    allowedTargets,
    requirementIds,
    taskIds,
    checkIds,
  });
  const retryIdentity = computeRetryIdentityFromAuthorityV1(identityAuthority);
  // Builder uses complete original batch obligations in identity; projection still carries
  // finding-derived obligations for minimality of the repair surface.
  // Authorizing build requires fully validated ledger authority (non-optional).
  if (!input.retryLedger) {
    throw new Error("invalid-evidence: RETRY_LEDGER_MISMATCH");
  }
  const ledgerCheck = validateRetryAttemptAgainstLedgerV1({
    expectedBatchId: batch.batchId,
    expectedBatchDigest: batch.digest,
    retryIdentity,
    attemptNumber,
    priorAttemptDigest: input.priorAttemptDigest,
    convergenceDossierRevision: integerValue(input.convergenceDossierRevision, "convergenceDossierRevision", 1),
    convergenceDossierDigest: input.convergenceDossierDigest,
    ledger: input.retryLedger,
  });
  if (!ledgerCheck.ok) {
    throw new Error(`invalid-evidence: ${ledgerCheck.code}`);
  }

  const payload = cloneCanonical({
    schema: "blocking-repair-projection-v1" as const,
    originalBatchId: batch.batchId,
    originalBatchDigest: batch.digest,
    originalManifestDigest: manifest.digest,
    convergenceDossierRevision: integerValue(input.convergenceDossierRevision, "convergenceDossierRevision", 1),
    convergenceDossierDigest: input.convergenceDossierDigest,
    routingDecisionDigest: routing.digest,
    selectedFindingIds: [...selectedFindingIds].sort() as FindingId[],
    requirementIds,
    taskIds,
    checkIds,
    allowedTargets,
    acceptanceObligations,
    causalEvidenceRefs,
    retryIdentity,
    attemptNumber,
    ...(input.priorAttemptDigest === undefined ? {} : { priorAttemptDigest: input.priorAttemptDigest }),
    authorizationRef: input.authorizationRef,
    effectCapabilityBinding: codeValue(input.effectCapabilityBinding, "effectCapabilityBinding"),
  });
  const digest = sha256Digest(payload);
  return deepFreeze({
    ...payload,
    projectionId: `repair-projection:v1:${digest.slice(7, 39)}` as const,
    digest,
  }) as BlockingRepairProjectionV1;
}

/** Structural-only parse: integrity of V1 keys/digest; never authorizing. */
export function parseBlockingRepairProjectionStructuralV1(
  value: unknown,
  batch: ApplyBatchContractV1,
  routing: RoutingDecisionV1,
): BlockingRepairProjectionV1 {
  assertExactKeys(value, PROJECTION_KEYS, "blocking repair projection");
  if (value.schema !== "blocking-repair-projection-v1") throw new Error("unsupported-contract-version");
  assertId(value.projectionId, "repair-projection:v1:", "projection.projectionId");
  assertDigest(value.digest, "projection.digest");
  assertBatchReferenceV1(
    {
      batchId: stringValue(value.originalBatchId, "projection.originalBatchId"),
      batchDigest: stringValue(value.originalBatchDigest, "projection.originalBatchDigest"),
    },
    batch,
  );
  if (value.routingDecisionDigest !== routing.digest) throw new Error("invalid-evidence: routingDecisionDigest");
  assertDigest(value.originalManifestDigest, "projection.originalManifestDigest");
  assertDigest(value.convergenceDossierDigest, "projection.convergenceDossierDigest");
  assertDigest(value.retryIdentity, "projection.retryIdentity");
  assertDigest(value.authorizationRef, "projection.authorizationRef");
  if (value.priorAttemptDigest !== undefined) assertDigest(value.priorAttemptDigest, "projection.priorAttemptDigest");

  const selectedFindingIds = stringArray(value.selectedFindingIds, "projection.selectedFindingIds", true) as FindingId[];
  const requirementIds = stringArray(value.requirementIds, "projection.requirementIds", true);
  const taskIds = stringArray(value.taskIds, "projection.taskIds", true);
  const checkIds = stringArray(value.checkIds, "projection.checkIds", true);
  const allowedTargets = stringArray(value.allowedTargets, "projection.allowedTargets", true);
  const acceptanceObligations = stringArray(value.acceptanceObligations, "projection.acceptanceObligations", true);
  const causalEvidenceRefs = parseEvidenceRefs(value.causalEvidenceRefs, ".");

  if (allowedTargets.some((t) => !batch.allowedTargets.includes(t))) {
    throw new Error("invalid-evidence: target-outside-batch");
  }
  if (allowedTargets.some((t) => batch.blockedTargets.includes(t))) {
    throw new Error("invalid-evidence: blocked-target-intersection");
  }

  const attemptNumber = integerValue(value.attemptNumber, "projection.attemptNumber", 1);
  const priorAttemptDigest =
    value.priorAttemptDigest === undefined ? undefined : (value.priorAttemptDigest as Sha256Digest);
  const convergenceDossierRevision = integerValue(
    value.convergenceDossierRevision,
    "projection.convergenceDossierRevision",
    1,
  );
  const convergenceDossierDigest = value.convergenceDossierDigest as Sha256Digest;
  const retryIdentity = value.retryIdentity as Sha256Digest;

  const payload = cloneCanonical({
    schema: "blocking-repair-projection-v1" as const,
    originalBatchId: batch.batchId,
    originalBatchDigest: batch.digest,
    originalManifestDigest: value.originalManifestDigest as Sha256Digest,
    convergenceDossierRevision,
    convergenceDossierDigest,
    routingDecisionDigest: routing.digest,
    selectedFindingIds,
    requirementIds,
    taskIds,
    checkIds,
    allowedTargets,
    acceptanceObligations,
    causalEvidenceRefs,
    retryIdentity,
    attemptNumber,
    ...(priorAttemptDigest === undefined ? {} : { priorAttemptDigest }),
    authorizationRef: value.authorizationRef as Sha256Digest,
    effectCapabilityBinding: codeValue(value.effectCapabilityBinding, "projection.effectCapabilityBinding"),
  });
  const expected = sha256Digest(payload);
  if (value.digest !== expected || value.projectionId !== `repair-projection:v1:${expected.slice(7, 39)}`) {
    throw new Error("invalid-evidence: blocking repair projection");
  }
  return deepFreeze({ ...payload, projectionId: value.projectionId, digest: value.digest }) as BlockingRepairProjectionV1;
}

/**
 * Authorizing parse: requires complete identity/ledger authority; rederives targets/anchors
 * from batch+manifest+disposition rather than trusting carried projection fields.
 */
export function parseBlockingRepairProjectionV1(
  value: unknown,
  batch: ApplyBatchContractV1,
  routing: RoutingDecisionV1,
  identityAuthority: {
    routingPolicyVersion: string;
    manifest: FailureManifestV1;
    disposition: FindingDispositionEnvelopeV1;
    retryLedger: RetryLedgerAuthorityV1;
    protectedRiskAuthority: ProtectedRiskAuthorityContextV1;
    repositoryRoot?: string;
  },
): BlockingRepairProjectionV1 {
  if (!identityAuthority) {
    throw new Error("invalid-evidence: RETRY_IDENTITY_MISMATCH");
  }
  const structural = parseBlockingRepairProjectionStructuralV1(value, batch, routing);
  const selectedFindingIds = structural.selectedFindingIds;
  const attemptNumber = structural.attemptNumber;
  const priorAttemptDigest = structural.priorAttemptDigest;
  const convergenceDossierRevision = structural.convergenceDossierRevision;
  const convergenceDossierDigest = structural.convergenceDossierDigest;

  if (!identityAuthority.routingPolicyVersion || !identityAuthority.routingPolicyVersion.trim()) {
    throw new Error("invalid-evidence: RETRY_POLICY_VERSION_MISMATCH");
  }
  if (!identityAuthority.retryLedger) {
    throw new Error("invalid-evidence: RETRY_LEDGER_MISMATCH");
  }
  if (!identityAuthority.protectedRiskAuthority) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }

  const protectedRiskAuthority = bindProtectedRiskAuthority(
    identityAuthority.protectedRiskAuthority,
    batch,
    identityAuthority.manifest,
    identityAuthority.disposition.classificationPolicyVersion,
    { required: true },
  )!;
  if (protectedRiskAuthority.routingPolicyVersion !== identityAuthority.routingPolicyVersion) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }

  const selectedRoutes = routing.routes.filter((r) => selectedFindingIds.includes(r.findingId));
  if (!selectedRoutes.length || selectedRoutes.some((r) => r.destination !== "targeted_repair" || r.owner !== "apply")) {
    throw new Error("invalid-evidence: RETRY_IDENTITY_MISMATCH");
  }
  for (const id of selectedFindingIds) {
    const finding = identityAuthority.manifest.findings.find((f) => f.findingId === id);
    if (!finding) throw new Error("invalid-evidence: selected-finding-missing");
    if (deriveProtectedRiskV1(finding, protectedRiskAuthority) !== "none") {
      throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  }

  // Rederive targets/anchors/checks/obligations/evidence from manifest+disposition (not carried fields).
  const derived = deriveRepairAuthorityFromSelectedFindingsV1({
    batch,
    manifest: identityAuthority.manifest,
    disposition: identityAuthority.disposition,
    selectedFindingIds,
    repositoryRoot: identityAuthority.repositoryRoot,
  });
  if (
    !sameSortedSet(structural.allowedTargets, derived.allowedTargets) ||
    !sameSortedSet(structural.requirementIds, derived.requirementIds) ||
    !sameSortedSet(structural.taskIds, derived.taskIds) ||
    !sameSortedSet(structural.checkIds, derived.checkIds) ||
    !sameSortedSet(structural.acceptanceObligations, derived.acceptanceObligations) ||
    !sameEvidenceSet(structural.causalEvidenceRefs, derived.causalEvidenceRefs)
  ) {
    throw new Error("invalid-evidence: RETRY_IDENTITY_MISMATCH");
  }

  const destination = selectedRoutes[0]!.destination;
  const owner = selectedRoutes[0]!.owner;
  const expectedAuthority = buildRetryIdentityAuthorityProjectionV1({
    routingPolicyVersion: identityAuthority.routingPolicyVersion,
    batch,
    manifest: identityAuthority.manifest,
    selectedFindingIds,
    destination,
    owner,
    allowedTargets: derived.allowedTargets,
    requirementIds: derived.requirementIds,
    taskIds: derived.taskIds,
    checkIds: derived.checkIds,
  });
  const expectedIdentity = computeRetryIdentityFromAuthorityV1(expectedAuthority);
  if (structural.retryIdentity !== expectedIdentity) {
    throw new Error("invalid-evidence: RETRY_IDENTITY_MISMATCH");
  }

  const ledgerCheck = validateRetryAttemptAgainstLedgerV1({
    expectedBatchId: batch.batchId,
    expectedBatchDigest: batch.digest,
    retryIdentity: expectedIdentity,
    attemptNumber,
    priorAttemptDigest,
    convergenceDossierRevision,
    convergenceDossierDigest,
    ledger: identityAuthority.retryLedger,
  });
  if (!ledgerCheck.ok) {
    throw new Error(`invalid-evidence: ${ledgerCheck.code}`);
  }

  return deepFreeze({
    ...structural,
    retryIdentity: expectedIdentity,
    allowedTargets: derived.allowedTargets,
    requirementIds: derived.requirementIds,
    taskIds: derived.taskIds,
    checkIds: derived.checkIds,
    acceptanceObligations: derived.acceptanceObligations,
    causalEvidenceRefs: derived.causalEvidenceRefs,
  }) as BlockingRepairProjectionV1;
}

/**
 * Effect-boundary revalidation immediately before invocation.
 * Set-equality/subset based; rejects extra anchors/checks/targets, blocked/excluded
 * intersections, and stale dossier/decision/authorization digests.
 */
export function validateBlockingRepairProjectionAtEffectBoundaryV1(input: {
  projection: BlockingRepairProjectionV1;
  batch: ApplyBatchContractV1;
  routing: RoutingDecisionV1;
  /** Authority for independent re-derivation of anchors/checks/targets at the effect boundary. */
  manifest: FailureManifestV1;
  disposition: FindingDispositionEnvelopeV1;
  expectedConvergenceDossierDigest: Sha256Digest;
  expectedRoutingDecisionDigest: Sha256Digest;
  expectedAuthorizationRef: Sha256Digest;
  expectedEffectCapabilityBinding: string;
  excludedChangeTargets: readonly string[];
  repositoryRoot?: string;
  /** Current routing-policy version for identity recompute at effect boundary (non-optional). */
  routingPolicyVersion: string;
  /** Current ledger for attempt/prior binding (non-optional). */
  retryLedger: RetryLedgerAuthorityV1;
  /** Mandatory protected-risk authority; independently rederived at effect boundary. */
  protectedRiskAuthority: ProtectedRiskAuthorityContextV1;
}): EffectBoundaryResultV1 {
  const codes: string[] = [];
  const { projection, batch, routing, manifest, disposition } = input;

  // Fail closed when mandatory effect authority is omitted.
  if (!input.routingPolicyVersion || !input.routingPolicyVersion.trim()) {
    codes.push("RETRY_POLICY_VERSION_MISMATCH");
  }
  if (!input.retryLedger) {
    codes.push("RETRY_LEDGER_MISMATCH");
  }
  if (!input.protectedRiskAuthority) {
    codes.push("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }

  let parseOk = true;
  try {
    if (input.routingPolicyVersion && input.retryLedger && input.protectedRiskAuthority) {
      parseBlockingRepairProjectionV1(projection, batch, routing, {
        routingPolicyVersion: input.routingPolicyVersion,
        manifest,
        disposition,
        retryLedger: input.retryLedger,
        protectedRiskAuthority: input.protectedRiskAuthority,
        repositoryRoot: input.repositoryRoot,
      });
    } else {
      parseOk = false;
      codes.push("PROJECTION_PARSE_FAILED");
    }
  } catch {
    parseOk = false;
    codes.push("PROJECTION_PARSE_FAILED");
  }

  if (projection.convergenceDossierDigest !== input.expectedConvergenceDossierDigest) {
    codes.push("STALE_CONVERGENCE_DOSSIER");
  }
  if (projection.routingDecisionDigest !== input.expectedRoutingDecisionDigest || projection.routingDecisionDigest !== routing.digest) {
    codes.push("STALE_ROUTING_DECISION");
  }
  if (projection.authorizationRef !== input.expectedAuthorizationRef || projection.authorizationRef !== batch.authorizationGrantRef) {
    codes.push("STALE_AUTHORIZATION");
  }
  if (projection.effectCapabilityBinding !== input.expectedEffectCapabilityBinding) {
    codes.push("MISMATCHED_CAPABILITY_BINDING");
  }
  if (projection.allowedTargets.some((t) => !batch.allowedTargets.includes(t))) {
    codes.push("TARGET_OUTSIDE_BATCH");
  }
  if (projection.allowedTargets.some((t) => batch.blockedTargets.includes(t))) {
    codes.push("BLOCKED_TARGET_INTERSECTION");
  }
  const excluded = new Set(input.excludedChangeTargets.map((t) => t.replaceAll("\\", "/")));
  if (projection.allowedTargets.some((t) => excluded.has(t) || [...excluded].some((e) => t === e || t.startsWith(`${e}/`)))) {
    codes.push("EXCLUDED_CHANGE_INTERSECTION");
  }

  const selectedRoutes = routing.routes.filter((r) => projection.selectedFindingIds.includes(r.findingId));
  if (selectedRoutes.length !== projection.selectedFindingIds.length) {
    codes.push("SELECTED_ROUTE_MISMATCH");
  }
  if (selectedRoutes.some((r) => r.destination !== "targeted_repair" || r.owner !== "apply")) {
    codes.push("NON_REPAIR_ROUTE");
  }
  if (routing.outcome !== "homogeneous") {
    codes.push("NON_HOMOGENEOUS_ROUTING");
  }

  // Content-addressed integrity: mutated projection fields (e.g. widened targets) fail closed.
  const rehashed = (() => {
    try {
      const { projectionId: _id, digest: _d, ...rest } = projection;
      return sha256Digest(rest);
    } catch {
      return undefined;
    }
  })();
  if (rehashed !== projection.digest) {
    codes.push("PROJECTION_DIGEST_MISMATCH");
    codes.push("OVERSIZED_TARGETS");
  }

  // Bind target/anchor/check sets to derived authority from selected blocking findings.
  // Digest + batch allowlist alone is insufficient: a validly rehashed projection can still
  // inject batch-allowed targets that were never derived from the selected findings.
  try {
    if (
      disposition.manifestDigest !== projection.originalManifestDigest ||
      disposition.batchDigest !== batch.digest ||
      manifest.digest !== projection.originalManifestDigest ||
      manifest.batchDigest !== batch.digest
    ) {
      codes.push("STALE_DERIVATION_AUTHORITY");
    } else {
      const derived = deriveRepairAuthorityFromSelectedFindingsV1({
        batch,
        manifest,
        disposition,
        selectedFindingIds: projection.selectedFindingIds,
        repositoryRoot: input.repositoryRoot,
      });
      if (!sameSortedSet(projection.allowedTargets, derived.allowedTargets)) {
        codes.push("OVERSIZED_TARGETS");
      }
      if (
        !sameSortedSet(projection.requirementIds, derived.requirementIds) ||
        !sameSortedSet(projection.taskIds, derived.taskIds)
      ) {
        codes.push("OVERSIZED_ANCHORS");
      }
      if (!sameSortedSet(projection.checkIds, derived.checkIds)) {
        codes.push("OVERSIZED_CHECKS");
      }
      if (!sameSortedSet(projection.acceptanceObligations, derived.acceptanceObligations)) {
        codes.push("OVERSIZED_OBLIGATIONS");
      }
      if (!sameEvidenceSet(projection.causalEvidenceRefs, derived.causalEvidenceRefs)) {
        codes.push("OVERSIZED_EVIDENCE");
      }

      // Protected-risk rederivation at effect boundary (REQ-DAVR-SEC-03 / FD-03).
      try {
        const boundAuthority = bindProtectedRiskAuthority(
          input.protectedRiskAuthority,
          batch,
          manifest,
          disposition.classificationPolicyVersion,
          { required: true },
        )!;
        for (const id of projection.selectedFindingIds) {
          const finding = manifest.findings.find((f) => f.findingId === id);
          if (!finding) {
            codes.push("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
            continue;
          }
          if (deriveProtectedRiskV1(finding, boundAuthority) !== "none") {
            codes.push("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
          }
        }
      } catch {
        codes.push("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
      }

      // Retry identity recompute at effect boundary (REQ-DAVR-MD-03 / RG-05).
      // Non-optional routingPolicyVersion + retryLedger — never skip identity/ledger enforcement.
      const selectedRoutesForIdentity = routing.routes.filter((r) =>
        projection.selectedFindingIds.includes(r.findingId),
      );
      if (selectedRoutesForIdentity.length) {
        const expectedAuthority = buildRetryIdentityAuthorityProjectionV1({
          routingPolicyVersion: input.routingPolicyVersion,
          batch,
          manifest,
          selectedFindingIds: projection.selectedFindingIds,
          destination: selectedRoutesForIdentity[0]!.destination,
          owner: selectedRoutesForIdentity[0]!.owner,
          allowedTargets: derived.allowedTargets,
          requirementIds: derived.requirementIds,
          taskIds: derived.taskIds,
          checkIds: derived.checkIds,
        });
        const expectedIdentity = computeRetryIdentityFromAuthorityV1(expectedAuthority);
        if (projection.retryIdentity !== expectedIdentity) {
          codes.push("RETRY_IDENTITY_MISMATCH");
        }
        const ledgerCheck = validateRetryAttemptAgainstLedgerV1({
          expectedBatchId: batch.batchId,
          expectedBatchDigest: batch.digest,
          retryIdentity: expectedIdentity,
          attemptNumber: projection.attemptNumber,
          priorAttemptDigest: projection.priorAttemptDigest,
          convergenceDossierRevision: projection.convergenceDossierRevision,
          convergenceDossierDigest: projection.convergenceDossierDigest,
          ledger: input.retryLedger,
        });
        if (!ledgerCheck.ok) codes.push(ledgerCheck.code);
      }
    }
  } catch {
    codes.push("DERIVATION_RECOMPUTE_FAILED");
  }

  if (!parseOk || codes.length) {
    return { accepted: false, outcome: "invalid-evidence", rationaleCodes: uniqueSorted(codes) };
  }
  return { accepted: true };
}
