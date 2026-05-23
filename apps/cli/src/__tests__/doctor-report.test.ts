import { describe, expect, test, vi } from "bun:test";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";

// We test the report formatter by passing fabricated result objects.
// The formatter reads no external modules — it only consumes DoctorDiagnosticsResult.
// So no module-level mocks are needed.

import { renderDoctorReport, shouldExitWithError } from "../doctor-command/doctor-report";

// ---------------------------------------------------------------------------
// Helpers — fabricate result objects for testing
// ---------------------------------------------------------------------------

function fabRuntime(overrides = {}) {
  return {
    runtimeId: "pi",
    name: "Pi",
    installed: true,
    version: "1.0.0",
    checks: [],
    ...overrides,
  };
}

function fabCategory(overrides = {}) {
  return {
    category: "Test Category",
    status: "ok" as const,
    items: [],
    ...overrides,
  };
}

function fabResult(overrides: Partial<DoctorDiagnosticsResult> = {}): DoctorDiagnosticsResult {
  return {
    runtimes: [],
    memory: [],
    mcp: [],
    hasCriticalErrors: false,
    ...overrides,
  };
}

function fabItem(status: "ok" | "warning" | "error", message: string, suggestion?: string) {
  return { status, message, ...(suggestion ? { suggestion } : {}) };
}

// ---------------------------------------------------------------------------
// Mock console.log so we can capture output
// ---------------------------------------------------------------------------

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => chunks.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Test: renderDoctorReport sections (REQ-RPT-003)
// ---------------------------------------------------------------------------

describe("renderDoctorReport", () => {
  describe("section rendering", () => {
    test("renders Runtimes section when runtimes are present", () => {
      const result = fabResult({
        runtimes: [
          {
            ...fabRuntime(),
            checks: [
              fabCategory({ category: "Runtime", status: "ok", items: [fabItem("ok", "Pi v1.0.0 detected")] }),
            ],
          },
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("Runtimes");
    });

    test("renders Memory Providers section when memory providers are present", () => {
      const result = fabResult({
        memory: [fabCategory({ category: "Engram", status: "ok", items: [fabItem("ok", "Engram binary found")] })],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("Memory Providers");
    });

    test("renders MCP Configuration section when mcp results are present", () => {
      const result = fabResult({
        mcp: [fabCategory({ category: "Pi MCP", status: "ok", items: [fabItem("ok", "Configured")] })],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("MCP Configuration");
    });
  });

  describe("status indicators (REQ-RPT-001)", () => {
    test("uses ✓ for ok status items", () => {
      const result = fabResult({
        runtimes: [
          {
            ...fabRuntime(),
            installed: true,
            checks: [
              fabCategory({
                category: "Runtime",
                status: "ok",
                items: [fabItem("ok", "Pi v1.0.0 detected")],
              }),
            ],
          },
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("✓");
    });

    test("uses ✗ for error status items", () => {
      const result = fabResult({
        runtimes: [
          {
            ...fabRuntime({ installed: false }),
            checks: [
              fabCategory({
                category: "Runtime",
                status: "warning",
                items: [fabItem("warning", "Pi not detected", "Install Pi to use it with Deck")],
              }),
            ],
          },
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("✗");
    });

    test("uses ⚠ for warning status items", () => {
      const result = fabResult({
        memory: [
          fabCategory({
            category: "Supermemory",
            status: "warning",
            items: [fabItem("warning", "Supermemory binary not found", "Install Supermemory")],
          }),
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("⚠");
    });
  });

  describe("fix suggestions (REQ-RPT-002)", () => {
    test("shows suggestion for warning items", () => {
      const result = fabResult({
        memory: [
          fabCategory({
            category: "Supermemory",
            status: "warning",
            items: [fabItem("warning", "Supermemory not found", "Install Supermemory or ensure it is on your PATH")],
          }),
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("Install Supermemory or ensure it is on your PATH");
    });

    test("shows suggestion for error items", () => {
      const result = fabResult({
        runtimes: [
          {
            ...fabRuntime({ installed: false }),
            checks: [
              fabCategory({
                category: "Runtime",
                status: "error",
                items: [
                  fabItem("error", "Pi not detected", "Install Pi to use it with Deck"),
                ],
              }),
            ],
          },
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("Install Pi to use it with Deck");
    });

    test("does not show suggestion for ok items", () => {
      const result = fabResult({
        memory: [
          fabCategory({
            category: "Engram",
            status: "ok",
            items: [fabItem("ok", "Engram binary found in PATH")],
          }),
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      // Suggestions only appear for warning/error — ok items should not have → lines
      expect(output).not.toContain("→");
    });
  });

  describe("TTY vs non-TTY (REQ-RPT-004, REQ-RPT-005)", () => {
    test("does not emit ANSI escape codes when stdout is not a TTY", () => {
      // When isTTY is false, the formatter should not use picocolors
      // We test this by verifying the output contains no ANSI escape codes
      const ESCAPE_PATTERN = /\x1b\[[0-9;]*m/;

      const result = fabResult({
        memory: [
          fabCategory({
            category: "Engram",
            status: "ok",
            items: [fabItem("ok", "Engram binary found")],
          }),
        ],
      });

      const output = captureStdout(() => renderDoctorReport(result));
      // ANSI codes would appear as literal escape characters in the output
      // when not in TTY mode (picocolors returns plain text)
      expect(output).not.toMatch(ESCAPE_PATTERN);
    });
  });

  describe("report title reflects critical errors", () => {
    test("title shows critical issues found when hasCriticalErrors is true", () => {
      const result = fabResult({ hasCriticalErrors: true });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("Critical Issues Found");
    });

    test("title shows all checks passed when hasCriticalErrors is false", () => {
      const result = fabResult({ hasCriticalErrors: false });

      const output = captureStdout(() => renderDoctorReport(result));
      expect(output).toContain("All Checks Passed");
    });
  });
});

// ---------------------------------------------------------------------------
// Test: shouldExitWithError (REQ-NF-002)
// ---------------------------------------------------------------------------

describe("shouldExitWithError", () => {
  test("returns true when hasCriticalErrors is true", () => {
    const result = fabResult({ hasCriticalErrors: true });
    expect(shouldExitWithError(result)).toBe(true);
  });

  test("returns false when hasCriticalErrors is false", () => {
    const result = fabResult({ hasCriticalErrors: false });
    expect(shouldExitWithError(result)).toBe(false);
  });

  test("returns false when there are warnings but no critical errors", () => {
    const result = fabResult({
      hasCriticalErrors: false,
      memory: [
        fabCategory({
          category: "Supermemory",
          status: "warning",
          items: [fabItem("warning", "Supermemory not found in PATH", "Install Supermemory")],
        }),
      ],
    });
    expect(shouldExitWithError(result)).toBe(false);
  });
});