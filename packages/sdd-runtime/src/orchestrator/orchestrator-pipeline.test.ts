import { describe, expect, test } from "bun:test";

import {
  runOrchestratorPipeline,
  type OrchestratorPipelineInput,
  type OrchestratorPipelineResult,
  type PipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
} from "./orchestrator-pipeline";

describe("orchestrator-pipeline", () => {
  describe("runOrchestratorPipeline", () => {
    test("low-risk passes through without quality invocation", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "simple change",
          boundaries: "single module",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.95,
          externalContracts: [],
          sensitiveData: [],
          testDirection: "unit-first",
        },
        auditType: "spec",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.qualityRouted).toBe(false);
      expect(result.loopAction).toBe("continue");
      expect(result.riskResult.score).toBeLessThan(30);
      expect(result.outcome).toBe("completed");
    });

    test("high-risk routes to quality with checks", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "payment processing",
          boundaries: "cross-boundary",
          ambiguity: ["unclear about error handling"],
          riskSignals: [
            { name: "secret_handling", evidence: "payment tokens" },
            { name: "cross_boundary_integration", evidence: "payment + order" },
          ],
          confidence: 0.4,
        },
        auditType: "spec",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.qualityRouted).toBe(true);
      expect(result.qualityDecision.checksToRun.length).toBeGreaterThan(0);
      expect(result.riskResult.score).toBeGreaterThanOrEqual(30);
    });

    test("loop breaker intercepts repeated failures in pipeline", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "defined",
          boundaries: "defined",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.9,
        },
        auditType: "spec",
        failureHistory: [
          {
            phase: "verify",
            taskGroup: "1.1",
            failingContract: "test",
            errorClass: "assertion",
            changedFiles: ["a.ts"],
            reviewFindingHash: "h1",
          },
          {
            phase: "verify",
            taskGroup: "1.1",
            failingContract: "test",
            errorClass: "assertion",
            changedFiles: ["a.ts"],
            reviewFindingHash: "h1",
          },
        ],
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.loopAction).toBe("repair");
    });

    // ── Enforcement mode blocking tests ──

    test("report-only mode: invalid audit produces partial outcome but continues", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "",
          boundaries: "",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.5,
        },
        auditType: "spec",
        enforcementMode: "report-only",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.blockReason).toBeTruthy();
      // Should still proceed to scoring
      expect(result.riskResult).toBeDefined();
    });

    test("conditional-routing mode: invalid audit blocks the pipeline", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "",
          boundaries: "",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.5,
        },
        auditType: "spec",
        enforcementMode: "conditional-routing",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("blocked");
      expect(result.blockReason).toContain("conditional-routing");
      expect(result.qualityRouted).toBe(false);
      expect(result.riskResult.score).toBe(100);
      expect(result.riskResult.tier).toBe("critical");
    });

    test("full-enforcement mode: invalid audit blocks the pipeline", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "",
          boundaries: "",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.5,
        },
        auditType: "spec",
        enforcementMode: "full-enforcement",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("blocked");
      expect(result.blockReason).toContain("full-enforcement");
      expect(result.qualityDecision.requiresReplanOrOverride).toBe(true);
    });

    test("conditional-routing mode: valid audit completes normally", () => {
      const input: OrchestratorPipelineInput = {
        audit: {
          invariants: "defined",
          boundaries: "defined",
          ambiguity: [],
          riskSignals: [],
          confidence: 0.9,
          externalContracts: [],
          sensitiveData: [],
          testDirection: "unit-first",
        },
        auditType: "spec",
        enforcementMode: "conditional-routing",
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(true);
      expect(result.outcome).toBe("completed");
    });

    // ── Null/primitive/missing arrays audit normalization tests ──

    test("report-only: null audit produces partial outcome without throwing", () => {
      const input = {
        audit: null as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.riskResult).toBeDefined();
      expect(result.riskResult.confidence).toBe(0);
    });

    test("report-only: primitive string audit produces partial outcome without throwing", () => {
      const input = {
        audit: "not an audit" as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      // Score comes from confidence penalty: gap(1-0) * 20 = 20
      expect(result.riskResult.score).toBe(20);
    });

    test("report-only: audit with missing riskSignals produces partial outcome without throwing", () => {
      const input = {
        audit: {
          invariants: "defined",
          boundaries: "defined",
          ambiguity: [],
          confidence: 0.5,
        } as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.riskResult).toBeDefined();
    });

    test("report-only: audit with missing ambiguity produces partial outcome without throwing", () => {
      const input = {
        audit: {
          invariants: "defined",
          boundaries: "defined",
          riskSignals: [],
          confidence: 0.5,
        } as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.riskResult).toBeDefined();
    });

    test("default mode (no enforcement): null audit produces partial outcome without throwing", () => {
      const input = {
        audit: null as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.riskResult).toBeDefined();
      expect(result.riskResult.confidence).toBe(0);
    });

    test("report-only: audit with non-array riskSignals normalizes safely", () => {
      const input = {
        audit: {
          invariants: "defined",
          boundaries: "defined",
          ambiguity: [],
          riskSignals: "not an array",
          confidence: 0.5,
        } as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.auditValid).toBe(false);
      expect(result.outcome).toBe("partial");
      expect(result.riskResult.signals.length).toBe(0);
    });
  });
});
