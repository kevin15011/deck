import { describe, expect, test } from "bun:test";

import {
  ALL_PI_RUNNER_CAPABILITY_IDS,
  INTERNAL_CAPABILITY_ENTRIES,
  PI_RUNNER_CAPABILITY_CATALOG,
  PI_RUNNER_CAPABILITY_IDS,
  getPiRunnerCapability,
  getUserFacingCapability,
  resolveToCanonicalCapabilityId,
  validatePiCapabilityMapping,
} from "./capability-catalog";

describe("PI_RUNNER_CAPABILITY_CATALOG", () => {
  test("contains only user-facing capability entries — excludes runner-mermaid (internal)", () => {
    // REQ-DASH-001: runner-mermaid must not appear as a user-facing capability
    // Only codebase-memory-mcp (not codebase-memory) is exposed in Pi TUI for OpenCode parity
    expect([...PI_RUNNER_CAPABILITY_IDS].sort()).toEqual([
      "codebase-memory-mcp",
      "context-mode",
      "context7",
      "pi-hud",
      "rtk",
      "serena",
    ]);

    const serialized = JSON.stringify(PI_RUNNER_CAPABILITY_CATALOG);
    expect(serialized).not.toContain("runner-mermaid");
    expect(serialized).not.toContain("@juicesharp/rpiv-todo");
    expect(serialized).not.toContain("@juicesharp/rpiv-ask-user-question");
    expect(serialized).not.toContain("engram-memory");
    // Note: context7 now uses standard @upstash/context7-mcp which is correct per REQ-MCP-001
  });

  test("uses standard @upstash/context7-mcp for context7 capability", () => {
    // REQ-MCP-001: Context7 should use standard package
    const context7 = PI_RUNNER_CAPABILITY_CATALOG["context7"];
    expect(context7.source).toContain("@upstash/context7-mcp");
    expect(context7.installKind).toBe("npm-package-plus-mcp");
  });
});

describe("INTERNAL_CAPABILITY_ENTRIES", () => {
  test("contains runner-mermaid as internal only", () => {
    expect(Object.keys(INTERNAL_CAPABILITY_ENTRIES)).toEqual(["runner-mermaid"]);

    const mermaid = INTERNAL_CAPABILITY_ENTRIES["runner-mermaid"];
    expect(mermaid.isInternal).toBe(true);
    expect(mermaid.requirementLevel).toBe("required");
    expect(mermaid.runnerScope).toBe("all");
    expect(mermaid.implementations?.pi?.id).toBe("pi-mermaid");
    expect(mermaid.implementations?.pi?.source).toBe("npm:pi-mermaid");
  });

  test("runner-mermaid is excluded from user-facing capability IDs", () => {
    expect(PI_RUNNER_CAPABILITY_IDS).not.toContain("runner-mermaid");
    // runner-mermaid is in INTERNAL_CAPABILITY_ENTRIES, not PI_RUNNER_CAPABILITY_CATALOG
    expect((INTERNAL_CAPABILITY_ENTRIES["runner-mermaid"] as { isInternal?: boolean }).isInternal).toBe(true);
  });
});

describe("ALL_PI_RUNNER_CAPABILITY_IDS", () => {
  test("includes both user-facing and internal capability IDs", () => {
    // Only codebase-memory-mcp is exposed (not codebase-memory) for OpenCode parity
    expect([...ALL_PI_RUNNER_CAPABILITY_IDS].sort()).toEqual([
      "codebase-memory-mcp",
      "context-mode",
      "context7",
      "pi-hud",
      "rtk",
      "runner-mermaid",
      "serena",
    ]);
  });
});

describe("getPiRunnerCapability", () => {
  test("returns capability entry for known IDs including internal", () => {
    const contextMode = getPiRunnerCapability("context-mode");
    expect(contextMode?.capabilityId).toBe("context-mode");

    const mermaid = getPiRunnerCapability("runner-mermaid");
    expect(mermaid?.capabilityId).toBe("runner-mermaid");
    expect((mermaid as { isInternal?: boolean }).isInternal).toBe(true);
  });

  test("returns undefined for unknown capability IDs", () => {
    expect(getPiRunnerCapability("unknown-capability" as CapabilityId)).toBeUndefined();
  });
});

describe("getUserFacingCapability", () => {
  test("returns user-facing entry for known user-facing IDs", () => {
    const contextMode = getUserFacingCapability("context-mode");
    expect(contextMode?.capabilityId).toBe("context-mode");
    expect(contextMode?.isInternal).toBeUndefined();
  });

  test("returns undefined for internal IDs (runner-mermaid)", () => {
    const mermaid = getUserFacingCapability("runner-mermaid");
    expect(mermaid).toBeUndefined();
  });

  test("returns undefined for unknown IDs", () => {
    expect(getUserFacingCapability("unknown" as CapabilityId)).toBeUndefined();
  });
});

describe("PI_RUNNER_CAPABILITY_CATALOG structural regressions", () => {
  test("all user-facing entries expose structural capability metadata", () => {
    for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
      const entry = PI_RUNNER_CAPABILITY_CATALOG[capabilityId];
      expect(entry.capabilityId).toBe(capabilityId);
      expect(entry.section).toMatch(/runner-(capabilities|ui-visual-helpers)/);
      expect(entry.runnerScope).toMatch(/^(all|pi|opencode)$/);
      // Updated to include new install kinds for Batch C
      expect(entry.installKind).toMatch(/^(pi-package|external|pending|python-tool|shared-binary-plus-mcp|shared-binary|npm-package-plus-mcp|manual-verified)$/);
      expect(entry.detector).toBeTruthy();
    }

    // Updated for Batch C: context-mode uses shared binary + MCP
    expect(PI_RUNNER_CAPABILITY_CATALOG["context-mode"]).toEqual(
      expect.objectContaining({ capabilityId: "context-mode", toolId: "context-mode" }),
    );
    // Updated for Batch C: rtk uses shared binary
    expect(PI_RUNNER_CAPABILITY_CATALOG.rtk).toEqual(
      expect.objectContaining({ capabilityId: "rtk", toolId: "rtk", installKind: "shared-binary" }),
    );
  });

  test("pi-hud remains optional Pi-only pending helper", () => {
    const piHud = PI_RUNNER_CAPABILITY_CATALOG["pi-hud"];

    expect(piHud.runnerScope).toBe("pi");
    expect(piHud.requirementLevel).toBe("optional");
    expect(piHud.installKind).toBe("pending");
    expect(piHud.source).toBe("TBD");
  });
});

// Type for test helper
type CapabilityId = "rtk" | "context-mode" | "codebase-memory-mcp" | "serena" | "context7" | "pi-hud" | "runner-mermaid";

// ---------------------------------------------------------------------------
// Tests for canonical capability resolution (Batch C)
// ---------------------------------------------------------------------------

describe("canonical capability resolution", () => {
  test("resolveToCanonicalCapabilityId returns canonical ID for known capabilities", () => {
    // Test that capabilities resolve to their canonical registry IDs
    // Only codebase-memory-mcp is exposed in Pi TUI (not codebase-memory) for OpenCode parity
    expect(resolveToCanonicalCapabilityId("context-mode")).toBe("context-mode");
    expect(resolveToCanonicalCapabilityId("codebase-memory-mcp")).toBe("codebase-memory-mcp");
    expect(resolveToCanonicalCapabilityId("rtk")).toBe("rtk");
    expect(resolveToCanonicalCapabilityId("serena")).toBe("serena");
    expect(resolveToCanonicalCapabilityId("context7")).toBe("context7");
  });

  test("validatePiCapabilityMapping returns true for all Pi capabilities", () => {
    // All new capabilities should have valid mappings to the registry
    for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
      expect(validatePiCapabilityMapping(capabilityId)).toBe(true);
    }

    // Internal capabilities should also validate
    expect(validatePiCapabilityMapping("runner-mermaid")).toBe(true);
    expect(validatePiCapabilityMapping("pi-hud")).toBe(true);
  });
});