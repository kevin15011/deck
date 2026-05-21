import { describe, expect, test } from "bun:test";

import { DEFAULT_OPENCODE_MODELS, resolveModelConfig } from "./model-config";

describe("DEFAULT_OPENCODE_MODELS", () => {
  test("contains all 12 developer team agents", () => {
    const expected = [
      "deck-developer-orchestrator",
      "deck-developer-explorer",
      "deck-developer-proposal",
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-task",
      "deck-developer-apply-general",
      "deck-developer-apply-backend",
      "deck-developer-apply-frontend",
      "deck-developer-verify",
      "deck-developer-review",
      "deck-developer-archive",
    ];
    for (const agentId of expected) {
      expect(DEFAULT_OPENCODE_MODELS[agentId]).toBeDefined();
      expect(DEFAULT_OPENCODE_MODELS[agentId].model).toBeTruthy();
    }
  });

  test("orchestrator has reasoningEffort: high", () => {
    expect(DEFAULT_OPENCODE_MODELS["deck-developer-orchestrator"].reasoningEffort).toBe("high");
  });

  test("subagents do not have reasoningEffort set", () => {
    const subagents = [
      "deck-developer-explorer",
      "deck-developer-proposal",
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-task",
      "deck-developer-apply-general",
      "deck-developer-apply-backend",
      "deck-developer-apply-frontend",
      "deck-developer-verify",
      "deck-developer-review",
      "deck-developer-archive",
    ];
    for (const id of subagents) {
      expect(DEFAULT_OPENCODE_MODELS[id].reasoningEffort).toBeUndefined();
    }
  });
});

describe("resolveModelConfig", () => {
  test("returns defaults when no overrides", () => {
    const config = resolveModelConfig("deck-developer-orchestrator");
    expect(config.model).toBe("openai/gpt-5.5");
    expect(config.reasoningEffort).toBe("high");
  });

  test("CLI override takes highest precedence", () => {
    const config = resolveModelConfig("deck-developer-orchestrator", "anthropic/claude-sonnet-4");
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.reasoningEffort).toBe("high"); // preserved from defaults
  });

  test("config file override is used when no CLI override", () => {
    const overrides = { "deck-developer-orchestrator": "google/gemini-2.5-pro" };
    const config = resolveModelConfig("deck-developer-orchestrator", undefined, overrides);
    expect(config.model).toBe("google/gemini-2.5-pro");
    expect(config.reasoningEffort).toBe("high");
  });

  test("CLI override wins over config file override", () => {
    const overrides = { "deck-developer-orchestrator": "google/gemini-2.5-pro" };
    const config = resolveModelConfig("deck-developer-orchestrator", "openai/gpt-4o", overrides);
    expect(config.model).toBe("openai/gpt-4o");
  });

  test("unknown agent returns empty model", () => {
    const config = resolveModelConfig("unknown-agent");
    expect(config.model).toBe("");
    expect(config.reasoningEffort).toBeUndefined();
  });

  test("composable — changing model doesn't touch other fields", () => {
    const defaults = DEFAULT_OPENCODE_MODELS["deck-developer-explorer"];
    const config = resolveModelConfig("deck-developer-explorer", "anthropic/claude-haiku-4");
    expect(config.model).toBe("anthropic/claude-haiku-4");
    // reasoningEffort should still be undefined (matching default)
    expect(config.reasoningEffort).toBe(defaults.reasoningEffort);
  });
});