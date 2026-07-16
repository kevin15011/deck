import type { ApplyBatchContractV1 } from "./apply-batch";
import { assertBatchReferenceV1, parseApplyBatchContractV1 } from "./apply-batch";
import { assertDigest, assertExactKeys, assertId, cloneCanonical, deepFreeze, integerValue, sha256Digest, type Sha256Digest } from "./canonical";
import type { CausalContextInputV1, CausalContextV1 } from "./causal-context";
import type { ExecutionDecisionV1 } from "./execution-decision";
import type { FailureDeltaV1 } from "./failure-delta";
import type { FailureManifestV1 } from "./failure-manifest";
import type { AuthorizationReferenceV1 } from "./invocation-authorization";
import type { LaneDecisionInputV1, LaneDecisionV1 } from "./execution-lane";
import type { RegistryIntentV1 } from "./registry-intent";
import type { StagedVerificationStateInputV1, StagedVerificationStateV1 } from "./verification-state";
import { parseExecutionDecisionV1 } from "./execution-decision";
import { buildLaneDecisionV1, parseLaneDecisionV1 } from "./execution-lane";
import { buildStagedVerificationStateV1, parseStagedVerificationStateV1 } from "./verification-state";
import { buildCausalContextV1, parseCausalContextV1 } from "./causal-context";
import { parseFailureManifestV1 } from "./failure-manifest";
import { parseFailureDeltaV1 } from "./failure-delta";
import { parseAuthorizationReferenceV1 } from "./invocation-authorization";
import { parseRegistryIntentV1 } from "./registry-intent";

export interface ExecutionDossierV1 { schema: "execution-dossier-v1"; dossierId: `dossier:v1:${string}`; digest: Sha256Digest; revision: number; previousDigest?: Sha256Digest; batch: ApplyBatchContractV1; priorManifest?: FailureManifestV1; currentManifest?: FailureManifestV1; delta?: FailureDeltaV1; decision?: ExecutionDecisionV1; lane: LaneDecisionV1; verification: StagedVerificationStateV1; causalContext: CausalContextV1; authorizationRef?: AuthorizationReferenceV1; registryIntents: readonly RegistryIntentV1[] }
export interface ExecutionDossierInputV1 extends Omit<ExecutionDossierV1, "dossierId" | "digest" | "revision" | "previousDigest" | "lane" | "verification" | "causalContext"> { lane: LaneDecisionInputV1 | LaneDecisionV1; verification: StagedVerificationStateInputV1 | StagedVerificationStateV1; causalContext: CausalContextInputV1 | CausalContextV1 }

function validate(input: ExecutionDossierInputV1): void {
  if (input.schema !== "execution-dossier-v1") throw new Error("unsupported-contract-version");
  for (const manifest of [input.priorManifest, input.currentManifest]) if (manifest) assertBatchReferenceV1(manifest, input.batch);
  if (input.verification.batchId !== input.batch.batchId || input.causalContext.batchDigest !== input.batch.digest) throw new Error("batch-reference-mismatch");
  if (input.delta && input.currentManifest && input.delta.currentManifestDigest !== input.currentManifest.digest) throw new Error("invalid-evidence: delta reference");
  if (input.delta && input.priorManifest && input.delta.previousManifestDigest !== input.priorManifest.digest) throw new Error("invalid-evidence: delta reference");
  if (input.delta && !input.priorManifest && input.delta.previousManifestDigest !== undefined) throw new Error("invalid-evidence: delta reference");
  if (input.delta && !input.currentManifest || input.priorManifest && !input.delta || input.decision && (!input.currentManifest || !input.delta)) throw new Error("invalid-evidence: incomplete delta chain");
  if (input.decision) {
    const decision = parseExecutionDecisionV1(input.decision);
    if (decision.batchId !== input.batch.batchId) throw new Error("batch-reference-mismatch");
  }
  if (input.authorizationRef && (input.authorizationRef.validation !== "accepted" || input.authorizationRef.claimsDigest !== input.batch.authorizationGrantRef)) throw new Error("batch-reference-mismatch");
  const intentIds=new Set<string>(),keys=new Set<string>();
  for (const intent of input.registryIntents) {
    if (intent.changeId !== input.batch.changeId || intent.batchId !== input.batch.batchId || intent.batchDigest !== input.batch.digest) throw new Error("batch-reference-mismatch");
    if (input.decision ? intent.decisionDigest !== input.decision.digest : intent.decisionDigest !== undefined) throw new Error("invalid-evidence: decision intent reference");
    if(intentIds.has(intent.intentId)||keys.has(intent.idempotencyKey))throw new Error("invalid-evidence: duplicate registry intent");intentIds.add(intent.intentId);keys.add(intent.idempotencyKey);
  }
  const active=new Set(input.currentManifest?.findings.filter(f=>f.status==="open").map(f=>f.findingId)??[]);if(input.causalContext.activeFindingIds.some(id=>!active.has(id)))throw new Error("invalid-evidence: causal active finding");
}
function issue(input: ExecutionDossierInputV1, revision: number, previous?: ExecutionDossierV1): ExecutionDossierV1 {
  parseApplyBatchContractV1(input.batch);
  if (input.priorManifest) parseFailureManifestV1(input.priorManifest, input.batch);
  if (input.currentManifest) parseFailureManifestV1(input.currentManifest, input.batch);
  if (input.delta) {
    if (!input.currentManifest) throw new Error("invalid-evidence: incomplete delta chain");
    parseFailureDeltaV1(input.delta, input.priorManifest, input.currentManifest);
  }
  if (input.decision) parseExecutionDecisionV1(input.decision);
  if (input.authorizationRef) parseAuthorizationReferenceV1(input.authorizationRef);
  input.registryIntents.forEach(parseRegistryIntentV1);
  validate(input);
  const lane = "digest" in input.lane ? parseLaneDecisionV1(input.lane) : buildLaneDecisionV1(input.lane);
  const verification = "digest" in input.verification ? parseStagedVerificationStateV1(input.verification) : buildStagedVerificationStateV1(input.verification);
  const causalContext = "digest" in input.causalContext ? parseCausalContextV1(input.causalContext) : buildCausalContextV1(input.causalContext);
  const payload = cloneCanonical({ ...input, revision, ...(previous ? { previousDigest:previous.digest } : {}), lane, verification, causalContext });
  const digest = sha256Digest(payload);
  return deepFreeze({ ...payload, dossierId: previous?.dossierId??`dossier:v1:${digest.slice(7,39)}`, digest }) as ExecutionDossierV1;
}
export function createExecutionDossierV1(input: ExecutionDossierInputV1): ExecutionDossierV1 { return issue(input, 1); }
export function reviseExecutionDossierV1(
  previous: ExecutionDossierV1,
  changes: Partial<Omit<ExecutionDossierInputV1, "schema" | "batch">>,
  history: readonly ExecutionDossierV1[] = [],
): ExecutionDossierV1 {
  // B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1: the caller's history always
  // includes `previous` itself (e.g. revise(d2, ..., [d1, d2])).  parseExecutionDossierV1
  // expects only predecessors in the history chain.  Slice history when its length
  // exceeds the expected predecessor count (revision - 1); pass as-is otherwise.
  const expectedPredecessorCount = previous.revision - 1;
  const historyForPrevious = history.length > expectedPredecessorCount
    ? history.slice(0, expectedPredecessorCount)
    : history;
  const validatedPrevious = parseExecutionDossierV1(previous, historyForPrevious);
  const { dossierId: _id, digest: _digest, revision: _revision, previousDigest: _previous, ...base } = validatedPrevious;
  const input = {
    ...base,
    ...changes,
    ...(changes.currentManifest && changes.currentManifest.digest !== validatedPrevious.currentManifest?.digest
      ? { priorManifest: validatedPrevious.currentManifest }
      : {}),
    schema: "execution-dossier-v1" as const,
    batch: validatedPrevious.batch,
  };
  const next = issue(input, validatedPrevious.revision + 1, validatedPrevious);
  // B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1: require length >= previous
  // before prefix comparison to prevent silent truncation.
  const prevIntents = validatedPrevious.registryIntents;
  if (next.registryIntents.length < prevIntents.length) {
    throw new Error("invalid-evidence: registry intent prefix");
  }
  if (next.registryIntents.slice(0, prevIntents.length).some((intent, index) => intent.digest !== prevIntents[index]!.digest)) {
    throw new Error("invalid-evidence: registry intent prefix");
  }
  const prevDecisions = validatedPrevious.causalContext.priorDecisionDigests;
  if (next.causalContext.priorDecisionDigests.length < prevDecisions.length) {
    throw new Error("invalid-evidence: decision digest prefix");
  }
  if (next.causalContext.priorDecisionDigests.slice(0, prevDecisions.length).some((digest, index) => digest !== prevDecisions[index])) {
    throw new Error("invalid-evidence: decision digest prefix");
  }
  // B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1: compare raw input digests
  // against previous state before build/normalization.  Silently accepting a
  // reorder (e.g. [A,B] → [B,A]) at depth 3+ violates the append-only contract.
  // Only check when length >= previous (truncation/mutation caught above).
  if (changes.causalContext && next.causalContext.priorDecisionDigests.length >= prevDecisions.length) {
    const rawDigests: readonly string[] = "priorDecisionDigests" in changes.causalContext
      ? (changes.causalContext as { priorDecisionDigests?: readonly string[] }).priorDecisionDigests ?? []
      : [];
    if (rawDigests.length >= prevDecisions.length) {
      const prevRaw = validatedPrevious.causalContext.priorDecisionDigests;
      if (!rawDigests.slice(0, prevRaw.length).every((d, i) => d === prevRaw[i])) {
        throw new Error("invalid-evidence: decision digest order");
      }
    }
  }
  return next;
}
type ExecutionDossierHistoryV1 = ExecutionDossierV1 | readonly ExecutionDossierV1[];

function parseDossierRevisionV1(value: unknown, previous?: ExecutionDossierV1): ExecutionDossierV1 {
  assertExactKeys(value, ["schema","dossierId","digest","revision","previousDigest","batch","priorManifest","currentManifest","delta","decision","lane","verification","causalContext","authorizationRef","registryIntents"], "dossier");
  const dossier = value as unknown as ExecutionDossierV1;
  if (dossier.schema !== "execution-dossier-v1") throw new Error("unsupported-contract-version");
  assertDigest(dossier.digest, "dossier.digest");
  assertId(dossier.dossierId, "dossier:v1:", "dossier.dossierId");
  integerValue(dossier.revision, "dossier.revision", 1);
  if (dossier.previousDigest !== undefined) assertDigest(dossier.previousDigest, "dossier.previousDigest");
  const { dossierId, digest, revision, previousDigest, ...input } = dossier;
  parseApplyNested(input);
  validate(input);
  const payload = cloneCanonical({ ...input, revision, ...(previousDigest ? { previousDigest } : {}) });
  const expected = sha256Digest(payload);
  if (revision === 1 && (previousDigest !== undefined || previous)) throw new Error("invalid-evidence: dossier revision");
  if (revision > 1 && (!previous || revision !== previous.revision + 1 || previousDigest !== previous.digest || dossierId !== previous.dossierId)) {
    throw new Error("invalid-evidence: dossier revision");
  }
  if (previous) {
    if (input.batch.batchId !== previous.batch.batchId || input.batch.digest !== previous.batch.digest) throw new Error("batch-reference-mismatch");
    // B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1: require length >= previous
    // before prefix comparison to prevent silent truncation in parsing.
    const prevIntents = previous.registryIntents;
    if (input.registryIntents.length < prevIntents.length) throw new Error("invalid-evidence: registry intent prefix");
    if (input.registryIntents.slice(0, prevIntents.length).some((intent, index) => intent.digest !== prevIntents[index]!.digest)) throw new Error("invalid-evidence: registry intent prefix");
    const prevDecisions = previous.causalContext.priorDecisionDigests;
    if (input.causalContext.priorDecisionDigests.length < prevDecisions.length) throw new Error("invalid-evidence: decision digest prefix");
    if (input.causalContext.priorDecisionDigests.slice(0, prevDecisions.length).some((item, index) => item !== prevDecisions[index])) throw new Error("invalid-evidence: decision digest prefix");
    // B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1: after length/prefix checks,
    // additionally reject wire dossiers that present a reordered prior-decision
    // prefix.  Truncation/mutation are already caught above; this guards only
    // the reorder case.
    if (input.causalContext.priorDecisionDigests.length >= prevDecisions.length &&
        prevDecisions.length > 0 &&
        !input.causalContext.priorDecisionDigests.slice(0, prevDecisions.length).every((d, i) => d === prevDecisions[i])) {
      throw new Error("invalid-evidence: decision digest order");
    }
    if (previous.currentManifest && input.currentManifest?.digest !== previous.currentManifest.digest && input.priorManifest?.digest !== previous.currentManifest.digest) throw new Error("invalid-evidence: dossier manifest revision");
  }
  if (digest !== expected || (revision === 1 && dossierId !== `dossier:v1:${expected.slice(7,39)}`)) throw new Error("invalid-evidence: dossier digest");
  return deepFreeze(cloneCanonical(dossier)) as ExecutionDossierV1;
}

export function parseExecutionDossierV1(value: unknown, history?: ExecutionDossierHistoryV1): ExecutionDossierV1 {
  assertExactKeys(value, ["schema","dossierId","digest","revision","previousDigest","batch","priorManifest","currentManifest","delta","decision","lane","verification","causalContext","authorizationRef","registryIntents"], "dossier");
  const revision = typeof value === "object" && value !== null ? (value as { revision?: unknown }).revision : undefined;
  const predecessors = history === undefined ? [] : Array.isArray(history) ? [...history] : [history];
  if (revision !== 1 && history === undefined) throw new Error("invalid-evidence: dossier revision");
  if (revision !== 1 && (!Number.isSafeInteger(revision) || predecessors.length !== Number(revision) - 1)) {
    throw new Error("invalid-evidence: dossier revision history");
  }
  if (revision === 1 && predecessors.length > 0) throw new Error("invalid-evidence: dossier revision");

  let previous: ExecutionDossierV1 | undefined;
  for (let index = 0; index < predecessors.length; index++) {
    const candidate = predecessors[index]!;
    if (candidate.revision !== index + 1) throw new Error("invalid-evidence: dossier revision history");
    previous = parseDossierRevisionV1(candidate, previous);
  }
  return parseDossierRevisionV1(value, previous);
}

function parseApplyNested(input: ExecutionDossierInputV1): void {
  parseApplyBatchContractV1(input.batch);
  if (input.priorManifest) parseFailureManifestV1(input.priorManifest, input.batch);
  if (input.currentManifest) parseFailureManifestV1(input.currentManifest, input.batch);
  if (input.delta) {
    if (!input.currentManifest) throw new Error("invalid-evidence: incomplete delta chain");
    parseFailureDeltaV1(input.delta, input.priorManifest, input.currentManifest);
  }
  if (input.decision) parseExecutionDecisionV1(input.decision);
  parseLaneDecisionV1(input.lane);
  parseStagedVerificationStateV1(input.verification);
  parseCausalContextV1(input.causalContext);
  if (input.authorizationRef) parseAuthorizationReferenceV1(input.authorizationRef);
  input.registryIntents.forEach(parseRegistryIntentV1);
}
