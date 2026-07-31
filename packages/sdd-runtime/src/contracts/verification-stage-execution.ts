import {
  assertDigest,
  assertExactKeys,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  integerValue,
  repositoryPath,
  sha256Digest,
  stringArray,
  stringValue,
  type Sha256Digest,
} from "./canonical";
import type { SafeEvidenceRefV1 } from "./failure-manifest";

export type CheckEffectProfileV1 =
  | { readonly kind: "repository_read_only" }
  | { readonly kind: "isolated_ephemeral"; readonly isolationKey: string; readonly cleanupRequired: true }
  | { readonly kind: "serial_required"; readonly reasonCodes: readonly string[] };

export interface VerificationCheckDescriptorV1 {
  readonly checkId: string;
  readonly capabilityDigest: Sha256Digest;
  readonly commandPlanDigest: Sha256Digest;
  readonly effectProfile: CheckEffectProfileV1;
  readonly dependencyCheckIds: readonly string[];
  readonly exclusiveResourceKeys: readonly string[];
}

export interface VerificationStageExecutionPlanV1 {
  readonly schema: "verification-stage-execution-plan-v1";
  readonly stageRunId: `stage-run:v1:${string}`;
  readonly stage: "targeted" | "affected_area" | "broad";
  readonly qaAuthorityDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly checkSetDigest: Sha256Digest;
  readonly checks: readonly VerificationCheckDescriptorV1[];
  readonly waves: readonly (readonly string[])[];
  readonly digest: Sha256Digest;
}

export type VerificationCheckOutcomeV1 =
  | { readonly kind: "completed"; readonly status: "passed" | "failed"; readonly evidence: readonly SafeEvidenceRefV1[] }
  | { readonly kind: "execution_error"; readonly code: "timeout" | "cancelled" | "crashed" | "invalid_result"; readonly evidence: readonly SafeEvidenceRefV1[] };

export interface VerificationCheckResultV1 {
  readonly schema: "verification-check-result-v1";
  readonly stageRunId: VerificationStageExecutionPlanV1["stageRunId"];
  readonly checkId: string;
  readonly planDigest: Sha256Digest;
  readonly capabilityDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly producerIdentityDigest: Sha256Digest;
  readonly outcome: VerificationCheckOutcomeV1;
  readonly digest: Sha256Digest;
}

export interface VerificationWaveExecutionReceiptV1 {
  readonly schema: "verification-wave-execution-receipt-v1";
  readonly stageRunId: VerificationStageExecutionPlanV1["stageRunId"];
  readonly planDigest: Sha256Digest;
  readonly waveIndex: number;
  readonly checkIds: readonly string[];
  readonly orderedResultDigests: readonly Sha256Digest[];
  readonly previousReceiptDigest?: Sha256Digest;
  readonly executionIdentityDigest: Sha256Digest;
  readonly digest: Sha256Digest;
}

export type VerificationStageExecutionJoinV1 =
  | {
      readonly status: "incomplete";
      readonly missingCheckIds: readonly string[];
      readonly failedCheckIds: readonly string[];
    }
  | {
      readonly schema: "verification-stage-execution-join-v1";
      readonly status: "passed" | "failed";
      readonly stage: VerificationStageExecutionPlanV1["stage"];
      readonly planDigest: Sha256Digest;
      readonly qaAuthorityDigest: Sha256Digest;
      readonly generation: number;
      readonly implementationSubjectDigest: Sha256Digest;
      readonly dependencySetDigest: Sha256Digest;
      readonly checkSetDigest: Sha256Digest;
      readonly orderedResultDigests: readonly Sha256Digest[];
      readonly waveReceiptDigests: readonly Sha256Digest[];
      readonly executionIdentityDigest: Sha256Digest;
      readonly evidenceSetDigest: Sha256Digest;
      readonly rawFailureManifestDigest?: Sha256Digest;
      readonly missingCheckIds: readonly [];
      readonly failedCheckIds: readonly string[];
      readonly digest: Sha256Digest;
    };

const PLAN_KEYS = [
  "schema", "stageRunId", "stage", "qaAuthorityDigest", "generation", "implementationSubjectDigest",
  "dependencySetDigest", "checkSetDigest", "checks", "waves", "digest",
] as const;
const CHECK_KEYS = [
  "checkId", "capabilityDigest", "commandPlanDigest", "effectProfile", "dependencyCheckIds", "exclusiveResourceKeys",
] as const;
const RESULT_KEYS = [
  "schema", "stageRunId", "checkId", "planDigest", "capabilityDigest", "generation",
  "implementationSubjectDigest", "dependencySetDigest", "producerIdentityDigest", "outcome", "digest",
] as const;
const WAVE_RECEIPT_KEYS = [
  "schema", "stageRunId", "planDigest", "waveIndex", "checkIds", "orderedResultDigests",
  "previousReceiptDigest", "executionIdentityDigest", "digest",
] as const;
const JOIN_KEYS = [
  "schema", "status", "stage", "planDigest", "qaAuthorityDigest", "generation", "implementationSubjectDigest", "dependencySetDigest", "checkSetDigest", "orderedResultDigests", "waveReceiptDigests", "executionIdentityDigest",
  "evidenceSetDigest", "rawFailureManifestDigest", "missingCheckIds", "failedCheckIds", "digest",
] as const;

function profile(value: unknown): CheckEffectProfileV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "serial_required", reasonCodes: ["UNKNOWN_EFFECT"] };
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === "repository_read_only") {
    assertExactKeys(raw, ["kind"], "effect profile");
    return { kind: "repository_read_only" };
  }
  if (raw.kind === "isolated_ephemeral") {
    assertExactKeys(raw, ["kind", "isolationKey", "cleanupRequired"], "effect profile");
    if (raw.cleanupRequired !== true) throw new Error("CHECK_EFFECT_PROFILE_INVALID");
    return { kind: "isolated_ephemeral", isolationKey: codeValue(raw.isolationKey, "isolationKey"), cleanupRequired: true };
  }
  if (raw.kind === "serial_required") {
    assertExactKeys(raw, ["kind", "reasonCodes"], "effect profile");
    return { kind: "serial_required", reasonCodes: stringArray(raw.reasonCodes, "reasonCodes", true) };
  }
  return { kind: "serial_required", reasonCodes: ["UNKNOWN_EFFECT"] };
}

function descriptor(value: unknown): VerificationCheckDescriptorV1 {
  assertExactKeys(value, CHECK_KEYS, "verification check");
  const raw = value as Record<string, unknown>;
  assertDigest(raw.capabilityDigest, "capabilityDigest");
  assertDigest(raw.commandPlanDigest, "commandPlanDigest");
  return {
    checkId: codeValue(raw.checkId, "checkId"),
    capabilityDigest: raw.capabilityDigest,
    commandPlanDigest: raw.commandPlanDigest,
    effectProfile: profile(raw.effectProfile),
    dependencyCheckIds: stringArray(raw.dependencyCheckIds, "dependencyCheckIds", true),
    exclusiveResourceKeys: stringArray(raw.exclusiveResourceKeys, "exclusiveResourceKeys", true),
  };
}

function waves(checks: readonly VerificationCheckDescriptorV1[]): readonly (readonly string[])[] {
  const remaining = new Map(checks.map((check) => [check.checkId, check]));
  const done = new Set<string>();
  const result: string[][] = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((check) => check.dependencyCheckIds.every((id) => done.has(id)))
      .sort((a, b) => a.checkId.localeCompare(b.checkId));
    if (!ready.length) throw new Error("CHECK_DEPENDENCY_CYCLE");
    const serial = ready.find((check) => check.effectProfile.kind === "serial_required");
    const claimedIsolationKeys = new Set<string>();
    const claimedResourceKeys = new Set<string>();
    const parallel = serial ? [serial] : ready.filter((check) => {
      const effect = check.effectProfile;
      if (effect.kind === "isolated_ephemeral" && claimedIsolationKeys.has(effect.isolationKey)) return false;
      if (check.exclusiveResourceKeys.some((key) => claimedResourceKeys.has(key))) return false;
      if (effect.kind === "isolated_ephemeral") claimedIsolationKeys.add(effect.isolationKey);
      check.exclusiveResourceKeys.forEach((key) => claimedResourceKeys.add(key));
      return true;
    });
    result.push(parallel.map((check) => check.checkId));
    for (const check of parallel) {
      remaining.delete(check.checkId);
      done.add(check.checkId);
    }
  }
  return result;
}

function normalizePlanInput(input: Omit<VerificationStageExecutionPlanV1, "schema" | "stageRunId" | "checkSetDigest" | "waves" | "digest">) {
  const checks = [...input.checks].map(descriptor).sort((a, b) => a.checkId.localeCompare(b.checkId));
  if (!checks.length || new Set(checks.map((check) => check.checkId)).size !== checks.length) throw new Error("CHECK_SET_INVALID");
  const checkIds = new Set(checks.map((check) => check.checkId));
  for (const check of checks) {
    if (check.dependencyCheckIds.some((id) => !checkIds.has(id) || id === check.checkId)) throw new Error("CHECK_DEPENDENCY_INVALID");
  }
  const payload = {
    schema: "verification-stage-execution-plan-v1" as const,
    stage: enumValue(input.stage, ["targeted", "affected_area", "broad"] as const, "stage"),
    qaAuthorityDigest: input.qaAuthorityDigest,
    generation: integerValue(input.generation, "generation", 0),
    implementationSubjectDigest: input.implementationSubjectDigest,
    dependencySetDigest: input.dependencySetDigest,
    checkSetDigest: sha256Digest(checks),
    checks,
    waves: waves(checks),
  };
  for (const value of [payload.qaAuthorityDigest, payload.implementationSubjectDigest, payload.dependencySetDigest]) assertDigest(value, "plan digest");
  return payload;
}

export function buildVerificationStageExecutionPlanV1(
  input: Omit<VerificationStageExecutionPlanV1, "schema" | "stageRunId" | "checkSetDigest" | "waves" | "digest">,
): VerificationStageExecutionPlanV1 {
  const base = normalizePlanInput(input);
  const stageRunId = `stage-run:v1:${sha256Digest(base).slice(7, 39)}` as const;
  const payload = { ...base, stageRunId };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as VerificationStageExecutionPlanV1;
}

export function parseVerificationStageExecutionPlanV1(value: unknown): VerificationStageExecutionPlanV1 {
  assertExactKeys(value, PLAN_KEYS, "verification stage execution plan");
  const raw = value as unknown as VerificationStageExecutionPlanV1;
  if (raw.schema !== "verification-stage-execution-plan-v1") throw new Error("unsupported-contract-version");
  const rebuilt = buildVerificationStageExecutionPlanV1({
    stage: raw.stage,
    qaAuthorityDigest: raw.qaAuthorityDigest,
    generation: raw.generation,
    implementationSubjectDigest: raw.implementationSubjectDigest,
    dependencySetDigest: raw.dependencySetDigest,
    checks: raw.checks,
  });
  if (raw.stageRunId !== rebuilt.stageRunId || raw.checkSetDigest !== rebuilt.checkSetDigest || raw.digest !== rebuilt.digest || JSON.stringify(raw.waves) !== JSON.stringify(rebuilt.waves)) {
    throw new Error("CHECK_PLAN_INVALID");
  }
  return rebuilt;
}

function evidence(value: unknown): SafeEvidenceRefV1[] {
  return denseArray(value, "checkResult.evidence").map((item, index) => {
    assertExactKeys(item, ["kind", "checkId", "artifact", "excerpt", "resultCode"], `checkResult.evidence[${index}]`);
    return {
      kind: codeValue(item.kind, `checkResult.evidence[${index}].kind`),
      checkId: codeValue(item.checkId, `checkResult.evidence[${index}].checkId`),
      artifact: repositoryPath(item.artifact, { repositoryRoot: "." }, `checkResult.evidence[${index}].artifact`),
      ...(item.excerpt === undefined ? {} : { excerpt: stringValue(item.excerpt, `checkResult.evidence[${index}].excerpt`, 1024) }),
      ...(item.resultCode === undefined ? {} : { resultCode: codeValue(item.resultCode, `checkResult.evidence[${index}].resultCode`) }),
    };
  }).sort((a, b) => sha256Digest(a).localeCompare(sha256Digest(b)));
}

function outcome(value: unknown): VerificationCheckOutcomeV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("CHECK_RESULT_INVALID");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "completed") {
    assertExactKeys(raw, ["kind", "status", "evidence"], "check result outcome");
    return { kind: "completed", status: enumValue(raw.status, ["passed", "failed"] as const, "check result status"), evidence: evidence(raw.evidence) };
  }
  assertExactKeys(raw, ["kind", "code", "evidence"], "check result outcome");
  if (raw.kind !== "execution_error") throw new Error("CHECK_RESULT_INVALID");
  return { kind: "execution_error", code: enumValue(raw.code, ["timeout", "cancelled", "crashed", "invalid_result"] as const, "check result code"), evidence: evidence(raw.evidence) };
}

export function buildVerificationCheckResultV1(
  planValue: VerificationStageExecutionPlanV1,
  input: { readonly checkId: string; readonly producerIdentityDigest: Sha256Digest; readonly outcome: VerificationCheckOutcomeV1 },
): VerificationCheckResultV1 {
  const plan = parseVerificationStageExecutionPlanV1(planValue);
  const checkId = codeValue(input.checkId, "checkResult.checkId");
  const check = plan.checks.find((entry) => entry.checkId === checkId);
  if (!check) throw new Error("CHECK_RESULT_INVALID");
  assertDigest(input.producerIdentityDigest, "checkResult.producerIdentityDigest");
  const normalizedOutcome = outcome(input.outcome);
  if (normalizedOutcome.evidence.some((entry) => entry.checkId !== checkId)) throw new Error("CHECK_RESULT_INVALID");
  const payload = {
    schema: "verification-check-result-v1" as const,
    stageRunId: plan.stageRunId,
    checkId,
    planDigest: plan.digest,
    capabilityDigest: check.capabilityDigest,
    generation: plan.generation,
    implementationSubjectDigest: plan.implementationSubjectDigest,
    dependencySetDigest: plan.dependencySetDigest,
    producerIdentityDigest: input.producerIdentityDigest,
    outcome: normalizedOutcome,
  };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as VerificationCheckResultV1;
}

export function parseVerificationCheckResultV1(value: unknown, planValue: VerificationStageExecutionPlanV1): VerificationCheckResultV1 {
  assertExactKeys(value, RESULT_KEYS, "verification check result");
  const raw = value as unknown as VerificationCheckResultV1;
  if (raw.schema !== "verification-check-result-v1") throw new Error("CHECK_RESULT_INVALID");
  const rebuilt = buildVerificationCheckResultV1(planValue, {
    checkId: raw.checkId,
    producerIdentityDigest: raw.producerIdentityDigest,
    outcome: raw.outcome,
  });
  if (
    raw.stageRunId !== rebuilt.stageRunId || raw.planDigest !== rebuilt.planDigest ||
    raw.capabilityDigest !== rebuilt.capabilityDigest || raw.generation !== rebuilt.generation ||
    raw.implementationSubjectDigest !== rebuilt.implementationSubjectDigest ||
    raw.dependencySetDigest !== rebuilt.dependencySetDigest || raw.digest !== rebuilt.digest
  ) throw new Error("CHECK_RESULT_INVALID");
  return rebuilt;
}

export function parseVerificationWaveExecutionReceiptV1(
  value: unknown,
  planValue: VerificationStageExecutionPlanV1,
  previous?: VerificationWaveExecutionReceiptV1,
): VerificationWaveExecutionReceiptV1 {
  const plan = parseVerificationStageExecutionPlanV1(planValue);
  assertExactKeys(value, WAVE_RECEIPT_KEYS, "verification wave execution receipt");
  const raw = value as unknown as VerificationWaveExecutionReceiptV1;
  if (raw.schema !== "verification-wave-execution-receipt-v1") throw new Error("unsupported-contract-version");
  const waveIndex = integerValue(raw.waveIndex, "waveReceipt.waveIndex", 0);
  const expectedCheckIds = plan.waves[waveIndex];
  if (
    expectedCheckIds === undefined || raw.stageRunId !== plan.stageRunId || raw.planDigest !== plan.digest ||
    JSON.stringify(raw.checkIds) !== JSON.stringify(expectedCheckIds) ||
    (waveIndex === 0 ? raw.previousReceiptDigest !== undefined : previous?.waveIndex !== waveIndex - 1 || raw.previousReceiptDigest !== previous.digest)
  ) throw new Error("WAVE_EXECUTION_RECEIPT_INVALID");
  const orderedResultDigests = [...raw.orderedResultDigests];
  if (orderedResultDigests.length !== expectedCheckIds.length) throw new Error("WAVE_EXECUTION_RECEIPT_INVALID");
  orderedResultDigests.forEach((digest) => assertDigest(digest, "waveReceipt.resultDigest"));
  assertDigest(raw.executionIdentityDigest, "waveReceipt.executionIdentityDigest");
  const payload = {
    schema: raw.schema,
    stageRunId: plan.stageRunId,
    planDigest: plan.digest,
    waveIndex,
    checkIds: [...expectedCheckIds],
    orderedResultDigests,
    ...(previous === undefined ? {} : { previousReceiptDigest: previous.digest }),
    executionIdentityDigest: raw.executionIdentityDigest,
  };
  if (raw.digest !== sha256Digest(payload)) throw new Error("WAVE_EXECUTION_RECEIPT_INVALID");
  return deepFreeze({ ...payload, digest: raw.digest });
}

export function buildVerificationWaveExecutionReceiptsV1(
  planValue: VerificationStageExecutionPlanV1,
  results: readonly VerificationCheckResultV1[],
  executionIdentityDigest: Sha256Digest,
): readonly VerificationWaveExecutionReceiptV1[] {
  const plan = parseVerificationStageExecutionPlanV1(planValue);
  assertDigest(executionIdentityDigest, "waveReceipt.executionIdentityDigest");
  const observed = new Map(results.map((result) => {
    const parsed = parseVerificationCheckResultV1(result, plan);
    return [parsed.checkId, parsed] as const;
  }));
  if (observed.size !== results.length || observed.size !== plan.checks.length) throw new Error("WAVE_EXECUTION_RECEIPTS_REQUIRED");
  const receipts: VerificationWaveExecutionReceiptV1[] = [];
  for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex += 1) {
    const checkIds = plan.waves[waveIndex]!;
    const orderedResultDigests = checkIds.map((checkId) => {
      const result = observed.get(checkId);
      if (!result) throw new Error("WAVE_EXECUTION_RECEIPTS_REQUIRED");
      return result.digest;
    });
    const previous = receipts[waveIndex - 1];
    const payload = {
      schema: "verification-wave-execution-receipt-v1" as const,
      stageRunId: plan.stageRunId,
      planDigest: plan.digest,
      waveIndex,
      checkIds: [...checkIds],
      orderedResultDigests,
      ...(previous === undefined ? {} : { previousReceiptDigest: previous.digest }),
      executionIdentityDigest,
    };
    receipts.push(deepFreeze({ ...payload, digest: sha256Digest(payload) }));
  }
  return deepFreeze(receipts);
}

export function parseVerificationStageExecutionJoinV1(value: unknown): Exclude<VerificationStageExecutionJoinV1, { status: "incomplete" }> {
  assertExactKeys(value, JOIN_KEYS, "verification stage execution join");
  const raw = value as Exclude<VerificationStageExecutionJoinV1, { status: "incomplete" }>;
  if (raw.schema !== "verification-stage-execution-join-v1") throw new Error("unsupported-contract-version");
  const status = enumValue(raw.status, ["passed", "failed"] as const, "join.status");
  const stage = enumValue(raw.stage, ["targeted", "affected_area", "broad"] as const, "join.stage");
  const generation = integerValue(raw.generation, "join.generation", 0);
  const orderedResultDigests = [...raw.orderedResultDigests];
  const waveReceiptDigests = [...raw.waveReceiptDigests];
  const failedCheckIds = stringArray(raw.failedCheckIds, "join.failedCheckIds", true);
  if (!Array.isArray(raw.missingCheckIds) || raw.missingCheckIds.length !== 0 || orderedResultDigests.length === 0 || waveReceiptDigests.length === 0) {
    throw new Error("CHECK_RESULT_INVALID");
  }
  for (const digest of [raw.planDigest, raw.qaAuthorityDigest, raw.implementationSubjectDigest, raw.dependencySetDigest, raw.checkSetDigest, ...orderedResultDigests, ...waveReceiptDigests, raw.executionIdentityDigest, raw.evidenceSetDigest]) {
    assertDigest(digest, "join.digest");
  }
  if (raw.rawFailureManifestDigest !== undefined) assertDigest(raw.rawFailureManifestDigest, "join.rawFailureManifestDigest");
  if ((status === "passed") !== (failedCheckIds.length === 0)) throw new Error("CHECK_RESULT_INVALID");
  const payload = {
    schema: raw.schema,
    status,
    stage,
    planDigest: raw.planDigest,
    qaAuthorityDigest: raw.qaAuthorityDigest,
    generation,
    implementationSubjectDigest: raw.implementationSubjectDigest,
    dependencySetDigest: raw.dependencySetDigest,
    checkSetDigest: raw.checkSetDigest,
    orderedResultDigests,
    waveReceiptDigests,
    executionIdentityDigest: raw.executionIdentityDigest,
    evidenceSetDigest: raw.evidenceSetDigest,
    ...(raw.rawFailureManifestDigest === undefined ? {} : { rawFailureManifestDigest: raw.rawFailureManifestDigest }),
    missingCheckIds: [] as const,
    failedCheckIds,
  };
  if (raw.digest !== sha256Digest(payload)) throw new Error("CHECK_RESULT_INVALID");
  return deepFreeze({ ...payload, digest: raw.digest });
}

export function joinVerificationStageExecutionV1(
  planValue: VerificationStageExecutionPlanV1,
  results: readonly VerificationCheckResultV1[],
  rawFailureManifestDigest?: Sha256Digest,
  waveReceipts?: readonly VerificationWaveExecutionReceiptV1[],
  executionIdentityDigest?: Sha256Digest,
): VerificationStageExecutionJoinV1 {
  const plan = parseVerificationStageExecutionPlanV1(planValue);
  const expected = new Set(plan.checks.map((check) => check.checkId));
  const observed = new Map<string, VerificationCheckResultV1>();
  for (const rawResult of results) {
    const result = parseVerificationCheckResultV1(rawResult, plan);
    if (!expected.has(result.checkId) || observed.has(result.checkId)) throw new Error("CHECK_RESULT_INVALID");
    observed.set(result.checkId, result);
  }
  const missingCheckIds = [...expected].filter((id) => !observed.has(id));
  const failedCheckIds = [...observed.values()]
    .filter((result) => result.outcome.kind === "execution_error" || result.outcome.status === "failed")
    .map((result) => result.checkId)
    .sort();
  if (missingCheckIds.length) return deepFreeze({ status: "incomplete" as const, missingCheckIds, failedCheckIds });
  if (waveReceipts === undefined || executionIdentityDigest === undefined) throw new Error("WAVE_EXECUTION_RECEIPTS_REQUIRED");
  const expectedWaveReceipts = buildVerificationWaveExecutionReceiptsV1(plan, [...observed.values()], executionIdentityDigest);
  if (
    waveReceipts.length !== expectedWaveReceipts.length ||
    waveReceipts.some((receipt, index) => {
      const previous = index === 0 ? undefined : expectedWaveReceipts[index - 1];
      const parsed = parseVerificationWaveExecutionReceiptV1(receipt, plan, previous);
      return parsed.executionIdentityDigest !== executionIdentityDigest || parsed.digest !== expectedWaveReceipts[index]!.digest;
    })
  ) throw new Error("WAVE_EXECUTION_RECEIPT_INVALID");
  if (plan.stage === "broad" && rawFailureManifestDigest === undefined) throw new Error("BROAD_FAILURE_MANIFEST_REQUIRED");
  if (plan.stage !== "broad" && rawFailureManifestDigest !== undefined) throw new Error("CHECK_RESULT_INVALID");
  if (rawFailureManifestDigest !== undefined) assertDigest(rawFailureManifestDigest, "join.rawFailureManifestDigest");
  const ordered = plan.checks.map((check) => observed.get(check.checkId)!);
  const joinedEvidence = ordered
    .flatMap((result) => result.outcome.evidence)
    .sort((a, b) => sha256Digest(a).localeCompare(sha256Digest(b)));
  const payload = {
    schema: "verification-stage-execution-join-v1" as const,
    status: failedCheckIds.length ? "failed" as const : "passed" as const,
    stage: plan.stage,
    planDigest: plan.digest,
    qaAuthorityDigest: plan.qaAuthorityDigest,
    generation: plan.generation,
    implementationSubjectDigest: plan.implementationSubjectDigest,
    dependencySetDigest: plan.dependencySetDigest,
    checkSetDigest: plan.checkSetDigest,
    orderedResultDigests: ordered.map((result) => result.digest),
    waveReceiptDigests: expectedWaveReceipts.map((receipt) => receipt.digest),
    executionIdentityDigest,
    evidenceSetDigest: sha256Digest(joinedEvidence),
    ...(rawFailureManifestDigest === undefined ? {} : { rawFailureManifestDigest }),
    missingCheckIds: [] as const,
    failedCheckIds,
  };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) });
}
