import { describe, expect, test } from "bun:test";
import { sha256Digest } from "./canonical";
import { buildVerificationCheckResultV1, buildVerificationStageExecutionPlanV1, buildVerificationWaveExecutionReceiptsV1, joinVerificationStageExecutionV1 } from "./verification-stage-execution";

const digest = (value: string) => sha256Digest(value);
const plan = () => buildVerificationStageExecutionPlanV1({
  stage: "targeted", qaAuthorityDigest: digest("authority"), generation: 1,
  implementationSubjectDigest: digest("implementation"), dependencySetDigest: digest("dependencies"),
  checks: [
    { checkId: "read-a", capabilityDigest: digest("a"), commandPlanDigest: digest("ca"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
    { checkId: "read-b", capabilityDigest: digest("b"), commandPlanDigest: digest("cb"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
    { checkId: "unknown", capabilityDigest: digest("c"), commandPlanDigest: digest("cc"), effectProfile: { kind: "serial_required", reasonCodes: ["UNKNOWN_EFFECT"] }, dependencyCheckIds: ["read-a"], exclusiveResourceKeys: [] },
  ],
});

describe("verification stage execution", () => {
  test("creates deterministic same-stage waves and serializes unknown effects", () => {
    expect(plan().waves).toEqual([["read-a", "read-b"], ["unknown"]]);
  });

  test("serializes isolated checks that share the same isolation key without stalling", () => {
    const value = buildVerificationStageExecutionPlanV1({
      stage: "broad",
      qaAuthorityDigest: digest("authority"),
      generation: 1,
      implementationSubjectDigest: digest("implementation"),
      dependencySetDigest: digest("dependencies"),
      checks: [
        { checkId: "isolated-a", capabilityDigest: digest("a"), commandPlanDigest: digest("ca"), effectProfile: { kind: "isolated_ephemeral", isolationKey: "shared", cleanupRequired: true }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
        { checkId: "isolated-b", capabilityDigest: digest("b"), commandPlanDigest: digest("cb"), effectProfile: { kind: "isolated_ephemeral", isolationKey: "shared", cleanupRequired: true }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
        { checkId: "isolated-c", capabilityDigest: digest("c"), commandPlanDigest: digest("cc"), effectProfile: { kind: "isolated_ephemeral", isolationKey: "other", cleanupRequired: true }, dependencyCheckIds: [], exclusiveResourceKeys: [] },
      ],
    });

    expect(value.waves).toEqual([["isolated-a", "isolated-c"], ["isolated-b"]]);
  });

  test("joins every required result and does not fail fast", () => {
    const value = plan();
    expect(joinVerificationStageExecutionV1(value, [
      buildVerificationCheckResultV1(value, { checkId: "read-a", producerIdentityDigest: digest("producer-a"), outcome: { kind: "completed", status: "failed", evidence: [] } }),
      buildVerificationCheckResultV1(value, { checkId: "read-b", producerIdentityDigest: digest("producer-b"), outcome: { kind: "completed", status: "passed", evidence: [] } }),
    ]).status).toBe("incomplete");
    const complete = [
      buildVerificationCheckResultV1(value, { checkId: "read-a", producerIdentityDigest: digest("producer-a"), outcome: { kind: "completed", status: "failed", evidence: [] } }),
      buildVerificationCheckResultV1(value, { checkId: "read-b", producerIdentityDigest: digest("producer-b"), outcome: { kind: "completed", status: "passed", evidence: [] } }),
      buildVerificationCheckResultV1(value, { checkId: "unknown", producerIdentityDigest: digest("producer-c"), outcome: { kind: "execution_error", code: "timeout", evidence: [] } }),
    ];
    expect(() => joinVerificationStageExecutionV1(value, complete)).toThrow("WAVE_EXECUTION_RECEIPTS_REQUIRED");
    const executionIdentityDigest = digest("executor");
    const receipts = buildVerificationWaveExecutionReceiptsV1(value, complete, executionIdentityDigest);
    expect(joinVerificationStageExecutionV1(value, complete, undefined, receipts, executionIdentityDigest).status).toBe("failed");
  });

  test("rejects a check result bound to another stage plan", () => {
    const value = plan();
    const valid = buildVerificationCheckResultV1(value, {
      checkId: "read-a",
      producerIdentityDigest: digest("producer"),
      outcome: { kind: "completed", status: "passed", evidence: [] },
    });
    expect(() => joinVerificationStageExecutionV1(value, [{ ...valid, planDigest: digest("other-plan") }])).toThrow("CHECK_RESULT_INVALID");
  });

  test("requires an explicit raw failure manifest digest for a completed BROAD join", () => {
    const value = buildVerificationStageExecutionPlanV1({
      stage: "broad",
      qaAuthorityDigest: digest("authority"),
      generation: 1,
      implementationSubjectDigest: digest("implementation"),
      dependencySetDigest: digest("dependencies"),
      checks: [{ checkId: "broad", capabilityDigest: digest("broad-capability"), commandPlanDigest: digest("broad-command"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] }],
    });
    const result = buildVerificationCheckResultV1(value, { checkId: "broad", producerIdentityDigest: digest("producer"), outcome: { kind: "completed", status: "passed", evidence: [] } });
    const executionIdentityDigest = digest("executor");
    const receipts = buildVerificationWaveExecutionReceiptsV1(value, [result], executionIdentityDigest);
    expect(() => joinVerificationStageExecutionV1(value, [result], undefined, receipts, executionIdentityDigest)).toThrow("BROAD_FAILURE_MANIFEST_REQUIRED");
    const joined = joinVerificationStageExecutionV1(value, [result], digest("manifest"), receipts, executionIdentityDigest);
    expect(joined.status === "incomplete" ? undefined : joined.rawFailureManifestDigest).toBe(digest("manifest"));
  });

  test("serializes checks that claim the same exclusive resource", () => {
    const value = buildVerificationStageExecutionPlanV1({
      stage: "targeted",
      qaAuthorityDigest: digest("authority"),
      generation: 1,
      implementationSubjectDigest: digest("implementation"),
      dependencySetDigest: digest("dependencies"),
      checks: [
        { checkId: "a", capabilityDigest: digest("a"), commandPlanDigest: digest("ca"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: ["port-3000"] },
        { checkId: "b", capabilityDigest: digest("b"), commandPlanDigest: digest("cb"), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: ["port-3000"] },
      ],
    });

    expect(value.waves).toEqual([["a"], ["b"]]);
  });
});
