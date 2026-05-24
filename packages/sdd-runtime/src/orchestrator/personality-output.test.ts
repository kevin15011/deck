import { describe, expect, test } from "bun:test";

import {
  formatBlockReason,
  formatSkipReason,
  formatLoopBreakerMessage,
  ORCHESTRATOR_PERSONALITIES,
  DEFAULT_ORCHESTRATOR_PERSONALITY,
  type BlockReasonFacts,
  type SkipReasonFacts,
  type LoopBreakerFacts,
} from "./personality-output";

describe("personality-output", () => {
  // ── Constants ──────────────────────────────────────────────────────────────

  describe("ORCHESTRATOR_PERSONALITIES", () => {
    test("contains exactly three personalities", () => {
      expect(ORCHESTRATOR_PERSONALITIES).toEqual(["guia", "pragmatica", "ahorro-extremo"]);
    });
  });

  describe("DEFAULT_ORCHESTRATOR_PERSONALITY", () => {
    test("is pragmatica", () => {
      expect(DEFAULT_ORCHESTRATOR_PERSONALITY).toBe("pragmatica");
    });
  });

  // ── formatBlockReason ─────────────────────────────────────────────────────

  describe("formatBlockReason", () => {
    const baseFacts: BlockReasonFacts = {
      missingFields: ["invariants", "boundaries"],
      invalidFields: ["confidence"],
      enforcementMode: "full-enforcement",
      auditType: "spec",
      isCritical: false,
    };

    test("guia includes full rationale and educational context", () => {
      const result = formatBlockReason(baseFacts, "guia");
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("full-enforcement");
      expect(result).toContain("Missing fields");
      expect(result).toContain("Invalid fields");
      expect(result).toContain("A valid self-audit ensures");
      expect(result).not.toContain("[CRITICAL]");
    });

    test("guia with critical=true adds critical-tier warning", () => {
      const result = formatBlockReason({ ...baseFacts, isCritical: true }, "guia");
      expect(result).toContain("CRITICAL-tier issue");
      expect(result).toContain("A valid self-audit is required");
      expect(result).not.toContain("[CRITICAL]");
    });

    test("pragmatica returns standard explanation (matches current behavior)", () => {
      const result = formatBlockReason(baseFacts, "pragmatica");
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("full-enforcement");
      expect(result).toContain("missing=[invariants,boundaries]");
      expect(result).toContain("invalid=[confidence]");
      expect(result).not.toContain("Missing fields");
      expect(result).not.toContain("A valid self-audit ensures");
    });

    test("ahorro-extremo returns one-line mandatory summary", () => {
      const result = formatBlockReason(baseFacts, "ahorro-extremo");
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("missing=[invariants,boundaries]");
      expect(result).not.toContain("A valid self-audit ensures");
      // Should be a single line — no newlines in output
      expect(result.split("\n").length).toBe(1);
    });

    test("ahorro-extremo with critical=true adds [CRITICAL] marker", () => {
      const result = formatBlockReason({ ...baseFacts, isCritical: true }, "ahorro-extremo");
      expect(result).toContain("[CRITICAL]");
      expect(result.split("\n").length).toBe(1);
    });

    test("unknown personality defaults to pragmatica", () => {
      const result = formatBlockReason(baseFacts, "unknown-personality" as never);
      // Should produce pragmatica output (standard explanation)
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("missing=[invariants,boundaries]");
    });

    test("undefined personality defaults to pragmatica", () => {
      const result = formatBlockReason(baseFacts, undefined);
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("missing=[invariants,boundaries]");
    });

    test("null personality defaults to pragmatica", () => {
      const result = formatBlockReason(baseFacts, null);
      expect(result).toContain("Self-audit invalid");
      expect(result).toContain("missing=[invariants,boundaries]");
    });

    test("empty missingFields and invalidFields handled gracefully", () => {
      const facts = { ...baseFacts, missingFields: [], invalidFields: [] };
      const guiaResult = formatBlockReason(facts, "guia");
      const pragmaticaResult = formatBlockReason(facts, "pragmatica");
      const ahorroResult = formatBlockReason(facts, "ahorro-extremo");

      expect(guiaResult).toContain("Self-audit invalid");
      expect(pragmaticaResult).toContain("Self-audit invalid");
      expect(ahorroResult).toContain("Self-audit invalid");
    });

    test("single missing field is formatted correctly", () => {
      const facts = { ...baseFacts, missingFields: ["invariants"], invalidFields: [] };
      const result = formatBlockReason(facts, "pragmatica");
      expect(result).toContain("missing=[invariants]");
    });
  });

  // ── formatSkipReason ───────────────────────────────────────────────────────

  describe("formatSkipReason", () => {
    const baseFacts: SkipReasonFacts = {
      riskScore: 22,
      threshold: 30,
      tier: "standard",
    };

    test("guia includes full rationale and educational context", () => {
      const result = formatSkipReason(baseFacts, "guia");
      expect(result).toContain("Risk score 22");
      expect(result).toContain("standard tier");
      expect(result).toContain("quality routing threshold of 30");
      expect(result).toContain("no quality agents will be invoked");
      expect(result).toContain("A valid risk assessment is needed");
    });

    test("pragmatica returns standard explanation", () => {
      const result = formatSkipReason(baseFacts, "pragmatica");
      expect(result).toContain("Risk score 22");
      expect(result).toContain("below standard threshold 30");
      expect(result).toContain("no quality agents needed");
      expect(result).not.toContain("A valid risk assessment");
    });

    test("ahorro-extremo returns one-line summary", () => {
      const result = formatSkipReason(baseFacts, "ahorro-extremo");
      expect(result).toContain("22");
      expect(result).toContain("30");
      expect(result).not.toContain("A valid risk assessment");
      expect(result.split("\n").length).toBe(1);
    });

    test("guia with override includes override explanation", () => {
      const facts: SkipReasonFacts = {
        ...baseFacts,
        overrideName: "test-override",
        overrideExpiresAt: "2025-12-31",
        tier: "critical",
      };
      const result = formatSkipReason(facts, "guia");
      expect(result).toContain("test-override");
      expect(result).toContain("override");
      expect(result).toContain("expires 2025-12-31");
    });

    test("pragmatica with override returns standard override wording", () => {
      const facts: SkipReasonFacts = {
        ...baseFacts,
        overrideName: "test-override",
        overrideExpiresAt: "2025-12-31",
        tier: "critical",
      };
      const result = formatSkipReason(facts, "pragmatica");
      expect(result).toContain("test-override");
      expect(result).toContain("expiring 2025-12-31");
    });

    test("ahorro-extremo with override returns concise override summary", () => {
      const facts: SkipReasonFacts = {
        ...baseFacts,
        overrideName: "test-override",
        overrideExpiresAt: "2025-12-31",
        tier: "critical",
      };
      const result = formatSkipReason(facts, "ahorro-extremo");
      expect(result).toContain("test-override");
      expect(result).toContain("expires 2025-12-31");
      expect(result.split("\n").length).toBe(1);
    });

    test("unknown personality defaults to pragmatica", () => {
      const result = formatSkipReason(baseFacts, "unknown" as never);
      expect(result).toContain("Risk score 22");
      expect(result).toContain("below standard threshold 30");
    });

    test("undefined tier handled gracefully", () => {
      const facts = { ...baseFacts, tier: undefined };
      const result = formatSkipReason(facts, "guia");
      expect(result).toContain("Risk score 22");
      expect(result).not.toContain("undefined");
    });
  });

  // ── formatLoopBreakerMessage ───────────────────────────────────────────────

  describe("formatLoopBreakerMessage", () => {
    const baseFacts: LoopBreakerFacts = {
      action: "repair",
      similarCount: 3,
      phase: "verify",
      taskGroup: "1.1",
      failingContract: "test",
    };

    test("guia includes full explanation and recommended next step", () => {
      const result = formatLoopBreakerMessage(baseFacts, "guia");
      expect(result).toContain("repair");
      expect(result).toContain("3 similar failures");
      expect(result).toContain("phase=");
      expect(result).toContain("taskGroup=");
      expect(result).toContain("contract=");
      expect(result).toContain("Review the failing contract");
    });

    test("pragmatica returns concise explanation", () => {
      const result = formatLoopBreakerMessage(baseFacts, "pragmatica");
      expect(result).toContain("Repair"); // capitalized
      expect(result).toContain("3 similar failures");
      expect(result).toContain("phase=verify");
      expect(result).toContain("taskGroup=1.1");
      expect(result).not.toContain("Review the failing contract");
    });

    test("ahorro-extremo returns single-line summary", () => {
      const result = formatLoopBreakerMessage(baseFacts, "ahorro-extremo");
      expect(result).toContain("Repair");
      expect(result).toContain("3 similar failures");
      expect(result.split("\n").length).toBe(1);
      expect(result).not.toContain("phase=");
      expect(result).not.toContain("Review");
    });

    test("ahorro-extremo for continue action is minimal", () => {
      const facts: LoopBreakerFacts = { action: "continue", similarCount: 0 };
      const result = formatLoopBreakerMessage(facts, "ahorro-extremo");
      expect(result).toContain("Continue");
      expect(result.split("\n").length).toBe(1);
    });

    test("all actions produce valid guia explanations", () => {
      const actions: LoopBreakerFacts["action"][] = ["continue", "repair", "replan", "escalate"];
      for (const action of actions) {
        const facts = { action, similarCount: 2, phase: "verify", taskGroup: "1.1", failingContract: "test" };
        const result = formatLoopBreakerMessage(facts, "guia");
        expect(result).toContain(action);
        expect(result).toContain("2 similar failures");
      }
    });

    test("unknown personality defaults to pragmatica", () => {
      const result = formatLoopBreakerMessage(baseFacts, "unknown" as never);
      expect(result).toContain("Repair"); // pragmatica capitalizes
      expect(result).toContain("3 similar failures");
    });

    test("minimal facts (no phase/taskGroup/contract) handled gracefully", () => {
      const facts: LoopBreakerFacts = { action: "repair", similarCount: 2 };
      const result = formatLoopBreakerMessage(facts, "pragmatica");
      expect(result).toContain("Repair");
      expect(result).toContain("2 similar failures");
      expect(result).not.toContain("phase=");
    });
  });

  // ── Personality invariance ─────────────────────────────────────────────────

  describe("machine-readable field invariance", () => {
    test("formatBlockReason produces structurally different output per personality", () => {
      const facts: BlockReasonFacts = {
        missingFields: ["invariants"],
        invalidFields: ["confidence"],
        enforcementMode: "full-enforcement",
        auditType: "spec",
      };

      const guia = formatBlockReason(facts, "guia");
      const pragmatica = formatBlockReason(facts, "pragmatica");
      const ahorro = formatBlockReason({ ...facts, isCritical: true }, "ahorro-extremo"); // critical=true to differentiate from pragmatica

      // guia is longest (full explanation), pragmatica is medium, ahorro-extremo (critical) is shortest with [CRITICAL]
      expect(guia.length).toBeGreaterThan(pragmatica.length);

      // ahorro-extremo with critical=true differs from pragmatica
      expect(ahorro).not.toBe(pragmatica);
      expect(ahorro).toContain("[CRITICAL]");
    });

    test("formatSkipReason produces structurally different output per personality", () => {
      const facts: SkipReasonFacts = { riskScore: 22, threshold: 30, tier: "standard" };

      const guia = formatSkipReason(facts, "guia");
      const pragmatica = formatSkipReason(facts, "pragmatica");
      const ahorro = formatSkipReason(facts, "ahorro-extremo");

      // guia is longest (full rationale), pragmatica is medium, ahorro-extremo is shortest
      expect(guia.length).toBeGreaterThan(pragmatica.length);
      expect(pragmatica.length).toBeGreaterThan(ahorro.length);

      // guia contains educational context; pragmatica does not; ahorro is single-line
      expect(guia).toContain("A valid risk assessment is needed");
      expect(pragmatica).not.toContain("A valid risk assessment is needed");
    });

    test("formatLoopBreakerMessage produces structurally different output per personality", () => {
      const facts: LoopBreakerFacts = { action: "repair", similarCount: 3, phase: "verify", taskGroup: "1.1" };

      const guia = formatLoopBreakerMessage(facts, "guia");
      const pragmatica = formatLoopBreakerMessage(facts, "pragmatica");
      const ahorro = formatLoopBreakerMessage(facts, "ahorro-extremo");

      expect(guia.length).toBeGreaterThan(pragmatica.length);
      expect(pragmatica.length).toBeGreaterThan(ahorro.length);
      expect(guia).toContain("Review");
      expect(pragmatica).not.toContain("Review");
      expect(ahorro).not.toContain("Review");
    });
  });
});