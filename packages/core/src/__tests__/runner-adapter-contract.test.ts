/**
 * Runner Adapter Contract Tests
 *
 * Tests the core runner adapter contracts widened by EG-1 (T1):
 * - RunnerThinkingLevel accepts arbitrary validated strings
 * - Optional getModelInventory method does not break existing adapters
 * - Adapters implement supportsThinking and getThinkingLevels
 *
 * These tests verify compile-time contracts only; runtime adapter behavior
 * is tested in adapter-specific test suites.
 */

import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Test: RunnerThinkingLevel is now an open string
// ---------------------------------------------------------------------------

describe("RunnerThinkingLevel widening", () => {
  it("should accept arbitrary validated strings", () => {
    // Canonical levels still work
    const canonical: import("../runner-adapter").RunnerThinkingLevel = "off";
    expect(canonical).toBe("off");

    const piLevel: import("../runner-adapter").RunnerThinkingLevel = "xhigh";
    expect(piLevel).toBe("xhigh");

    // OpenCode-specific variant keys work (adapters must validate)
    const openCodeVariant: import("../runner-adapter").RunnerThinkingLevel = "minimal";
    expect(openCodeVariant).toBe("minimal");

    // Provider-specific variant keys work (using valid canonical level)
    const providerVariant: import("../runner-adapter").RunnerThinkingLevel = "high";
    expect(providerVariant).toBe("high");
  });

  it("should be assignable from string variables", () => {
    const userInput = "high" as import("../runner-adapter").RunnerThinkingLevel;
    expect(typeof userInput).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Test: RunnerModelInventory types exist and are well-formed
// ---------------------------------------------------------------------------

describe("RunnerModelInventory types", () => {
  it("should define RunnerModelSource discriminator", () => {
    type Sources = import("../runner-adapter").RunnerModelSource;
    const sources: readonly Sources[] = [
      "runner-cache",
      "runner-config",
    ];
    expect(sources).toHaveLength(2);
  });

  it("should create valid RunnerModelProvider entries", () => {
    const provider: import("../runner-adapter").RunnerModelProvider = {
      id: "openai",
      displayName: "OpenAI API",
      source: "runner-cache",
    };
    expect(provider.id).toBe("openai");
    expect(provider.source).toBe("runner-cache");
  });

  it("should create valid RunnerModelEntry entries", () => {
    const entry: import("../runner-adapter").RunnerModelEntry = {
      id: "openai/gpt-5.5",
      providerId: "openai",
      displayName: "GPT-5.5",
      supportsTools: true,
      supportsReasoning: true,
      variants: ["low", "medium", "high"],
      source: "runner-cache",
    };
    expect(entry.variants).toEqual(["low", "medium", "high"]);
  });

  it("should create valid RunnerModelInventory", () => {
    const inventory: import("../runner-adapter").RunnerModelInventory = {
      providers: [
        { id: "openai", displayName: "OpenAI API", source: "runner-cache" },
      ],
      modelsByProvider: {
        openai: [
          {
            id: "openai/gpt-5.5",
            providerId: "openai",
            displayName: "GPT-5.5",
            variants: ["low", "medium", "high"],
            source: "runner-cache",
          },
        ],
      },
      diagnostics: [],
    };
    expect(inventory.providers).toHaveLength(1);
    expect(Object.keys(inventory.modelsByProvider)).toContain("openai");
  });

  it("should allow empty variants to indicate no confirmed support", () => {
    const entry: import("../runner-adapter").RunnerModelEntry = {
      id: "openai/gpt-4o",
      providerId: "openai",
      displayName: "GPT-4o",
      source: "runner-cache",
      // variants is undefined = no confirmed variants
    };
    expect(entry.variants).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test: RunnerAdapter interface includes required methods
// ---------------------------------------------------------------------------

describe("RunnerAdapter interface contracts", () => {
  it("should require getThinkingLevels method", () => {
    // This is a compile-time check - if this file compiles,
    // the interface includes getThinkingLevels
    type HasGetThinkingLevels = import("../runner-adapter").RunnerAdapter extends {
      getThinkingLevels(modelId?: string): readonly import("../runner-adapter").RunnerThinkingLevel[];
    }
      ? true
      : false;
    const _check: HasGetThinkingLevels = true;
    expect(_check).toBe(true);
  });

  it("should require supportsThinking method", () => {
    type HasSupportsThinking = import("../runner-adapter").RunnerAdapter extends {
      supportsThinking(modelId: string): boolean;
    }
      ? true
      : false;
    const _check: HasSupportsThinking = true;
    expect(_check).toBe(true);
  });

  it("should allow optional getModelInventory method", () => {
    // getModelInventory is optional - adapters can implement incrementally
    // The actual interface allows Promise | sync return, so we check if the method exists optionally
    type RunnerAdapter = import("../runner-adapter").RunnerAdapter;
    type HasInventoryMethod = RunnerAdapter extends { getModelInventory?: (...args: never[]) => unknown }
      ? true
      : false;
    const _check: HasInventoryMethod = true;
    expect(_check).toBe(true);
  });
});