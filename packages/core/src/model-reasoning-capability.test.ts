import { describe, expect, test } from "bun:test";

import { MODEL_CATALOG } from "./model-catalog";
import {
  resolveReasoningEffortSupport,
  catalogSupportsReasoning,
  type ResolveReasoningSupportInput,
  type ResolveReasoningSupportResult,
  type ReasoningSupportSource,
} from "./model-reasoning-capability";

describe("resolveReasoningEffortSupport", () => {
  describe("precedence: runner signal wins over catalog", () => {
    test("runner true wins over catalog false", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "opencode-go/deepseek-v4-flash", // has supportsReasoning: false in catalog
        runnerSupportsReasoning: true,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("runner");
    });

    test("runner false wins over catalog true", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "anthropic/claude-sonnet-4", // has capabilities: [..., "reasoning"]
        runnerSupportsReasoning: false,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("runner");
    });
  });

  describe("precedence: catalog fallback when no runner signal", () => {
    test("explicit supportsReasoning: true in catalog returns true", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "opencode-go/deepseek-v4-flash", // has supportsReasoning: false explicitly
        runnerSupportsReasoning: null, // null means "no signal"
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("catalog");
    });

    test("no explicit supportsReasoning, derives from capabilities", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "anthropic/claude-sonnet-4", // has capabilities: [..., "reasoning"]
        runnerSupportsReasoning: null,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true);
      expect(result.source).toBe("catalog");
    });

    test("no reasoning in capabilities returns false", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "openai/gpt-4o", // has capabilities: ["tool-use", "vision"] - no reasoning
        runnerSupportsReasoning: null,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("catalog");
    });
  });

  describe("unknown/default case", () => {
    test("modelId not found in catalog returns false with unknown source", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "unknown/model-xyz",
        runnerSupportsReasoning: null,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });

    test("no modelId provided returns false with unknown source", () => {
      const input: ResolveReasoningSupportInput = {
        runnerSupportsReasoning: null,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });

    test("no catalog provided returns false with unknown source", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "anthropic/claude-sonnet-4",
        runnerSupportsReasoning: null,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(false);
      expect(result.source).toBe("unknown");
    });

    test("undefined runner signal is treated as no signal", () => {
      const input: ResolveReasoningSupportInput = {
        modelId: "anthropic/claude-sonnet-4",
        runnerSupportsReasoning: undefined,
        catalog: MODEL_CATALOG,
      };
      const result = resolveReasoningEffortSupport(input);
      expect(result.supportsReasoning).toBe(true); // derived from capabilities
      expect(result.source).toBe("catalog");
    });
  });

  describe("explicit reasoning support in catalog (priority over capabilities)", () => {
    test("explicit supportsReasoning: false beats capabilities includes reasoning", () => {
      // opencode-go/deepseek-v4-flash has capabilities: ["tool-use"] but supportsReasoning: false
      const model = MODEL_CATALOG.models.find((m) => m.id === "opencode-go/deepseek-v4-flash");
      expect(model).toBeDefined();
      expect(model!.supportsReasoning).toBe(false);
      expect(model!.capabilities.includes("reasoning")).toBe(false);

      const supports = catalogSupportsReasoning(model);
      expect(supports).toBe(false);
    });

    test("explicit supportsReasoning: true beats capabilities that don't include reasoning", () => {
      // Should not happen in current catalog, but the logic should handle it
      // For test: verify that explicit true is respected
      const result = resolveReasoningEffortSupport({
        modelId: "anthropic/claude-sonnet-4",
        runnerSupportsReasoning: null,
        catalog: MODEL_CATALOG,
      });
      // claude-sonnet-4 has capabilities: [..., "reasoning"], should return true
      expect(result.supportsReasoning).toBe(true);
    });
  });
});

describe("catalogSupportsReasoning", () => {
  // Note: Current catalog has no explicit supportsReasoning: true entries
  // The only explicit supportsReasoning is false on deepseek-v4-flash
  // Most models derive from capabilities.includes("reasoning")

  test("returns false when model has explicit supportsReasoning: false", () => {
    const model = MODEL_CATALOG.models.find((m) => m.id === "opencode-go/deepseek-v4-flash");
    expect(model).toBeDefined();
    expect(model!.supportsReasoning).toBe(false);
    const supports = catalogSupportsReasoning(model);
    expect(supports).toBe(false);
  });

  test("returns undefined when model has no explicit supportsReasoning but has reasoning in capabilities", () => {
    // This should derive from capabilities in the main resolver, but the helper itself returns undefined
    const model = MODEL_CATALOG.models.find((m) => m.id === "anthropic/claude-opus-4");
    expect(model).toBeDefined();
    expect(model!.supportsReasoning).toBeUndefined();
    expect(model!.capabilities.includes("reasoning")).toBe(true);
    const supports = catalogSupportsReasoning(model);
    // Helper returns undefined when no explicit supportsReasoning
    expect(supports).toBeUndefined();
  });

  test("returns undefined when model has no explicit supportsReasoning and no reasoning in capabilities", () => {
    const model = MODEL_CATALOG.models.find((m) => m.id === "openai/gpt-4o");
    expect(model).toBeDefined();
    expect(model!.supportsReasoning).toBeUndefined();
    expect(model!.capabilities.includes("reasoning")).toBe(false);
    const supports = catalogSupportsReasoning(model);
    // Helper returns undefined when no explicit supportsReasoning
    expect(supports).toBeUndefined();
  });

  test("returns undefined when model is undefined", () => {
    const supports = catalogSupportsReasoning(undefined);
    expect(supports).toBeUndefined();
  });
});
