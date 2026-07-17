import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { BatchId } from "../contracts/apply-batch";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import {
  createStagedVerificationScheduleV1,
  transitionStagedVerificationV1,
  validateVerificationAcceptanceV1,
  validateVerificationDisciplineV1,
  type MandatoryBroadReasonV1,
  type StagedVerificationPolicyV1,
} from "./staged-verification";

const batchId = "batch:v1:11111111111111111111111111111111" as BatchId;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const evidence = (checkId: string) => ({ kind: "check", checkId, artifact: "verify-report.md", resultCode: "passed" });
const policy = (changes: Partial<StagedVerificationPolicyV1> = {}): StagedVerificationPolicyV1 => ({
  lane: "guarded",
  broadRequired: true,
  mandatoryBroadReasons: [],
  broadDeferralPolicyIds: ["policy:bounded-broad-deferral"],
  ...changes,
});
const schedule = () => createStagedVerificationScheduleV1({
  batchId,
  checkIds: { targeted: ["targeted-check"], affected_area: ["affected-check"], broad: ["broad-check"] },
});
const omission = (reasonCode: "not_applicable" | "not_available" | "blocked_by_prior_stage" | "policy_deferred", policyId = "policy:bounded-broad-deferral") => ({
  reasonCode,
  evidence: evidence("omission-evidence"),
  policyId,
  nextTrigger: "next:release-gate",
  riskAcceptance: { actor: "project-owner", acceptedAt: "2026-07-16T00:00:00.000Z", rationaleCode: "BOUNDED_RISK_ACCEPTED" },
});

function passTargeted(state = schedule()) {
  return transitionStagedVerificationV1(state, { stage: "targeted", status: "passed", evidence: [evidence("targeted-check")] }, policy()).state;
}

function passAffected(state = passTargeted()) {
  return transitionStagedVerificationV1(state, { stage: "affected_area", status: "passed", evidence: [evidence("affected-check")] }, policy()).state;
}

describe("staged verification scheduler", () => {
  test("advances targeted, affected-area, and broad in exact order", () => {
    const targeted = transitionStagedVerificationV1(schedule(), { stage: "targeted", status: "passed", evidence: [evidence("targeted-check")] }, policy());
    expect(targeted.code).toBe("advanced");
    expect(targeted.state.nextStage).toBe("affected_area");
    const affected = transitionStagedVerificationV1(targeted.state, { stage: "affected_area", status: "passed", evidence: [evidence("affected-check")] }, policy());
    expect(affected.state.nextStage).toBe("broad");
    const broad = transitionStagedVerificationV1(affected.state, { stage: "broad", status: "passed", evidence: [evidence("broad-check")] }, policy());
    expect(broad.code).toBe("complete");
    expect(broad.state.nextStage).toBeUndefined();
    expect(validateVerificationAcceptanceV1(broad.state, policy()).code).toBe("complete");
  });

  test("rejects out-of-order, incomplete, and failed-stage advancement", () => {
    expect(transitionStagedVerificationV1(schedule(), { stage: "broad", status: "passed", evidence: [evidence("broad-check")] }, policy()).code)
      .toBe("invalid-evidence");
    expect(transitionStagedVerificationV1(schedule(), { stage: "targeted", status: "passed", evidence: [] }, policy()).code)
      .toBe("verification-evidence-required");
    const failed = transitionStagedVerificationV1(schedule(), { stage: "targeted", status: "failed", evidence: [evidence("targeted-check")] }, policy());
    expect(failed.code).toBe("verification-evidence-required");
    expect(failed.state.nextStage).toBeUndefined();
    expect(transitionStagedVerificationV1(failed.state, { stage: "affected_area", status: "passed", evidence: [evidence("affected-check")] }, policy()).code)
      .toBe("invalid-evidence");
  });

  test("requires complete bounded omission evidence", () => {
    const targeted = passTargeted();
    expect(transitionStagedVerificationV1(targeted, { stage: "affected_area", status: "skipped", evidence: [] }, policy()).code)
      .toBe("verification-evidence-required");
    const skipped = transitionStagedVerificationV1(targeted, {
      stage: "affected_area",
      status: "skipped",
      evidence: [],
      omission: omission("not_applicable"),
    }, policy());
    expect(skipped.code).toBe("advanced");
    expect(skipped.state.stages[1].omission?.riskAcceptance.actor).toBe("project-owner");
  });

  test("never omits broad checks for mandatory floor reasons", () => {
    const reasons: MandatoryBroadReasonV1[] = [
      "security", "authorization", "data_loss", "migration", "destructive", "public_api",
      "cross_package_architecture", "incident", "material_repair",
    ];
    for (const reason of reasons) {
      const outcome = transitionStagedVerificationV1(passAffected(), {
        stage: "broad",
        status: "deferred",
        evidence: [],
        omission: omission("policy_deferred"),
      }, policy({ mandatoryBroadReasons: [reason] }));
      expect(outcome.code).toBe("lane-floor-violation");
      expect(outcome.rationaleCode).toBe("VERIFY_BROAD_MANDATORY");
    }
  });

  test("accepts only an explicitly authorized broad deferral", () => {
    const unauthorized = transitionStagedVerificationV1(passAffected(), {
      stage: "broad",
      status: "deferred",
      evidence: [],
      omission: omission("policy_deferred", "policy:unknown"),
    }, policy());
    expect(unauthorized.code).toBe("lane-floor-violation");
    const authorized = transitionStagedVerificationV1(passAffected(), {
      stage: "broad",
      status: "deferred",
      evidence: [],
      omission: omission("policy_deferred"),
    }, policy());
    expect(authorized.code).toBe("complete");
    expect(validateVerificationAcceptanceV1(authorized.state, policy()).code).toBe("complete");
  });

  test("keeps legacy omission states parseable but refuses acceptance without complete evidence", () => {
    const legacy = buildStagedVerificationStateV1({
      schema: "staged-verification-state-v1",
      batchId,
      stages: [
        { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
        { stage: "affected_area", status: "skipped", checkIds: [], evidence: [], skipReason: "not_applicable" },
        { stage: "broad", status: "passed", checkIds: ["broad-check"], evidence: [evidence("broad-check")] },
      ],
    });
    expect(validateVerificationAcceptanceV1(legacy, policy()).rationaleCode).toBe("VERIFY_OMISSION_EVIDENCE_MISSING");
  });

  test("fails closed on malformed transition policy instead of weakening broad floors", () => {
    expect(transitionStagedVerificationV1(schedule(), {
      stage: "targeted",
      status: "passed",
      evidence: [evidence("targeted-check")],
    }, policy({ mandatoryBroadReasons: ["unknown" as MandatoryBroadReasonV1] })).code).toBe("invalid-evidence");
  });
});

describe("TDD and generated source discipline", () => {
  const completed = () => transitionStagedVerificationV1(passAffected(), {
    stage: "broad",
    status: "passed",
    evidence: [evidence("broad-check")],
  }, policy()).state;

  test("requires prior failing-test and deterministic canonical regeneration evidence", () => {
    const rejected = validateVerificationDisciplineV1(completed(), {
      behaviorChanged: true,
      generatedOutputsChanged: ["generated.ts"],
      canonicalSourcesChanged: [],
      directGeneratedEdit: true,
      firstRegenerationDigest: sha("one"),
      secondRegenerationDigest: sha("two"),
    });
    expect(rejected.code).toBe("verification-evidence-required");
    expect(rejected.rationaleCodes).toEqual([
      "GENERATED_CANONICAL_SOURCE_REQUIRED",
      "GENERATED_DETERMINISM_REQUIRED",
      "GENERATED_DIRECT_EDIT",
      "GENERATED_INVOCATION_REQUIRED",
      "TDD_PRIOR_FAILURE_REQUIRED",
    ]);
  });

  test("accepts complete TDD and canonical generation evidence", () => {
    const digest = sha("deterministic");
    expect(validateVerificationDisciplineV1(completed(), {
      behaviorChanged: true,
      priorFailingTest: { ...evidence("red-test"), resultCode: "failed-before-implementation" },
      generatedOutputsChanged: ["generated.ts"],
      canonicalSourcesChanged: ["source.ts"],
      generatorInvocation: evidence("generator-run"),
      directGeneratedEdit: false,
      firstRegenerationDigest: digest,
      secondRegenerationDigest: digest,
    })).toEqual({ code: "accepted", rationaleCodes: [] });
  });

  test("rejects label-only red evidence and an incomplete verification schedule", () => {
    const incomplete = buildStagedVerificationStateV1({
      schema: "staged-verification-state-v1",
      batchId,
      stages: [],
    });
    expect(validateVerificationDisciplineV1(incomplete, {
      behaviorChanged: true,
      priorFailingTest: { ...evidence("red-test"), resultCode: "passed" },
      generatedOutputsChanged: [],
      canonicalSourcesChanged: [],
      directGeneratedEdit: false,
    }).rationaleCodes).toEqual(["TDD_PASSING_STAGES_REQUIRED", "TDD_PRIOR_FAILURE_REQUIRED"]);
  });
});
