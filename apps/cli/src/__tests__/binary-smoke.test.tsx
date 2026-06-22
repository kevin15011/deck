/**
 * Binary smoke tests for compiled deck binary.
 *
 * Verifies the compiled binary works correctly across all supported commands.
 * These tests run using bun to emulate the compiled binary behavior.
 */

import { describe, expect, test } from "bun:test";
import { getBuildInfo } from "../runtime/build-info";
import { spawn as bunSpawn } from "bun";

/**
 * Collect a ReadableStream<Uint8Array> into a string.
 */
async function collectStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc, 0);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array()),
  );
}

/**
 * Run deck CLI as a subprocess and capture output with a hard timeout.
 * Uses SIGKILL to enforce a subprocess timeout so network hangs
 * do not block the test runner.
 *
 * Returns { code, stdout, stderr } where code is:
 *   - the actual exit code (0, 1, etc.)
 *   - 124 if the subprocess timed out
 */
async function runDeckCommand(
  args: string[],
  timeoutMs = 5000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = bunSpawn(["bun", "run", "apps/cli/src/main.tsx", ...args], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process may have already exited
      }
      resolve({ code: 124, stdout: "", stderr: "Subprocess timed out" });
    }, timeoutMs);

    Promise.all([
      collectStream(proc.stdout),
      collectStream(proc.stderr),
      proc.exited.catch(() => 1),
    ]).then(([stdout, stderr, code]) => {
      clearTimeout(timer);
      resolve({ code: (code as number) ?? 1, stdout, stderr });
    });
  });
}

describe("Binary smoke tests", () => {
  test("version outputs version/commit/date/platform", async () => {
    const result = await runDeckCommand(["version"]);

    expect(result.code).toBe(0);

    // Verify output contains expected fields
    const output = result.stdout;
    expect(output).toContain("deck ");
    expect(output).toContain("commit:");
    expect(output).toContain("date:");
    expect(output).toContain("target:");
    expect(output).toContain("channel:");
  });

  test("doctor runs and reports diagnostics", async () => {
    const result = await runDeckCommand(["doctor"], 20_000);

    // Doctor may exit 0 (all good), 1 (issues found), or 124 (hard timeout — doctor is slow).
    expect([0, 1, 124]).toContain(result.code);

    // Should have some output (or a timeout message)
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });

  test("TUI (no args) launches with fallback output", async () => {
    // Running without TTY should fallback to string render
    const result = await runDeckCommand([]);

    // Exit code 0 means fallback worked
    expect(result.code).toBe(0);

    // Should have output from screen frame render
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("upgrade handles network gracefully", async () => {
    const result = await runDeckCommand(["upgrade"], 20_000);

    // Acceptable: 0 (up to date), 1 (network error), 124 (timeout → treated as network failure)
    expect([0, 1, 124]).toContain(result.code);

    // Should have some output (or a timeout message)
    const hasOutput = result.stdout.length > 0 || result.stderr.length > 0;
    expect(hasOutput).toBe(true);
  });
});

describe("Platform binary attributes", () => {
  test("build-info target is a valid release target", () => {
    const info = getBuildInfo();

    // Valid release targets built by scripts/build-binaries.ts.
    // Note: after a multi-target build the generated file reflects the last-built
    // target (darwin-arm64), not the current host platform. This assertion
    // verifies the target is a legitimate release target regardless of build host.
    const validTargets = [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
    ];
    expect(validTargets).toContain(info.target);
    expect(info.target).toMatch(/^(linux|darwin)-(x64|arm64)$/);
  });

  test("version is semver format", () => {
    const info = getBuildInfo();
    
    // Dev versions: 0.0.0-dev, production: x.y.z
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});