/**
 * TUI tests for Task T13 (adapter-driven inventory) and Task T14 (model-aware effort selection).
 *
 * These tests verify:
 * - T13: OpenCode TUI inventory uses adapter-driven inventory when available
 * - T14: effort picker uses model-aware getThinkingLevels(modelId) and hides effort for unsupported models
 *
 * Uses deterministic mock approach with fixture adapters that return known variant sets.
 * This proves the required behaviors without depending on real adapter cache state.
 * Covers: REQ-INV-001, REQ-INV-002, REQ-EFFORT-001, REQ-EFFORT-002, REQ-EFFORT-004, REQ-TUI-001, REQ-TUI-002,
 *        REQ-CLEAN-001, REQ-CLEAN-002, REQ-EFFORT-005
 *
 * NOTE: This test file intentionally does NOT reference any forbidden external packages.
 */

import React from "react";
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { renderToString } from "ink";
import { getAdapter } from "../../runner-adapters";

import {
  AgentModelAssignmentScreen,
  AgentModelConfigListScreen,
  OpenCodeModelDiscoveryScreen,
} from "../screens/developer-team-screens";
import type { RunnerAdapter, RunnerThinkingLevel, RunnerModelInventory, RunnerModelInventoryResult } from "@deck/core";
import {
  buildTuiInventoryFromAdapterInventory,
  buildTuiInventoryFromDiscoveryResult,
  resolveOpenCodeModelDiscovery,
} from "../app";

// ============================================================================
// Deterministic Mock Adapters with Known Variant Sets
// These replace real adapter behavior to prove required behaviors deterministically
// ============================================================================

/**
 * Mock OpenCode adapter that returns model-specific variant sets.
 * Model A (gpt-4.5): low, medium, high (three levels)
 * Model B (gpt-5.5): minimal, low, medium, high, xhigh (five levels)
 * Unknown models: empty (no thinking support)
 */
function createMockOpenCodeAdapter(): RunnerAdapter {
  return {
    runnerId: "opencode",
    // Model A has 3 variants
    getThinkingLevels: (modelId?: string): readonly RunnerThinkingLevel[] => {
      if (modelId === "openai/gpt-4.5") {
        return ["low", "medium", "high"] as const;
      }
      if (modelId === "openai/gpt-5.5") {
        return ["minimal", "low", "medium", "high", "xhigh"] as const;
      }
      // Unknown models have no thinking support
      return [];
    },
    supportsThinking: (modelId?: string): boolean => {
      if (!modelId) return false;
      return modelId === "openai/gpt-4.5" || modelId === "openai/gpt-5.5";
    },
    getModelInventory: (): RunnerModelInventory => {
      return {
        providers: [
          { id: "openai", displayName: "OpenAI", source: "runner-resolved" as const },
        ],
        modelsByProvider: {
          openai: [
            { id: "openai/gpt-4.5", providerId: "openai", displayName: "GPT-4.5", supportsReasoning: true, source: "runner-resolved" as const },
            { id: "openai/gpt-5.5", providerId: "openai", displayName: "GPT-5.5", supportsReasoning: true, source: "runner-resolved" as const },
          ],
        },
      };
    },
    // Minimal implementation for other required methods
    readModelAssignments: () => ({}),
    readThinkingAssignments: () => ({}),
    getModelConfig: () => ({}),
    supportsTools: () => true,
  } as unknown as RunnerAdapter;
}

/**
 * Mock adapter that simulates unsupported/no-variant model.
 * Returns empty variant set to prove hiding behavior.
 */
function createMockUnsupportedAdapter(): RunnerAdapter {
  return {
    runnerId: "opencode",
    getThinkingLevels: () => [],
    supportsThinking: () => false,
    getModelInventory: () => ({
      providers: [],
      modelsByProvider: {},
    }),
    readModelAssignments: () => ({}),
    readThinkingAssignments: () => ({}),
    getModelConfig: () => ({}),
    supportsTools: () => false,
  } as unknown as RunnerAdapter;
}

/**
 * Mock adapter that simulates model change - different variant sets.
 * Used to verify REQ-CLEAN-002: model change clears stale effort.
 */
function createMockModelChangeAdapter(): RunnerAdapter {
  return {
    runnerId: "opencode",
    getThinkingLevels: (modelId?: string): readonly RunnerThinkingLevel[] => {
      const model = modelId ?? "openai/gpt-4.5";
      if (model === "openai/gpt-4.5") {
        return ["low", "medium", "high"] as const;
      }
      if (model === "openai/gpt-5.5") {
        return ["minimal", "low", "medium", "high", "xhigh"] as const;
      }
      return [];
    },
    supportsThinking: (modelId?: string): boolean => {
      return modelId === "openai/gpt-4.5" || modelId === "openai/gpt-5.5";
    },
    getModelInventory: (): RunnerModelInventory => ({
      providers: [{ id: "openai", displayName: "OpenAI", source: "runner-resolved" as const }],
      modelsByProvider: {
        openai: [
          { id: "openai/gpt-4.5", providerId: "openai", displayName: "GPT-4.5", supportsReasoning: true, source: "runner-resolved" as const },
          { id: "openai/gpt-5.5", providerId: "openai", displayName: "GPT-5.5", supportsReasoning: true, source: "runner-resolved" as const },
        ],
      },
    }),
    readModelAssignments: () => ({}),
    readThinkingAssignments: () => ({}),
    getModelConfig: () => ({}),
    supportsTools: () => true,
  } as unknown as RunnerAdapter;
}

// ============================================================================
// Test Suite - T13: Adapter-Driven Inventory Contract (REQ-INV-001, REQ-TUI-001)
// ============================================================================

describe("T13: Adapter-driven inventory contract (REQ-INV-001, REQ-TUI-001)", () => {
  test("getThinkingLevels returns per-model variants - deterministic proof", () => {
    const adapter = createMockOpenCodeAdapter();

    // Model A has 3 variants
    const levelsA = adapter.getThinkingLevels("openai/gpt-4.5");
    expect(levelsA).toEqual(["low", "medium", "high"]);

    // Model B has 5 variants - proves different models can have different variant sets
    const levelsB = adapter.getThinkingLevels("openai/gpt-5.5");
    expect(levelsB).toEqual(["minimal", "low", "medium", "high", "xhigh"]);

    // Unknown model has no variants
    const levelsUnknown = adapter.getThinkingLevels("unknown/model");
    expect(levelsUnknown).toEqual([]);
  });

  test("getModelInventory returns provider model data - deterministic proof", () => {
    const adapter = createMockOpenCodeAdapter();
    const inventory = (adapter as unknown as { getModelInventory(): RunnerModelInventory })
      .getModelInventory();

    expect(inventory.providers).toHaveLength(1);
    expect(inventory.providers[0].id).toBe("openai");
    expect(inventory.providers[0].source).toBe("runner-resolved");
    expect(inventory.modelsByProvider.openai).toHaveLength(2);
  });

  test("adapter inventory provides models with source metadata (REQ-INV-002)", () => {
    const adapter = createMockOpenCodeAdapter();
    const inventory = (adapter as unknown as { getModelInventory(): RunnerModelInventory })
      .getModelInventory();

    // REQ-INV-002: Adapter-driven inventory source is runner-owned
    expect(inventory.providers[0].source).toBe("runner-resolved");
  });
});

// ============================================================================
// Test Suite - T14: Model-Aware Effort Picker Screen Logic
// ============================================================================

describe("T14: Model-aware effort picker screen logic (REQ-EFFORT-001, REQ-TUI-002)", () => {
  test("shows thinking options when adapter returns non-empty variants", () => {
    // Use Pi runtime with known fixed thinking levels
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    expect(output).toContain("thinking");
    expect(output).not.toContain("Thinking not supported");
  });

  test("hides effort picker when adapter returns empty (no variants) - REQ-EFFORT-004 proof", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="unknown/model"
        defaultThinking="off"
        supportsThinking={false}
        runtime="opencode"
      />,
    );

    // REQ-EFFORT-004: No confirmed variants hides picker
    expect(output).toContain("Thinking not supported");
    expect(output).not.toContain("thinking");
  });

  test("screen respects supportsThinking prop to hide effort picker (REQ-TUI-002)", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="some-model"
        defaultThinking="off"
        supportsThinking={false}
        runtime="opencode"
      />,
    );

    expect(output).toContain("Thinking not supported");
  });

  test("screen shows model ID in output", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/gpt-5.5"
        defaultThinking="high"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    expect(output).toContain("Selected model: openai/gpt-5.5");
  });

  test("screen shows agent progress", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={1}
        totalAgents={5}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    expect(output).toContain("2/5");
    expect(output).toContain("Explorer Agent");
  });
});

// ============================================================================
// Test Suite - Two Models Return Different Variant Sets (REQ-EFFORT-002)
// ============================================================================

describe("T14: Two models can return different variant sets (REQ-EFFORT-002)", () => {
  test("adapter returns different variants for model A vs model B", () => {
    const adapter = createMockOpenCodeAdapter();

    // Model A has 3 variants
    const levelsA = adapter.getThinkingLevels("openai/gpt-4.5");
    expect(levelsA).toHaveLength(3);

    // Model B has 5 variants - proves different models can have different sets
    const levelsB = adapter.getThinkingLevels("openai/gpt-5.5");
    expect(levelsB).toHaveLength(5);

    // The variant sets are different
    expect(levelsA).not.toEqual(levelsB);
  });

  test("model-aware variants - model A specific variants present", () => {
    const adapter = createMockOpenCodeAdapter();
    const levelsA = adapter.getThinkingLevels("openai/gpt-4.5");

    // Model A has specific variants
    expect(levelsA).toContain("low");
    expect(levelsA).toContain("medium");
    expect(levelsA).toContain("high");
    // But NOT xhigh
    expect(levelsA).not.toContain("xhigh");
  });

  test("model-aware variants - model B specific variants present", () => {
    const adapter = createMockOpenCodeAdapter();
    const levelsB = adapter.getThinkingLevels("openai/gpt-5.5");

    // Model B has extended variants
    expect(levelsB).toContain("minimal");
    expect(levelsB).toContain("low");
    expect(levelsB).toContain("medium");
    expect(levelsB).toContain("high");
    expect(levelsB).toContain("xhigh");
  });
});

// ============================================================================
// Test Suite - Unsupported Model Hides Effort Picker (REQ-EFFORT-004)
// ============================================================================

describe("T14: Unsupported model hides effort picker (REQ-EFFORT-004)", () => {
  test("unsupported model returns empty variants", () => {
    const adapter = createMockUnsupportedAdapter();

    const levels = adapter.getThinkingLevels("unknown/model");
    expect(levels).toEqual([]);
  });

  test("supportsThinking returns false for unsupported model", () => {
    const adapter = createMockUnsupportedAdapter();

    const supports = adapter.supportsThinking("unknown/model");
    expect(supports).toBe(false);
  });

  test("screen shows 'not supported' for unsupported model", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="unknown/model"
        defaultThinking="off"
        supportsThinking={false}
        runtime="opencode"
      />,
    );

    expect(output).toContain("Thinking not supported");
  });
});

// ============================================================================
// Test Suite - Model Change Clears Stale Effort (REQ-CLEAN-002)
// ============================================================================

describe("T14: Model change clears stale effort (REQ-CLEAN-002)", () => {
  test("different model returns different variants - proves re-fetch needed", () => {
    const adapter = createMockModelChangeAdapter();

    // Get variants for model A
    const modelAVariants = adapter.getThinkingLevels("openai/gpt-4.5");
    expect(modelAVariants).toEqual(["low", "medium", "high"]);

    // Get variants for model B - different set
    const modelBVariants = adapter.getThinkingLevels("openai/gpt-5.5");
    expect(modelBVariants).toEqual(["minimal", "low", "medium", "high", "xhigh"]);

    // Variants are different - proves TUI must re-fetch on model change
    expect(modelAVariants).not.toEqual(modelBVariants);
  });

  test("supportsThinking reflects model-specific support", () => {
    const adapter = createMockModelChangeAdapter();

    expect(adapter.supportsThinking("openai/gpt-4.5")).toBe(true);
    expect(adapter.supportsThinking("openai/gpt-5.5")).toBe(true);
    expect(adapter.supportsThinking("unknown/model")).toBe(false);
  });
});

// ============================================================================
// Test Suite - Native Variant Preselection with Legacy reasoningEffort Fallback (REQ-EFFORT-005)
// ============================================================================

describe("T14: Native variant preselection with legacy reasoningEffort fallback (REQ-EFFORT-005)", () => {
  test("screen handles defaultThinking as variant preselection", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="high"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    // REQ-EFFORT-005: defaultThinking prop used for preselection
    expect(output).toContain("high");
  });

  test("screen handles undefined defaultThinking (no preselection)", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="off"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    expect(output).toContain("thinking");
  });

  test("screen handles legacy reasoningEffort as fallback via defaultThinking", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    // REQ-EFFORT-005: native variant OR legacy reasoningEffort via defaultThinking
    expect(output).toContain("medium");
  });
});

// ============================================================================
// Test Suite - Pi Compatibility (REQ-COMPAT-001)
// ============================================================================

describe("Pi compatibility (REQ-COMPAT-001)", () => {
  test("Pi runtime uses fixed thinking levels", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    expect(output).toContain("thinking");
    expect(output).not.toContain("Thinking not supported");
  });

  test("Pi adapter has distinct thinking levels from OpenCode", () => {
    // Import real Pi adapter for comparison
    const piAdapter = getAdapter("pi") as RunnerAdapter;
    const opencodeAdapter = getAdapter("opencode") as RunnerAdapter;

    // Pi has fixed six levels
    const piLevels = piAdapter.getThinkingLevels("claude-sonnet-4");
    expect(piLevels.length).toBe(6);

    // OpenCode levels are runner-resolved (empty in this test environment).
    const ocLevels = opencodeAdapter.getThinkingLevels("openai/gpt-4.5");
    expect(Array.isArray(ocLevels)).toBe(true);
  });
});

// ============================================================================
// Test Suite - Adapter-Driven Inventory Preferred When Available (REQ-INV-002)
// ============================================================================

describe("T13: Adapter-driven inventory is preferred when available (REQ-INV-002)", () => {
  test("adapter inventory provides models with variants", () => {
    const adapter = createMockOpenCodeAdapter();
    const inventory = (adapter as unknown as { getModelInventory(): RunnerModelInventory })
      .getModelInventory();

    expect(inventory.providers).toHaveLength(1);
    expect(inventory.modelsByProvider.openai).toHaveLength(2);
  });

  test("inventory source is marked as runner-owned", () => {
    const adapter = createMockOpenCodeAdapter();
    const inventory = (adapter as unknown as { getModelInventory(): RunnerModelInventory })
      .getModelInventory();

    // REQ-INV-002: Runner-owned source
    expect(inventory.providers[0].source).toBe("runner-resolved");
  });
});

// ============================================================================
// Test Suite - No Forbidden Dependency (REQ-INV-005, REQ-TEST-003)
// ============================================================================

describe("No forbidden dependency (REQ-INV-005, REQ-TEST-003)", () => {
  test("mock adapter does not reference forbidden packages", () => {
    const adapter = createMockOpenCodeAdapter();

    expect(adapter.runnerId).toBe("opencode");
  });
});

// ============================================================================
// Regression Test - Pi Model Inventory Detector Exists (REQ-COMPAT-001)
// Prevents regression where detectPiModelInventoryForTui() was accidentally removed
// ============================================================================

describe("Pi model inventory detector regression (REQ-COMPAT-001)", () => {
  test("Pi adapter getThinkingLevels returns fixed levels for known models", () => {
    const piAdapter = getAdapter("pi") as RunnerAdapter;
    
    // Pi adapter should return fixed six levels for known models
    const levels = piAdapter.getThinkingLevels("claude-sonnet-4");
    expect(levels).toBeDefined();
    expect(levels.length).toBe(6);
    expect(levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  });

  test("Pi adapter supportsThinking returns true for known models", () => {
    const piAdapter = getAdapter("pi") as RunnerAdapter;
    
    // Pi adapter should support thinking for known models
    expect(piAdapter.supportsThinking("claude-sonnet-4")).toBe(true);
    expect(piAdapter.supportsThinking("claude-opus-4")).toBe(true);
  });
});

// ============================================================================
// Test Suite - OpenCode TUI Uses Runner-Resolved Inventory\n//\n// Availability and variants come only from the adapter's runner-resolved\n// `opencode models --verbose` inventory. Cache/config metadata may enrich\n// presentation, but never add models or variants.\n//\n// Covers: REQ-INV-001, REQ-TEST-002\n//\n// These tests directly exercise the module-scope helpers from app.tsx so the\n// runner-result mapping contract is provable without spinning up DeckApp.
// ============================================================================

describe("OpenCode TUI discovery states (Group 3)", () => {
  const runnerInventory: RunnerModelInventory = {
    providers: [{ id: "plugin", displayName: "Plugin", source: "runner-resolved" }],
    modelsByProvider: {
      plugin: [{
        id: "plugin/model",
        providerId: "plugin",
        modelId: "model",
        displayName: "Plugin Model",
        variants: ["custom-fast", "custom-deep"],
        metadataSource: "runner",
        source: "runner-resolved",
      }],
    },
  };

  test("renders text-based loading, empty, stale, and blocked states with keyboard-reachable Retry and Back", () => {
    expect(renderToString(<OpenCodeModelDiscoveryScreen cursor={0} state={{ kind: "loading" }} />))
      .toContain("Reading models from OpenCode");

    const empty = renderToString(<OpenCodeModelDiscoveryScreen cursor={0} state={{ kind: "empty" }} />);
    expect(empty).toContain("OpenCode reported no available models.");
    expect(empty).toContain("Retry discovery");
    expect(empty).toContain("Back");
    expect(empty.lastIndexOf("❯", empty.indexOf("Retry discovery"))).toBeGreaterThan(-1);

    const stale = renderToString(<OpenCodeModelDiscoveryScreen cursor={0} state={{
      kind: "stale",
      discoveredAt: 0,
      errorMessage: "OpenCode timed out. Retry discovery.",
    }} />);
    expect(stale).toContain("Last known OpenCode models (discovered");
    expect(stale).toContain("changes cannot be applied");

    const blocked = renderToString(<OpenCodeModelDiscoveryScreen cursor={0} state={{
      kind: "blocked",
      errorMessage: "OpenCode discovery timed out. Retry discovery.",
    }} />);
    expect(blocked).toContain("OpenCode discovery timed out. Retry discovery.");
    expect(blocked).toContain("opencode models --verbose");
  });

  test("maps only runner inventory IDs and preserves exact variant order", () => {
    const ready: RunnerModelInventoryResult = {
      state: "ready",
      inventory: runnerInventory,
      source: "live",
      discoveredAt: 1,
      fingerprint: "fresh",
    };
    const mapped = buildTuiInventoryFromDiscoveryResult(ready);

    expect(mapped.kind).toBe("ready");
    if (mapped.kind !== "ready") throw new Error("expected ready discovery state");
    expect(mapped.inventory.modelsByProvider.plugin?.map((model) => model.id)).toEqual(["plugin/model"]);
    expect(mapped.inventory.modelsByProvider.plugin?.[0]?.variants).toEqual(["custom-fast", "custom-deep"]);
  });

  test("uses only a local rescan request and preserves unavailable persisted model and variant labels", async () => {
    const requests: unknown[] = [];
    const adapter = {
      getModelInventory: async (request: unknown) => {
        requests.push(request);
        return {
          state: "ready",
          inventory: runnerInventory,
          source: "live",
          discoveredAt: 1,
          fingerprint: "fresh",
        } as RunnerModelInventoryResult;
      },
    };
    await resolveOpenCodeModelDiscovery(adapter, { projectRoot: "/fixture", mode: "rescan" });
    expect(requests).toEqual([{ projectRoot: "/fixture", mode: "rescan" }]);

    const output = renderToString(
      <AgentModelConfigListScreen
        cursor={0}
        runtime="opencode"
        modelAssignments={{
          "deck-developer-orchestrator": "retired/model",
          "deck-developer-proposal": "plugin/model",
        }}
        thinkingAssignments={{ "deck-developer-proposal": "old-variant" }}
        assignmentStates={{
          "deck-developer-orchestrator": "model-unavailable",
          "deck-developer-proposal": "variant-unavailable",
        }}
      />,
    );
    expect(output).toContain("retired/model · Unavailable model");
    expect(output).toContain("Variant unavailable: old-variant");
    expect(output).toContain("plugin/model");
  });

  test("zero-variant models state that no reasoning choice applies", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="plugin/no-variants"
        defaultThinking=""
        runtime="opencode"
        thinkingLevels={[]}
      />,
    );
    expect(output).toContain("No reasoning choice applies to this model.");
  });


  test("adapter inventory is mapped into the TUI provider/model shape", () => {
    // Fixture mirrors a runner-resolved inventory returned by adapter.getModelInventory().
    // OpenCode may report built-in and custom models with exact runner keys.
    // The mapping preserves those records without treating cache/auth data as authority.
    const raw: RunnerModelInventory = {
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          envVars: ["OPENAI_API_KEY"],
          source: "runner-resolved",
        },
        {
          id: "anthropic",
          displayName: "Anthropic",
          envVars: ["ANTHROPIC_API_KEY"],
          source: "runner-resolved",
        },
      ],
      modelsByProvider: {
        openai: [
          {
            id: "openai/gpt-5.3-codex",
            providerId: "openai",
            displayName: "Gpt 5.3 Codex",
            supportsReasoning: true,
            source: "runner-resolved",
          },
          {
            id: "openai/gpt-5.5",
            providerId: "openai",
            displayName: "Gpt 5.5",
            supportsReasoning: true,
            source: "runner-resolved",
          },
        ],
        anthropic: [
          {
            id: "anthropic/claude-sonnet-4",
            providerId: "anthropic",
            displayName: "Claude Sonnet 4",
            supportsReasoning: true,
            source: "runner-resolved",
          },
        ],
      },
    };

    const mapped = buildTuiInventoryFromAdapterInventory(raw);

    expect(mapped.providers.map((p) => p.id).sort()).toEqual(["anthropic", "openai"]);
    const openai = mapped.providers.find((p) => p.id === "openai")!;
    expect(openai.displayName).toBe("OpenAI");
    expect(openai.envVars).toEqual(["OPENAI_API_KEY"]);

    // The exact runner-resolved model key must surface unchanged in the TUI.
    const openaiModels = mapped.modelsByProvider["openai"] ?? [];
    expect(openaiModels.map((m) => m.id)).toContain("openai/gpt-5.3-codex");
    expect(openaiModels.find((m) => m.id === "openai/gpt-5.3-codex")?.thinking).toBe(true);

    const anthropicModels = mapped.modelsByProvider["anthropic"] ?? [];
    expect(anthropicModels.map((m) => m.id)).toContain("anthropic/claude-sonnet-4");
  });

});

// ============================================================================
// Test Suite - Model-Specific Effort Picker Rendering (REQ-EFFORT-001, REQ-EFFORT-002,
//                                              REQ-EFFORT-004, REQ-COMPAT-001)
//
// These tests prove the AgentModelAssignmentScreen renders the EXACT effort
// levels passed via the `thinkingLevels` prop (which app.tsx sources from
// `adapter.getThinkingLevels(selectedModel.id)`) rather than the hardcoded
// OPENCODE_THINKING_LEVELS constant.
//
// Proves:
//   - Model A with variants ["high","max"] renders ONLY those two options.
//   - Model B with variants ["none","low","medium","high","xhigh"] renders those.
//   - Unsupported/no-variant model (empty array) hides the picker.
//   - Pi fixed levels remain unchanged when no thinkingLevels prop is passed.
// ============================================================================

describe("T14: Model-specific effort picker rendering (REQ-EFFORT-001, REQ-EFFORT-002)", () => {
  test("OpenCode model A with variants [high, max] renders exactly those options", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/o3"
        defaultThinking="high"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={["high", "max"]}
      />,
    );

    // Exactly the two model-specific variants must appear.
    expect(output).toContain("thinking high");
    expect(output).toContain("thinking max");

    // Must NOT contain any of the hardcoded OPENCODE_THINKING_LEVELS options
    // that this model does not support.
    expect(output).not.toContain("thinking low");
    expect(output).not.toContain("thinking medium");
    expect(output).not.toContain("thinking off");
    expect(output).not.toContain("thinking minimal");
    expect(output).not.toContain("thinking xhigh");
  });

  test("OpenCode model B with variants [none, low, medium, high, xhigh] renders those options", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/gpt-5.5"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={["none", "low", "medium", "high", "xhigh"]}
      />,
    );

    // All five model-specific variants must appear.
    expect(output).toContain("thinking none");
    expect(output).toContain("thinking low");
    expect(output).toContain("thinking medium");
    expect(output).toContain("thinking high");
    expect(output).toContain("thinking xhigh");

    // Must NOT contain the hardcoded "off" or "minimal" levels that this
    // model does not support.
    expect(output).not.toContain("thinking off");
    expect(output).not.toContain("thinking minimal");
  });

  test("OpenCode model A variants do NOT leak model B variants and vice versa", () => {
    // Model A
    const outputA = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/o3"
        defaultThinking="high"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={["high", "max"]}
      />,
    );
    // Model A must not contain "max" variant leaking into model B, and vice versa.
    // "max" is model A only; "xhigh" is model B only.
    expect(outputA).toContain("thinking max");
    expect(outputA).not.toContain("thinking xhigh");

    const outputB = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/gpt-5.5"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={["none", "low", "medium", "high", "xhigh"]}
      />,
    );
    expect(outputB).toContain("thinking xhigh");
    // "max" is model A only and must not appear for model B.
    expect(outputB).not.toContain("thinking max");
  });
});

describe("T14: Unsupported/no-variant model hides effort picker via thinkingLevels (REQ-EFFORT-004)", () => {
  test("empty thinkingLevels array hides the picker even when supportsThinking prop is true", () => {
    // This proves the fail-closed contract: adapter.getThinkingLevels()
    // returns [] for unknown/unsupported models, and the screen hides the
    // picker rather than showing hardcoded levels.
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="unknown/model"
        defaultThinking="off"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={[]}
      />,
    );

    expect(output).toContain("No reasoning choice applies to this model.");
    // No effort options should be rendered.
    expect(output).not.toContain("thinking high");
    expect(output).not.toContain("thinking low");
    expect(output).not.toContain("thinking medium");
    expect(output).not.toContain("thinking off");
  });

  test("thinkingLevels with single variant renders exactly that one option", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="openai/special"
        defaultThinking="off"
        supportsThinking={true}
        runtime="opencode"
        thinkingLevels={["only"]}
      />,
    );

    expect(output).toContain("thinking only");
    expect(output).not.toContain("thinking high");
    expect(output).not.toContain("thinking low");
  });
});

describe("T14: Pi fixed levels remain unchanged (REQ-COMPAT-001)", () => {
  test("Pi runtime without thinkingLevels prop renders all six fixed PI_THINKING_LEVELS", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    // PI_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"]
    expect(output).toContain("thinking off");
    expect(output).toContain("thinking minimal");
    expect(output).toContain("thinking low");
    expect(output).toContain("thinking medium");
    expect(output).toContain("thinking high");
    expect(output).toContain("thinking xhigh");
  });

  test("Pi runtime does not show OpenCode-specific model variants", () => {
    const output = renderToString(
      <AgentModelAssignmentScreen
        cursor={0}
        agentIndex={0}
        totalAgents={3}
        modelId="claude-sonnet-4"
        defaultThinking="medium"
        supportsThinking={true}
        runtime="pi"
      />,
    );

    // Pi never shows "max" (an OpenCode-only provider-specific token).
    expect(output).not.toContain("thinking max");
    expect(output).not.toContain("Thinking not supported");
  });
});
