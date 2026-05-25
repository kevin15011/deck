/**
 * Binary smoke tests for compiled deck binary.
 *
 * Verifies the compiled binary works correctly across all supported commands.
 * These tests run using bun to emulate the compiled binary behavior.
 */

import { describe, expect, test } from "bun:test";
import { getBuildInfo } from "../runtime/build-info";
import { spawnSync as bunSpawnSync } from "bun";

/**
 * Run deck CLI as a subprocess and capture output.
 * This mirrors what a compiled binary would do.
 */
function runDeckCommand(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = bunSpawnSync(["bun", "run", "apps/cli/src/main.tsx", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

describe("Binary smoke tests", () => {
  test("--version outputs version/commit/date/platform", () => {
    const result = runDeckCommand(["--version"]);
    
    expect(result.code).toBe(0);
    
    // Verify output contains expected fields
    const output = result.stdout;
    expect(output).toContain("deck ");
    expect(output).toContain("commit:");
    expect(output).toContain("date:");
    expect(output).toContain("target:");
    expect(output).toContain("channel:");
  });

  test("--doctor runs and reports diagnostics", () => {
    const result = runDeckCommand(["doctor"]);
    
    // Doctor may exit 0 (all good) or 1 (issues found)
    expect([0, 1]).toContain(result.code);
    
    // Should have some output
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });

  test("TUI (no args) launches with fallback output", () => {
    // Running without TTY should fallback to string render
    const result = runDeckCommand([]);
    
    // Exit code 0 means fallback worked
    expect(result.code).toBe(0);
    
    // Should have output from screen frame render
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("--upgrade handles network gracefully", () => {
    const result = runDeckCommand(["upgrade"]);
    
    // Acceptable: 0 (up to date), 1 (network error handled)
    expect([0, 1]).toContain(result.code);
    
    // Should have some output
    const hasOutput = result.stdout.length > 0 || result.stderr.length > 0;
    expect(hasOutput).toBe(true);
  });
});

describe("Platform binary attributes", () => {
  test("build-info target matches host platform", () => {
    const info = getBuildInfo();
    
    // Target format: os-arch
    expect(info.target).toContain(process.platform);
    expect(info.target).toMatch(/x64|arm64|x86_64|aarch64/);
  });

  test("version is semver format", () => {
    const info = getBuildInfo();
    
    // Dev versions: 0.0.0-dev, production: x.y.z
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});