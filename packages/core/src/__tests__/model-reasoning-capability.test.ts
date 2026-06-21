/**
 * Model Reasoning Capability Tests
 *
 * Tests the model-reasoning-capability.ts resolver with EG-1 T2 updates:
 * - Runner variants signal support
 * - Runner explicit signal takes precedence
 * - Catalog fallback for known models
 * - Unknown models default to false (safe)
 */

import { describe, it, expect } from "bun:test";
import {
  resolveReasoningEffortSupport,
  type ResolveReasoningSupportInput,
} from "../model-reasoning-capability";
import { getModelCatalog } from "../model-catalog";

const catalog = getModelCatalog();

describe("resolveReasoningEffortSupport", () => {
  // ---------------------------------------------------------------------------
  // EG-1 T2: Runner variants signal support (NEW)
  // ---------------------------------------------------------------------------

  describe("runner variants signal (EG-1 T2)", () => {
    it("should return true with source 'runner' when runner confirms non-empty variants", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
        runnerVariants: ["low", "medium", "high"],
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("runner");
    });

    it("should fall through to catalog when runner confirms empty variants array", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
        runnerVariants: [],
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      // Empty variants = not provided, falls through to catalog which has reasoning
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("catalog");
    });

    it("should fall through to catalog when runnerVariants is undefined", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
        runnerSupportsReasoning: null, // explicitly null, not provided
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      // Falls through to catalog which has reasoning support for gpt-5.5
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("catalog");
    });
  });

  // ---------------------------------------------------------------------------
  // Runner explicit signal takes precedence
  // ---------------------------------------------------------------------------

  describe("runner explicit signal", () => {
    it("should return true when runner explicitly signals true", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "unknown-model",
        runnerSupportsReasoning: true,
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("runner");
    });

    it("should return false when runner explicitly signals false", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
        runnerSupportsReasoning: false,
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("runner");
    });

    it("should prioritize runnerVariants over runnerSupportsReasoning (variants first)", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
        runnerVariants: ["high"],
        runnerSupportsReasoning: false, // explicit false should not override variants
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      // Variants take precedence, so true even though runnerSupportsReasoning is false
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("runner");
    });
  });

  // ---------------------------------------------------------------------------
  // Catalog fallback
  // ---------------------------------------------------------------------------

  describe("catalog fallback", () => {
    it("should use catalog explicit support when no runner signal", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5", // catalog has this
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true); // catalog lists reasoning capability
      expect(result.source).toBe("catalog");
    });

    it("should derive from capabilities when no explicit support", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-4o", // has tool-use but not reasoning
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("catalog");
    });

    it("should use explicit supportsReasoning over derived", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "opencode-go/deepseek-v4-flash", // has capabilities: [tool-use], supportsReasoning: false
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false); // explicit false wins
      expect(result.source).toBe("catalog");
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown model safe default
  // ---------------------------------------------------------------------------

  describe("unknown model safe default", () => {
    it("should return false for unknown model with no runner signal", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "some-unknown-provider/unknown-model",
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });

    it("should return false when no modelId provided", () => {
      const input: ResolveReasoningSupportInput = {
        catalog,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });

    it("should return false when no catalog provided either", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-5.5",
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });
  });
});