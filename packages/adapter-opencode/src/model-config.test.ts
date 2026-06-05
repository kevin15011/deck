import { describe, expect, test } from "bun:test";

import { DEFAULT_OPENCODE_MODELS, resolveModelConfig, supportsThinkingForOpenCodeModel, resolveThinkingForOpenCodeModel, getDefaultThinkingForOpenCodeModel, readOpenCodeDeveloperTeamModelConfigAssignments } from "./model-config";
import { resolveReasoningEffortSupport, getModelCatalog } from "@deck/core";

describe("DEFAULT_OPENCODE_MODELS", () => {
  // REQ-MC-005: No hardcoded defaults - this should be empty
  test("is empty (no hardcoded defaults)", () => {
    expect(Object.keys(DEFAULT_OPENCODE_MODELS).length).toBe(0);
  });
});

describe("resolveModelConfig", () => {
  test("returns defaults when no overrides", () => {
    // REQ-MC-005: No hardcoded defaults - returns empty when nothing configured
    const config = resolveModelConfig("deck-developer-orchestrator");
    expect(config.model).toBeUndefined();
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("CLI override takes highest precedence", () => {
    // REQ-MC-005: No defaults - no reasoningEffort without explicit config
    const config = resolveModelConfig("deck-developer-orchestrator", "anthropic/claude-sonnet-4");
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("config file override is used when no CLI override", () => {
    // REQ-MC-005: No defaults - no reasoningEffort without explicit config
    const overrides = { "deck-developer-orchestrator": "google/gemini-2.5-pro" };
    const config = resolveModelConfig("deck-developer-orchestrator", undefined, overrides);
    expect(config.model).toBe("google/gemini-2.5-pro");
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("reasoningEffort override is respected", () => {
    // Verify reasoningEffort overrides work correctly
    const reasoningOverrides = { "deck-developer-orchestrator": "high" as const };
    const config = resolveModelConfig("deck-developer-orchestrator", "anthropic/claude-sonnet-4", undefined, reasoningOverrides);
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBe("high");
  });

  test("CLI override wins over config file override", () => {
    const overrides = { "deck-developer-orchestrator": "google/gemini-2.5-pro" };
    const config = resolveModelConfig("deck-developer-orchestrator", "openai/gpt-4o", overrides);
    expect(config.model).toBe("openai/gpt-4o");
  });

  test("unknown agent returns undefined model (no hardcoded defaults)", () => {
    // REQ-MC-005: No hardcoded defaults for any agent
    const config = resolveModelConfig("unknown-agent");
    expect(config.model).toBeUndefined();
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("composable — CLI override sets model", () => {
    // REQ-MC-005: No defaults, CLI override works correctly
    const config = resolveModelConfig("deck-developer-explorer", "anthropic/claude-haiku-4");
    expect(config.model).toBe("anthropic/claude-haiku-4");
    expect(config.reasoningEffort).toBeUndefined(); // no default reasoning
  });
});

describe("supportsThinkingForOpenCodeModel with resolver delegation", () => {
  test("returns false for openai/gpt-4o (catalog: no reasoning support)", () => {
    // gpt-4o does NOT have reasoning in capabilities
    const result = supportsThinkingForOpenCodeModel("openai/gpt-4o");
    expect(result).toBe(false);
  });

  test("returns false for google/gemini-2.5-flash (catalog: no reasoning support)", () => {
    const result = supportsThinkingForOpenCodeModel("google/gemini-2.5-flash");
    expect(result).toBe(false);
  });

  test("returns true for anthropic/claude-sonnet-4 (catalog: has reasoning)", () => {
    // claude-sonnet-4 has reasoning in capabilities
    const result = supportsThinkingForOpenCodeModel("anthropic/claude-sonnet-4");
    expect(result).toBe(true);
  });

  test("returns true for openai/gpt-5.5 (catalog: has reasoning)", () => {
    const result = supportsThinkingForOpenCodeModel("openai/gpt-5.5");
    expect(result).toBe(true);
  });

  test("runner true wins over catalog false", () => {
    // Even if catalog says no, runner explicit true should win
    const catalog = getModelCatalog();
    const result = resolveReasoningEffortSupport({
      modelId: "openai/gpt-4o",
      runnerSupportsReasoning: true,
      catalog,
    });
    expect(result.supportsReasoning).toBe(true);
    expect(result.source).toBe("runner");
  });

  test("runner false wins over catalog true", () => {
    // Even if catalog says yes, runner explicit false should win
    const catalog = getModelCatalog();
    const result = resolveReasoningEffortSupport({
      modelId: "anthropic/claude-sonnet-4",
      runnerSupportsReasoning: false,
      catalog,
    });
    expect(result.supportsReasoning).toBe(false);
    expect(result.source).toBe("runner");
  });

  test("unknown model returns false", () => {
    const catalog = getModelCatalog();
    const result = resolveReasoningEffortSupport({
      modelId: "unknown/model-xyz",
      catalog,
    });
    expect(result.supportsReasoning).toBe(false);
    expect(result.source).toBe("unknown");
  });

  test("supportsThinkingForOpenCodeModel with options uses runner signal", () => {
    // Test that options.runnerSupportsReasoning is used
    const withRunnerTrue = supportsThinkingForOpenCodeModel("openai/gpt-4o", { runnerSupportsReasoning: true });
    expect(withRunnerTrue).toBe(true);

    const withRunnerFalse = supportsThinkingForOpenCodeModel("anthropic/claude-sonnet-4", { runnerSupportsReasoning: false });
    expect(withRunnerFalse).toBe(false);

    // Without options, falls back to catalog
    const withoutOptions = supportsThinkingForOpenCodeModel("anthropic/claude-sonnet-4");
    expect(withoutOptions).toBe(true);
  });
});

describe("resolveThinkingForOpenCodeModel", () => {
  test("returns undefined for unsupported model", () => {
    // gpt-4o doesn't support reasoning - should return undefined
    const result = resolveThinkingForOpenCodeModel("openai/gpt-4o", "high");
    expect(result).toBeUndefined();
  });

  test("returns level for supported model", () => {
    // claude-sonnet-4 supports reasoning
    const result = resolveThinkingForOpenCodeModel("anthropic/claude-sonnet-4", "high");
    expect(result).toBe("high");
  });

  test("returns default level when requested is undefined for supported model", () => {
    const result = resolveThinkingForOpenCodeModel("anthropic/claude-sonnet-4", undefined);
    expect(result).toBe("low"); // default
  });

  test("respects runner false even for supported catalog model", () => {
    const result = resolveThinkingForOpenCodeModel("anthropic/claude-sonnet-4", "high", { runnerSupportsReasoning: false });
    expect(result).toBeUndefined(); // runner says no, so undefined
  });

  test("respects runner true for unsupported catalog model", () => {
    const result = resolveThinkingForOpenCodeModel("openai/gpt-4o", "high", { runnerSupportsReasoning: true });
    expect(result).toBe("high"); // runner says yes
  });
});

describe("getDefaultThinkingForOpenCodeModel", () => {
  test("returns off for unsupported model", () => {
    const result = getDefaultThinkingForOpenCodeModel("openai/gpt-4o");
    expect(result).toBe("off");
  });

  test("returns low for supported model", () => {
    const result = getDefaultThinkingForOpenCodeModel("anthropic/claude-sonnet-4");
    expect(result).toBe("low");
  });

  test("returns off for unknown model", () => {
    const result = getDefaultThinkingForOpenCodeModel("unknown/model");
    expect(result).toBe("off");
  });

  test("returns off when runner says false", () => {
    const result = getDefaultThinkingForOpenCodeModel("anthropic/claude-sonnet-4", { runnerSupportsReasoning: false });
    expect(result).toBe("off");
  });

  test("returns low when runner says true", () => {
    const result = getDefaultThinkingForOpenCodeModel("openai/gpt-4o", { runnerSupportsReasoning: true });
    expect(result).toBe("low");
  });
});

describe("resolveModelConfig with capabilityMap", () => {
  test("omits reasoningEffort when model is unsupported by catalog", () => {
    // openai/gpt-4o is unsupported by catalog
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      "openai/gpt-4o",
      undefined,
      { "deck-developer-orchestrator": "high" }
    );
    expect(config.model).toBe("openai/gpt-4o");
    // reasoningEffort should be omitted because model doesn't support it
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("preserves reasoningEffort when model is supported by catalog", () => {
    // anthropic/claude-sonnet-4 is supported
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      "anthropic/claude-sonnet-4",
      undefined,
      { "deck-developer-orchestrator": "high" }
    );
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBe("high");
  });

  test("capabilityMap runner signal overrides catalog", () => {
    // openai/gpt-4o is unsupported by catalog, but runner says true
    const capabilityMap = { "openai/gpt-4o": true };
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      "openai/gpt-4o",
      undefined,
      { "deck-developer-orchestrator": "high" },
      undefined,
      capabilityMap
    );
    expect(config.model).toBe("openai/gpt-4o");
    expect(config.reasoningEffort).toBe("high"); // runner signal true overrides catalog
  });

  test("capabilityMap runner false overrides catalog true", () => {
    // anthropic/claude-sonnet-4 is supported by catalog, but runner says false
    const capabilityMap = { "anthropic/claude-sonnet-4": false };
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      "anthropic/claude-sonnet-4",
      undefined,
      { "deck-developer-orchestrator": "high" },
      undefined,
      capabilityMap
    );
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBeUndefined(); // runner says no
  });

  test("off level omits reasoningEffort even for supported model", () => {
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      "anthropic/claude-sonnet-4",
      undefined,
      { "deck-developer-orchestrator": "off" }
    );
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBeUndefined(); // off means omit
  });

  test("no model means no reasoningEffort even if reasoning override exists", () => {
    const config = resolveModelConfig(
      "deck-developer-orchestrator",
      undefined, // no model
      undefined,
      { "deck-developer-orchestrator": "high" } // reasoning override without model
    );
    expect(config.model).toBeUndefined();
    // When no model, no reasoningEffort should be written
    expect(config.reasoningEffort).toBeUndefined();
  });
});

describe("readOpenCodeDeveloperTeamModelConfigAssignments with effectiveThinkingAssignments", () => {
  test("returns effectiveThinkingAssignments as undefined when model is unsupported", () => {
    // Create a mock config with an unsupported model (gpt-4o)
    const mockConfig = {
      exists: (_path: string) => true,
      readFile: (_path: string, _encoding: string) => JSON.stringify({
        agent: {
          "deck-developer-orchestrator": {
            model: "openai/gpt-4o",
            reasoningEffort: "high"
          }
        }
      })
    };

    const result = readOpenCodeDeveloperTeamModelConfigAssignments("/fake/path", mockConfig);

    // The raw thinkingAssignments should be present (preserved for debugging)
    expect(result.thinkingAssignments["deck-developer-orchestrator"]).toBe("high");
    // effectiveThinkingAssignments should be undefined for unsupported model
    expect(result.effectiveThinkingAssignments).toBeDefined();
    expect(result.effectiveThinkingAssignments?.["deck-developer-orchestrator"]).toBeUndefined();
  });

  test("returns effectiveThinkingAssignments when model is supported", () => {
    const mockConfig = {
      exists: (_path: string) => true,
      readFile: (_path: string, _encoding: string) => JSON.stringify({
        agent: {
          "deck-developer-orchestrator": {
            model: "anthropic/claude-sonnet-4",
            reasoningEffort: "high"
          }
        }
      })
    };

    const result = readOpenCodeDeveloperTeamModelConfigAssignments("/fake/path", mockConfig);

    expect(result.thinkingAssignments["deck-developer-orchestrator"]).toBe("high");
    expect(result.effectiveThinkingAssignments?.["deck-developer-orchestrator"]).toBe("high");
  });
});
