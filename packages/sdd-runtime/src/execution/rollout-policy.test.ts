import { describe, expect, test } from "bun:test";

import type { RolloutObservationV1 } from "./telemetry";
import {
  evaluateRolloutGateV1,
  transitionRolloutStateV1,
  type RolloutControlsV1,
  type RolloutGateDecisionV1,
  type RolloutStateV1,
} from "./rollout-policy";

const CONTROLS: RolloutControlsV1 = {
  executionContracts: "enforce",
  decisionKernel: "active",
  invocationAuthorization: {
    default: "invocation-required",
    opencode: "invocation-required",
    pi: "invocation-required",
  },
  registryWriter: "centralized",
  routePolicy: "risk-lanes",
  promptProfile: "compact",
  telemetry: "local-safe",
};

function passingObservation(): RolloutObservationV1 {
  return {
    schema: "rollout-observation-v1",
    eligibleExecutions: 100,
    consecutiveDays: 14,
    observedRunners: ["opencode", "pi"],
    safety: {
      replayMismatchCount: 0,
      batchReferenceBreakCount: 0,
      authorizationBypassCount: 0,
      registryHistoryLossCount: 0,
      duplicateRegistryEventCount: 0,
      broadCheckMissCount: 0,
      freshReviewMissCount: 0,
      laneFloorDowngradeCount: 0,
      adapterDivergenceCount: 0,
      escapedCriticalFindingCount: 0,
      baselineSecurityArchitectureEscapeRate: 0,
      candidateSecurityArchitectureEscapeRate: 0,
    },
    metrics: [
      {
        riskTier: "high",
        lane: "full_sdd",
        baselineCount: 100,
        candidateCount: 100,
        baselineMedianAcceptedCompletionMs: 100,
        candidateMedianAcceptedCompletionMs: 90,
        baselineMedianPhaseLaunchCount: 10,
        candidateMedianPhaseLaunchCount: 8,
        baselineNoPositiveDeltaCycleRate: 0.4,
        candidateNoPositiveDeltaCycleRate: 0.2,
        baselineRegistryConflictRate: 0.2,
        candidateRegistryConflictRate: 0.1,
        candidateControlPlaneP95Ms: 50,
      },
    ],
  };
}

function gateInput(observation = passingObservation()) {
  return {
    observation,
    baselineFrozen: true,
    legacyCompatibilityProven: true,
    additiveHistoryProven: true,
    currentCohortPercent: 0 as const,
    requestedCohortPercent: 5 as const,
    currentStepObservationDays: 0,
  };
}

describe("developer-team rollout gate", () => {
  test("refuses 99 executions, 13 days, an incomplete active-step window, and invalid expansion steps", () => {
    const insufficientVolume = passingObservation();
    const cases = [
      {
        input: gateInput({
          ...insufficientVolume,
          eligibleExecutions: 99,
          metrics: [{ ...insufficientVolume.metrics[0]!, candidateCount: 99 }],
        }),
        reason: "insufficient-eligible-executions",
      },
      {
        input: gateInput({ ...passingObservation(), consecutiveDays: 13 }),
        reason: "insufficient-consecutive-days",
      },
      {
        input: {
          ...gateInput(),
          currentCohortPercent: 5 as const,
          requestedCohortPercent: 25 as const,
          currentStepObservationDays: 6,
        },
        reason: "insufficient-step-observation",
      },
      {
        input: { ...gateInput(), requestedCohortPercent: 25 as const },
        reason: "invalid-rollout-step",
      },
    ];

    for (const { input, reason } of cases) {
      const decision = evaluateRolloutGateV1(input);
      expect(decision.status).toBe("rollout-paused");
      expect(decision.reasonCodes).toContain(reason);
      expect(decision.effectiveCohortPercent).toBe(input.currentCohortPercent);
    }
  });

  test("pauses on every zero-tolerance safety condition", () => {
    const conditions = {
      replayMismatchCount: "deterministic-replay-mismatch",
      batchReferenceBreakCount: "batch-reference-discontinuity",
      authorizationBypassCount: "authorization-bypass",
      registryHistoryLossCount: "registry-history-violation",
      duplicateRegistryEventCount: "registry-history-violation",
      broadCheckMissCount: "broad-check-noncompliance",
      freshReviewMissCount: "fresh-review-noncompliance",
      laneFloorDowngradeCount: "lane-floor-violation",
      adapterDivergenceCount: "adapter-semantic-divergence",
      escapedCriticalFindingCount: "escaped-critical-finding",
    } as const;

    for (const [field, reason] of Object.entries(conditions)) {
      const observation = passingObservation();
      const safety = { ...observation.safety, [field]: 1 };
      const decision = evaluateRolloutGateV1(gateInput({ ...observation, safety }));
      expect(decision.status).toBe("rollout-paused");
      expect(decision.reasonCodes).toContain(reason);
    }
  });

  test("requires both adapters, frozen compatibility evidence, and no security/architecture escape increase", () => {
    const observation = passingObservation();
    const cases = [
      {
        input: gateInput({ ...observation, observedRunners: ["opencode"] }),
        reason: "adapter-parity-incomplete",
      },
      {
        input: { ...gateInput(), baselineFrozen: false },
        reason: "baseline-not-frozen",
      },
      {
        input: { ...gateInput(), legacyCompatibilityProven: false },
        reason: "legacy-compatibility-unproven",
      },
      {
        input: { ...gateInput(), additiveHistoryProven: false },
        reason: "additive-history-unproven",
      },
      {
        input: gateInput({
          ...observation,
          safety: {
            ...observation.safety,
            baselineSecurityArchitectureEscapeRate: 0,
            candidateSecurityArchitectureEscapeRate: 0.01,
          },
        }),
        reason: "escaped-security-architecture-regression",
      },
    ];

    for (const { input, reason } of cases) {
      expect(evaluateRolloutGateV1(input).reasonCodes).toContain(reason);
    }
  });

  test("blocks a median accepted-completion regression over five percent by risk tier", () => {
    const observation = passingObservation();
    const metric = observation.metrics[0]!;
    const decision = evaluateRolloutGateV1(gateInput({
      ...observation,
      metrics: [{ ...metric, candidateMedianAcceptedCompletionMs: 106 }],
    }));

    expect(decision.status).toBe("rollout-paused");
    expect(decision.reasonCodes).toContain("accepted-completion-regression");
  });

  test("fails closed on non-finite or malformed observation evidence", () => {
    const observation = passingObservation();
    const malformed = {
      ...observation,
      eligibleExecutions: Number.NaN,
      metrics: [{
        ...observation.metrics[0]!,
        candidateMedianAcceptedCompletionMs: Number.POSITIVE_INFINITY,
      }],
    };

    const decision = evaluateRolloutGateV1(gateInput(malformed));
    expect(decision.status).toBe("rollout-paused");
    expect(decision.reasonCodes).toContain("invalid-rollout-evidence");
    expect(decision.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(() => evaluateRolloutGateV1({
      ...gateInput(),
      observation: null as never,
    })).not.toThrow();
    expect(evaluateRolloutGateV1({
      ...gateInput(),
      observation: null as never,
    }).reasonCodes).toContain("invalid-rollout-evidence");
  });

  test("rejects observation totals that do not match the reported metric buckets", () => {
    const observation = passingObservation();
    const decision = evaluateRolloutGateV1(gateInput({
      ...observation,
      metrics: [{ ...observation.metrics[0]!, candidateCount: 99 }],
    }));

    expect(decision.status).toBe("rollout-paused");
    expect(decision.reasonCodes).toContain("invalid-rollout-evidence");
  });

  test("expands one step only after every mandatory gate and reports efficiency by lane/risk tier", () => {
    const decision = evaluateRolloutGateV1(gateInput());

    expect(decision.status).toBe("eligible");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.effectiveCohortPercent).toBe(5);
    expect(decision.efficiency).toEqual([
      expect.objectContaining({
        riskTier: "high",
        lane: "full_sdd",
        acceptedCompletionImprovementPercent: 10,
        phaseLaunchImprovementPercent: 20,
        meetsSpecValueTarget: true,
        meetsDesignEfficiencyTargets: false,
      }),
    ]);
    expect(decision.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("rollout pause and rollback", () => {
  function activeState(): RolloutStateV1 {
    return {
      schema: "developer-team-rollout-state-v1",
      status: "active",
      cohortPercent: 50,
      automaticEffectsEnabled: true,
      controls: CONTROLS,
      permanentFloors: {
        explicitFullSdd: true,
        freshReview: true,
        gitSafety: true,
        requiredAuthorization: true,
      },
      history: [{
        schema: "rollout-history-event-v1",
        observedDay: 20_000,
        status: "active",
        cohortPercent: 50,
        reasonCodes: ["prior-activation"],
        evidenceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
    };
  }

  const pausedDecision: RolloutGateDecisionV1 = {
    schema: "rollout-gate-decision-v1",
    status: "rollout-paused",
    currentCohortPercent: 50,
    requestedCohortPercent: 100,
    effectiveCohortPercent: 50,
    reasonCodes: ["authorization-bypass"],
    efficiency: [],
    evidenceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };

  test("rolls the responsible control and cohort back exactly one state while appending history", () => {
    const prior = activeState();
    const next = transitionRolloutStateV1(prior, {
      decision: pausedDecision,
      responsibleControl: "decisionKernel",
      observedDay: 20_001,
    });

    expect(next.status).toBe("rollout-paused");
    expect(next.cohortPercent).toBe(25);
    expect(next.controls.decisionKernel).toBe("shadow");
    expect(next.automaticEffectsEnabled).toBe(false);
    expect(next.permanentFloors).toEqual(prior.permanentFloors);
    expect(next.history).toHaveLength(2);
    expect(next.history[0]).toEqual(prior.history[0]);
    expect(next.history[1]).toEqual(expect.objectContaining({
      observedDay: 20_001,
      status: "rollout-paused",
      cohortPercent: 25,
      reasonCodes: ["authorization-bypass"],
    }));
    expect(prior.controls.decisionKernel).toBe("active");
    expect(prior.history).toHaveLength(1);
  });

  test("never weakens invocation-required after it becomes a permanent floor", () => {
    const prior = activeState();
    const next = transitionRolloutStateV1(prior, {
      decision: pausedDecision,
      responsibleControl: "invocationAuthorization",
      observedDay: 20_001,
    });

    expect(next.controls.invocationAuthorization).toEqual(prior.controls.invocationAuthorization);
    expect(next.permanentFloors.requiredAuthorization).toBe(true);
    expect(next.automaticEffectsEnabled).toBe(false);
  });

  test("keeps centralized registry paused until recovery is proven before rollback", () => {
    const prior = activeState();
    const paused = transitionRolloutStateV1(prior, {
      decision: pausedDecision,
      responsibleControl: "registryWriter",
      observedDay: 20_001,
    });
    const recovered = transitionRolloutStateV1(prior, {
      decision: pausedDecision,
      responsibleControl: "registryWriter",
      registryRecoveryProven: true,
      observedDay: 20_001,
    });

    expect(paused.status).toBe("rollout-paused");
    expect(paused.automaticEffectsEnabled).toBe(false);
    expect(paused.controls.registryWriter).toBe("centralized");
    expect(recovered.controls.registryWriter).toBe("distributed-compatible");
  });

  test("refuses premature expansion without rolling back an otherwise safe active cohort", () => {
    const prior = activeState();
    const decision = evaluateRolloutGateV1({
      ...gateInput(),
      currentCohortPercent: 50,
      requestedCohortPercent: 100,
      currentStepObservationDays: 6,
    });
    const next = transitionRolloutStateV1(prior, {
      decision,
      responsibleControl: "decisionKernel",
      observedDay: 20_001,
    });

    expect(decision.status).toBe("rollout-paused");
    expect(decision.reasonCodes).toEqual(["insufficient-step-observation"]);
    expect(next.status).toBe("active");
    expect(next.cohortPercent).toBe(50);
    expect(next.automaticEffectsEnabled).toBe(true);
    expect(next.controls).toEqual(prior.controls);
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toEqual(expect.objectContaining({
      status: "active",
      cohortPercent: 50,
      reasonCodes: ["insufficient-step-observation"],
    }));
  });
});
