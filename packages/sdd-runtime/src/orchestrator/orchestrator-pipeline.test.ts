import { describe, expect, test } from "bun:test";

import {
  runOrchestratorPipeline,
  type OrchestratorPipelineInput,
  type OrchestratorPipelineResult,
  type PipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
  type StageError,
} from "./orchestrator-pipeline";
import { DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "./orchestrator-pipeline";

describe("orchestrator-pipeline", () => {
  describe("init-gate", () => {
    test("initialized: true → normal pipeline", () => {
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
        projectRoot: "/fake/path",
      };

      const config: PipelineConfig = {
        ...DEFAULT_PIPELINE_CONFIG,
        readInitState: (root) => ({ initialized: true }),
      };

      const result = runOrchestratorPipeline(input, config);

      expect(result.outcome).toBe("completed");
      expect(result.delegate).toBeUndefined();
    });

    test("initialized: false → outcome needs-init", () => {
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
        projectRoot: "/fake/path",
      };

      const config: PipelineConfig = {
        ...DEFAULT_PIPELINE_CONFIG,
        readInitState: (root) => ({ initialized: false }),
      };

      const result = runOrchestratorPipeline(input, config);

      expect(result.outcome).toBe("needs-init");
      expect(result.delegate?.skillId).toBe("deck-init");
      expect(result.delegate?.reason).toBe("Project not initialized");
      expect(result.initState?.initialized).toBe(false);
    });

    test("missing config → skip gate (backward compat)", () => {
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
        projectRoot: "/fake/path",
      };

      // No readInitState provided — should skip gate entirely
      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.outcome).toBe("completed");
      expect(result.delegate).toBeUndefined();
    });

    test("readInitState hook not provided → skip gate", () => {
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
        projectRoot: "/fake/path",
      };

      const config: PipelineConfig = {
        ...DEFAULT_PIPELINE_CONFIG,
        // readInitState intentionally not set
      };

      const result = runOrchestratorPipeline(input, config);

      expect(result.outcome).toBe("completed");
      expect(result.delegate).toBeUndefined();
    });
  });

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

    // ── Personality output tests ─────────────────────────────────────────────

    const invalidAuditInput: OrchestratorPipelineInput = {
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

    const lowRiskAuditInput: OrchestratorPipelineInput = {
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

    describe("personality output", () => {
      test("pragmatica output matches current pipeline behavior (baseline regression)", () => {
        const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, personality: "pragmatica" };
        const result = runOrchestratorPipeline(invalidAuditInput, config);

        expect(result.outcome).toBe("blocked");
        expect(result.blockReason).toContain("Self-audit invalid");
        expect(result.blockReason).toContain("full-enforcement");
        expect(result.blockReason).toContain("missing=[invariants,boundaries,externalContracts,sensitiveData,testDirection]");
        // pragmatica does NOT contain CRITICAL-tier issue explanation
        expect(result.blockReason).not.toContain("CRITICAL-tier issue");
        expect(result.blockReason).not.toContain("A valid self-audit is required");
      });

      test("guia output includes expanded rationale with educational context for block reasons", () => {
        const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, personality: "guia" };
        const result = runOrchestratorPipeline(invalidAuditInput, config);

        expect(result.outcome).toBe("blocked");
        expect(result.blockReason).toContain("Self-audit invalid");
        expect(result.blockReason).toContain("CRITICAL-tier issue");
        expect(result.blockReason).toContain("A valid self-audit is required");

        // guia output is longer than pragmatica output due to added rationale
        const pragmaticaResult = runOrchestratorPipeline(invalidAuditInput, {
          ...DEFAULT_PIPELINE_CONFIG,
          personality: "pragmatica",
        });
        expect(result.blockReason!.length).toBeGreaterThan(pragmaticaResult.blockReason!.length);
      });

      test("undefined personality defaults to pragmatica and produces standard output", () => {
        const configNoPersonality: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG };
        const resultDefault = runOrchestratorPipeline(invalidAuditInput, configNoPersonality);
        const resultPragmatica = runOrchestratorPipeline(invalidAuditInput, {
          ...DEFAULT_PIPELINE_CONFIG,
          personality: "pragmatica",
        });

        // blockReason should be identical for pragmatica and default (undefined → pragmatica)
        expect(resultDefault.blockReason).toBe(resultPragmatica.blockReason);
        expect(resultDefault.outcome).toBe(resultPragmatica.outcome);
        expect(resultDefault.auditValid).toBe(resultPragmatica.auditValid);
      });

      test("low-risk: pragmatica produces standard skip reason", () => {
        const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, personality: "pragmatica" };
        const result = runOrchestratorPipeline(lowRiskAuditInput, config);

        // Low risk → qualityRouted=false, skipReason should be set
        expect(result.qualityRouted).toBe(false);
        expect(result.qualityDecision.skipReason).toBeTruthy();
        if (result.qualityDecision.skipReason) {
          expect(result.qualityDecision.skipReason).toContain("Risk score");
          expect(result.qualityDecision.skipReason).toContain("below standard threshold");
          expect(result.qualityDecision.skipReason).not.toContain("why it matters");
        }
      });

      test("low-risk: guia produces expanded rationale in skip reason", () => {
        const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, personality: "guia" };
        const result = runOrchestratorPipeline(lowRiskAuditInput, config);

        expect(result.qualityRouted).toBe(false);
        expect(result.qualityDecision.skipReason).toBeTruthy();
        if (result.qualityDecision.skipReason) {
          // guia adds context but for skip reason the format is the same base text
          expect(result.qualityDecision.skipReason).toContain("Risk score");
          expect(result.qualityDecision.skipReason).toContain("below standard threshold");
        }
      });

      test("low-risk: machine-readable skip fields identical across guia and pragmatica", () => {
        const personalities: OrchestratorPersonality[] = ["guia", "pragmatica"];
        const results = personalities.map((p) =>
          runOrchestratorPipeline(lowRiskAuditInput, { ...DEFAULT_PIPELINE_CONFIG, personality: p }),
        );

        // qualityRouted must be identical
        expect(new Set(results.map((r) => r.qualityRouted)).size).toBe(1);
        // qualityDecision.invokeQuality must be identical
        expect(new Set(results.map((r) => r.qualityDecision.invokeQuality)).size).toBe(1);
        // qualityDecision.checksToRun must be identical
        expect(new Set(results.map((r) => JSON.stringify(r.qualityDecision.checksToRun))).size).toBe(1);
        // qualityDecision.requiresReplanOrOverride must be identical
        expect(new Set(results.map((r) => r.qualityDecision.requiresReplanOrOverride)).size).toBe(1);
      });

      test("pragmatica personality output format matches current orchestrator behavior", () => {
        // This is a regression test: pragmatica should match the existing
        // orchestrator output format that existed before personality was introduced.
        const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, personality: "pragmatica" };
        const result = runOrchestratorPipeline(invalidAuditInput, config);

        // The pragmatica format is: "Self-audit invalid in {mode}: missing=[...]" (invalid= omitted when empty)
        expect(result.blockReason).toMatch(/^Self-audit invalid in full-enforcement mode: missing=\[.*\]$/);
      });
    });

    // ── Stage isolation tests ─────────────────────────────────────────────────

    test("stageErrors is empty when pipeline completes without errors", () => {
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

      expect(result.outcome).toBe("completed");
      expect(result.stageErrors).toBeDefined();
      expect(result.stageErrors.length).toBe(0);
    });

    test("invalid audit collects error in stageErrors and pipeline continues", () => {
      // Null audit should be normalized and produce a stage error
      const input = {
        audit: null as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      // Pipeline should continue despite null audit
      expect(result.riskResult).toBeDefined();
      expect(result.qualityDecision).toBeDefined();
      expect(result.loopAction).toBeDefined();
      // Audit error is recorded
      const auditError = result.stageErrors.find((e) => e.stage === "audit");
      expect(auditError).toBeDefined();
      expect(auditError!.recoverable).toBe(false);
    });

    test("all stages execute even when one stage fails", () => {
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
        failureHistory: [
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

      // All stages should have run — check that loop stage was reached
      expect(result.loopAction).toBeDefined();
      // risk and quality should have results
      expect(result.riskResult).toBeDefined();
      expect(result.qualityDecision).toBeDefined();
    });

    test("invalid audit in report-only mode sets outcome to partial", () => {
      const input = {
        audit: null as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      expect(result.outcome).toBe("partial");
      expect(result.auditValid).toBe(false);
      // Audit error is in stageErrors
      const auditError = result.stageErrors.find((e) => e.stage === "audit");
      expect(auditError).toBeDefined();
    });

    test("enforced invalid audit sets outcome to blocked", () => {
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

      expect(result.outcome).toBe("blocked");
      expect(result.auditValid).toBe(false);
      expect(result.blockReason).toBeTruthy();
    });

    test("stageErrors contains stage name and error message on validation failure", () => {
      const input = {
        audit: null as unknown as OrchestratorPipelineInput["audit"],
        auditType: "spec" as const,
        enforcementMode: "report-only" as const,
      };

      const result = runOrchestratorPipeline(input, DEFAULT_PIPELINE_CONFIG);

      const auditError = result.stageErrors.find((e) => e.stage === "audit");
      expect(auditError).toBeDefined();
      expect(auditError!.stage).toBe("audit");
      expect(auditError!.error).toBeTruthy();
      expect(typeof auditError!.recoverable).toBe("boolean");
    });

    test("pipeline runs in report-only mode regardless of stage errors", () => {
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

      // Should proceed through all stages despite invalid audit
      expect(result.riskResult).toBeDefined();
      expect(result.qualityDecision).toBeDefined();
      expect(result.loopAction).toBeDefined();
      expect(result.outcome).toBe("partial");
    });
  });
});
