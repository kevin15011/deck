import { describe, expect, test } from "bun:test";

import { computeRiskScore, DEFAULT_SCORER_CONFIG } from "./orchestrator/risk-scorer";
import { routeQuality, DEFAULT_ROUTER_CONFIG } from "./orchestrator/quality-router";
import { checkLoopCondition, DEFAULT_LOOP_BREAKER_CONFIG } from "./orchestrator/loop-breaker";
import { classifyTransportFailure, attemptResume, validateArtifactForResume, DEFAULT_RECOVERY_CONFIG } from "./runner/runner-recovery";
import { submitStateUpdate, validateAdapterCapabilities, type ArtifactStoreAdapter, type ArtifactVersion } from "./artifact-state/artifact-state-manager";
import { checkBudget, DEFAULT_BUDGET_CONFIG } from "./orchestrator/budget-watchdog";

describe("scenario tests", () => {
  describe("4.1: low-risk no-extra-quality", () => {
    test("score <30 → no quality agent invoked, skip decision logged", () => {
      const riskResult = computeRiskScore(
        { ambiguity: [], riskSignals: [], confidence: 0.95 },
        DEFAULT_SCORER_CONFIG,
      );

      expect(riskResult.score).toBeLessThan(30);

      const routing = routeQuality(riskResult, DEFAULT_ROUTER_CONFIG);

      expect(routing.invokeQuality).toBe(false);
      expect(routing.skipReason).toBeTruthy();
      expect(routing.checksToRun).toEqual([]);
    });
  });

  describe("4.2: high-risk conditional quality", () => {
    test("score >=60 → quality gate enforced before Apply", () => {
      const riskResult = computeRiskScore(
        {
          ambiguity: [],
          riskSignals: [
            { name: "secret_handling", weight: 0.9, evidence: "JWT token flow" },
            { name: "cross_boundary_integration", weight: 0.7, evidence: "auth + billing" },
          ],
          confidence: 0.5,
        },
        DEFAULT_SCORER_CONFIG,
      );

      expect(riskResult.score).toBeGreaterThanOrEqual(60);

      const routing = routeQuality(riskResult, DEFAULT_ROUTER_CONFIG);

      expect(routing.invokeQuality).toBe(true);
      expect(routing.checksToRun.length).toBeGreaterThan(0);
    });
  });

  describe("4.3: repeated loop replan", () => {
    test("3 similar failures trigger replan; different failures do not falsely loop", () => {
      const fp = {
        phase: "verify" as const,
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["risk-scorer.ts"],
        reviewFindingHash: "abc123",
      };

      const sameResult = checkLoopCondition(fp, [fp, fp], DEFAULT_LOOP_BREAKER_CONFIG);
      expect(sameResult.action).toBe("replan");
      expect(sameResult.similarCount).toBe(3);

      const differentFp = {
        phase: "review" as const,
        taskGroup: "3.2",
        failingContract: "quality-router",
        errorClass: "timeout",
        changedFiles: ["quality-router.ts"],
        reviewFindingHash: "def456",
      };

      const diffResult = checkLoopCondition(fp, [differentFp, differentFp], DEFAULT_LOOP_BREAKER_CONFIG);
      expect(diffResult.action).toBe("continue");
      expect(diffResult.similarCount).toBe(1);
    });
  });

  describe("4.4: transport error with artifact present-valid", () => {
    test("resume from valid artifact, not relaunch duplicate work", () => {
      const failureResult = classifyTransportFailure({
        transportDisconnected: true,
        artifactPresent: true,
        artifactValid: true,
        artifactFresh: true,
      });

      expect(failureResult.classification).toBe("artifact_present_valid");

      const resumeResult = attemptResume(
        failureResult,
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc123",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-scenario-4.4",
        },
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.fromArtifact).toBe(true);
      expect(resumeResult.relaunch).toBe(false);
    });

    test("does NOT resume from artifact missing hash — conservative", () => {
      const failureResult = classifyTransportFailure({
        transportDisconnected: true,
        artifactPresent: true,
        artifactValid: true,
        artifactFresh: true,
      });

      const resumeResult = attemptResume(
        failureResult,
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: undefined, // missing hash
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-scenario-4.4b",
        },
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(resumeResult.resumed).toBe(false);
      expect(resumeResult.relaunch).toBe(true);
    });
  });

  describe("4.5: stale state update recovery", () => {
    test("rejected with current version + retry guidance; refresh-retry succeeds", async () => {
      let current: ArtifactVersion = { version: 1, writerId: "init", content: "initial", events: [] };
      const store: ArtifactStoreAdapter = {
        capabilities: { atomicCAS: true, idempotencyReplay: true, eventOrLockGuarantees: true },
        async readVersion(): Promise<ArtifactVersion> {
          return { ...current };
        },
        async commitUpdate(
          _artifact: string,
          baseVersion: number,
          update: { writerId: string; content: string; idempotencyKey: string },
        ) {
          if (baseVersion !== current.version) {
            return {
              success: false as const,
              conflict: {
                currentVersion: current.version,
                currentWriter: current.writerId,
                retryGuidance: "Refresh and retry with current version",
              },
            };
          }
          current = {
            version: current.version + 1,
            writerId: update.writerId,
            content: update.content,
            events: [...current.events, { type: "update", writerId: update.writerId, timestamp: new Date().toISOString() }],
          };
          return { success: true as const, newVersion: current.version };
        },
      };

      // First attempt with stale version
      const stale = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: 0,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      });

      expect(stale.success).toBe(false);
      expect(stale.conflict!.currentVersion).toBe(1);
      expect(stale.conflict!.retryGuidance).toBeTruthy();

      // Refresh and retry
      const fresh = await store.readVersion("test.md");
      const retry = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: fresh.version,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1-retry",
        timestamp: new Date().toISOString(),
      });

      expect(retry.success).toBe(true);
    });

    test("weak adapter is rejected — no stale safety without required capabilities", async () => {
      const weakStore: ArtifactStoreAdapter = {
        capabilities: { atomicCAS: false, idempotencyReplay: false, eventOrLockGuarantees: false },
        async readVersion(): Promise<ArtifactVersion> {
          return { version: 1, writerId: "init", content: "initial", events: [] };
        },
        async commitUpdate(): Promise<{ success: boolean; newVersion?: number }> {
          return { success: true, newVersion: 2 };
        },
      };

      const result = await submitStateUpdate(weakStore, {
        targetArtifact: "test.md",
        baseVersion: 1,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.conflict!.retryGuidance).toContain("atomicCAS");
    });
  });

  describe("4.6: budget escalation", () => {
    test("soft budget → checkpoint prompt; hard budget → stop with budget-exceeded outcome", () => {
      // Soft budget
      const softResult = checkBudget(
        { tokensUsed: 45000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 },
        DEFAULT_BUDGET_CONFIG,
      );

      expect(softResult.status).toBe("soft_budget");
      expect(softResult.checkpointRequested).toBe(true);
      expect(softResult.mustStop).toBe(false);

      // Hard budget
      const hardResult = checkBudget(
        { tokensUsed: 65000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 },
        DEFAULT_BUDGET_CONFIG,
      );

      expect(hardResult.status).toBe("hard_budget");
      expect(hardResult.mustStop).toBe(true);
      expect(hardResult.outcome).toBe("budget_exceeded");
      expect(hardResult.budgetReport).toBeDefined();
    });
  });
});
