import {
  assertExactKeys,
  assertPlainRecord,
  deepFreeze,
  enumValue,
  sha256Digest,
  stringValue,
  type Sha256Digest,
} from "../contracts/canonical";
import type { CandidateRefV1 } from "../contracts/qa-authority";
import type { VerificationStageExecutionPlanV1 } from "../contracts/verification-stage-execution";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import {
  executeVerificationStageV1,
  type BroadFailureManifestFinalizerPortV1,
  type VerificationCheckExecutorPortV1,
  type VerificationStageExecutionResultV1,
} from "../orchestrator/verification-stage-executor";
import type { StagedVerificationPolicyV1 } from "../orchestrator/staged-verification";
import {
  consumeExecutionRoleResultV1,
  scheduleExecutionRoleInvocationV1,
  type ExecutionPlanV1,
  type ExecutionRoleInvocationV1,
  type ExecutionRoleResultConsumptionV1,
} from "./execution-control-plane";
import { decideQaNextActionV1 } from "./qa-execution-authority";

export interface QaRunnerHostInvocationRequestV1 {
  readonly runnerId: "opencode" | "pi";
  readonly sessionId: string;
  /** The runner's own call identifier, not the control-plane invocation identifier. */
  readonly invocationId: string;
  readonly requestedRole: "verify" | "review";
}

export interface QaRunnerHostExecutionContextV1 {
  readonly plan: ExecutionPlanV1;
  readonly agentInstanceId: string;
  readonly freshness: FreshnessPolicyInputV1;
  readonly candidate: CandidateRefV1;
  readonly verificationPlan?: VerificationStageExecutionPlanV1;
  readonly verificationPolicy: StagedVerificationPolicyV1;
  readonly verificationCheckExecutor?: VerificationCheckExecutorPortV1;
  readonly broadFailureManifestFinalizer?: BroadFailureManifestFinalizerPortV1;
}

export interface QaRunnerHostInvocationReferenceV1 {
  readonly schema: "qa-runner-host-invocation-reference-v1";
  readonly invocation: ExecutionRoleInvocationV1;
  readonly verificationExecution?: VerificationStageExecutionResultV1;
  readonly digest: Sha256Digest;
}

export interface QaRunnerHostPreparedInvocationV1 {
  readonly invocationId: string;
  readonly digest: Sha256Digest;
  readonly reference: QaRunnerHostInvocationReferenceV1;
}

export interface QaRunnerHostAuthorityOptionsV1 {
  readonly resolveContext: (
    request: QaRunnerHostInvocationRequestV1,
  ) => QaRunnerHostExecutionContextV1 | Promise<QaRunnerHostExecutionContextV1>;
  readonly recordConsumption: (
    request: QaRunnerHostInvocationRequestV1,
    reference: QaRunnerHostInvocationReferenceV1,
    consumption: ExecutionRoleResultConsumptionV1,
  ) => void | Promise<void>;
  readonly clearSession?: (sessionId: string) => void;
}

export interface QaRunnerHostAuthorityV1 {
  prepare(request: unknown): Promise<QaRunnerHostPreparedInvocationV1>;
  consume(reference: unknown, result: unknown): Promise<ExecutionRoleResultConsumptionV1>;
  clearSession(sessionId: unknown): void;
}

type QaHostErrorCode =
  | "QA_HOST_REQUEST_INVALID"
  | "QA_HOST_CONTEXT_UNAVAILABLE"
  | "QA_HOST_LIFECYCLE_UNSUPPORTED"
  | "QA_HOST_ROLE_NOT_AUTHORIZED"
  | "QA_HOST_VERIFY_EXECUTION_REQUIRED"
  | "QA_HOST_REVIEW_EXECUTION_FORBIDDEN"
  | "QA_HOST_SCHEDULE_REJECTED"
  | "QA_HOST_VERIFY_EXECUTION_FAILED"
  | "QA_HOST_DUPLICATE_PREPARE"
  | "QA_HOST_REFERENCE_INVALID"
  | "QA_HOST_REFERENCE_REPLAYED"
  | "QA_HOST_SESSION_CLEARED"
  | "QA_HOST_EXECUTION_EVIDENCE_MISMATCH"
  | "QA_HOST_CONTROL_PLANE_FAILED"
  | "QA_HOST_RECORD_CONSUMPTION_FAILED"
  | "QA_HOST_CLEAR_FAILED";

const ERROR_CODES = new Set<QaHostErrorCode>([
  "QA_HOST_REQUEST_INVALID",
  "QA_HOST_CONTEXT_UNAVAILABLE",
  "QA_HOST_LIFECYCLE_UNSUPPORTED",
  "QA_HOST_ROLE_NOT_AUTHORIZED",
  "QA_HOST_VERIFY_EXECUTION_REQUIRED",
  "QA_HOST_REVIEW_EXECUTION_FORBIDDEN",
  "QA_HOST_SCHEDULE_REJECTED",
  "QA_HOST_VERIFY_EXECUTION_FAILED",
  "QA_HOST_DUPLICATE_PREPARE",
  "QA_HOST_REFERENCE_INVALID",
  "QA_HOST_REFERENCE_REPLAYED",
  "QA_HOST_SESSION_CLEARED",
  "QA_HOST_EXECUTION_EVIDENCE_MISMATCH",
  "QA_HOST_CONTROL_PLANE_FAILED",
  "QA_HOST_RECORD_CONSUMPTION_FAILED",
  "QA_HOST_CLEAR_FAILED",
]);

interface PendingInvocationV1 {
  readonly key: string;
  readonly request: QaRunnerHostInvocationRequestV1;
  readonly context: QaRunnerHostExecutionContextV1;
  readonly reference: QaRunnerHostInvocationReferenceV1;
}

function fail(code: QaHostErrorCode): never {
  throw new Error(code);
}

function isHostError(error: unknown): error is Error {
  return error instanceof Error && ERROR_CODES.has(error.message as QaHostErrorCode);
}

function sanitizeRequest(value: unknown): QaRunnerHostInvocationRequestV1 {
  assertExactKeys(value, ["runnerId", "sessionId", "invocationId", "requestedRole"], "qa host request");
  return deepFreeze({
    runnerId: enumValue(value.runnerId, ["opencode", "pi"] as const, "qa host request.runnerId"),
    sessionId: stringValue(value.sessionId, "qa host request.sessionId", 256),
    invocationId: stringValue(value.invocationId, "qa host request.invocationId", 256),
    requestedRole: enumValue(value.requestedRole, ["verify", "review"] as const, "qa host request.requestedRole"),
  });
}

function sessionKey(request: QaRunnerHostInvocationRequestV1): string {
  return `${request.runnerId}\u0000${request.sessionId}\u0000${request.invocationId}`;
}

function assertTrustedLifecycle(
  context: QaRunnerHostExecutionContextV1,
  requestedRole: QaRunnerHostInvocationRequestV1["requestedRole"],
): "verify" | "review" {
  try {
    if (!context?.plan?.qaExecutionAuthority) fail("QA_HOST_LIFECYCLE_UNSUPPORTED");
    const action = decideQaNextActionV1({ snapshot: context.plan.qaExecutionAuthority });
    const authorizedRole = action.kind === "run_verify_stage"
      ? "verify"
      : action.kind === "run_review"
        ? "review"
        : undefined;
    if (!authorizedRole) fail("QA_HOST_LIFECYCLE_UNSUPPORTED");
    if (requestedRole !== authorizedRole) fail("QA_HOST_ROLE_NOT_AUTHORIZED");
    return authorizedRole;
  } catch (error) {
    if (isHostError(error)) throw error;
    fail("QA_HOST_LIFECYCLE_UNSUPPORTED");
  }
}

function assertExecutionContext(
  context: QaRunnerHostExecutionContextV1,
  role: QaRunnerHostInvocationRequestV1["requestedRole"],
): void {
  if (role === "verify") {
    if (!context.verificationPlan || !context.verificationCheckExecutor) fail("QA_HOST_VERIFY_EXECUTION_REQUIRED");
    return;
  }
  if (context.verificationPlan || context.verificationCheckExecutor || context.broadFailureManifestFinalizer) {
    fail("QA_HOST_REVIEW_EXECUTION_FORBIDDEN");
  }
}

function assertTrustedExecutionEvidence(result: unknown, execution: VerificationStageExecutionResultV1): void {
  try {
    assertPlainRecord(result, "qa host result");
    if (
      sha256Digest(result.verificationCheckResults) !== sha256Digest(execution.results) ||
      sha256Digest(result.verificationWaveReceipts) !== sha256Digest(execution.receipts)
    ) fail("QA_HOST_EXECUTION_EVIDENCE_MISMATCH");
    const rawFailureManifestDigest = execution.join.status === "incomplete"
      ? undefined
      : execution.join.rawFailureManifestDigest;
    if (rawFailureManifestDigest !== undefined) {
      assertPlainRecord(result.failureManifest, "qa host failure manifest");
      if (
        execution.failureManifest === undefined ||
        result.failureManifest.digest !== rawFailureManifestDigest ||
        sha256Digest(result.failureManifest) !== sha256Digest(execution.failureManifest)
      ) fail("QA_HOST_EXECUTION_EVIDENCE_MISMATCH");
    }
  } catch (error) {
    if (isHostError(error)) throw error;
    fail("QA_HOST_EXECUTION_EVIDENCE_MISMATCH");
  }
}

/**
 * Creates the process-local authority which binds a runner call to exactly one
 * trusted control-plane invocation. Runner request metadata never supplies
 * identity, candidate, freshness, plan, or verification evidence.
 */
export function createQaRunnerHostAuthorityV1(options: QaRunnerHostAuthorityOptionsV1): QaRunnerHostAuthorityV1 {
  if (!options || typeof options.resolveContext !== "function" || typeof options.recordConsumption !== "function") {
    fail("QA_HOST_CONTEXT_UNAVAILABLE");
  }
  const pendingByKey = new Map<string, PendingInvocationV1>();
  const pendingByReference = new WeakMap<object, PendingInvocationV1>();
  const consumedReferences = new WeakSet<object>();
  const clearedReferences = new WeakSet<object>();
  const settledKeys = new Map<string, string>();

  return deepFreeze({
    async prepare(requestValue: unknown): Promise<QaRunnerHostPreparedInvocationV1> {
      let request: QaRunnerHostInvocationRequestV1;
      try {
        request = sanitizeRequest(requestValue);
      } catch {
        fail("QA_HOST_REQUEST_INVALID");
      }
      const key = sessionKey(request);
      if (pendingByKey.has(key) || settledKeys.has(key)) fail("QA_HOST_DUPLICATE_PREPARE");

      let context: QaRunnerHostExecutionContextV1;
      try {
        context = await options.resolveContext(request);
      } catch {
        fail("QA_HOST_CONTEXT_UNAVAILABLE");
      }
      const role = assertTrustedLifecycle(context, request.requestedRole);
      assertExecutionContext(context, role);

      let scheduled: ReturnType<typeof scheduleExecutionRoleInvocationV1>;
      try {
        scheduled = scheduleExecutionRoleInvocationV1(context.plan, {
          role,
          agentInstanceId: context.agentInstanceId,
          freshness: context.freshness,
          currentCandidate: context.candidate,
          ...(role === "verify" ? { verificationPlan: context.verificationPlan } : {}),
        });
      } catch {
        fail("QA_HOST_SCHEDULE_REJECTED");
      }
      if (scheduled.code !== "scheduled" && scheduled.code !== "shadow-only") fail("QA_HOST_SCHEDULE_REJECTED");
      const invocation = scheduled.invocation;

      let verificationExecution: VerificationStageExecutionResultV1 | undefined;
      if (role === "verify") {
        try {
          const executionIdentityDigest = sha256Digest({
            invocationId: invocation.invocationId,
            role: invocation.role,
            agentInstanceId: invocation.agentInstanceId,
          });
          verificationExecution = await executeVerificationStageV1({
            plan: context.verificationPlan!,
            executor: context.verificationCheckExecutor!,
            executionIdentityDigest,
            ...(invocation.stage === "broad" ? { broadFailureManifestFinalizer: context.broadFailureManifestFinalizer } : {}),
          });
        } catch {
          fail("QA_HOST_VERIFY_EXECUTION_FAILED");
        }
      }
      const referencePayload = {
        schema: "qa-runner-host-invocation-reference-v1" as const,
        invocation,
        ...(verificationExecution === undefined ? {} : { verificationExecution }),
      };
      const reference = deepFreeze({ ...referencePayload, digest: sha256Digest(referencePayload) }) as QaRunnerHostInvocationReferenceV1;
      const pending: PendingInvocationV1 = { key, request, context, reference };
      pendingByKey.set(key, pending);
      pendingByReference.set(reference, pending);
      return deepFreeze({ invocationId: request.invocationId, digest: reference.digest, reference });
    },

    async consume(referenceValue: unknown, result: unknown): Promise<ExecutionRoleResultConsumptionV1> {
      if (!referenceValue || typeof referenceValue !== "object") fail("QA_HOST_REFERENCE_INVALID");
      const reference = referenceValue as object;
      const pending = pendingByReference.get(reference);
      if (!pending) {
        if (clearedReferences.has(reference)) fail("QA_HOST_SESSION_CLEARED");
        if (consumedReferences.has(reference)) fail("QA_HOST_REFERENCE_REPLAYED");
        fail("QA_HOST_REFERENCE_INVALID");
      }

      try {
        if (pending.reference.verificationExecution) {
          assertTrustedExecutionEvidence(result, pending.reference.verificationExecution);
        }
        try {
          const consumption = consumeExecutionRoleResultV1(
            pending.context.plan,
            pending.reference.invocation,
            result,
            pending.context.verificationPolicy,
          );
          if (consumption.code !== "accepted" && consumption.code !== "shadow-observed" && consumption.code !== "role-result-failed") {
            fail("QA_HOST_CONTROL_PLANE_FAILED");
          }
          try {
            await options.recordConsumption(pending.request, pending.reference, consumption);
          } catch {
            fail("QA_HOST_RECORD_CONSUMPTION_FAILED");
          }
          return consumption;
        } catch (error) {
          if (isHostError(error)) throw error;
          fail("QA_HOST_CONTROL_PLANE_FAILED");
        }
      } finally {
        pendingByReference.delete(reference);
        pendingByKey.delete(pending.key);
        settledKeys.set(pending.key, pending.request.sessionId);
        consumedReferences.add(reference);
      }
    },

    clearSession(sessionIdValue: unknown): void {
      let sessionId: string;
      try {
        sessionId = stringValue(sessionIdValue, "qa host sessionId", 256);
      } catch {
        fail("QA_HOST_REQUEST_INVALID");
      }
      try {
        for (const [key, pending] of pendingByKey) {
          if (pending.request.sessionId !== sessionId) continue;
          pendingByKey.delete(key);
          pendingByReference.delete(pending.reference);
          clearedReferences.add(pending.reference);
        }
        for (const [key, settledSessionId] of settledKeys) {
          if (settledSessionId === sessionId) settledKeys.delete(key);
        }
        options.clearSession?.(sessionId);
      } catch {
        fail("QA_HOST_CLEAR_FAILED");
      }
    },
  });
}
