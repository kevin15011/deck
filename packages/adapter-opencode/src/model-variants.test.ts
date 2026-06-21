/**
 * Unit tests for model-variants.ts
 */

import { describe, expect, it } from "bun:test";
import { loadVariantCache, normalizeVariantKey, isVariantSupportedForModel, sanitizePersistedVariantForModel } from "./model-variants";

// Test fixtures
const validCache = JSON.stringify({
  schemaVersion: 1,
  runner: "opencode",
  generatedAt: "2026-01-01T00:00:00Z",
  providers: {
    openai: {
      "openai/gpt-5.5": ["low", "medium", "high"],
    },
    anthropic: {
      "anthropic/claude-sonnet-4": ["off", "low", "medium", "high"],
    },
  },
});

const malformedProvidersArray = JSON.stringify({
  schemaVersion: 1,
  runner: "opencode",
  generatedAt: "2026-01-01T00:00:00Z",
  providers: [], // Should be object, not array
});

const malformedProviderValue = JSON.stringify({
  schemaVersion: 1,
  runner: "opencode",
  generatedAt: "2026-01-01T00:00:00Z",
  providers: {
    openai: "not an object", // Should be object
  },
});

const malformedModelVariants = JSON.stringify({
  schemaVersion: 1,
  runner: "opencode",
  generatedAt: "2026-01-01T00:00:00Z",
  providers: {
    openai: {
      "openai/gpt-5.5": "not an array", // Should be array
    },
  },
});

const invalidGeneratedAt = JSON.stringify({
  schemaVersion: 1,
  runner: "opencode",
  generatedAt: "not-a-date",
  providers: {
    openai: {
      "openai/gpt-5.5": ["low"],
    },
  },
});

describe("loadVariantCache", () => {
  it("parses valid cache", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => validCache,
    });

    expect(result.cache).not.toBeNull();
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns empty when cache not found", () => {
    const result = loadVariantCache({
      cachePath: "/fake/missing",
      exists: () => false,
    });

    expect(result.cache).toBeNull();
    expect(result.diagnostics[0]).toContain("unavailable");
  });

  it("rejects malformed JSON", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => "not json{",
    });

    expect(result.cache).toBeNull();
    expect(result.diagnostics[0]).toContain("Malformed");
  });

  it("rejects array as providers", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => malformedProvidersArray,
    });

    expect(result.cache).toBeNull();
  });

  it("rejects non-object provider value", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => malformedProviderValue,
    });

    expect(result.cache).toBeNull();
  });

  it("rejects non-array model variants", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => malformedModelVariants,
    });

    expect(result.cache).toBeNull();
  });

  it("rejects unparseable generatedAt", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => invalidGeneratedAt,
    });

    expect(result.cache).toBeNull();
  });

  it("rejects invalid schemaVersion", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => JSON.stringify({
        schemaVersion: 2,
        runner: "opencode",
        generatedAt: "2026-01-01T00:00:00Z",
        providers: {},
      }),
    });

    expect(result.cache).toBeNull();
  });

  it("rejects invalid runner", () => {
    const result = loadVariantCache({
      cachePath: "/fake/path",
      exists: () => true,
      readFile: () => JSON.stringify({
        schemaVersion: 1,
        runner: "other",
        generatedAt: "2026-01-01T00:00:00Z",
        providers: {},
      }),
    });

    expect(result.cache).toBeNull();
  });
});

describe("normalizeVariantKey", () => {
  it("returns null for empty input", () => {
    expect(normalizeVariantKey(undefined)).toBeNull();
    expect(normalizeVariantKey("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(normalizeVariantKey("  low  ")).toBe("low");
  });

  it("returns null for control characters", () => {
    expect(normalizeVariantKey("low\x00")).toBeNull();
    expect(normalizeVariantKey("medium\x1F")).toBeNull();
  });

  it("returns trimmed string for valid input", () => {
    expect(normalizeVariantKey("high")).toBe("high");
  });
});

describe("isVariantSupportedForModel", () => {
  it("returns false when cache not loaded", () => {
    // Without cache, should return false
    const { isVariantSupportedForModel: checkVariant } = require("./model-variants");
    expect(checkVariant("openai", "openai/gpt-5.5", "low")).toBe(false);
  });
});

describe("sanitizePersistedVariantForModel", () => {
  it("returns undefined for empty input", () => {
    const result = sanitizePersistedVariantForModel("openai", "openai/gpt-5.5", undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid input", () => {
    const result = sanitizePersistedVariantForModel("openai", "openai/gpt-5.5", "");
    expect(result).toBeUndefined();
  });
});