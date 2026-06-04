/**
 * Tests for doctor-presentation.ts formatter.
 *
 * Tests the shared presentation model that both CLI and TUI consume.
 */

import { describe, expect, test } from "bun:test";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";
import {
  formatDoctorResult,
  formatExecutiveSummary,
  getSemanticToken,
  formatTruncatedItems,
  type SemanticToken,
} from "../doctor-command/doctor-presentation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fabCategory(name: string, status: "ok" | "warning" | "error", items: Array<{ status: "ok" | "warning" | "error"; message: string }>) {
  return {
    category: name,
    status,
    items: items.map((i) => ({ ...i, suggestion: i.status !== "ok" ? "Fix this" : undefined })),
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

// ---------------------------------------------------------------------------
// Tests: formatDoctorResult
// ---------------------------------------------------------------------------

describe("formatDoctorResult", () => {
  test("produces ordered sections", () => {
    const result = fabResult({
      deck: [fabCategory("Manifest", "ok", [{ status: "ok", message: "ok" }])],
      runtimes: [],
      memory: [fabCategory("Memory", "ok", [{ status: "ok", message: "ok" }])],
      mcp: [],
      binaryCheck: [fabCategory("Binaries", "ok", [{ status: "ok", message: "ok" }])],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);

    expect(presentation.sections).toBeDefined();
    // Should have deck sections
    const deckSections = presentation.sections.filter(s => s.category === "Manifest");
    expect(deckSections.length).toBeGreaterThan(0);
  });

  test("includes summary with hasCriticalErrors", () => {
    const result = fabResult({
      hasCriticalErrors: true,
      deck: [fabCategory("Manifest", "error", [{ status: "error", message: "err" }])],
      runtimes: [],
      memory: [],
      mcp: [],
      binaryCheck: [],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);

    // Should preserve hasCriticalErrors
    expect(presentation.hasCriticalErrors).toBe(true);
    expect(presentation.summary).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: formatExecutiveSummary
// ---------------------------------------------------------------------------

describe("formatExecutiveSummary", () => {
  test("shows all ok affirmative text", () => {
    const result = fabResult({
      hasCriticalErrors: false,
      deck: [fabCategory("Manifest", "ok", [{ status: "ok", message: "ok" }])],
      runtimes: [],
      memory: [],
      mcp: [],
      binaryCheck: [],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);
    const summary = formatExecutiveSummary(presentation);

    expect(summary).toContain("All");
    expect(summary).toContain("passed");
  });

  test("shows error count when hasCriticalErrors is true", () => {
    const result = fabResult({
      hasCriticalErrors: true,
      deck: [fabCategory("Manifest", "error", [{ status: "error", message: "err" }])],
      runtimes: [],
      memory: [],
      mcp: [],
      binaryCheck: [],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);
    const summary = formatExecutiveSummary(presentation);

    expect(summary).toContain("error");
  });

  test("shows counts by severity", () => {
    const result = fabResult({
      hasCriticalErrors: false,
      deck: [
        fabCategory("Manifest", "ok", [
          { status: "ok", message: "ok" },
          { status: "warning", message: "warn" },
          { status: "error", message: "err" },
        ]),
      ],
      runtimes: [],
      memory: [],
      mcp: [],
      binaryCheck: [],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);
    const summary = formatExecutiveSummary(presentation);

    // Should show counts
    expect(summary).toMatch(/\d+/); // At least one number
  });
});

// ---------------------------------------------------------------------------
// Tests: getSemanticToken
// ---------------------------------------------------------------------------

describe("getSemanticToken", () => {
  test("returns correct token for ok status", () => {
    const token = getSemanticToken("ok");
    expect(token.status).toBe("ok");
    expect(token.icon).toBe("✓");
    expect(token.label).toBe("OK");
  });

  test("returns correct token for warning status", () => {
    const token = getSemanticToken("warning");
    expect(token.status).toBe("warning");
    expect(token.icon).toBe("⚠");
    expect(token.label).toBe("Warning");
  });

  test("returns correct token for error status", () => {
    const token = getSemanticToken("error");
    expect(token.status).toBe("error");
    expect(token.icon).toBe("✗");
    expect(token.label).toBe("Error");
  });
});

// ---------------------------------------------------------------------------
// Tests: formatTruncatedItems
// ---------------------------------------------------------------------------

describe("formatTruncatedItems", () => {
  test("returns all items when under limit", () => {
    const items = [{ message: "a" }, { message: "b" }, { message: "c" }];
    const result = formatTruncatedItems(items, 10);

    expect(result.truncated).toBe(false);
    expect(result.items).toEqual(items);
    expect(result.remaining).toBe(0);
  });

  test("truncates when over limit", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ message: `item${i}` }));
    const result = formatTruncatedItems(items, 10);

    expect(result.truncated).toBe(true);
    expect(result.items.length).toBe(10);
    expect(result.remaining).toBe(5);
  });

  test("shows correct residual count (M6 fix)", () => {
    // For 50 items with limit 10: should show 10 and residual 40
    const items = Array.from({ length: 50 }, (_, i) => ({ message: `item${i}` }));
    const result = formatTruncatedItems(items, 10);

    // The displayed items = 10, remaining = 40 (not 50-3 or other math)
    expect(result.items.length).toBe(10);
    expect(result.remaining).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Tests: mixed severity formatting
// ---------------------------------------------------------------------------

describe("mixed severity formatting", () => {
  test("prioritizes error over warning and ok", () => {
    const result = fabResult({
      deck: [
        fabCategory("Manifest", "ok", [{ status: "ok", message: "ok" }]),
        fabCategory("State", "warning", [{ status: "warning", message: "warn" }]),
        {
          category: "Drift",
          status: "error",
          items: [{ status: "error", message: "err", suggestion: "fix" }],
        },
      ],
      runtimes: [],
      memory: [],
      mcp: [],
      binaryCheck: [],
      runnerConfig: [],
    });

    const presentation = formatDoctorResult(result);

    // Error category should dominate
    const errorSection = presentation.sections.find(s => s.category === "Drift");
    expect(errorSection?.status).toBe("error");
  });
});
