import { describe, expect, test } from "bun:test";

import {
  runRunnerPipeline,
  type RunnerPipelineInput,
  type RunnerPipelineResult,
  type RunnerPipelineConfig,
  DEFAULT_RUNNER_PIPELINE_CONFIG,
} from "./runner-pipeline";

describe("runner-pipeline", () => {
  describe("runRunnerPipeline", () => {
    test("resumes from valid artifact when transport lost after write", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: true,
          artifactValid: true,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-test",
        },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.classification).toBe("artifact_present_valid");
      expect(result.resumed).toBe(true);
    });

    test("retries on transport failure without artifact", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: false,
          artifactValid: false,
          artifactFresh: false,
        },
        artifactValidation: {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.classification).toBe("transport_failure_no_artifact");
      expect(result.resumed).toBe(false);
      expect(result.retryAllowed).toBe(true);
    });

    test("reports implementation failure when transport is fine", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: false,
          artifactPresent: true,
          artifactValid: false,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.classification).toBe("implementation_failure");
      expect(result.resumed).toBe(false);
    });

    // ── Hard budget override tests ──

    test("hard budget overrides runner continuation even with valid artifact", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: true,
          artifactValid: true,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-test",
        },
        budgetUsage: { tokensUsed: 65000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      // Hard budget must override — no resume
      expect(result.resumed).toBe(false);
      expect(result.retryAllowed).toBe(false);
      expect(result.budgetOutcome).toBe("budget_exceeded");
      expect(result.breachedDimension).toBe("tokens");
      expect(result.budgetStatus).toBe("hard_budget");
      // Must NOT be classified as implementation_failure
      expect(result.classification).toBe("budget_exhausted");
      expect(result.classification).not.toBe("implementation_failure");
    });

    test("hard budget on turns stops runner regardless of recovery", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: false,
          artifactValid: false,
          artifactFresh: false,
        },
        artifactValidation: {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
        budgetUsage: { tokensUsed: 1000, turnsUsed: 20, timeElapsedMs: 60000, toolCallsUsed: 5 },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.resumed).toBe(false);
      expect(result.retryAllowed).toBe(false);
      expect(result.budgetOutcome).toBe("budget_exceeded");
      expect(result.breachedDimension).toBe("turns");
      // Must NOT be classified as implementation_failure
      expect(result.classification).toBe("budget_exhausted");
    });

    test("soft budget does not block resume", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: true,
          artifactValid: true,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-test",
        },
        budgetUsage: { tokensUsed: 45000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      // Soft budget should NOT block resume
      expect(result.resumed).toBe(true);
      expect(result.budgetOutcome).toBeUndefined();
      expect(result.budgetStatus).toBe("soft_budget");
    });

    test("no budget usage provided does not block runner", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: true,
          artifactPresent: true,
          artifactValid: true,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-test",
        },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.resumed).toBe(true);
      expect(result.budgetStatus).toBeUndefined();
      expect(result.budgetOutcome).toBeUndefined();
    });

    test("hard budget exhaustion is never counted as implementation_failure", () => {
      const input: RunnerPipelineInput = {
        transportContext: {
          transportDisconnected: false,
          artifactPresent: true,
          artifactValid: false,
          artifactFresh: true,
        },
        artifactValidation: {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
        budgetUsage: { tokensUsed: 70000, turnsUsed: 3, timeElapsedMs: 30000, toolCallsUsed: 2 },
      };

      const result = runRunnerPipeline(input, DEFAULT_RUNNER_PIPELINE_CONFIG);

      expect(result.classification).toBe("budget_exhausted");
      expect(result.classification).not.toBe("implementation_failure");
      expect(result.budgetOutcome).toBe("budget_exceeded");
    });
  });
});
