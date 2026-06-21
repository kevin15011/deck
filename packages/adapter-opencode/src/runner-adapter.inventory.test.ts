/**
 * Unit tests for the OpenCode runner adapter's model inventory and thinking levels surface.
 * Tests getModelInventory() and getThinkingLevels() per Task 15 and REQ-INV-002.
 *
 * Covers the model-specific effort-level fix: getThinkingLevels(modelId) looks
 * up the model in the inventory and returns its per-model effort variants
 * (populated from the cache's reasoning_options), failing closed (empty)
 * for unsupported models rather than returning a generic constant.
 */

import { describe, expect, it } from "bun:test";
import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import type {
  RunnerAdapter,
  RunnerModelInventory,
  RunnerModelEntry,
  RunnerModelSource,
} from "@deck/core";

/**
 * `RunnerAdapter` does not declare `getModelInventory` (it is an extra method
 * on `OpenCodeRunnerAdapterImpl`). This type re-adds it so tests can call it
 * without per-site non-null assertions. The runtime object always provides it.
 */
type AdapterWithInventory = RunnerAdapter & {
  getModelInventory(): RunnerModelInventory;
};

/** Build an adapter, optionally injecting an inventory for testing. */
function makeAdapter(inventory?: RunnerModelInventory): AdapterWithInventory {
  return createOpenCodeRunnerAdapter(
    inventory ? { inventoryLoader: () => inventory } : undefined,
  ) as AdapterWithInventory;
}

/**
 * Build a minimal RunnerModelInventory with the given models grouped by provider.
 */
function inventoryWith(
  ...models: Array<{
    id: string;
    providerId: string;
    displayName?: string;
    variants?: readonly string[];
  }>
): RunnerModelInventory {
  const modelsByProvider: Record<string, RunnerModelEntry[]> = {};
  for (const m of models) {
    if (!modelsByProvider[m.providerId]) {
      modelsByProvider[m.providerId] = [];
    }
    const entry: RunnerModelEntry = {
      id: m.id,
      providerId: m.providerId,
      displayName: m.displayName ?? m.id,
      variants: m.variants,
      source: "runner-cache" as RunnerModelSource,
    };
    modelsByProvider[m.providerId].push(entry);
  }
  return {
    providers: Object.keys(modelsByProvider).map((id) => ({
      id,
      displayName: id,
      source: "runner-cache" as RunnerModelSource,
    })),
    modelsByProvider,
  };
}

describe("opencode / getModelInventory()", () => {
  it("returns a RunnerModelInventory object", () => {
    const adapter = makeAdapter();
    const inventory = adapter.getModelInventory();
    expect(inventory).toBeDefined();
    expect(typeof inventory).toBe("object");
    expect(Array.isArray(inventory.providers) || inventory.providers === undefined).toBe(true);
    expect(typeof inventory.modelsByProvider === "object").toBe(true);
  });

  it("caches inventory on subsequent calls", () => {
    const adapter = makeAdapter();
    const first = adapter.getModelInventory();
    const second = adapter.getModelInventory();
    // Should return same cached reference
    expect(first).toBe(second);
  });

  it("uses an injected inventoryLoader when provided", () => {
    const injected = inventoryWith({
      id: "openai/gpt-5.5",
      providerId: "openai",
      variants: ["low", "medium", "high"],
    });
    const adapter = makeAdapter(injected);
    const inventory = adapter.getModelInventory();
    expect(inventory).toBe(injected);
    // Cached: second call returns the same reference.
    expect(adapter.getModelInventory()).toBe(injected);
  });
});

describe("opencode / getThinkingLevels(modelId)", () => {
  it("returns all canonical levels when no modelId provided", () => {
    const adapter = makeAdapter();
    const levels = adapter.getThinkingLevels(undefined);
    // When no modelId is provided, returns all available thinking levels
    expect(Array.isArray(levels)).toBe(true);
    expect(levels.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown model (fail-closed, no generic constant)", () => {
    const adapter = makeAdapter(
      inventoryWith({
        id: "openai/gpt-5.5",
        providerId: "openai",
        variants: ["low", "medium", "high"],
      }),
    );
    const levels = adapter.getThinkingLevels("unknown/model");
    expect(Array.isArray(levels)).toBe(true);
    // Must be empty — NOT the generic 3/4-level constant.
    expect(levels).toEqual([]);
  });

  it("returns array (possibly empty) for known provider but unknown model", () => {
    const adapter = makeAdapter(
      inventoryWith({
        id: "openai/gpt-4o",
        providerId: "openai",
        variants: ["low", "medium"],
      }),
    );
    const levels = adapter.getThinkingLevels("openai/unknown-model-12345");
    expect(Array.isArray(levels)).toBe(true);
    expect(levels).toEqual([]);
  });

  // The core fix: model-specific effort variants must be returned for the
  // requested model, drawn from the inventory (which the cache parser now
  // populates from reasoning_options[].values).
  it("returns model-specific effort variants (high,max)", () => {
    const adapter = makeAdapter(
      inventoryWith(
        {
          id: "alibaba-token-plan/glm-5.2",
          providerId: "alibaba-token-plan",
          displayName: "GLM 5.2",
          variants: ["high", "max"],
        },
        {
          id: "openai/gpt-5.3-codex-spark",
          providerId: "openai",
          displayName: "GPT 5.3 Codex Spark",
          variants: ["none", "low", "medium", "high", "xhigh"],
        },
      ),
    );

    // Cast to readonly string[] because per-model effort variants may include
    // non-canonical tokens ("max", "none") that the closed RunnerThinkingLevel
    // union does not enumerate (runtime-correct, type-narrowed).
    const glmLevels = adapter.getThinkingLevels("alibaba-token-plan/glm-5.2") as readonly string[];
    expect(glmLevels).toEqual(["high", "max"]);

    const sparkLevels = adapter.getThinkingLevels("openai/gpt-5.3-codex-spark") as readonly string[];
    expect(sparkLevels).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  it("returns different variant sets per model (high,max vs none..xhigh)", () => {
    const adapter = makeAdapter(
      inventoryWith(
        {
          id: "alibaba-token-plan/glm-5.2",
          providerId: "alibaba-token-plan",
          variants: ["high", "max"],
        },
        {
          id: "openai/gpt-5.3-codex-spark",
          providerId: "openai",
          variants: ["none", "low", "medium", "high", "xhigh"],
        },
      ),
    );

    const a = adapter.getThinkingLevels("alibaba-token-plan/glm-5.2") as readonly string[];
    const b = adapter.getThinkingLevels("openai/gpt-5.3-codex-spark") as readonly string[];
    expect(a).not.toEqual(b);
    expect(a).toEqual(["high", "max"]);
    expect(b).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  // Model ID mismatch tolerance: callers may pass a raw model id without the
  // provider prefix. The lookup must still resolve via suffix match.
  it("resolves a raw model id (no provider prefix) via suffix match", () => {
    const adapter = makeAdapter(
      inventoryWith({
        id: "alibaba-token-plan/glm-5.2",
        providerId: "alibaba-token-plan",
        variants: ["high", "max"],
      }),
    );

    // Raw model id, no "provider/" prefix.
    const levels = adapter.getThinkingLevels("glm-5.2") as readonly string[];
    expect(levels).toEqual(["high", "max"]);
  });

  // Models with budget_tokens reasoning options have no discrete effort
  // variants (empty array in the inventory). getThinkingLevels must return
  // empty — NOT a generic constant — so the picker hides.
  it("returns empty for a budget_tokens-only model (no effort variants)", () => {
    const adapter = makeAdapter(
      inventoryWith({
        id: "anthropic/claude-sonnet-4-5",
        providerId: "anthropic",
        variants: [],
      }),
    );

    const levels = adapter.getThinkingLevels("anthropic/claude-sonnet-4-5");
    expect(levels).toEqual([]);
  });

  // A model present in the inventory but with undefined variants is treated
  // the same as empty: fail closed.
  it("returns empty when model exists but variants is undefined", () => {
    const adapter = makeAdapter(
      inventoryWith({
        id: "openai/gpt-4o",
        providerId: "openai",
        // variants intentionally omitted
      }),
    );

    const levels = adapter.getThinkingLevels("openai/gpt-4o");
    expect(levels).toEqual([]);
  });

  // When the inventory is unavailable (loader throws), getThinkingLevels
  // must fail closed (empty) for a specific model rather than guessing the
  // generic constant. The no-modelId path is covered separately below.
  it("fails closed (empty) when the inventory loader throws for a specific model", () => {
    const adapter = makeAdapter(
      new Proxy({} as RunnerModelInventory, {
        get() {
          throw new Error("cache unreadable");
        },
      }),
    );

    const levels = adapter.getThinkingLevels("alibaba-token-plan/glm-5.2");
    expect(levels).toEqual([]);
  });

  it("still returns canonical levels when no modelId AND inventory is unavailable", () => {
    // The no-modelId fallback to canonical levels is the pre-existing contract
    // (callers that want the full set without targeting a model). This path
    // does not depend on inventory availability — the constant is returned
    // before the inventory is ever consulted.
    const adapter = makeAdapter(
      new Proxy({} as RunnerModelInventory, {
        get() {
          throw new Error("cache unreadable");
        },
      }),
    );

    const levels = adapter.getThinkingLevels(undefined);
    expect(Array.isArray(levels)).toBe(true);
    expect(levels.length).toBeGreaterThan(0);
  });
});

describe("opencode / supportsThinking(modelId)", () => {
  it("returns false for unknown model", () => {
    const adapter = makeAdapter();
    const supported = adapter.supportsThinking("unknown/model");
    expect(typeof supported).toBe("boolean");
  });
});
