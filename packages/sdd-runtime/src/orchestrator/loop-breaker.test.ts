import { describe, expect, test } from "bun:test";

import {
  classifyFailure,
  checkLoopCondition,
  type FailureFingerprint,
  type LoopBreakerConfig,
  DEFAULT_LOOP_BREAKER_CONFIG,
} from "./loop-breaker";

describe("loop-breaker", () => {
  describe("classifyFailure / checkLoopCondition", () => {
    test("two similar failures trigger task repair", () => {
      const fingerprint: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["risk-scorer.ts"],
        reviewFindingHash: "abc123",
      };

      const config = DEFAULT_LOOP_BREAKER_CONFIG;
      const history = [fingerprint];

      const result = checkLoopCondition(fingerprint, history, config);

      expect(result.action).toBe("repair");
      expect(result.similarCount).toBe(2);
    });

    test("three similar failures trigger replan", () => {
      const fingerprint: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["risk-scorer.ts"],
        reviewFindingHash: "abc123",
      };

      const history = [fingerprint, fingerprint];
      const result = checkLoopCondition(fingerprint, history, DEFAULT_LOOP_BREAKER_CONFIG);

      expect(result.action).toBe("replan");
      expect(result.similarCount).toBe(3);
    });

    test("four similar failures trigger escalation", () => {
      const fingerprint: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["risk-scorer.ts"],
        reviewFindingHash: "abc123",
      };

      const history = [fingerprint, fingerprint, fingerprint];
      const result = checkLoopCondition(fingerprint, history, DEFAULT_LOOP_BREAKER_CONFIG);

      expect(result.action).toBe("escalate");
      expect(result.similarCount).toBe(4);
    });

    test("different failures do not falsely loop", () => {
      const fingerprint: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["risk-scorer.ts"],
        reviewFindingHash: "abc123",
      };

      const differentFingerprint: FailureFingerprint = {
        phase: "review",
        taskGroup: "3.2",
        failingContract: "quality-router",
        errorClass: "timeout",
        changedFiles: ["quality-router.ts"],
        reviewFindingHash: "def456",
      };

      const history = [differentFingerprint, differentFingerprint, differentFingerprint];
      const result = checkLoopCondition(fingerprint, history, DEFAULT_LOOP_BREAKER_CONFIG);

      expect(result.similarCount).toBe(1);
      expect(result.action).toBe("continue");
    });

    test("empty history returns continue with count 1", () => {
      const fingerprint: FailureFingerprint = {
        phase: "apply",
        taskGroup: "1.1",
        failingContract: "self-audit",
        errorClass: "type_error",
        changedFiles: ["self-audit.ts"],
        reviewFindingHash: "xyz",
      };

      const result = checkLoopCondition(fingerprint, [], DEFAULT_LOOP_BREAKER_CONFIG);

      expect(result.action).toBe("continue");
      expect(result.similarCount).toBe(1);
    });

    test("normalized fingerprints match despite minor file order differences", () => {
      const fp1: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["a.ts", "b.ts"],
        reviewFindingHash: "abc",
      };

      const fp2: FailureFingerprint = {
        phase: "verify",
        taskGroup: "2.1",
        failingContract: "risk-scorer",
        errorClass: "assertion_error",
        changedFiles: ["b.ts", "a.ts"],
        reviewFindingHash: "abc",
      };

      const result = checkLoopCondition(fp1, [fp2], DEFAULT_LOOP_BREAKER_CONFIG);

      expect(result.similarCount).toBe(2);
    });
  });
});
