import { describe, expect, test } from "bun:test";
import {
  detectConfiguredProviders,
  listModelsForProvider,
  parsePiListModelsOutput,
  buildModelInventoryFromPiListModels,
  PI_PROVIDERS,
  DEFAULT_MODELS_BY_PROVIDER,
} from "./model-config";

describe("detectConfiguredProviders", () => {
  test("returns empty array when no env vars are set", () => {
    const result = detectConfiguredProviders({ env: {} });
    expect(result).toEqual([]);
  });

  test("detects Pi default provider from settings without env vars", () => {
    const result = detectConfiguredProviders({
      env: {},
      settings: { defaultProvider: "opencode-go", defaultModel: "kimi-k2.6" },
    });
    expect(result.map((p) => p.id)).toEqual(["opencode-go"]);
  });

  test("detects Pi default provider from injected settings file", () => {
    const result = detectConfiguredProviders({
      env: {},
      settingsPath: "/fake/settings.json",
      readFile: () => JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "gpt-5.5" }),
    });
    expect(result.map((p) => p.id)).toEqual(["openai-codex"]);
  });

  test("detects providers from pi --list-models table output", () => {
    const result = detectConfiguredProviders({
      env: {},
      runCommand: () => ({
        exitCode: 0,
        stdout: [
          "provider      model                context  max-out",
          "openai-codex  gpt-5.5              272K     128K",
          "opencode-go   kimi-k2.6            262.1K   65.5K",
        ].join("\n"),
      }),
    });

    expect(result.map((p) => p.id).sort()).toEqual(["openai-codex", "opencode-go"]);
  });

  test("detects providers from pi --list-models stderr when stdout is empty", () => {
    const result = detectConfiguredProviders({
      env: {},
      runCommand: () => ({
        exitCode: 0,
        stdout: "",
        stderr: [
          "provider      model                context  max-out",
          "openai-codex  gpt-5.5              272K     128K",
          "opencode-go   kimi-k2.6            262.1K   65.5K",
        ].join("\n"),
      }),
    });

    expect(result.map((p) => p.id).sort()).toEqual(["openai-codex", "opencode-go"]);
  });

  test("detects anthropic when ANTHROPIC_API_KEY is present", () => {
    const result = detectConfiguredProviders({ env: { ANTHROPIC_API_KEY: "sk-123" } });
    expect(result.map((p) => p.id)).toContain("anthropic");
  });

  test("detects openai when OPENAI_API_KEY is present", () => {
    const result = detectConfiguredProviders({ env: { OPENAI_API_KEY: "sk-abc" } });
    expect(result.map((p) => p.id)).toContain("openai");
  });

  test("detects google when GEMINI_API_KEY is present", () => {
    const result = detectConfiguredProviders({ env: { GEMINI_API_KEY: "key" } });
    expect(result.map((p) => p.id)).toContain("google");
  });

  test("ignores empty or whitespace-only env values", () => {
    const result = detectConfiguredProviders({
      env: { ANTHROPIC_API_KEY: "  ", OPENAI_API_KEY: "" },
    });
    expect(result).toEqual([]);
  });

  test("returns multiple providers when several keys are set", () => {
    const result = detectConfiguredProviders({
      env: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b", GROQ_API_KEY: "c" },
    });
    expect(result.map((p) => p.id).sort()).toEqual(["anthropic", "groq", "openai", "openai-codex"]);
  });

  test("detects opencode-go from OPENCODE_API_KEY env fallback", () => {
    const result = detectConfiguredProviders({ env: { OPENCODE_API_KEY: "key" } });
    expect(result.map((p) => p.id)).toContain("opencode-go");
  });

  test("uses process.env by default", () => {
    // Just ensure it doesn't throw when called without options
    const result = detectConfiguredProviders();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("listModelsForProvider", () => {
  test("returns default models for anthropic", () => {
    const models = listModelsForProvider("anthropic");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.providerId === "anthropic")).toBe(true);
    expect(models.some((m) => m.id.includes("claude"))).toBe(true);
  });

  test("returns default models for openai", () => {
    const models = listModelsForProvider("openai");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes("gpt"))).toBe(true);
  });

  test("returns default models for opencode-go", () => {
    const models = listModelsForProvider("opencode-go");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "opencode-go/kimi-k2.6")).toBe(true);
  });

  test("returns empty array for unknown provider", () => {
    const models = listModelsForProvider("unknown");
    expect(models).toEqual([]);
  });

  test("prefers pi --list-models output when runCommand succeeds", () => {
    const runCommand = () => ({
      stdout: "anthropic/claude-custom\nanthropic/claude-other",
      exitCode: 0,
    });
    const models = listModelsForProvider("anthropic", { runCommand });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("anthropic/claude-custom");
    expect(models[0].displayName).toBe("Claude Custom");
    expect(models[1].id).toBe("anthropic/claude-other");
    expect(models[1].displayName).toBe("Claude Other");
  });

  test("parses pi --list-models from stderr when stdout is empty", () => {
    const runCommand = () => ({
      stdout: "",
      stderr: "anthropic/claude-custom\nanthropic/claude-other",
      exitCode: 0,
    });
    const models = listModelsForProvider("anthropic", { runCommand });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("anthropic/claude-custom");
    expect(models[0].displayName).toBe("Claude Custom");
    expect(models[1].id).toBe("anthropic/claude-other");
    expect(models[1].displayName).toBe("Claude Other");
  });

  test("parses real pi --list-models table output for a provider", () => {
    const stdout = [
      "provider      model                context  max-out  thinking  images",
      "openai-codex  gpt-5.5              272K     128K     yes       yes",
      "opencode-go   kimi-k2.6            262.1K   65.5K    yes       yes",
      "opencode-go   qwen3.6-plus         262.1K   65.5K    yes       yes",
    ].join("\n");

    const models = parsePiListModelsOutput(stdout, "opencode-go");
    expect(models.map((model) => model.id)).toEqual(["opencode-go/kimi-k2.6", "opencode-go/qwen3.6-plus"]);
  });

  test("uses pi --list-models table output for opencode-go", () => {
    const models = listModelsForProvider("opencode-go", {
      runCommand: () => ({
        exitCode: 0,
        stdout: [
          "provider      model                context  max-out",
          "opencode-go   kimi-k2.6            262.1K   65.5K",
          "openai-codex  gpt-5.5              272K     128K",
        ].join("\n"),
      }),
    });

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("opencode-go/kimi-k2.6");
  });

  test("uses provided modelsOutput before curated defaults", () => {
    const models = listModelsForProvider("opencode-go", {
      modelsOutput: [
        "provider      model                context  max-out",
        "opencode-go   deepseek-v4-flash    1M       384K",
        "opencode-go   kimi-k2.6            262.1K   65.5K",
        "opencode-go   qwen3.6-plus         262.1K   65.5K",
        "opencode-go   minimax-m2.7         204.8K   131.1K",
      ].join("\n"),
    });

    expect(models.map((m) => m.id)).toEqual([
      "opencode-go/deepseek-v4-flash",
      "opencode-go/kimi-k2.6",
      "opencode-go/qwen3.6-plus",
      "opencode-go/minimax-m2.7",
    ]);
  });

  test("falls back to defaults when pi --list-models fails", () => {
    const runCommand = () => ({ stdout: "", exitCode: 1 });
    const models = listModelsForProvider("anthropic", { runCommand });
    expect(models).toEqual([...DEFAULT_MODELS_BY_PROVIDER.anthropic]);
  });

  test("falls back to defaults when runCommand throws", () => {
    const runCommand = () => {
      throw new Error("pi not found");
    };
    const models = listModelsForProvider("anthropic", { runCommand });
    expect(models).toEqual([...DEFAULT_MODELS_BY_PROVIDER.anthropic]);
  });
});

describe("buildModelInventoryFromPiListModels", () => {
  test("builds providers and full model lists from Pi table output", () => {
    const inventory = buildModelInventoryFromPiListModels(
      [
        "provider      model                context  max-out",
        "openai-codex  gpt-5.1              272K     128K",
        "openai-codex  gpt-5.5              272K     128K",
        "opencode-go   kimi-k2.6            262.1K   65.5K",
        "opencode-go   qwen3.6-plus         262.1K   65.5K",
      ].join("\n"),
    );

    expect(inventory.providers.map((p) => p.id).sort()).toEqual(["openai-codex", "opencode-go"]);
    expect(inventory.modelsByProvider["openai-codex"].map((m) => m.id)).toEqual([
      "openai-codex/gpt-5.1",
      "openai-codex/gpt-5.5",
    ]);
    expect(inventory.modelsByProvider["opencode-go"].map((m) => m.id)).toEqual([
      "opencode-go/kimi-k2.6",
      "opencode-go/qwen3.6-plus",
    ]);
  });
});

describe("PI_PROVIDERS", () => {
  test("contains expected providers", () => {
    const ids = PI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("opencode-go");
    expect(ids).toContain("openai-codex");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("groq");
    expect(ids).toContain("ollama");
    expect(ids).toContain("mistral");
  });
});
