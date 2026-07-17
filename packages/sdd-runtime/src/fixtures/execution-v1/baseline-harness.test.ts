import { describe, expect, test } from "bun:test";

import { submitStateUpdate, type ArtifactStoreAdapter, type ArtifactVersion, type StateManagerResult } from "../../artifact-state/artifact-state-manager";
import { evaluateRepairIncident } from "../../orchestrator/repair-loop-governance";
import { DEFAULT_PIPELINE_CONFIG, runOrchestratorPipeline } from "../../orchestrator/orchestrator-pipeline";
import { EXECUTION_V1_FIXTURES } from "./index";

describe("execution-v1 frozen compatibility fixtures", () => {
  test("exercises legacy outcome and failure-set behavior instead of labels only", () => {
    const { scenarios } = EXECUTION_V1_FIXTURES;
    const legacyResult = runOrchestratorPipeline(EXECUTION_V1_FIXTURES.pipelineInputs[0], DEFAULT_PIPELINE_CONFIG);
    expect([scenarios.legacyNoContract.contract, legacyResult.outcome]).toEqual([null, "completed"]);
    expect([legacyResult.auditValid, legacyResult.stageErrors]).toEqual([true, []]);
    expect(legacyResult.outcome === "completed" ? scenarios.legacyNoContract.result : "blocked").toBe("legacy-compatible");
    expect(legacyResult.outcome === "completed" ? [] : [legacyResult.blockReason]).toEqual(scenarios.pass.findings);

    const phaseOutcome = (phase: string) => runOrchestratorPipeline({
      ...EXECUTION_V1_FIXTURES.pipelineInputs[0],
      failureHistory: [0, 1].map(() => ({
        phase,
        taskGroup: "EG1",
        failingContract: "fixture",
        errorClass: "assertion",
        changedFiles: ["fixture.ts"],
        reviewFindingHash: "fixture",
      })),
    }, DEFAULT_PIPELINE_CONFIG).loopAction;
    expect(phaseOutcome(scenarios.verifyFailure.phase)).toBe("repair");
    expect(phaseOutcome(scenarios.reviewFailure.phase)).toBe("repair");

    const incidentTemplate = EXECUTION_V1_FIXTURES.repairIncidents[0];
    expect([scenarios.incident.status, evaluateRepairIncident(incidentTemplate).decision]).toEqual(["open", "continue"]);
    const decisionFor = (ids: readonly string[]) => evaluateRepairIncident({
      ...incidentTemplate,
      failures: ids.map((id) => ({ ...incidentTemplate.failures[0], id })),
    }).decision;
    expect([decisionFor(scenarios.unchangedSet.prior), decisionFor(scenarios.unchangedSet.current)]).toEqual(["continue", "continue"]);
    expect([decisionFor(scenarios.shrinkingSet.prior), decisionFor(scenarios.shrinkingSet.current)]).toEqual(["repair", "continue"]);
    expect([decisionFor(scenarios.expandingSet.prior), decisionFor(scenarios.expandingSet.current)]).toEqual(["continue", "repair"]);
  });

  test("freezes current repair incident outcomes", () => {
    const outcomes = EXECUTION_V1_FIXTURES.repairIncidents.map((incident) =>
      evaluateRepairIncident(incident).decision
    );
    expect(outcomes).toEqual(["continue", "repair", "replan"]);
  });

  test("freezes current orchestrator pipeline results", () => {
    const results = EXECUTION_V1_FIXTURES.pipelineInputs.map((input) => {
      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);
      return [result.outcome, result.riskResult.tier, result.qualityRouted, result.loopAction];
    });
    expect(results).toEqual([
      ["completed", "standard", false, "continue"],
      ["blocked", "critical", false, "continue"],
      ["completed", "standard", false, "repair"],
    ]);
  });

  test("freezes artifact-state CAS and idempotency behavior", async () => {
    let current: ArtifactVersion = { version: 1, writerId: "fixture", content: "initial", events: [] };
    const seen = new Map<string, StateManagerResult>();
    const store: ArtifactStoreAdapter = {
      capabilities: { atomicCAS: true, idempotencyReplay: true, eventOrLockGuarantees: true },
      async readVersion() { return current; },
      async commitUpdate(_artifact, baseVersion, update) {
        const replay = seen.get(update.idempotencyKey);
        if (replay) return { ...replay, idempotentReplay: true };
        if (baseVersion !== current.version) return { success: false, conflict: { currentVersion: current.version, currentWriter: current.writerId, retryGuidance: "Refresh and retry with the current base version" } };
        current = { ...current, version: current.version + 1, writerId: update.writerId, content: update.content };
        const result = { success: true, newVersion: current.version } satisfies StateManagerResult;
        seen.set(update.idempotencyKey, result);
        return result;
      },
    };
    const update = EXECUTION_V1_FIXTURES.stateUpdate;
    expect(await submitStateUpdate(store, update)).toEqual({ success: true, newVersion: 2 });
    expect((await submitStateUpdate(store, update)).conflict?.currentVersion).toBe(2);
    expect(await submitStateUpdate(store, { ...update, baseVersion: 2 })).toEqual({ success: true, newVersion: 2, idempotentReplay: true });
    expect((await submitStateUpdate(store, { ...update, idempotencyKey: "stale" })).conflict?.currentVersion).toBe(2);
  });

  test("excluded WIP targets are frozen as rejected scope", () => {
    expect(EXECUTION_V1_FIXTURES.scenarios.excludedWip).toEqual({
      target: "openspec/changes/runner-capability-standardization/state.yaml",
      commit: "8c6d167",
      result: "excluded-scope",
    });
  });
});
