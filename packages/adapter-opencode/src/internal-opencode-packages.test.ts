import { describe, expect, test } from "bun:test";

import { detectMermaidPluginStatus, INTERNAL_OPENCODE_PACKAGE_IDS, INTERNAL_OPENCODE_PACKAGES } from "./internal-opencode-packages";
import type { OpenCodeConfig } from "./types";

describe("INTERNAL_OPENCODE_PACKAGES", () => {
  test("contains opencode-mermaid-renderer", () => {
    expect(INTERNAL_OPENCODE_PACKAGES["opencode-mermaid-renderer"]).toBeDefined();
    expect(INTERNAL_OPENCODE_PACKAGES["opencode-mermaid-renderer"].id).toBe("opencode-mermaid-renderer");
    expect(INTERNAL_OPENCODE_PACKAGES["opencode-mermaid-renderer"].required).toBe(true);
  });

  test("INTERNAL_OPENCODE_PACKAGE_IDS has two entries", () => {
    expect(INTERNAL_OPENCODE_PACKAGE_IDS).toHaveLength(2);
    expect(INTERNAL_OPENCODE_PACKAGE_IDS[0]).toBe("opencode-mermaid-renderer");
    expect(INTERNAL_OPENCODE_PACKAGE_IDS[1]).toBe("deck-model-variants");
  });
});

describe("detectMermaidPluginStatus", () => {
  test('returns "ready" when plugin is present', () => {
    const config: OpenCodeConfig = { plugin: ["opencode-mermaid-renderer", "other-plugin"] };
    expect(detectMermaidPluginStatus(config)).toBe("ready");
  });

  test('returns "ready" when plugin is the only entry', () => {
    const config: OpenCodeConfig = { plugin: ["opencode-mermaid-renderer"] };
    expect(detectMermaidPluginStatus(config)).toBe("ready");
  });

  test('returns "missing" when plugin is absent', () => {
    const config: OpenCodeConfig = { plugin: ["some-other-plugin"] };
    expect(detectMermaidPluginStatus(config)).toBe("missing");
  });

  test('returns "missing" when plugin array is empty', () => {
    const config: OpenCodeConfig = { plugin: [] };
    expect(detectMermaidPluginStatus(config)).toBe("missing");
  });

  test('returns "missing" when plugin key is absent', () => {
    const config: OpenCodeConfig = {};
    expect(detectMermaidPluginStatus(config)).toBe("missing");
  });

  test("is non-blocking — throws are caught by caller", () => {
    // If config itself throws on access, that's the caller's responsibility to handle
    // We just verify the function doesn't throw for valid configs
    const config: OpenCodeConfig = { plugin: [] };
    expect(() => detectMermaidPluginStatus(config)).not.toThrow();
  });
});