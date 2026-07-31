import { describe, expect, test } from "bun:test";

import { sha256Digest } from "../contracts/canonical";
import {
  buildVerificationCheckResultV1,
  buildVerificationStageExecutionPlanV1,
  type VerificationCheckDescriptorV1,
  type VerificationStageExecutionPlanV1,
} from "../contracts/verification-stage-execution";
import { executeVerificationStageV1, type VerificationCheckExecutorPortV1 } from "./verification-stage-executor";

const digest = (value: string) => sha256Digest(value);
const executionIdentityDigest = digest("stage-executor");

const plan = (stage: "targeted" | "broad" = "targeted") => buildVerificationStageExecutionPlanV1({
  stage,
  qaAuthorityDigest: digest("authority"),
  generation: 1,
  implementationSubjectDigest: digest("implementation"),
  dependencySetDigest: digest("dependencies"),
  checks: [
    { checkId: "a", capabilityDigest: digest("a"), commandPlanDigest: digest("command-a"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
    { checkId: "b", capabilityDigest: digest("b"), commandPlanDigest: digest("command-b"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
    { checkId: "c", capabilityDigest: digest("c"), commandPlanDigest: digest("command-c"), effectProfile: { kind: "serial_required", reasonCodes: ["DEPENDENT"] }, dependencyCheckIds: ["a"], exclusiveResourceKeys: [] },
  ],
});

const passed = (value: VerificationStageExecutionPlanV1, check: VerificationCheckDescriptorV1) => buildVerificationCheckResultV1(value, {
  checkId: check.checkId,
  producerIdentityDigest: executionIdentityDigest,
  outcome: { kind: "completed", status: "passed", evidence: [] },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("executeVerificationStageV1", () => {
  test("starts a later wave only after every promise in the preceding wave settles", async () => {
    const value = plan();
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    const started: string[] = [];
    const executor: VerificationCheckExecutorPortV1 = {
      execute(receivedPlan, check) {
        started.push(check.checkId);
        if (check.checkId === "a") return a.promise;
        if (check.checkId === "b") return b.promise;
        return passed(receivedPlan, check);
      },
    };

    const execution = executeVerificationStageV1({ plan: value, executor, executionIdentityDigest });
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);

    b.resolve(passed(value, value.checks[1]!));
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);

    a.resolve(passed(value, value.checks[0]!));
    const completed = await execution;
    expect(started).toEqual(["a", "b", "c"]);
    expect(completed.results.map((result) => result.checkId)).toEqual(["a", "b", "c"]);
    expect(completed.receipts.map((receipt) => receipt.waveIndex)).toEqual([0, 1]);
    expect(completed.join.status).toBe("passed");
  });

  test("records execution errors and failed checks without fail-fast behavior", async () => {
    const value = plan();
    const started: string[] = [];
    const executor: VerificationCheckExecutorPortV1 = {
      async execute(receivedPlan, check) {
        started.push(check.checkId);
        if (check.checkId === "a") return buildVerificationCheckResultV1(receivedPlan, {
          checkId: "a",
          producerIdentityDigest: executionIdentityDigest,
          outcome: { kind: "completed", status: "failed", evidence: [] },
        });
        if (check.checkId === "b") throw new Error("runner crashed");
        return passed(receivedPlan, check);
      },
    };

    const completed = await executeVerificationStageV1({ plan: value, executor, executionIdentityDigest });
    expect(started).toEqual(["a", "b", "c"]);
    expect(completed.results.map((result) => result.outcome.kind === "execution_error" ? result.outcome.code : result.outcome.status))
      .toEqual(["failed", "crashed", "passed"]);
    expect(completed.join.status).toBe("failed");
    expect(completed.join.status === "incomplete" ? [] : completed.join.failedCheckIds).toEqual(["a", "b"]);
  });

  test("rejects malformed results after the other checks in their wave settle", async () => {
    const value = plan();
    const checked: string[] = [];
    const executor: VerificationCheckExecutorPortV1 = {
      async execute(receivedPlan, check) {
        checked.push(check.checkId);
        if (check.checkId === "a") return {};
        return passed(receivedPlan, check);
      },
    };

    await expect(executeVerificationStageV1({ plan: value, executor, executionIdentityDigest })).rejects.toThrow("CHECK_RESULT_INVALID");
    expect(checked).toEqual(["a", "b"]);
  });

  test("rejects duplicate results that leave a required check missing", async () => {
    const value = plan();
    const executor: VerificationCheckExecutorPortV1 = {
      execute(receivedPlan, check) {
        return check.checkId === "b"
          ? buildVerificationCheckResultV1(receivedPlan, {
              checkId: "a",
              producerIdentityDigest: executionIdentityDigest,
              outcome: { kind: "completed", status: "passed", evidence: [] },
            })
          : passed(receivedPlan, check);
      },
    };

    await expect(executeVerificationStageV1({ plan: value, executor, executionIdentityDigest })).rejects.toThrow("CHECK_RESULT_INVALID");
  });

  test("rejects check results produced by a different execution identity", async () => {
    const value = plan();
    const executor: VerificationCheckExecutorPortV1 = {
      execute(receivedPlan, check) {
        return buildVerificationCheckResultV1(receivedPlan, {
          checkId: check.checkId,
          producerIdentityDigest: digest("untrusted-producer"),
          outcome: { kind: "completed", status: "passed", evidence: [] },
        });
      },
    };

    await expect(executeVerificationStageV1({ plan: value, executor, executionIdentityDigest })).rejects.toThrow("CHECK_RESULT_INVALID");
  });

  test("rejects results bound to a different stage plan", async () => {
    const value = plan();
    const otherPlan = plan("broad");
    const executor: VerificationCheckExecutorPortV1 = {
      execute(receivedPlan, check) {
        return check.checkId === "b"
          ? buildVerificationCheckResultV1(otherPlan, {
              checkId: "b",
              producerIdentityDigest: executionIdentityDigest,
              outcome: { kind: "completed", status: "passed", evidence: [] },
            })
          : passed(receivedPlan, check);
      },
    };

    await expect(executeVerificationStageV1({ plan: value, executor, executionIdentityDigest })).rejects.toThrow("CHECK_RESULT_INVALID");
  });

  test("requires a trusted failure manifest finalizer and invokes it after every BROAD check settles", async () => {
    const value = plan("broad");
    let calls = 0;
    let finalizedResultCount = 0;
    const executor: VerificationCheckExecutorPortV1 = {
      execute(receivedPlan, check) {
        calls += 1;
        return passed(receivedPlan, check);
      },
    };

    await expect(executeVerificationStageV1({ plan: value, executor, executionIdentityDigest })).rejects.toThrow("BROAD_FAILURE_MANIFEST_REQUIRED");
    expect(calls).toBe(0);
    const completed = await executeVerificationStageV1({
      plan: value,
      executor,
      executionIdentityDigest,
      broadFailureManifestFinalizer: {
        finalize(_plan, results) {
          finalizedResultCount = results.length;
          return Object.freeze({ schema: "failure-manifest-v1", digest: digest("manifest") });
        },
      },
    });
    expect(calls).toBe(3);
    expect(finalizedResultCount).toBe(3);
    expect(completed.join.status).toBe("passed");
    expect(completed.join.status === "incomplete" ? undefined : completed.join.rawFailureManifestDigest).toBe(digest("manifest"));
    expect(completed.failureManifest).toEqual({ schema: "failure-manifest-v1", digest: digest("manifest") });
    expect(Object.isFrozen(completed.failureManifest)).toBe(true);
  });
});
