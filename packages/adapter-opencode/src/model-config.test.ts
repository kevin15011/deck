import { describe, expect, test } from "bun:test";

import { DEFAULT_OPENCODE_MODELS, resolveModelConfig } from "./model-config";

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