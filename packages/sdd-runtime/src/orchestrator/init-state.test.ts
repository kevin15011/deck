import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { readOpenSpecInitState } from "./init-state";

describe("init-state", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory for tests
    tempDir = mkdtempSync(tmpdir() + "/" + "init-state-test-");
  });

  afterAll(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("missing config file → initialized: false", () => {
    const result = readOpenSpecInitState(tempDir);
    expect(result.initialized).toBe(false);
    expect(result.parseError).toBeUndefined();
  });

  test("malformed YAML → initialized: false, parseError present", () => {
    // Write malformed YAML
    const configPath = tempDir + "/openspec/config.yaml";
    mkdirSync(tempDir + "/openspec", { recursive: true });
    writeFileSync(configPath, "this is not valid yaml:\n  - broken: syntax\n    [}", "utf-8");

    const result = readOpenSpecInitState(tempDir);
    expect(result.initialized).toBe(false);
    expect(result.parseError).toBeDefined();
    expect(result.parseError!.length).toBeGreaterThan(0);
  });

  test("initialized: false → initialized: false (no parseError)", () => {
    const configPath = tempDir + "/openspec/config.yaml";
    
    // Create minimal config.yaml with initialized: false
    mkdirSync(tempDir + "/openspec", { recursive: true });
    writeFileSync(configPath, "schema: spec-driven\n\ninitialized: false\n", "utf-8");

    const result = readOpenSpecInitState(tempDir);
    expect(result.initialized).toBe(false);
    expect(result.parseError).toBeUndefined();
  });

  test("initialized: true → all fields present", () => {
    const configPath = tempDir + "/openspec/config.yaml";
    
    // Create full config.yaml
    mkdirSync(tempDir + "/openspec", { recursive: true });
    writeFileSync(
      configPath,
      `schema: spec-driven

initialized: true
last_index: v1.0.0
index_mode: full
context: |
  Test context for initialized project
  Tech stack: TypeScript, Bun`,
      "utf-8"
    );

    const result = readOpenSpecInitState(tempDir);
    expect(result.initialized).toBe(true);
    expect(result.last_index).toBe("v1.0.0");
    expect(result.index_mode).toBe("full");
    expect(result.context).toContain("Test context");
    expect(result.context).toContain("Tech stack: TypeScript");
    expect(result.parseError).toBeUndefined();
  });

  test("real project config (openspec/config.yaml)", () => {
    // This tests against the actual openspec/config.yaml in the deck project
    const result = readOpenSpecInitState("/home/kevinlb/deck");

    // Real config has initialized: true (deck project has been initialized)
    expect(result.initialized).toBe(true);
    expect(result.parseError).toBeUndefined();
  });
});