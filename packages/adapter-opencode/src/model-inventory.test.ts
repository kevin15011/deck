/**
 * Unit tests for model-inventory.ts
 */

import { describe, expect, it } from "bun:test";
import { loadModelInventory } from "./model-inventory";
import type { RunnerModelProvider, RunnerModelEntry } from "./model-inventory";
import type { PathLike } from "node:fs";

// Test fixtures
const validProviderMapCache = JSON.stringify({
  providers: {
    openai: { id: "openai", name: "OpenAI" },
    anthropic: { id: "anthropic", name: "Anthropic" },
  },
  models: {
    "openai/gpt-5.5": { id: "openai/gpt-5.5", name: "GPT 5.5", variants: ["low", "medium", "high"] },
    "anthropic/claude-sonnet-4": { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", variants: ["off", "low", "medium", "high"] },
  },
});

const validProviderArrayCache = JSON.stringify({
  providers: [
    { id: "openai", name: "OpenAI" },
  ],
  models: [
    { id: "openai/gpt-5.5", providerId: "openai", variants: ["low", "medium"] },
  ],
});

const malformedCache = JSON.stringify({
  providers: {
    // Invalid: missing id field
    "": { name: "Invalid" },
  },
});

const duplicateVariantsCache = JSON.stringify({
  providers: {
    openai: { id: "openai", name: "OpenAI" },
  },
  models: {
    "openai/gpt-5.5": { id: "openai/gpt-5.5", variants: ["low", "medium", "low", "HIGH"] },
  },
});

const controlCharVariantsCache = JSON.stringify({
  providers: {
    openai: { id: "openai", name: "OpenAI" },
  },
  models: {
    "openai/gpt-5.5": { id: "openai/gpt-5.5", variants: ["low", "medium\x00", "high"] },
  },
});

const emptyVariantsCache = JSON.stringify({
  providers: {
    openai: { id: "openai", name: "OpenAI" },
  },
  models: {
    "openai/gpt-5.5": { id: "openai/gpt-5.5", variants: ["", "  ", "low"] },
  },
});

/**
 * Helper: create exists/readFile mocks that route paths to different content.
 * - cachePath -> cacheContent
 * - authPath -> authContent (optional)
 * - configPath -> returns false (no config)
 * - everything else -> returns false
 */
function makeFsMocks(
  cacheContent: string,
  authContent?: string,
) {
  const exists = (path: string | PathLike) => {
    const p = typeof path === "string" ? path : path.toString();
    if (p === "/fake/cache") return true;
    if (authContent && p === "/fake/auth") return true;
    return false;
  };
  const readFile = (path: string | PathLike, _encoding: "utf-8") => {
    const p = typeof path === "string" ? path : path.toString();
    if (p === "/fake/cache") return cacheContent;
    if (p === "/fake/auth" && authContent) return authContent;
    throw new Error(`Unexpected read: ${p}`);
  };
  return { exists, readFile };
}

describe("loadModelInventory", () => {
  it("parses valid provider map cache", () => {
    const { exists, readFile } = makeFsMocks(validProviderMapCache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai", "anthropic"],
    });

    expect(result.providers.length).toBeGreaterThanOrEqual(1);
  });

  it("parses valid provider array cache", () => {
    const { exists, readFile } = makeFsMocks(validProviderArrayCache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    expect(result.providers.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when cache not found", () => {
    const result = loadModelInventory({
      cachePath: "/fake/missing",
      exists: () => false,
    });

    expect(result.providers).toHaveLength(0);
  });

  it("handles malformed JSON gracefully", () => {
    const result = loadModelInventory({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => "not json{",
      configuredProviderIds: [],
    });

    expect(result.providers).toHaveLength(0);
  });

  // REQ-INV-002: Model-map shape without explicit providerId should infer from model ID
  it("parses model-map with inferred providerId and preserves variants", () => {
    // This is the required model-map shape from OpenCode cache
    const modelMapCache = JSON.stringify({
      providers: {
        openai: { name: "OpenAI" },
      },
      models: {
        // Model ID includes provider prefix - providerId should be inferred
        "openai/gpt-5.5": { name: "GPT 5.5", variants: ["minimal", "low", "medium", "high", "xhigh"] },
        "anthropic/claude-sonnet-4": { name: "Claude Sonnet 4", variants: ["off", "low", "medium", "high"] },
      },
    });

    const { exists, readFile } = makeFsMocks(modelMapCache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai", "anthropic"],
    });

    // Should have both providers (openai from cache, anthropic inferred from model ID)
    expect(result.providers.length).toBeGreaterThanOrEqual(2);
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "openai")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "anthropic")).toBeDefined();

    // Should have models with variants (the key fix: providerId inferred from model ID)
    const openaiModels = result.modelsByProvider["openai"];
    expect(openaiModels).toBeDefined();
    expect(openaiModels.length).toBeGreaterThanOrEqual(1);

    const gpt55 = openaiModels.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    expect(gpt55?.variants).toContain("high");
    expect(gpt55?.variants).toContain("xhigh");

    // Anthropic models are under anthropic provider (inferred from model ID)
    const anthropicModels = result.modelsByProvider["anthropic"];
    expect(anthropicModels).toBeDefined();
    const claude = anthropicModels.find((m: RunnerModelEntry) => m.id === "anthropic/claude-sonnet-4");
    expect(claude).toBeDefined();
    expect(claude?.variants).toContain("off");
  });

  // REQ-EFFORT-002: Per-model variants should be preserved
  it("preserves per-model variants from model-map cache", () => {
    const modelMapCache = JSON.stringify({
      providers: {
        openai: { name: "OpenAI" },
        anthropic: { name: "Anthropic" },
      },
      models: {
        "openai/gpt-5.5": { variants: ["low", "medium", "high"] },
        "anthropic/claude-sonnet-4": { variants: ["minimal", "low", "medium", "high", "xhigh"] },
      },
    });

    const { exists, readFile } = makeFsMocks(modelMapCache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai", "anthropic"],
    });

    const openaiModels = result.modelsByProvider["openai"];
    const gpt55 = openaiModels?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55?.variants).toEqual(["low", "medium", "high"]);

    const anthropicModels = result.modelsByProvider["anthropic"];
    const claude = anthropicModels?.find((m: RunnerModelEntry) => m.id === "anthropic/claude-sonnet-4");
    expect(claude?.variants).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });

  // Real OpenCode cache shape: flat provider map with nested models
  it("parses real OpenCode cache shape (flat provider map)", () => {
    const realOpenCodeCache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": { name: "GPT 5.5", tool_call: true, variants: ["low", "medium", "high"] },
          "gpt-4o": { name: "GPT-4o", tool_call: true, variants: ["minimal", "low"] },
        },
      },
      anthropic: {
        name: "Anthropic",
        models: {
          "claude-sonnet-4": { name: "Claude Sonnet 4", tool_call: true, reasoning: true, variants: ["off", "low", "medium", "high"] },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(realOpenCodeCache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai", "anthropic"],
    });

    // Should have both providers
    expect(result.providers.length).toBe(2);
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "openai")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "anthropic")).toBeDefined();

    // Should have models with correct provider IDs
    const openaiModels = result.modelsByProvider["openai"];
    expect(openaiModels).toBeDefined();
    expect(openaiModels.length).toBe(2);

    const gpt55 = openaiModels.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    expect(gpt55?.displayName).toBe("GPT 5.5");
    expect(gpt55?.supportsTools).toBe(true);
    expect(gpt55?.variants).toEqual(["low", "medium", "high"]);

    const gpt4o = openaiModels.find((m: RunnerModelEntry) => m.id === "openai/gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o?.supportsTools).toBe(true);

    const anthropicModels = result.modelsByProvider["anthropic"];
    expect(anthropicModels).toBeDefined();
    expect(anthropicModels.length).toBe(1);

    const claude = anthropicModels.find((m: RunnerModelEntry) => m.id === "anthropic/claude-sonnet-4");
    expect(claude).toBeDefined();
    expect(claude?.supportsTools).toBe(true);
    expect(claude?.supportsReasoning).toBe(true);
    expect(claude?.variants).toEqual(["off", "low", "medium", "high"]);
  });

  it("parses flat provider map with model IDs already including provider prefix", () => {
    const cacheWithPrefixedModels = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "openai/gpt-5.5": { name: "GPT 5.5", tool_call: true },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cacheWithPrefixedModels);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const openaiModels = result.modelsByProvider["openai"];
    expect(openaiModels).toBeDefined();
    expect(openaiModels.length).toBe(1);
    // Should not double-prefix: "openai/openai/gpt-5.5" is wrong
    expect(openaiModels[0].id).toBe("openai/gpt-5.5");
  });

  it("parses flat provider map with array-shaped models", () => {
    const cacheWithArrayModels = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: [
          { id: "gpt-5.5", name: "GPT 5.5", tool_call: true },
          { id: "gpt-4o", name: "GPT-4o", tool_call: true },
        ],
      },
    });

    const { exists, readFile } = makeFsMocks(cacheWithArrayModels);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const openaiModels = result.modelsByProvider["openai"];
    expect(openaiModels).toBeDefined();
    expect(openaiModels.length).toBe(2);
    expect(openaiModels.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5")).toBeDefined();
    expect(openaiModels.find((m: RunnerModelEntry) => m.id === "openai/gpt-4o")).toBeDefined();
  });

  it("filters out unavailable models (tool_call: false) in flat provider map", () => {
    const cacheWithUnavailable = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": { name: "GPT 5.5", tool_call: true },
          "gpt-3.5": { name: "GPT-3.5", tool_call: false },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cacheWithUnavailable);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const openaiModels = result.modelsByProvider["openai"];
    expect(openaiModels).toBeDefined();
    expect(openaiModels.length).toBe(1);
    expect(openaiModels[0].id).toBe("openai/gpt-5.5");
  });

  it("handles empty provider in flat provider map", () => {
    const cacheWithEmptyProvider = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {},
      },
      anthropic: {
        name: "Anthropic",
      },
    });

    const { exists, readFile } = makeFsMocks(cacheWithEmptyProvider);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai", "anthropic"],
    });

    // Should still have both providers
    expect(result.providers.length).toBe(2);
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "openai")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "anthropic")).toBeDefined();

    // OpenAI has empty models array
    expect(result.modelsByProvider["openai"]).toEqual([]);
    // Anthropic has no models field, should also be empty
    expect(result.modelsByProvider["anthropic"]).toEqual([]);
  });

  // --- Configured provider filtering tests ---

  it("filters flat provider catalog to configured providers from auth data", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
      anthropic: {
        name: "Anthropic",
        models: { "claude-sonnet-4": { name: "Claude Sonnet 4", tool_call: true } },
      },
      google: {
        name: "Google",
        models: { "gemini-pro": { name: "Gemini Pro", tool_call: true } },
      },
    });
    // Only openai and anthropic are configured via auth
    const auth = JSON.stringify({
      openai: { type: "api", key: "sk-..." },
      anthropic: { type: "api", key: "sk-ant-..." },
    });

    const { exists, readFile } = makeFsMocks(cache, auth);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
    });

    // Only configured providers should appear
    expect(result.providers.length).toBe(2);
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "openai")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "anthropic")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "google")).toBeUndefined();

    // Models for unconfigured providers should not appear
    expect(result.modelsByProvider["google"]).toBeUndefined();
    expect(result.modelsByProvider["openai"]?.length).toBe(1);
    expect(result.modelsByProvider["anthropic"]?.length).toBe(1);
  });

  it("includes env-configured provider via env field", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
      anthropic: {
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: { "claude-sonnet-4": { name: "Claude Sonnet 4", tool_call: true } },
      },
    });
    // No auth file; only OPENAI_API_KEY is set in env
    const env = { OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "" };

    const exists = (path: string | PathLike) => path === "/fake/cache";
    const readFile = (path: string | PathLike, _encoding: "utf-8") => {
      if (path === "/fake/cache") return cache;
      throw new Error(`Unexpected read: ${path}`);
    };

    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      env,
    });

    // Only openai should be included (ANTHROPIC_API_KEY is empty)
    expect(result.providers.length).toBe(1);
    expect(result.providers[0].id).toBe("openai");
    expect(result.modelsByProvider["openai"]?.length).toBe(1);
    expect(result.modelsByProvider["anthropic"]).toBeUndefined();
  });

  it("excludes unconfigured providers", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
      anthropic: {
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: { "claude-sonnet-4": { name: "Claude Sonnet 4", tool_call: true } },
      },
      google: {
        name: "Google",
        env: ["GOOGLE_API_KEY"],
        models: { "gemini-pro": { name: "Gemini Pro", tool_call: true } },
      },
    });
    // No auth file; no env vars set
    const env = {};

    const exists = (path: string | PathLike) => path === "/fake/cache";
    const readFile = (path: string | PathLike, _encoding: "utf-8") => {
      if (path === "/fake/cache") return cache;
      throw new Error(`Unexpected read: ${path}`);
    };

    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      env,
    });

    // No providers should be included
    expect(result.providers.length).toBe(0);
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.some((d: string) => d.includes("no-configured-providers"))).toBe(true);
  });

  it("supports legacy env_vars field for env-configured providers", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        env_vars: ["OPENAI_API_KEY"],
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
    });
    const env = { OPENAI_API_KEY: "sk-test" };

    const exists = (path: string | PathLike) => path === "/fake/cache";
    const readFile = (path: string | PathLike, _encoding: "utf-8") => {
      if (path === "/fake/cache") return cache;
      throw new Error(`Unexpected read: ${path}`);
    };

    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      env,
    });

    expect(result.providers.length).toBe(1);
    expect(result.providers[0].id).toBe("openai");
  });

  it("returns empty inventory with diagnostics when no auth/env configured", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
    });
    // No auth file, no env vars
    const env = {};

    const exists = (path: string | PathLike) => path === "/fake/cache";
    const readFile = (path: string | PathLike, _encoding: "utf-8") => {
      if (path === "/fake/cache") return cache;
      throw new Error(`Unexpected read: ${path}`);
    };

    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      env,
    });

    expect(result.providers.length).toBe(0);
    expect(result.diagnostics).toBeDefined();
  });

  it("combines auth-configured and env-configured providers", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        models: { "gpt-5.5": { name: "GPT 5.5", tool_call: true } },
      },
      anthropic: {
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: { "claude-sonnet-4": { name: "Claude Sonnet 4", tool_call: true } },
      },
      google: {
        name: "Google",
        env: ["GOOGLE_API_KEY"],
        models: { "gemini-pro": { name: "Gemini Pro", tool_call: true } },
      },
    });
    // Auth has openai; env has ANTHROPIC_API_KEY; google is unconfigured
    const auth = JSON.stringify({
      openai: { type: "api", key: "sk-..." },
    });
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };

    const { exists, readFile } = makeFsMocks(cache, auth);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      env,
    });

    // openai (from auth) + anthropic (from env) should be included
    expect(result.providers.length).toBe(2);
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "openai")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "anthropic")).toBeDefined();
    expect(result.providers.find((p: RunnerModelProvider) => p.id === "google")).toBeUndefined();
  });

  // --- reasoning_options (real OpenCode cache format) ---

  // Real OpenCode cache stores per-model reasoning options as an array of
  // { type, values?, min? } entries, NOT a top-level variants field.
  // parseModelEntry must extract discrete effort levels from entries where
  // type === "effort" and values is a string array.
  it("extracts effort variants from reasoning_options (type=effort, string values)", () => {
    const cache = JSON.stringify({
      "alibaba-token-plan": {
        name: "Alibaba Token Plan",
        models: {
          "glm-5.2": {
            name: "GLM 5.2",
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["high", "max"] }],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["alibaba-token-plan"],
    });

    const models = result.modelsByProvider["alibaba-token-plan"];
    expect(models).toBeDefined();
    const glm = models?.find((m: RunnerModelEntry) => m.id === "alibaba-token-plan/glm-5.2");
    expect(glm).toBeDefined();
    // Variants must come from reasoning_options[].values, NOT be empty.
    expect(glm?.variants).toEqual(["high", "max"]);
  });

  it("extracts multi-level effort variants (none,low,medium,high,xhigh)", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.3-codex-spark": {
            name: "GPT 5.3 Codex Spark",
            tool_call: true,
            reasoning_options: [
              { type: "effort", values: ["none", "low", "medium", "high", "xhigh"] },
            ],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const spark = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.3-codex-spark");
    expect(spark).toBeDefined();
    expect(spark?.variants).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  // Models with only budget_tokens reasoning options have no discrete effort
  // levels. Variants must be empty (not a generic constant) so downstream
  // code can hide the effort picker / fail closed.
  it("leaves variants empty for budget_tokens-only models", () => {
    const cache = JSON.stringify({
      anthropic: {
        name: "Anthropic",
        models: {
          "claude-sonnet-4-5": {
            name: "Claude Sonnet 4.5",
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: "budget_tokens", min: 1024 }],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["anthropic"],
    });

    const models = result.modelsByProvider["anthropic"];
    const claude = models?.find((m: RunnerModelEntry) => m.id === "anthropic/claude-sonnet-4-5");
    expect(claude).toBeDefined();
    // budget_tokens yields no discrete effort variants.
    expect(claude?.variants).toEqual([]);
  });

  it("leaves variants empty when reasoning_options is absent", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-4o": {
            name: "GPT-4o",
            tool_call: true,
            // No reasoning_options, no variants.
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const gpt4o = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o?.variants).toEqual([]);
  });

  // reasoning_options effort values take precedence over the legacy variants
  // field when both are present. The real cache uses reasoning_options; the
  // variants field is supported only for backward compatibility.
  it("prefers reasoning_options effort values over legacy variants field", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": {
            name: "GPT 5.5",
            tool_call: true,
            variants: ["low", "medium", "high"],
            reasoning_options: [{ type: "effort", values: ["high", "max"] }],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const gpt55 = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    // reasoning_options wins.
    expect(gpt55?.variants).toEqual(["high", "max"]);
  });

  // reasoning_options with an unknown type (neither "effort" nor "budget_tokens")
  // must not contribute variants; fall back to legacy variants field if present.
  it("ignores reasoning_options entries with unknown type", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": {
            name: "GPT 5.5",
            tool_call: true,
            variants: ["low", "medium", "high"],
            reasoning_options: [{ type: "custom_unknown", values: ["weird"] }],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const gpt55 = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    // No effort entry → fall back to legacy variants field.
    expect(gpt55?.variants).toEqual(["low", "medium", "high"]);
  });

  // Malformed reasoning_options (non-array values, non-string entries) must
  // be ignored gracefully, not crash the parser.
  it("ignores malformed reasoning_options entries (non-string values)", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": {
            name: "GPT 5.5",
            tool_call: true,
            reasoning_options: [
              { type: "effort", values: "not-an-array" },
              { type: "effort", values: ["high", 42, null, "max"] },
            ],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const gpt55 = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    // Only string entries survive; non-strings are filtered out.
    expect(gpt55?.variants).toEqual(["high", "max"]);
  });

  // Validation/dedup rules apply to reasoning_options effort values too:
  // duplicates removed, control characters rejected, empty/whitespace dropped.
  it("deduplicates and validates reasoning_options effort values", () => {
    const cache = JSON.stringify({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.5": {
            name: "GPT 5.5",
            tool_call: true,
            reasoning_options: [
              { type: "effort", values: ["high", "high", "max\x00", "  ", "max"] },
            ],
          },
        },
      },
    });

    const { exists, readFile } = makeFsMocks(cache);
    const result = loadModelInventory({
      cachePath: "/fake/cache",
      authPath: "/fake/auth",
      exists,
      readFile,
      configuredProviderIds: ["openai"],
    });

    const models = result.modelsByProvider["openai"];
    const gpt55 = models?.find((m: RunnerModelEntry) => m.id === "openai/gpt-5.5");
    expect(gpt55).toBeDefined();
    // Duplicates removed, control-char rejected, whitespace dropped.
    expect(gpt55?.variants).toEqual(["high", "max"]);
  });
});