import { assertDigest, assertPlainRecord, deepFreeze, sha256Digest, type Sha256Digest } from "../contracts/canonical";
import {
  buildVerificationCheckResultV1,
  joinVerificationStageExecutionV1,
  parseVerificationCheckResultV1,
  parseVerificationStageExecutionPlanV1,
  parseVerificationWaveExecutionReceiptV1,
  type VerificationCheckDescriptorV1,
  type VerificationCheckResultV1,
  type VerificationStageExecutionJoinV1,
  type VerificationStageExecutionPlanV1,
  type VerificationWaveExecutionReceiptV1,
} from "../contracts/verification-stage-execution";

/** Boundary adapter for one authority-bound check; its result is always untrusted. */
export interface VerificationCheckExecutorPortV1 {
  execute(
    plan: VerificationStageExecutionPlanV1,
    descriptor: VerificationCheckDescriptorV1,
  ): Promise<unknown> | unknown;
}

export interface BroadFailureManifestFinalizerPortV1 {
  finalize(
    plan: VerificationStageExecutionPlanV1,
    results: readonly VerificationCheckResultV1[],
  ): Promise<unknown> | unknown;
}

export interface ExecuteVerificationStageInputV1 {
  readonly plan: unknown;
  readonly executor: VerificationCheckExecutorPortV1;
  readonly executionIdentityDigest: Sha256Digest;
  readonly broadFailureManifestFinalizer?: BroadFailureManifestFinalizerPortV1;
}

export interface VerificationStageExecutionResultV1 {
  readonly results: readonly VerificationCheckResultV1[];
  readonly receipts: readonly VerificationWaveExecutionReceiptV1[];
  readonly failureManifest?: Readonly<Record<string, unknown>>;
  readonly join: VerificationStageExecutionJoinV1;
}

function crashedResult(
  plan: VerificationStageExecutionPlanV1,
  checkId: string,
  producerIdentityDigest: Sha256Digest,
): VerificationCheckResultV1 {
  return buildVerificationCheckResultV1(plan, {
    checkId,
    producerIdentityDigest,
    outcome: { kind: "execution_error", code: "crashed", evidence: [] },
  });
}

function issueReceipt(
  plan: VerificationStageExecutionPlanV1,
  waveIndex: number,
  results: ReadonlyMap<string, VerificationCheckResultV1>,
  executionIdentityDigest: Sha256Digest,
  previous: VerificationWaveExecutionReceiptV1 | undefined,
): VerificationWaveExecutionReceiptV1 {
  const checkIds = plan.waves[waveIndex]!;
  const orderedResultDigests = checkIds.map((checkId) => {
    const result = results.get(checkId);
    if (!result) throw new Error("CHECK_RESULT_INVALID");
    return result.digest;
  });
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
  return parseVerificationWaveExecutionReceiptV1(
    { ...payload, digest: sha256Digest(payload) },
    plan,
    previous,
  );
}

/**
 * Executes only the plan's precomputed waves. A wave's receipt is produced at
 * its barrier, so the later join merely validates execution evidence.
 */
export async function executeVerificationStageV1(
  input: ExecuteVerificationStageInputV1,
): Promise<VerificationStageExecutionResultV1> {
  const plan = parseVerificationStageExecutionPlanV1(input.plan);
  assertDigest(input.executionIdentityDigest, "executionIdentityDigest");
  if (!input.executor || typeof input.executor.execute !== "function") throw new Error("CHECK_EXECUTOR_INVALID");
  if (plan.stage === "broad" && !input.broadFailureManifestFinalizer) throw new Error("BROAD_FAILURE_MANIFEST_REQUIRED");
  if (plan.stage !== "broad" && input.broadFailureManifestFinalizer !== undefined) throw new Error("CHECK_RESULT_INVALID");
  if (input.broadFailureManifestFinalizer && typeof input.broadFailureManifestFinalizer.finalize !== "function") {
    throw new Error("BROAD_FAILURE_MANIFEST_REQUIRED");
  }

  const resultsByCheckId = new Map<string, VerificationCheckResultV1>();
  const receipts: VerificationWaveExecutionReceiptV1[] = [];
  for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex += 1) {
    const checkIds = plan.waves[waveIndex]!;
    const settled = await Promise.all(checkIds.map(async (checkId) => {
      const check = plan.checks.find((candidate) => candidate.checkId === checkId);
      if (!check) throw new Error("CHECK_RESULT_INVALID");
      try {
        return await input.executor.execute(plan, check);
      } catch {
        return crashedResult(plan, checkId, input.executionIdentityDigest);
      }
    }));

    for (let index = 0; index < settled.length; index += 1) {
      const checkId = checkIds[index]!;
      const result = parseVerificationCheckResultV1(settled[index], plan);
      if (result.checkId !== checkId || result.producerIdentityDigest !== input.executionIdentityDigest || resultsByCheckId.has(result.checkId)) {
        throw new Error("CHECK_RESULT_INVALID");
      }
      resultsByCheckId.set(result.checkId, result);
    }
    receipts.push(issueReceipt(plan, waveIndex, resultsByCheckId, input.executionIdentityDigest, receipts[waveIndex - 1]));
  }

  const results = plan.checks.map((check) => {
    const result = resultsByCheckId.get(check.checkId);
    if (!result) throw new Error("CHECK_RESULT_INVALID");
    return result;
  });
  let rawFailureManifestDigest: Sha256Digest | undefined;
  let failureManifest: Readonly<Record<string, unknown>> | undefined;
  if (plan.stage === "broad") {
    try {
      const value = await input.broadFailureManifestFinalizer!.finalize(plan, Object.freeze([...results]));
      assertPlainRecord(value, "failureManifest");
      assertDigest(value.digest, "rawFailureManifestDigest");
      rawFailureManifestDigest = value.digest;
      failureManifest = deepFreeze(value);
    } catch {
      throw new Error("BROAD_FAILURE_MANIFEST_INVALID");
    }
  }
  const join = joinVerificationStageExecutionV1(
    plan,
    results,
    rawFailureManifestDigest,
    receipts,
    input.executionIdentityDigest,
  );
  if (join.status === "incomplete") throw new Error("CHECK_RESULT_INVALID");
  return deepFreeze({ results, receipts, ...(failureManifest === undefined ? {} : { failureManifest }), join });
}
